import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Composer } from '@/components/chat/Composer'
import { cancelRun, retryPending, sendMessage } from '@/features/messages/chat-controller'
import { adoptNewChatMode, useModeSelectionStore, useToolSelectionStore } from '@/features/tools/useTools'
import { documentIdsFromHistory } from '@/features/uploads/useDocumentContext'
import { useAuthStore } from '@/stores/auth.store'
import { useChatStore } from '@/stores/chat.store'
import { useDraftStore } from '@/stores/draft.store'
import type { ApiMessage, ToolDescriptor } from '@/types/api'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const tool = (id: string, over: Partial<ToolDescriptor> = {}): ToolDescriptor => ({
  id,
  name: id.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  description: `${id} description`,
  version: '1.0.0',
  parameters: [{ name: 'query', type: 'string', description: 'q', required: true }],
  auto_runnable: true,
  ...over,
})

const file = (id: string, status: string, filename = `${id}.pdf`) => ({
  document_id: id, conversation_id: null, owner_id: 'u', filename, content_type: 'application/pdf',
  size_bytes: 10, status, current_version: 1, created_at: '', updated_at: '',
})

interface Api {
  tools?: () => Response
  files?: Record<string, ReturnType<typeof file> | 404>
}

/** Mocks only the HTTP boundary. Returns the recorded request bodies of message POSTs. */
function mockApi(api: Api) {
  const posts: Array<Record<string, unknown>> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      const path = url.pathname.replace('/api/v1', '')
      if (path === '/tools') return api.tools ? api.tools() : json(200, { tools: [], max_selected: 5 })
      const fm = /^\/files\/([^/]+)$/.exec(path)
      if (fm) {
        const f = api.files?.[fm[1]!]
        return f && f !== 404 ? json(200, f) : json(404, { error_code: 'FileRecordNotFoundError', message: 'nope' })
      }
      if (init?.method === 'POST' && path.endsWith('/messages')) {
        posts.push(JSON.parse(String(init.body)))
        return json(202, { message_id: 'm1', response_message_id: 'a1', conversation_id: 'c1', sender: 'user', content: 'x', created_at: '', status: 'sent' })
      }
      if (path.startsWith('/stream/')) return json(503, { detail: 'down' })
      return json(200, { items: [], next_cursor: null, has_more: false })
    }),
  )
  return { posts }
}

function renderComposer(onSend = vi.fn(async () => true), props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <Composer conversationId="c1" draftKey="c1" busy={false} onSend={onSend} {...props} />
    </QueryClientProvider>,
  )
  return { onSend, qc }
}

const openTools = async () => userEvent.click(screen.getByRole('button', { name: /^tools/i }))

beforeEach(() => {
  useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null, expired: false })
  useToolSelectionStore.setState({ byKey: {} })
  useModeSelectionStore.setState({ modeByKey: {} })
  useDraftStore.setState({ drafts: {} })
  useChatStore.setState({ runs: {}, citations: {} })
})
afterEach(() => {
  cancelRun('c1')
  vi.unstubAllGlobals()
})

