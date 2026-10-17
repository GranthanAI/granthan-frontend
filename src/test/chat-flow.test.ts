import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  cancelRun,
  cmpEventId,
  sendMessage,
  TIMING,
  watchPending,
} from '@/features/messages/chat-controller'
import { needsPolling } from '@/features/messages/hooks'
import { useAuthStore } from '@/stores/auth.store'
import { useChatStore } from '@/stores/chat.store'
import type { ApiMessage } from '@/types/api'

/**
 * The network is mocked at the fetch boundary (the API gateway contract), so these tests verify
 * how the frontend handles the documented protocol (resumable SSE, replay cursor, history
 * reconciliation). They do not prove backend behaviour; that is covered by the backend tests and
 * the live checks in the hand-off report.
 */

const CID = '11111111-1111-4111-8111-111111111111'
const CID2 = '99999999-9999-4999-8999-999999999999'
const A1 = '22222222-2222-4222-8222-222222222222'
const A2 = '44444444-4444-4444-8444-444444444444'
const enc = new TextEncoder()

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const ev = (cid: string, mid: string, o: object) =>
  `data: ${JSON.stringify({ conversation_id: cid, message_id: mid, sender: 'assistant', ...o })}\n\n`

const chunk = (cid: string, mid: string, seq: number, content: string) =>
  `id: 100-${seq}\n` + ev(cid, mid, { content, sequence_number: seq, is_final: false, event_id: `100-${seq}` })

const final = (cid: string, mid: string, full: string, extra: object = {}) =>
  'id: 100-99\n' +
  ev(cid, mid, { content: '', is_final: true, status: 'completed', full_content: full, event_id: '100-99', ...extra })

/** An SSE response that emits `frames` after the ": ok" ack, then closes (or stays open). */
function sse(frames: string[], opts: { holdOpen?: boolean } = {}) {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c
    },
  })
  void (async () => {
    ctrl.enqueue(enc.encode(': ok\n\n'))
    for (const f of frames) {
      await new Promise((r) => setTimeout(r, 5))
      ctrl.enqueue(enc.encode(f))
    }
    if (!opts.holdOpen) ctrl.close()
  })()
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const ack = (cid: string, assistantId: string, userId = '33333333-3333-4333-8333-333333333333') => ({
  message_id: userId,
  conversation_id: cid,
  sender: 'user',
  content: 'hello',
  created_at: '2026-01-01T00:00:00Z',
  status: 'sent',
  response_message_id: assistantId,
})

const emptyPage = { items: [], next_cursor: null, has_more: false }

async function waitFor(fn: () => boolean, ms = 3000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition')
    await new Promise((r) => setTimeout(r, 10))
  }
}

interface Routes {
  stream?: (url: URL, call: number) => Response | Promise<Response>
  post?: (cid: string) => Response
  history?: (cid: string) => Response
}

/** Installs a fetch mock; returns the recorded calls. */
function mockApi(routes: Routes) {
  const calls: string[] = []
  const streamCalls: URL[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      const path = url.pathname.replace('/api/v1', '')
      calls.push(`${init?.method ?? 'GET'} ${path}${url.search}`)
      if (path.startsWith('/stream/')) {
        streamCalls.push(url)
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
        expect(url.search).not.toContain('token=') // the token never travels in the URL
        return routes.stream!(url, streamCalls.length)
      }
      if (path === '/auth/refresh') return json(401, { detail: 'no refresh' })
      if (init?.method === 'POST' && path.endsWith('/messages'))
        return routes.post!(path.split('/')[2]!)
      if (path.endsWith('/messages')) return routes.history?.(path.split('/')[2]!) ?? json(200, emptyPage)
      return json(200, emptyPage)
    }),
  )
  return { calls, streamCalls }
}

const run = (cid: string) => useChatStore.getState().runs[cid]
const done = (cid: string) => waitFor(() => !run(cid))

