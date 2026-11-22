import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { errorMessage, toApiError } from '@/lib/errors'
import { qk } from '@/lib/query-keys'
import { openConversationStream, type OpenedStream } from '@/lib/streaming'
import { uuid } from '@/lib/utils'
import { invalidateBilling } from '@/features/billing/hooks'
import { modelForRequest, useLastRequestedModel } from '@/features/billing/model-selection'
import { reportBillingError, useBillingNoticeStore } from '@/stores/billing-notice.store'
import { useDraftStore } from '@/stores/draft.store'
import { currentThink } from '@/features/think/think'
import { editService } from '@/services/quickwins.service'
import { messageService } from '@/services/message.service'
import { isBusy, useChatStore } from '@/stores/chat.store'
import { useUiStore } from '@/stores/ui.store'
import type { ApiMessage, Page, StreamEvent } from '@/types/api'

/**
 * Orchestrates one chat turn outside React so streams survive navigation between
 * conversations. Flow (matches the gateway/conversation-service contract):
 *
 *   1. POST the message (202) -> `response_message_id` identifies the assistant reply
 *   2. open GET /stream/{cid}?message_id=<assistant id>&since=<cursor>. The server replays the
 *      retained events of that turn after the cursor and then follows live, so events published
 *      before the connection existed are NOT lost (no subscription race).
 *   3. render `chat.response.chunk` events ordered by `sequence_number`, deduplicated
 *   4. the final event (`is_final`) carries `full_content` + `citations` and replaces the buffer
 *   5. if the stream drops it reconnects from the last `event_id` (bounded backoff)
 *   6. independently, persisted history is checked every few seconds: if the assistant row has
 *      left `pending`, the turn finishes from persisted state (covers a lost stream, a
 *      replay log that is unavailable, or an older backend without replay)
 *   7. refetch history and drop the local overlay only once persisted data is available
 */

/**
 * Timing knobs (mutable only so tests can shrink them). `deadlineMs`: conversation-service fails
 * un-answered turns after 120 s, so wait a little longer than that before giving up.
 */
export const TIMING = {
  deadlineMs: 150_000,
  /** A think-longer turn: the server waits 300 s before failing it, so wait a little longer than that. */
  thinkDeadlineMs: 330_000,
  reconcileMs: 5_000,
  reconnectBaseMs: 300,
  reconnectMaxMs: 3_000,
}

/** Text the backend uses when its own watchdog fails a turn (a real reply may still arrive later). */
export const TIMEOUT_TEXT = 'Generation timed out'

const active = new Map<string, { abort: AbortController; stream?: OpenedStream }>()

export const isRunning = (cid: string) => active.has(cid)

interface Outcome {
  text: string
  failed: boolean
  error?: string
  final?: StreamEvent | null
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        resolve()
      },
      { once: true },
    )
  })

export class TurnAssembler {
  private chunks = new Map<number, string>()
  private arrival = 0
  private finalEvent: StreamEvent | null = null
  /** Highest `event_id` seen: the resume cursor for reconnects. */
  lastEventId: string | null = null
  private resolveDone!: () => void
  readonly done = new Promise<void>((r) => (this.resolveDone = r))

  constructor(
    private cid: string,
    private messageId: string,
    private onText: (text: string) => void,
  ) {}

  push(e: StreamEvent) {
    if (e.message_id !== this.messageId || e.conversation_id !== this.cid) return
    if (e.event_id && (!this.lastEventId || cmpEventId(e.event_id, this.lastEventId) > 0))
      this.lastEventId = e.event_id
    if (e.is_final) {
      // A completed reply always wins over an earlier failure (timeout watchdog) and vice versa
      // is ignored: once completed, nothing replaces it.
      if (this.finalEvent?.status === 'completed') return
      if (this.finalEvent && e.status !== 'completed') return
      this.finalEvent = e
      this.resolveDone()
      return
    }
    if (this.finalEvent) return
    // Duplicate sequence numbers are ignored; missing numbers are tolerated.
    const seq = e.sequence_number ?? 1_000_000 + this.arrival++
    if (this.chunks.has(seq)) return
    this.chunks.set(seq, e.content ?? '')
    this.onText(this.text())
  }

  text() {
    return [...this.chunks.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v)
      .join('')
  }

  get final() {
    return this.finalEvent
  }
}

/** Redis Stream ids are "<ms>-<seq>". */
export function cmpEventId(a: string, b: string): number {
  const [am = 0, as = 0] = a.split('-').map(Number)
  const [bm = 0, bs = 0] = b.split('-').map(Number)
  return am !== bm ? am - bm : as - bs
}