describe('tool picker (discovery from the backend)', () => {
  it('lists exactly what the backend returns and nothing hardcoded', async () => {
    mockApi({ tools: () => json(200, { tools: [tool('web_search'), tool('calculator')], max_selected: 5 }) })
    renderComposer()
    await openTools()
    const group = await screen.findByRole('group', { name: 'Tools' })
    expect(within(group).getAllByRole('checkbox').map((c) => c.textContent)).toEqual([
      expect.stringContaining('Web Search'),
      expect.stringContaining('Calculator'),
    ])
  })

  it('shows a loading state, then an empty state when no tools are enabled', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    vi.stubGlobal('fetch', vi.fn(async () => { await gate; return json(200, { tools: [], max_selected: 5 }) }))
    renderComposer()
    await openTools()
    expect(await screen.findByText(/loading tools/i)).toBeInTheDocument()
    release()
    expect(await screen.findByText(/no tools are enabled/i)).toBeInTheDocument()
  })

  it('shows an error with retry when discovery fails, and recovers', async () => {
    let fail = true
    mockApi({ tools: () => (fail ? json(503, { detail: 'down' }) : json(200, { tools: [tool('web_search')], max_selected: 5 })) })
    renderComposer()
    await openTools()
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load tools/i)
    fail = false
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('checkbox', { name: /web search/i })).toBeInTheDocument()
  })

  it('selects and deselects a tool, shows it as a removable chip, and prevents duplicates', async () => {
    mockApi({ tools: () => json(200, { tools: [tool('web_search')], max_selected: 5 }) })
    renderComposer()
    await openTools()
    const box = await screen.findByRole('checkbox', { name: /web search/i })
    await userEvent.click(box)
    expect(box).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Tools, 1 selected' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove tool web search/i })).toBeInTheDocument()
    await userEvent.click(box)
    expect(useToolSelectionStore.getState().byKey['c1']).toEqual([])
    await userEvent.click(box)
    await userEvent.click(screen.getByRole('button', { name: /remove tool web search/i }))
    expect(useToolSelectionStore.getState().byKey['c1']).toEqual([])
  })

  it('enforces the backend-provided maximum', async () => {
    mockApi({ tools: () => json(200, { tools: [tool('a_tool'), tool('b_tool')], max_selected: 1 }) })
    renderComposer()
    await openTools()
    await userEvent.click(await screen.findByRole('checkbox', { name: /a tool/i }))
    expect(screen.getByRole('checkbox', { name: /b tool/i })).toBeDisabled()
  })

  it('disables tools that need input chat cannot provide', async () => {
    mockApi({ tools: () => json(200, { tools: [tool('needs_file', { auto_runnable: false })], max_selected: 5 }) })
    renderComposer()
    await openTools()
    expect(await screen.findByRole('checkbox', { name: /needs file/i })).toBeDisabled()
  })

  it('drops a selected tool that the backend no longer offers', async () => {
    useToolSelectionStore.setState({ byKey: { c1: ['web_search', 'gone_tool'] } })
    mockApi({ tools: () => json(200, { tools: [tool('web_search')], max_selected: 5 }) })
    renderComposer()
    await waitFor(() => expect(useToolSelectionStore.getState().byKey['c1']).toEqual(['web_search']))
  })

  it('sends the selected tool ids with the message and clears them afterwards', async () => {
    mockApi({ tools: () => json(200, { tools: [tool('web_search')], max_selected: 5 }) })
    const { onSend } = renderComposer()
    await openTools()
    await userEvent.click(await screen.findByRole('checkbox', { name: /web search/i }))
    await userEvent.type(screen.getByLabelText('Message GranthanAI'), 'latest news')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('latest news', [], ['web_search'], undefined))
    await waitFor(() => expect(useToolSelectionStore.getState().byKey['c1'] ?? []).toEqual([]))
  })

  it('sends nothing extra when no tool is selected (unchanged behaviour)', async () => {
    mockApi({})
    const { onSend } = renderComposer()
    await userEvent.type(screen.getByLabelText('Message GranthanAI'), 'hello')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('hello', [], undefined, undefined))
  })
})

describe('selected tools in the request payload', () => {
  it('POSTs selected_tools and file_ids exactly as chosen', async () => {
    const { posts } = mockApi({})
    sendMessage(new QueryClient(), 'c1', 'q', ['doc-1'], ['web_search'])
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toMatchObject({ content: 'q', file_ids: ['doc-1'], selected_tools: ['web_search'] })
  })

  it('omits selected_tools entirely when none are chosen', async () => {
    const { posts } = mockApi({})
    sendMessage(new QueryClient(), 'c1', 'q')
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).not.toHaveProperty('selected_tools')
    expect(posts[0]).not.toHaveProperty('file_ids')
  })

  it('a retry after a failed send resends the same tools and files', async () => {
    let n = 0
    const posts: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname.replace('/api/v1', '')
      if (init?.method === 'POST' && path.endsWith('/messages')) {
        posts.push(JSON.parse(String(init.body)))
        return n++ === 0 ? json(503, { detail: 'x' }) : json(202, { message_id: 'm', response_message_id: 'a', conversation_id: 'c1', sender: 'user', content: 'q', created_at: '', status: 'sent' })
      }
      return json(503, { detail: 'down' })
    }))
    const qc = new QueryClient()
    sendMessage(qc, 'c1', 'q', ['doc-1'], ['web_search'])
    await waitFor(() => expect(useChatStore.getState().runs['c1']?.pendingUser?.status).toBe('failed'))
    expect(retryPending(qc, 'c1')).toBe(true)
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1]).toMatchObject({ file_ids: ['doc-1'], selected_tools: ['web_search'] })
  })
})

