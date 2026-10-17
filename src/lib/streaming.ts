import { API_BASE_URL } from './config'
import { ApiError, parseErrorBody } from './errors'
import { refreshSession } from './api-client'
import { getAccessToken } from '@/stores/auth.store'
import type { StreamEvent } from '@/types/api'

const LINE_BREAK = /\r\n|\n|\r/

/**
 * Incremental Server-Sent-Events parser. Handles chunk boundaries that split lines,
 * CRLF, comments (": ok", ": heartbeat") and multi-line `data:` fields.
 */
export class SseParser {
  private buffer = ''
  private data: string[] = []
  private event = ''

  constructor(private onMessage: (data: string, event: string) => void) {}

  push(text: string) {
    this.buffer += text
    for (;;) {
      const m = LINE_BREAK.exec(this.buffer)
      if (!m) break
      // A trailing "\r" might be the first half of "\r\n"; wait for more input.
      if (m[0] === '\r' && m.index === this.buffer.length - 1) break
      const line = this.buffer.slice(0, m.index)
      this.buffer = this.buffer.slice(m.index + m[0].length)
      this.line(line)
    }
  }

  private line(line: string) {
    if (line === '') {
      if (this.data.length) this.onMessage(this.data.join('\n'), this.event || 'message')
      this.data = []
      this.event = ''
      return
    }
    if (line.startsWith(':')) return // comment / heartbeat
    const c = line.indexOf(':')
    const field = c === -1 ? line : line.slice(0, c)
    let value = c === -1 ? '' : line.slice(c + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') this.data.push(value)
    else if (field === 'event') this.event = value
  }
}

export interface StreamHandlers {
  onEvent: (e: StreamEvent) => void
  /** Server-sent `event: error` payload (e.g. cache offline). */
  onServerError?: (message: string) => void
}

export interface OpenedStream {
  /** Resolves when the stream ends (server closed after the final event, or aborted). */
  closed: Promise<void>
  close: () => void
}

/**
 * Opens GET /stream/{conversation_id} using fetch (not EventSource) so the access token
 * travels in the Authorization header instead of the URL query string.
 *
 * The returned promise resolves once the server has acknowledged the subscription (first
 * bytes, the ": ok" comment). Live pub/sub has no replay, so reliability comes from the
 * resumable mode: with `messageId` + `since` the server replays the retained events of that
 * turn after the cursor and then follows live, so a late or re-established connection does
 * not lose events. Each event carries an `event_id` to use as the next `since`.
 */
export interface ResumeOptions {
  /** Assistant response id: replay + follow only this turn, and end after its terminal event. */
  messageId?: string
  /** Resume after this event_id ("0" = everything the server still retains). */
  since?: string
}

export async function openConversationStream(
  conversationId: string,
  handlers: StreamHandlers,
  external?: AbortSignal,
  resume: ResumeOptions = {},
): Promise<OpenedStream> {
  const ctrl = new AbortController()
  if (external) {
    if (external.aborted) ctrl.abort()
    else external.addEventListener('abort', () => ctrl.abort(), { once: true })
  }
  const qs = new URLSearchParams()
  if (resume.messageId) qs.set('message_id', resume.messageId)
  if (resume.since) qs.set('since', resume.since)
  const query = qs.toString()
  const url = `${API_BASE_URL}/stream/${encodeURIComponent(conversationId)}${query ? `?${query}` : ''}`
  const connect = (token: string | null) =>
    fetch(url, {
      headers: {
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      signal: ctrl.signal,
      cache: 'no-store',
    })

  let res: Response
  try {
    res = await connect(getAccessToken())
    if (res.status === 401) {
      const fresh = await refreshSession()
      if (fresh) res = await connect(fresh)
    }
  } catch {
    throw new ApiError('network', 'Could not open the live response stream.')
  }
  if (!res.ok || !res.body) {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = undefined
    }
    throw parseErrorBody(res.status, body)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const parser = new SseParser((data, event) => {
    try {
      const parsed = JSON.parse(data)
      if (event === 'error') handlers.onServerError?.(String(parsed?.message ?? 'Stream error'))
      else handlers.onEvent(parsed as StreamEvent)
    } catch {
      // Ignore malformed frames rather than killing the stream.
    }
  })

  // Wait for the first bytes (": ok") so the subscription is live before we return.
  try {
    const first = await Promise.race([
      reader.read(),
      new Promise<null>((r) => setTimeout(() => r(null), 5000)),
    ])
    if (first?.done) throw new ApiError('network', 'The response stream closed unexpectedly.')
    if (first?.value) parser.push(decoder.decode(first.value, { stream: true }))
  } catch (e) {
    ctrl.abort()
    throw e instanceof ApiError
      ? e
      : new ApiError('network', 'Could not open the live response stream.')
  }

  const closed = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parser.push(decoder.decode(value, { stream: true }))
      }
    } catch {
      // Aborted or connection dropped: callers detect a missing final event and fall back.
    }
  })()

  return { closed, close: () => ctrl.abort() }
}