async function fetchRow(cid: string, messageId: string, signal: AbortSignal) {
  const page = await messageService.history(cid, { limit: 20 }, signal)
  return page.items.find((x) => x.message_id === messageId) ?? null
}

/**
 * Resolves with the turn outcome from whichever source settles first: the (resumable) stream's
 * terminal event, the periodic persisted-history check, or the overall deadline.
 */
function waitForOutcome(
  cid: string,
  messageId: string,
  assembler: TurnAssembler,
  entry: { abort: AbortController; stream?: OpenedStream },
  deadlineMs: number = TIMING.deadlineMs,
): Promise<Outcome> {
  const { signal } = entry.abort
  return new Promise<Outcome>((resolve) => {
    let settled = false
    const finish = (o: Outcome) => {
      if (settled) return
      settled = true
      clearInterval(reconciler)
      clearTimeout(deadline)
      entry.stream?.close()
      resolve(o)
    }

    const fromFinal = (): Outcome => {
      const f = assembler.final!
      const failed = f.status === 'failed'
      const text = failed ? f.content || 'Generation failed.' : f.full_content || assembler.text()
      return { text, failed, error: failed ? text : undefined, final: f }
    }
    void assembler.done.then(() => finish(fromFinal()))

    // Persisted-state reconciler: independent of the stream.
    let checking = false
    const reconciler = setInterval(() => {
      if (checking || settled) return
      checking = true
      fetchRow(cid, messageId, signal)
        .then((row) => {
          if (!row || row.status === 'pending' || settled) return
          const failed = row.status === 'failed'
          finish({ text: row.content, failed, error: failed ? row.content : undefined })
        })
        .catch(() => {})
        .finally(() => {
          checking = false
        })
    }, TIMING.reconcileMs)

    const deadline = setTimeout(
      () =>
        finish({
          text: assembler.text(),
          failed: true,
          error: 'The response did not complete in time. Please try again.',
        }),
      deadlineMs,
    )

    signal.addEventListener('abort', () => finish({ text: '', failed: true, error: 'Cancelled.' }), {
      once: true,
    })

    // Stream loop: connect (replaying from the cursor), consume, reconnect with backoff.
    void (async () => {
      let attempt = 0
      while (!settled && !signal.aborted) {
        try {
          const stream = await openConversationStream(
            cid,
            {
              onEvent: (e) => assembler.push(e),
              onServerError: () => {},
              onNotice: (n) => useBillingNoticeStore.getState().showQuiet(cid, n),
            },
            signal,
            { messageId, since: assembler.lastEventId ?? '0' },
          )
          entry.stream = stream
          attempt = 0
          await stream.closed
        } catch (e) {
          const err = toApiError(e)
          if (err.kind === 'auth') {
            finish({ text: assembler.text(), failed: true, error: 'Your session expired. Please sign in again.' })
            return
          }
          if (err.kind === 'not_found' || err.kind === 'forbidden') {
            finish({ text: assembler.text(), failed: true, error: err.message })
            return
          }
        }
        if (settled || assembler.final) return
        await sleep(Math.min(TIMING.reconnectBaseMs * 2 ** attempt++, TIMING.reconnectMaxMs), signal)
      }
    })()
  })
}

async function settle(
  qc: QueryClient,
  cid: string,
  messageId: string | null,
  result: Outcome,
) {
  invalidateBilling(qc) // a completed (or refused) turn changes today's usage
  const store = useChatStore.getState()
  if (messageId && result.final?.citations?.length) store.setCitations(messageId, result.final.citations)
  if (messageId && result.final?.notice_key) store.setNotice(messageId, result.final.notice_key)
  store.patch(cid, (r) => ({
    ...r,
    pendingUser: r.pendingUser ? { ...r.pendingUser, status: 'sent' } : null,
    assistant: r.assistant
      ? { ...r.assistant, text: result.text, phase: result.failed ? 'failed' : 'completed', error: result.error }
      : r.assistant,
  }))
  // Reconcile with persisted history, then drop the overlay.
  try {
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.messages(cid) }),
      qc.invalidateQueries({ queryKey: qk.conversations }),
      qc.invalidateQueries({ queryKey: qk.conversation(cid) }),
    ])
  } finally {
    store.clearRun(cid)
  }
}

interface RunArgs {
  qc: QueryClient
  cid: string
  trigger: (signal: AbortSignal) => Promise<ApiMessage>
  replaces?: string
  /** The turn asked to think longer: longer deadline and "Thinking longer…" copy. */
  think?: boolean
  onTriggerError: (message: string, error: unknown) => void
}