describe('documents attached earlier stay in context for follow-up questions', () => {
  const msg = (id: string, fileIds: string[]): ApiMessage => ({
    message_id: id, conversation_id: 'c1', sender: 'user', content: 'x', created_at: '', status: 'sent', file_ids: fileIds,
  })

  it('collects distinct document ids from history, most recent first, capped', () => {
    const ids = documentIdsFromHistory([msg('1', ['a', 'b']), msg('2', []), msg('3', ['b', 'c'])])
    expect(ids).toEqual(['b', 'c', 'a'])
    expect(documentIdsFromHistory(Array.from({ length: 12 }, (_, i) => msg(String(i), [`d${i}`]))).length).toBe(5)
    expect(documentIdsFromHistory([])).toEqual([])
  })

  it('includes a READY earlier document in the next question and lets the user switch it off', async () => {
    mockApi({ files: { 'doc-1': file('doc-1', 'READY', 'handbook.pdf') } })
    const { onSend } = renderComposer(vi.fn(async () => true), { contextDocumentIds: ['doc-1'] })
    expect(await screen.findByText('handbook.pdf')).toBeInTheDocument()
    await screen.findByRole('button', { name: /stop using handbook.pdf/i })
    await userEvent.type(screen.getByLabelText('Message GranthanAI'), 'what does section 2 say?')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith('what does section 2 say?', ['doc-1'], undefined, undefined))

    await userEvent.click(screen.getByRole('button', { name: /stop using handbook.pdf/i }))
    await userEvent.type(screen.getByLabelText('Message GranthanAI'), 'general question')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith('general question', [], undefined, undefined))
  })

  it('never sends a document that is not READY or no longer exists', async () => {
    mockApi({ files: { 'doc-p': file('doc-p', 'PROCESSING'), 'doc-f': file('doc-f', 'FAILED'), 'doc-x': 404 } })
    const { onSend } = renderComposer(vi.fn(async () => true), { contextDocumentIds: ['doc-p', 'doc-f', 'doc-x'] })
    expect(await screen.findByText('Still processing')).toBeInTheDocument()
    expect(await screen.findByText('Processing failed')).toBeInTheDocument()
    expect(await screen.findByText('No longer available')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Message GranthanAI'), 'summarise it')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('summarise it', [], undefined, undefined))
  })
})


