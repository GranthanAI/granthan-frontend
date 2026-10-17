import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { errorMessage } from '@/lib/errors'
import { qk } from '@/lib/query-keys'
import { openConversationStream, type OpenedStream } from '@/lib/streaming'
import { uuid } from '@/lib/utils'
import { messageService } from '@/services/message.service'
import { isBusy, useChatStore } from '@/stores/chat.store'
import type { ApiMessage, Page, StreamEvent } from '@/types/api'

/**
 * Orchestrates one chat turn outside React so streams survive navigation between
 * conversations. Flow (matches the gateway/conversation-service contract):
 *
 *   1. open GET /stream/{cid} and wait for the subscription ack (no replay on the server)
 *   2. POST the message (202) -> `response_message_id` identifies the assistant reply
 *   3. render `chat.response.chunk` events ordered by `sequence_number`
 *   4. the final event (`is_final`) carries `full_content` + `citations` and replaces the buffer
 *   5. if the stream ends without a final event, poll history until the row leaves `pending`
 *   6. refetch history and drop the local overlay once persisted data is available
 */

const POLL_INTERVAL_MS = 2000
const POLL_MAX_MS = 150_000 // conversation-service fails un-answered turns after 120 s

const active = new Map<string, { abort: AbortController; stream?: OpenedStream }>()

export const isRunning = (cid: string) => active.has(cid)

interface TurnResult {
  text: string
  failed: boolean
  error?: string
}

class TurnAssembler {
  private chunks = new Map<number, string>()
  private arrival = 0
  private expectedId: string | null = null
  private backlog: StreamEvent[] = []
  private finalEvent: StreamEvent | null = null
  private resolveDone!: () => void
  readonly done = new Promise<void>((r) => (this.resolveDone = r))

  constructor(
    private cid: string,
    private onText: (text: string) => void,
    private onFinal: (e: StreamEvent) => void,
  ) {}

  /** Stream events may arrive before the POST acknowledgement; buffer until the id is known. */
  push(e: StreamEvent) {
    if (!this.expectedId) {
      this.backlog.push(e)
      return
    }
    this.apply(e)
  }

  setExpected(id: string) {
    this.expectedId = id
    const b = this.backlog
    this.backlog = []
    b.forEach((e) => this.apply(e))
  }

  private apply(e: StreamEvent) {
    if (e.message_id !== this.expectedId || e.conversation_id !== this.cid) return
    if (this.finalEvent) return // duplicates after completion
    if (e.is_final) {
      this.finalEvent = e
      this.onFinal(e)
      this.resolveDone()
      return
    }
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

async function pollUntilSettled(
  cid: string,
  messageId: string,
  signal: AbortSignal,
): Promise<ApiMessage | null> {
  const started = Date.now()
  while (!signal.aborted && Date.now() - started < POLL_MAX_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    try {
      const page = await messageService.history(cid, { limit: 20 }, signal)
      const m = page.items.find((x) => x.message_id === messageId)
      if (m && m.status !== 'pending') return m
    } catch {
      // transient: keep polling until the deadline
    }
  }
  return null
}

async function settle(
  qc: QueryClient,
  cid: string,
  messageId: string | null,
  result: TurnResult,
  citationsFor?: StreamEvent | null,
) {
  const store = useChatStore.getState()
  if (messageId && citationsFor?.citations?.length) store.setCitations(messageId, citationsFor.citations)
  store.patch(cid, (r) => ({
    ...r,
    pendingUser: r.pendingUser ? { ...r.pendingUser, status: 'sent' } : null,
    assistant: r.assistant
      ? {
          ...r.assistant,
          text: result.text,
          phase: result.failed ? 'failed' : 'completed',
          error: result.error,
        }
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

  const assembler = new TurnAssembler(
    cid,
    (text) =>
      patch(cid, (r) =>
        r.assistant ? { ...r, assistant: { ...r.assistant, text, phase: 'streaming' } } : r,
      ),
    () => {},
  )

  try {
    try {
      entry.stream = await openConversationStream(cid, { onEvent: (e) => assembler.push(e) }, abort.signal)
    } catch (e) {
      onTriggerError(errorMessage(e))
      patch(cid, (r) => ({ ...r, assistant: null }))
      return
    }

    let ack: ApiMessage
    try {
      ack = await trigger(abort.signal)
    } catch (e) {
      entry.stream.close()
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
    assembler.setExpected(assistantId)

    // Wait for the final event, a closed stream, or cancellation.
    await Promise.race([assembler.done, entry.stream.closed])
    entry.stream.close()

    const final = assembler.final
    if (final) {
      const failed = final.status === 'failed'
      const text = failed
        ? final.content || 'Generation failed.'
        : final.full_content || assembler.text()
      await settle(qc, cid, assistantId, { text, failed, error: failed ? text : undefined }, final)
      return
    }

    if (abort.signal.aborted) return

    // Stream ended without a final event (dropped connection): fall back to persisted state.
    const m = await pollUntilSettled(cid, assistantId, abort.signal)
    if (m) {
      const failed = m.status === 'failed'
      await settle(qc, cid, assistantId, { text: m.content, failed, error: failed ? m.content : undefined })
    } else if (!abort.signal.aborted) {
      await settle(qc, cid, assistantId, {
        text: assembler.text(),
        failed: true,
        error: 'The response did not complete. Please try again.',
      })
    }
  } finally {
    if (active.get(cid) === entry) active.delete(cid)
  }
}

export function sendMessage(
  qc: QueryClient,
  cid: string,
  content: string,
  fileIds: string[] = [],
  retryOf?: { idempotencyKey: string; tempId: string },
): boolean {
  if (active.has(cid) || isBusy(useChatStore.getState().runs[cid])) return false
  const idempotencyKey = retryOf?.idempotencyKey ?? uuid()
  useChatStore.getState().patch(cid, (r) => ({
    ...r,
    pendingUser: {
      tempId: retryOf?.tempId ?? uuid(),
      content,
      fileIds,
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
      messageService.send(cid, { content, file_ids: fileIds.length ? fileIds : undefined }, idempotencyKey, signal),
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
  return sendMessage(qc, cid, p.content, p.fileIds, { idempotencyKey: p.idempotencyKey, tempId: p.tempId })
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
 * navigating back mid-generation). Earlier chunks cannot be replayed, so this shows a
 * waiting state and uses the final event (full_content) or history polling.
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