describe('live response delivery', () => {
  let qc: QueryClient
  const saved = { ...TIMING }
  beforeEach(() => {
    qc = new QueryClient()
    useChatStore.setState({ runs: {}, citations: {} })
    useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null, expired: false })
    Object.assign(TIMING, { reconcileMs: 60, deadlineMs: 1500, reconnectBaseMs: 10, reconnectMaxMs: 40 })
  })
  afterEach(() => {
    cancelRun(CID)
    cancelRun(CID2)
    vi.unstubAllGlobals()
    Object.assign(TIMING, saved)
  })

  it('"hi" appears live: renders chunks incrementally, then the final text, with no reload', async () => {
    const api = mockApi({
      post: () => json(202, ack(CID, A1)),
      stream: () =>
        sse([chunk(CID, A1, 1, 'Hel'), chunk(CID, A1, 2, 'lo'), final(CID, A1, 'Hello!', {
          citations: [{ file_id: 'f', source_name: 'doc.pdf', page_number: 2, section: null }],
        })]),
    })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const seen: string[] = []
    const phases = new Set<string>()
    const unsub = useChatStore.subscribe((s) => {
      const a = s.runs[CID]?.assistant
      if (a) phases.add(a.phase)
      if (a?.text && seen[seen.length - 1] !== a.text) seen.push(a.text)
    })
    expect(sendMessage(qc, CID, 'hi')).toBe(true)
    await done(CID)
    unsub()

    expect(seen).toEqual(['Hel', 'Hello', 'Hello!']) // incremental, then replaced by full_content
    expect(phases.has('streaming')).toBe(true)
    expect(useChatStore.getState().citations[A1]?.[0]?.source_name).toBe('doc.pdf')
    // message accepted first; the stream is addressed to the assistant message and resumable
    expect(api.calls[0]).toMatch(/^POST \/conversations\/.*\/messages/)
    expect(api.streamCalls[0]!.searchParams.get('message_id')).toBe(A1)
    expect(api.streamCalls[0]!.searchParams.get('since')).toBe('0')
    // persisted history is invalidated (refetched by the mounted view) before the overlay is dropped
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['messages', CID] })
  })

  it('recovers events published before the stream connected (server replay)', async () => {
    // The whole turn happened before the browser subscribed; the server replays it on connect.
    mockApi({
      post: () => json(202, ack(CID, A1)),
      stream: () => sse([chunk(CID, A1, 1, 'Al'), chunk(CID, A1, 2, 'ready'), final(CID, A1, 'Already here')]),
    })
    let last = ''
    const unsub = useChatStore.subscribe((s) => (last = s.runs[CID]?.assistant?.text ?? last))
    sendMessage(qc, CID, 'hi')
    await done(CID)
    unsub()
    expect(last).toBe('Already here')
  })

  it('reconnects mid-response from the last event_id and does not duplicate text', async () => {
    const api = mockApi({
      post: () => json(202, ack(CID, A1)),
      stream: (_u, call) =>
        call === 1
          ? sse([chunk(CID, A1, 1, 'A'), chunk(CID, A1, 2, 'B')]) // connection drops after B
          : sse([chunk(CID, A1, 2, 'B'), chunk(CID, A1, 3, 'C'), final(CID, A1, 'ABC')]),
    })
    const texts: string[] = []
    const unsub = useChatStore.subscribe((s) => {
      const t = s.runs[CID]?.assistant?.text
      if (t && texts[texts.length - 1] !== t) texts.push(t)
    })
    sendMessage(qc, CID, 'hi')
    await done(CID)
    unsub()
    expect(api.streamCalls.length).toBeGreaterThanOrEqual(2)
    expect(api.streamCalls[0]!.searchParams.get('since')).toBe('0')
    expect(api.streamCalls[1]!.searchParams.get('since')).toBe('100-2') // resumed after the last seen event
    expect(texts).toEqual(['A', 'AB', 'ABC']) // the replayed duplicate 'B' did not repeat
  })

  it('renders the persisted reply when every stream event was missed (stream unavailable)', async () => {
    let history: ApiMessage[] = [
      { message_id: A1, conversation_id: CID, sender: 'assistant', content: '', status: 'pending', created_at: '2026-01-01T00:00:00' },
    ]
    mockApi({
      post: () => json(202, ack(CID, A1)),
      stream: () => json(503, { detail: 'Bad gateway: service conversation is unreachable.' }),
      history: () => json(200, { items: history, next_cursor: null, has_more: false }),
    })
    let last = ''
    const unsub = useChatStore.subscribe((s) => (last = s.runs[CID]?.assistant?.text ?? last))
    sendMessage(qc, CID, 'hi')
    await waitFor(() => run(CID)?.assistant?.phase === 'waiting')
    history = [{ ...history[0]!, content: 'Persisted hello', status: 'sent' }] // reply lands in storage
    await done(CID)
    unsub()
    expect(last).toBe('Persisted hello')
    expect(run(CID)).toBeUndefined() // loading state cleared
  })

  it('shows a useful error and clears loading when the turn never completes', async () => {
    mockApi({
      post: () => json(202, ack(CID, A1)),
      stream: () => sse([], { holdOpen: true }),
      history: () =>
        json(200, { items: [{ message_id: A1, conversation_id: CID, sender: 'assistant', content: '', status: 'pending', created_at: '2026-01-01T00:00:00' }], next_cursor: null, has_more: false }),
    })
    TIMING.deadlineMs = 250
    let error = ''
    let phase = ''
    const unsub = useChatStore.subscribe((s) => {
      const a = s.runs[CID]?.assistant
      if (a?.phase === 'failed') {
        error = a.error ?? ''
        phase = a.phase
      }
    })
    sendMessage(qc, CID, 'hi')
    await done(CID)
    unsub()
    expect(phase).toBe('failed')
    expect(error).toMatch(/did not complete/i)
  })

  it('surfaces a failed terminal event (provider error) as a failed turn', async () => {
    mockApi({
      post: () => json(202, ack(CID, A1)),
      stream: () =>
        sse([ev(CID, A1, { content: 'Upstream AI provider error occurred.', is_final: true, status: 'failed', event_id: '100-1' })]),
    })
    let error = ''
    const unsub = useChatStore.subscribe((s) => (error = s.runs[CID]?.assistant?.error ?? error))
    sendMessage(qc, CID, 'hi')
    await done(CID)
    unsub()
    expect(error).toMatch(/provider error/)
  })

  it('handles an authentication failure on the stream without hanging', async () => {
    mockApi({
      post: () => json(202, ack(CID, A1)),
      stream: () => json(401, { detail: 'Access token has expired.' }),
    })
    let error = ''
    const unsub = useChatStore.subscribe((s) => (error = s.runs[CID]?.assistant?.error ?? error))
    sendMessage(qc, CID, 'hi')
    await done(CID)
    unsub()
    expect(error).toMatch(/session expired|sign in/i)
  })

  it('ignores duplicate, out-of-order and foreign-message events', async () => {
    mockApi({
      post: () => json(202, ack(CID, A1)),
      stream: () =>
        sse([
          chunk(CID, A1, 2, 'B'),
          chunk(CID, A1, 1, 'A'),
          chunk(CID, A1, 1, 'A'), // duplicate
          chunk(CID, 'other-message', 3, 'ZZZ'), // different turn
          chunk(CID2, A1, 4, 'WRONG-CONVERSATION'),
          final(CID, A1, ''),
        ]),
    })
    let last = ''
    const unsub = useChatStore.subscribe((s) => (last = s.runs[CID]?.assistant?.text ?? last))
    sendMessage(qc, CID, 'x')
    await done(CID)
    unsub()
    expect(last).toBe('AB')
  })

  it('keeps two conversations separate when messages are sent concurrently', async () => {
    mockApi({
      post: (cid) => json(202, ack(cid, cid === CID ? A1 : A2)),
      stream: (url) => {
        const cid = url.pathname.split('/').pop()!
        const mid = url.searchParams.get('message_id')!
        // each stream also (wrongly) leaks the other conversation's events; they must be ignored
        const other = cid === CID ? [CID2, A2] : [CID, A1]
        return sse([
          chunk(other[0]!, other[1]!, 1, 'LEAK'),
          chunk(cid, mid, 1, cid === CID ? 'first' : 'second'),
          final(cid, mid, cid === CID ? 'first done' : 'second done'),
        ])
      },
    })
    const last: Record<string, string> = {}
    const unsub = useChatStore.subscribe((s) => {
      for (const c of [CID, CID2]) last[c] = s.runs[c]?.assistant?.text ?? last[c] ?? ''
    })
    expect(sendMessage(qc, CID, 'one')).toBe(true)
    expect(sendMessage(qc, CID2, 'two')).toBe(true)
    await waitFor(() => !run(CID) && !run(CID2))
    unsub()
    expect(last[CID]).toBe('first done')
    expect(last[CID2]).toBe('second done')
  })

  it('keeps the user message for retry when the POST fails, and opens no stream', async () => {
    const api = mockApi({ post: () => json(503, { detail: 'internal boom' }), stream: () => sse([]) })
    sendMessage(qc, CID, 'keep me')
    await waitFor(() => run(CID)?.pendingUser?.status === 'failed')
    const p = run(CID)!.pendingUser!
    expect(p.content).toBe('keep me')
    expect(p.error).not.toMatch(/boom/) // server internals are not exposed
    expect(run(CID)!.assistant).toBeNull()
    expect(api.streamCalls).toHaveLength(0)
  })

  it('rejects a duplicate submission while a turn is in flight', async () => {
    mockApi({ post: () => json(202, ack(CID, A1)), stream: () => sse([], { holdOpen: true }) })
    expect(sendMessage(qc, CID, 'one')).toBe(true)
    expect(sendMessage(qc, CID, 'two')).toBe(false)
  })

  it('attaches to a reply that is already pending on the server and restores its partial text', async () => {
    mockApi({
      post: () => json(500, {}),
      stream: () => sse([chunk(CID, A1, 1, 'Part'), chunk(CID, A1, 2, 'ial'), final(CID, A1, 'Partial done')]),
    })
    let last = ''
    const unsub = useChatStore.subscribe((s) => (last = s.runs[CID]?.assistant?.text ?? last))
    expect(watchPending(qc, CID, A1)).toBe(true)
    await done(CID)
    unsub()
    expect(last).toBe('Partial done')
  })
})