async function runTurn({ qc, cid, trigger, replaces, think, onTriggerError }: RunArgs) {
  const abort = new AbortController()
  const entry: { abort: AbortController; stream?: OpenedStream } = { abort }
  active.set(cid, entry)
  const { patch } = useChatStore.getState()

  patch(cid, (r) => ({
    ...r,
    assistant: { messageId: null, text: '', phase: 'connecting', replaces, think },
  }))

  try {
    let ack: ApiMessage
    try {
      ack = await trigger(abort.signal)
    } catch (e) {
      onTriggerError(errorMessage(e), e)
      patch(cid, (r) => ({ ...r, assistant: null }))
      return
    }

    const assistantId = ack.response_message_id ?? ack.message_id
    patch(cid, (r) => ({
      ...r,
      pendingUser: r.pendingUser
        ? { ...r.pendingUser, messageId: replaces ? r.pendingUser.messageId : ack.message_id, status: 'sent' }
        : null,
      assistant: r.assistant ? { ...r.assistant, messageId: assistantId, phase: 'waiting' } : null,
    }))

    const assembler = new TurnAssembler(cid, assistantId, (text) =>
      patch(cid, (r) =>
        r.assistant ? { ...r, assistant: { ...r.assistant, text, phase: 'streaming' } } : r,
      ),
    )

    const outcome = await waitForOutcome(cid, assistantId, assembler, entry, think ? TIMING.thinkDeadlineMs : TIMING.deadlineMs)
    if (abort.signal.aborted) return
    await settle(qc, cid, assistantId, outcome)
    if (!outcome.failed) refreshSuggestions(qc, cid)
  } finally {
    if (active.get(cid) === entry) active.delete(cid)
  }
}

export interface SendOptions {
  /** Response mode id. undefined/null = not chosen for this message: the user's saved default
   * applies (or Auto). 'auto' = explicitly Auto. */
  mode?: string | null
  /** Catalog model id or 'auto'. undefined = the conversation's chosen model (if any), else the saved default. */
  model?: string
  retryOf?: { idempotencyKey: string; tempId: string }
  /** "Think longer" for this message. undefined = the composer's toggle. */
  think?: boolean
}

export function sendMessage(
  qc: QueryClient,
  cid: string,
  content: string,
  fileIds: string[] = [],
  /** undefined = not chosen (saved default tools apply); [] = explicitly no tools. */
  toolIds?: string[],
  opts: SendOptions = {},
): boolean {
  const { retryOf, mode = null } = opts
  const model = opts.model ?? modelForRequest(qc, cid)
  const think = opts.think ?? currentThink() ?? undefined
  useLastRequestedModel.getState().set(cid, model)
  if (active.has(cid) || isBusy(useChatStore.getState().runs[cid])) return false
  const idempotencyKey = retryOf?.idempotencyKey ?? uuid()
  useChatStore.getState().patch(cid, (r) => ({
    ...r,
    pendingUser: {
      tempId: retryOf?.tempId ?? uuid(),
      content,
      fileIds,
      toolIds,
      mode,
      model,
      idempotencyKey,
      messageId: null,
      status: 'sending',
      createdAt: Date.now(),
    },
  }))
  void runTurn({
    qc,
    cid,
    think,
    trigger: (signal) =>
      messageService.send(
        cid,
        {
          content,
          file_ids: fileIds.length ? fileIds : undefined,
          selected_tools: toolIds,
          mode: mode ?? undefined,
          model,
          include_diagrams: useUiStore.getState().includeDiagrams || undefined,
          think,
        },
        idempotencyKey,
        signal,
      ),
    onTriggerError: (message, error) => {
      // A billing refusal is shown as an inline notice above the composer and the text goes back into the draft.
      if (reportBillingError(cid, error)) {
        const draft = useDraftStore.getState()
        if (!draft.drafts[cid]) draft.set(cid, content)
        useChatStore.getState().patch(cid, (r) => ({ ...r, pendingUser: null }))
        return
      }
      useChatStore.getState().patch(cid, (r) => ({
        ...r,
        pendingUser: r.pendingUser ? { ...r.pendingUser, status: 'failed', error: message } : null,
      }))
    },
  })
  return true
}

/** The latest assistant row has follow-up suggestions. */
export function hasSuggestions(data: InfiniteData<Page<ApiMessage>> | undefined): boolean {
  const last = [...flattenHistory(data)].reverse().find((m) => m.sender === 'assistant')
  return !!last?.suggestions?.length
}

/** Follow-ups arrive a moment after the answer: re-read the latest page at +1.5 s and +4 s, stopping once they are there. */
export const SUGGESTION_REREADS_MS = [1500, 4000]
export function refreshSuggestions(qc: QueryClient, cid: string) {
  for (const delay of SUGGESTION_REREADS_MS) {
    setTimeout(() => {
      if (hasSuggestions(qc.getQueryData<InfiniteData<Page<ApiMessage>>>(qk.messages(cid)))) return
      void qc.invalidateQueries({ queryKey: qk.messages(cid) })
    }, delay)
  }
}