describe('mode selector (modes come from the backend)', () => {
  const modes = [
    { id: 'tutor', name: 'Tutor', description: 'Explains step by step.' },
    { id: 'deep_research', name: 'Deep research', description: 'Thorough, sourced answers.' },
  ]
  const withModes = () => mockApi({ tools: () => json(200, { tools: [tool('web_search')], max_selected: 5, modes }) })

  it('offers Auto plus exactly the modes the backend returns', async () => {
    withModes()
    renderComposer()
    await openTools()
    const group = await screen.findByRole('radiogroup', { name: 'Mode' })
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      expect.stringContaining('Auto'),
      expect.stringContaining('Tutor'),
      expect.stringContaining('Deep research'),
    ])
    expect(within(group).getByRole('radio', { name: /auto/i })).toHaveAttribute('aria-checked', 'true')
  })

  it('hides the mode section when the backend offers none (older backend)', async () => {
    mockApi({ tools: () => json(200, { tools: [tool('web_search')], max_selected: 5 }) })
    renderComposer()
    await openTools()
    await screen.findByRole('checkbox', { name: /web search/i })
    expect(screen.queryByRole('radiogroup', { name: 'Mode' })).not.toBeInTheDocument()
  })

  it('sends the chosen mode with the tools; the mode stays for the next message, the tools do not', async () => {
    withModes()
    const { onSend } = renderComposer()
    await openTools()
    await userEvent.click(await screen.findByRole('radio', { name: /deep research/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: /web search/i }))
    expect(screen.getByRole('button', { name: 'Clear mode Deep research' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Message GranthanAI'), 'compare kafka and pulsar')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('compare kafka and pulsar', [], ['web_search'], 'deep_research'))
    await waitFor(() => expect(useToolSelectionStore.getState().byKey['c1']).toBeUndefined())
    expect(useModeSelectionStore.getState().modeByKey['c1']).toBe('deep_research')
    // second message: same mode, no tools chosen
    await userEvent.type(screen.getByLabelText('Message GranthanAI'), 'and rabbitmq?')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith('and rabbitmq?', [], undefined, 'deep_research'))
  })

  it('the new-chat mode moves to the created conversation', () => {
    useModeSelectionStore.getState().setMode('new', 'tutor')
    adoptNewChatMode('new', 'c9')
    expect(useModeSelectionStore.getState().modeByKey).toEqual({ c9: 'tutor' })
  })

  it('lets the user clear the mode back to Auto', async () => {
    withModes()
    renderComposer()
    await openTools()
    await userEvent.click(await screen.findByRole('radio', { name: /tutor/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Clear mode Tutor' }))
    expect(useModeSelectionStore.getState().modeByKey['c1']).toBeUndefined()
  })

  it('falls back to Auto when the backend stops offering the selected mode', async () => {
    useModeSelectionStore.setState({ modeByKey: { c1: 'smart' } })
    withModes()
    renderComposer()
    await waitFor(() => expect(useModeSelectionStore.getState().modeByKey['c1']).toBeUndefined())
  })

  it('POSTs the mode as the API field and omits it for Auto', async () => {
    const { posts } = mockApi({})
    sendMessage(new QueryClient(), 'c1', 'q', [], [], { mode: 'tutor' })
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toMatchObject({ content: 'q', mode: 'tutor' })
    cancelRun('c1')
    sendMessage(new QueryClient(), 'c1', 'q2')
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1]).not.toHaveProperty('mode')
  })
})

describe('documents inherited from ancestor branches', () => {
  it('shows where an inherited document came from, sends it, and lets the user exclude it', async () => {
    mockApi({ files: { d1: file('d1', 'READY', 'paper.pdf') } })
    const { onSend } = renderComposer(undefined, { contextDocumentIds: ['d1'], inheritedFrom: { d1: 'Branch A' } })
    expect(await screen.findByText('from Branch A')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Message GranthanAI'), 'what does section 2 say?')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('what does section 2 say?', ['d1'], undefined, undefined))
  })

  it('an excluded inherited document is not sent', async () => {
    mockApi({ files: { d1: file('d1', 'READY', 'paper.pdf') } })
    const { onSend } = renderComposer(undefined, { contextDocumentIds: ['d1'], inheritedFrom: { d1: 'Branch A' } })
    await userEvent.click(await screen.findByRole('button', { name: /stop using paper.pdf as context/i }))
    await userEvent.type(screen.getByLabelText('Message GranthanAI'), 'general question')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('general question', [], undefined, undefined))
  })

  it('a deleted or inaccessible inherited document is never sent', async () => {
    mockApi({ files: { d1: 404 } })
    const { onSend } = renderComposer(undefined, { contextDocumentIds: ['d1'], inheritedFrom: { d1: 'Branch A' } })
    expect(await screen.findByText('No longer available')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Message GranthanAI'), 'hello there')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('hello there', [], undefined, undefined))
  })
})
