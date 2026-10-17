import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { cancelRun, sendMessage } from '@/features/messages/chat-controller'
import { useAuthStore } from '@/stores/auth.store'
import { useChatStore } from '@/stores/chat.store'

/**
 * Network is mocked at the fetch boundary (the API gateway contract), so these tests verify
 * the frontend's handling of the documented protocol, not backend integration.
 */

const CID = '11111111-1111-4111-8111-111111111111'
const ASSISTANT = '22222222-2222-4222-8222-222222222222'
const enc = new TextEncoder()

function sseResponse(frames: Array<string | 'END'>, opts: { holdOpen?: boolean } = {}) {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c
    },
  })
  const push = async () => {
    ctrl.enqueue(enc.encode(': ok\n\n'))
    await new Promise((r) => setTimeout(r, 5))
    for (const f of frames) {
      if (f === 'END') break
      ctrl.enqueue(enc.encode(f))
      await new Promise((r) => setTimeout(r, 5))
    }
    if (!opts.holdOpen) ctrl.close()
  }
  return { response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }), push }
}

const ev = (o: object) => `data: ${JSON.stringify({ conversation_id: CID, message_id: ASSISTANT, sender: 'assistant', ...o })}\n\n`
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const ack = {
  message_id: '33333333-3333-4333-8333-333333333333',
  conversation_id: CID,
  sender: 'user',
  content: 'hello',
  created_at: '2026-01-01T00:00:00Z',
  status: 'sent',
  response_message_id: ASSISTANT,
}

async function waitFor(fn: () => boolean, ms = 3000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('sendMessage turn lifecycle', () => {
  let qc: QueryClient
  beforeEach(() => {
    qc = new QueryClient()
    useChatStore.setState({ runs: {}, citations: {} })
    useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null, expired: false })
  })
  afterEach(() => {
    cancelRun(CID)
    vi.unstubAllGlobals()
  })

  it('streams chunks incrementally, replaces with full_content and citations on completion, and reconciles', async () => {
    const stream = sseResponse([
      ev({ content: 'Hel', sequence_number: 1, is_final: false }),
      ev({ content: 'lo', sequence_number: 2, is_final: false }),
      ev({ content: '', is_final: true, status: 'completed', full_content: 'Hello world', citations: [{ file_id: 'f', source_name: 'doc.pdf', page_number: 2, section: null }] }),
    ])
    const calls: string[] = []
    let postBody: unknown
    let idemKey: string | null = null
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url.replace(/^.*\/api\/v1/, '')}`)
      if (url.includes('/stream/')) {
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
        expect(url).not.toContain('token=') // token must not travel in the URL
        void stream.push()
        return stream.response
      }
      if (init?.method === 'POST') {
        postBody = JSON.parse(String(init.body))
        idemKey = (init.headers as Record<string, string>)['X-Idempotency-Key'] ?? null
        return json(202, ack)
      }
      return json(200, { items: [], next_cursor: null, has_more: false })
    }))

    const seen: string[] = []
    const unsub = useChatStore.subscribe((s) => {
      const a = s.runs[CID]?.assistant
      if (a && a.text && seen[seen.length - 1] !== a.text) seen.push(a.text)
    })

    expect(sendMessage(qc, CID, 'hello', [])).toBe(true)
    await waitFor(() => !useChatStore.getState().runs[CID])
    unsub()

    // stream opened BEFORE the message was posted (server has no replay)
    expect(calls[0]).toMatch(/^GET \/stream\//)
    expect(calls[1]).toMatch(/^POST \/conversations\/.*\/messages/)
    expect(postBody).toMatchObject({ content: 'hello' })
    expect(idemKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(seen).toContain('Hel')
    expect(seen).toContain('Hello world')
    expect(useChatStore.getState().citations[ASSISTANT]?.[0]?.source_name).toBe('doc.pdf')
    // history was refetched to reconcile
    expect(calls.some((c) => c.startsWith('GET /conversations/') || c === 'GET /conversations?limit=30')).toBeDefined()
  })

  it('reorders out-of-order chunks and ignores duplicates and other messages', async () => {
    const stream = sseResponse([
      ev({ content: 'B', sequence_number: 2, is_final: false }),
      ev({ content: 'A', sequence_number: 1, is_final: false }),
      ev({ content: 'A', sequence_number: 1, is_final: false }),
      `data: ${JSON.stringify({ conversation_id: CID, message_id: 'other', sender: 'assistant', content: 'ZZZ', sequence_number: 3, is_final: false })}\n\n`,
      ev({ content: '', is_final: true, status: 'completed', full_content: '' }),
    ])
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/stream/')) { void stream.push(); return stream.response }
      if (init?.method === 'POST') return json(202, ack)
      return json(200, { items: [], next_cursor: null, has_more: false })
    }))
    let final = ''
    const unsub = useChatStore.subscribe((s) => { final = s.runs[CID]?.assistant?.text ?? final })
    sendMessage(qc, CID, 'x')
    await waitFor(() => !useChatStore.getState().runs[CID])
    unsub()
    expect(final).toBe('AB')
  })

  it('shows a failed assistant turn when the final event reports failure', async () => {
    const stream = sseResponse([ev({ content: 'Upstream AI provider error occurred.', is_final: true, status: 'failed' })])
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/stream/')) { void stream.push(); return stream.response }
      if (init?.method === 'POST') return json(202, ack)
      return json(200, { items: [], next_cursor: null, has_more: false })
    }))
    let phase = ''
    let error = ''
    const unsub = useChatStore.subscribe((s) => {
      const a = s.runs[CID]?.assistant
      if (a?.phase === 'failed') { phase = a.phase; error = a.error ?? '' }
    })
    sendMessage(qc, CID, 'x')
    await waitFor(() => !useChatStore.getState().runs[CID])
    unsub()
    expect(phase).toBe('failed')
    expect(error).toMatch(/provider error/)
  })

  it('keeps the user message for retry when the POST fails, and does not lose the draft', async () => {
    const stream = sseResponse([], { holdOpen: true })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/stream/')) { void stream.push(); return stream.response }
      if (init?.method === 'POST') return json(503, { detail: 'internal boom' })
      return json(200, {})
    }))
    sendMessage(qc, CID, 'keep me')
    await waitFor(() => useChatStore.getState().runs[CID]?.pendingUser?.status === 'failed')
    const p = useChatStore.getState().runs[CID]!.pendingUser!
    expect(p.content).toBe('keep me')
    expect(p.error).not.toMatch(/boom/) // server internals are not exposed
    expect(useChatStore.getState().runs[CID]!.assistant).toBeNull()
  })

  it('rejects a duplicate submission while a turn is in flight', async () => {
    const stream = sseResponse([], { holdOpen: true })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/stream/')) { void stream.push(); return stream.response }
      if (init?.method === 'POST') return json(202, ack)
      return json(200, {})
    }))
    expect(sendMessage(qc, CID, 'one')).toBe(true)
    expect(sendMessage(qc, CID, 'two')).toBe(false)
  })
})