export interface EditArgs {
  /** Reused when the same click is retried, so the server replays instead of creating a second branch. */
  idempotencyKey: string
  mode?: string | null
  toolIds?: string[]
  think?: boolean
}

/**
 * Edits a sent message into a NEW sibling branch (Q1) with the composer's current mode, tools, model, think and diagram
 * setting (files omitted: the server keeps the original attachments). On 202 the lists are refreshed, `onCreated` navigates to
 * the new conversation and the answer streams through the normal turn path. Errors are thrown to the caller (409 codes such as
 * conversation_busy, plan_limit through reportBillingError).
 */
export async function editMessage(qc: QueryClient, cid: string, messageId: string, content: string, args: EditArgs, onCreated: (newCid: string) => void): Promise<string> {
  const model = modelForRequest(qc, cid)
  const think = args.think ?? currentThink()
  let res
  try {
    res = await editService.edit(
      cid,
      messageId,
      {
        content,
        mode: args.mode ?? undefined,
        selected_tools: args.toolIds,
        model,
        include_diagrams: useUiStore.getState().includeDiagrams || undefined,
        think,
      },
      args.idempotencyKey,
    )
  } catch (e) {
    reportBillingError(cid, e)
    throw e
  }
  const newCid = res.conversation.conversation_id
  useLastRequestedModel.getState().set(newCid, model)
  await Promise.all([
    qc.invalidateQueries({ queryKey: qk.conversations }),
    qc.invalidateQueries({ queryKey: qk.children(cid) }),
    qc.invalidateQueries({ queryKey: qk.messages(cid) }),
    qc.invalidateQueries({ queryKey: qk.edits(cid, messageId) }),
  ])
  onCreated(newCid)
  void runTurn({ qc, cid: newCid, think, trigger: async () => res.message, onTriggerError: () => {} })
  return newCid
}

export function retryPending(qc: QueryClient, cid: string): boolean {
  const p = useChatStore.getState().runs[cid]?.pendingUser
  if (!p || p.status !== 'failed') return false
  return sendMessage(qc, cid, p.content, p.fileIds, p.toolIds, {
    mode: p.mode ?? null,
    model: p.model,
    retryOf: { idempotencyKey: p.idempotencyKey, tempId: p.tempId },
  })
}

export function dismissPending(cid: string) {
  useChatStore.getState().patch(cid, (r) => ({ ...r, pendingUser: null }))
}

export function regenerate(qc: QueryClient, cid: string, assistantMessageId: string): boolean {
  if (active.has(cid) || isBusy(useChatStore.getState().runs[cid])) return false
  const model = modelForRequest(qc, cid)
  const think = currentThink()
  useLastRequestedModel.getState().set(cid, model)
  void runTurn({
    qc,
    cid,
    think,
    replaces: assistantMessageId,
    trigger: () => messageService.regenerate(cid, assistantMessageId, model, think),
    onTriggerError: (message, error) => {
      reportBillingError(cid, error)
      useChatStore.getState().patch(cid, (r) => ({
        ...r,
        assistant: { messageId: assistantMessageId, text: '', phase: 'failed', error: message },
      }))
    },
  })
  return true
}

/**
 * Attaches to an assistant reply that is already `pending` on the server (page reload or
 * navigating back mid-generation). The resumable stream replays the retained chunks, so the
 * partial text is restored; persisted history remains the fallback.
 */
export function watchPending(qc: QueryClient, cid: string, messageId: string): boolean {
  if (active.has(cid)) return false
  void runTurn({
    qc,
    cid,
    trigger: async () =>
      ({
        message_id: messageId,
        response_message_id: messageId,
        conversation_id: cid,
        sender: 'assistant',
        content: '',
        created_at: new Date().toISOString(),
        status: 'pending',
      }) satisfies ApiMessage,
    onTriggerError: () => {},
  })
  return true
}

export function cancelRun(cid: string) {
  const e = active.get(cid)
  if (!e) return
  e.abort.abort()
  e.stream?.close()
  active.delete(cid)
  useChatStore.getState().clearRun(cid)
}

/** Message list merge helpers --------------------------------------------------------- */

/** Flattens newest-first pages into chronological order. */
export function flattenHistory(data: InfiniteData<Page<ApiMessage>> | undefined): ApiMessage[] {
  if (!data) return []
  const all = data.pages.flatMap((p) => p.items)
  const seen = new Set<string>()
  const unique = all.filter((m) => (seen.has(m.message_id) ? false : (seen.add(m.message_id), true)))
  return unique.reverse()
}