describe('late recovery and ordering helpers', () => {
  const row = (over: Partial<ApiMessage>): ApiMessage => ({
    message_id: 'm', conversation_id: CID, sender: 'assistant', content: '', status: 'sent',
    created_at: new Date().toISOString(), ...over,
  })

  it('keeps polling a pending reply and a very recent timeout failure (a late real reply may land)', () => {
    expect(needsPolling([row({ status: 'pending' })])).toBe(true)
    expect(needsPolling([row({ status: 'failed', content: 'Generation timed out: no response from the AI service.' })])).toBe(true)
  })

  it('stops polling for completed, provider-failed, or very old timeout rows', () => {
    expect(needsPolling([row({ status: 'sent', content: 'done' })])).toBe(false)
    expect(needsPolling([row({ status: 'failed', content: 'Upstream AI provider error occurred.' })])).toBe(false)
    expect(
      needsPolling([row({ status: 'failed', content: 'Generation timed out: x', created_at: '2020-01-01T00:00:00Z' })]),
    ).toBe(false)
  })

  it('orders replay-log event ids numerically', () => {
    expect(cmpEventId('100-2', '100-10')).toBeLessThan(0)
    expect(cmpEventId('101-0', '100-99')).toBeGreaterThan(0)
    expect(cmpEventId('5-1', '5-1')).toBe(0)
  })
})
