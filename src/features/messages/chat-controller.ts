import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { errorMessage, toApiError } from '@/lib/errors'
import { qk } from '@/lib/query-keys'
import { openConversationStream, type OpenedStream } from '@/lib/streaming'
import { uuid } from '@/lib/utils'
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
      TIMING.deadlineMs,
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
  const store = useChatStore.getState()
  if (messageId && result.final?.citations?.length) store.setCitations(messageId, result.final.citations)
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
  onTriggerError: (message: string) => void
}

async function runTurn({ qc, cid, trigger, replaces, onTriggerError }: RunArgs) {
  const abort = new AbortController()
  const entry: { abort: AbortController; stream?: OpenedStream } = { abort }
  active.set(cid, entry)
  const { patch } = useChatStore.getState()

  patch(cid, (r) => ({
    ...r,
    assistant: { messageId: null, text: '', phase: 'connecting', replaces },
  }))

  try {
    let ack: ApiMessage
    try {
      ack = await trigger(abort.signal)
    } catch (e) {
      onTriggerError(errorMessage(e))
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

    const outcome = await waitForOutcome(cid, assistantId, assembler, entry)
    if (abort.signal.aborted) return
    await settle(qc, cid, assistantId, outcome)
  } finally {
    if (active.get(cid) === entry) active.delete(cid)
  }
}

export interface SendOptions {
  /** Response mode id. undefined/null = not chosen for this message: the user's saved default
   * applies (or Auto). 'auto' = explicitly Auto. */
  mode?: string | null
  retryOf?: { idempotencyKey: string; tempId: string }
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
      idempotencyKey,
      messageId: null,
      status: 'sending',
      createdAt: Date.now(),
    },
  }))
  void runTurn({
    qc,
    cid,
    trigger: (signal) =>
      messageService.send(
        cid,
        {
          content,
          file_ids: fileIds.length ? fileIds : undefined,
          selected_tools: toolIds,
          mode: mode ?? undefined,
          include_diagrams: useUiStore.getState().includeDiagrams || undefined,
        },
        idempotencyKey,
        signal,
      ),
    onTriggerError: (message) =>
      useChatStore.getState().patch(cid, (r) => ({
        ...r,
        pendingUser: r.pendingUser ? { ...r.pendingUser, status: 'failed', error: message } : null,
      })),
  })
  return true
}

export function retryPending(qc: QueryClient, cid: string): boolean {
  const p = useChatStore.getState().runs[cid]?.pendingUser
  if (!p || p.status !== 'failed') return false
  return sendMessage(qc, cid, p.content, p.fileIds, p.toolIds, {
    mode: p.mode ?? null,
    retryOf: { idempotencyKey: p.idempotencyKey, tempId: p.tempId },
  })
}

export function dismissPending(cid: string) {
  useChatStore.getState().patch(cid, (r) => ({ ...r, pendingUser: null }))
}

export function regenerate(qc: QueryClient, cid: string, assistantMessageId: string): boolean {
  if (active.has(cid) || isBusy(useChatStore.getState().runs[cid])) return false
  void runTurn({
    qc,
    cid,
    replaces: assistantMessageId,
    trigger: () => messageService.regenerate(cid, assistantMessageId),
    onTriggerError: (message) =>
      useChatStore.getState().patch(cid, (r) => ({
        ...r,
        assistant: { messageId: assistantMessageId, text: '', phase: 'failed', error: message },
      })),
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
