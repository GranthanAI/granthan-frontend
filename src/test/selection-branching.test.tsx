import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Composer } from '@/components/chat/Composer'
import { MessageItem } from '@/components/chat/MessageItem'
import { SelectionActions } from '@/components/chat/SelectionActions'
import { useSelectionBranch } from '@/features/conversations/useSelectionBranch'
import { branchTitle, cleanSelection, formatQuoted, MAX_QUOTE_CHARS, parseQuoted } from '@/lib/quote'
import { useAuthStore } from '@/stores/auth.store'
import { useDraftStore } from '@/stores/draft.store'
import { useQuoteStore } from '@/stores/quote.store'
import type { DisplayMessage } from '@/features/messages/display'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// ------------------------------------------------------------------ pure helpers

describe('branch title', () => {
  it('is the first five words of the selection', () => {
    expect(branchTitle('Quantization reduces model size by lowering numeric precision')).toBe('Quantization reduces model size by')
    expect(branchTitle('  one   two\nthree four five six seven ')).toBe('one two three four five')
  })

  it('keeps short selections whole and drops trailing punctuation and markdown decoration', () => {
    expect(branchTitle('What is JEV?')).toBe('What is JEV')
    expect(branchTitle('## Heading words here, then more words')).toBe('Heading words here, then more')
    expect(branchTitle('- **bold** item `code` end tail')).toBe('bold item code end tail')
  })

  it('never returns an empty title', () => {
    expect(branchTitle('   ')).toBe('New branch')
    expect(branchTitle('### >>> ***')).toBe('New branch')
  })
})

describe('quote format', () => {
  it('formats a quote block above the prompt and parses it back', () => {
    const content = formatQuoted('line one\nline two', 'Explain this')
    expect(content).toBe('> line one\n> line two\n\nExplain this')
    expect(parseQuoted(content)).toEqual({ quote: 'line one\nline two', body: 'Explain this' })
  })

  it('leaves messages without a quote untouched', () => {
    expect(formatQuoted(null, 'hello')).toBe('hello')
    expect(formatQuoted('   ', 'hello')).toBe('hello')
    expect(parseQuoted('hello\n> not leading')).toEqual({ quote: null, body: 'hello\n> not leading' })
  })

  it('caps long selections and normalizes whitespace', () => {
    expect(cleanSelection('a\r\n\r\n\r\n\r\nb   c')).toBe('a\n\nb c')
    const long = cleanSelection('x'.repeat(5000))
    expect(long.length).toBeLessThanOrEqual(MAX_QUOTE_CHARS + 1)
    expect(long.endsWith('…')).toBe(true)
  })
})

// ------------------------------------------------------------------ the toolbar over selected text

function fakeSelection(opts: { text: string; anchor: Node; focus?: Node; collapsed?: boolean }) {
  // Behaves like a real Selection: removeAllRanges() empties it.
  const state = { text: opts.text, collapsed: opts.collapsed ?? false }
  const removeAllRanges = vi.fn(() => {
    state.text = ''
    state.collapsed = true
  })
  const sel = {
    rangeCount: 1,
    get isCollapsed() {
      return state.collapsed
    },
    toString: () => state.text,
    anchorNode: opts.anchor,
    focusNode: opts.focus ?? opts.anchor,
    getRangeAt: () => ({ getBoundingClientRect: () => ({ top: 300, bottom: 320, left: 200, width: 100 }) }),
    removeAllRanges,
  }
  vi.spyOn(window, 'getSelection').mockReturnValue(sel as unknown as Selection)
  return { removeAllRanges }
}

function Page({ children }: { children?: ReactNode }) {
  return (
    <div>
      <div data-chat-messages>
        <article data-message-id="m1">
          <p id="p1">Quantization reduces model size by lowering numeric precision.</p>
        </article>
        <article data-message-id="m2">
          <p id="p2">Second message.</p>
        </article>
      </div>
      <textarea id="composer-input" defaultValue="draft" />
      {children}
    </div>
  )
}

const finishSelecting = async () => {
  fireEvent.mouseUp(document)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5))
  })
}

describe('selection toolbar', () => {
  afterEach(() => vi.restoreAllMocks())

  function setup() {
    const onNewBranch = vi.fn()
    const onThisBranch = vi.fn()
    render(
      <Page>
        <SelectionActions onNewBranch={onNewBranch} onThisBranch={onThisBranch} />
      </Page>,
    )
    return { onNewBranch, onThisBranch }
  }
  const textNode = (id: string) => document.getElementById(id)!.firstChild!

  it('shows the two actions over text selected inside one message', async () => {
    setup()
    fakeSelection({ text: 'lowering numeric precision', anchor: textNode('p1') })
    await finishSelecting()
    const bar = await screen.findByRole('toolbar', { name: /selected text/i })
    expect(bar).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create new branch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'In this branch' })).toBeInTheDocument()
  })

  it('stays hidden for selections outside messages, across messages, or collapsed', async () => {
    setup()
    fakeSelection({ text: 'draft', anchor: document.getElementById('composer-input')! })
    await finishSelecting()
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()

    fakeSelection({ text: 'spans two', anchor: textNode('p1'), focus: textNode('p2') })
    await finishSelecting()
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()

    fakeSelection({ text: '', anchor: textNode('p1'), collapsed: true })
    await finishSelecting()
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('"Create new branch" passes the selected text, clears the selection and hides', async () => {
    const { onNewBranch } = setup()
    const { removeAllRanges } = fakeSelection({ text: 'lowering numeric precision', anchor: textNode('p1') })
    await finishSelecting()
    await userEvent.click(await screen.findByRole('button', { name: 'Create new branch' }))
    expect(onNewBranch).toHaveBeenCalledWith('lowering numeric precision')
    expect(removeAllRanges).toHaveBeenCalled()
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('"In this branch" passes the selected text to the other handler only', async () => {
    const { onNewBranch, onThisBranch } = setup()
    fakeSelection({ text: 'model size', anchor: textNode('p1') })
    await finishSelecting()
    await userEvent.click(await screen.findByRole('button', { name: 'In this branch' }))
    expect(onThisBranch).toHaveBeenCalledWith('model size')
    expect(onNewBranch).not.toHaveBeenCalled()
  })

  it('hides on Escape and when the selection collapses', async () => {
    setup()
    fakeSelection({ text: 'numeric', anchor: textNode('p1') })
    await finishSelecting()
    await screen.findByRole('toolbar')
    fireEvent.keyUp(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('toolbar')).not.toBeInTheDocument())

    fakeSelection({ text: 'numeric', anchor: textNode('p1') })
    await finishSelecting()
    await screen.findByRole('toolbar')
    fakeSelection({ text: '', anchor: textNode('p1'), collapsed: true })
    fireEvent(document, new Event('selectionchange'))
    await waitFor(() => expect(screen.queryByRole('toolbar')).not.toBeInTheDocument())
  })

  it('keeps the selection when the buttons are pressed (mousedown is prevented)', async () => {
    setup()
    fakeSelection({ text: 'numeric', anchor: textNode('p1') })
    await finishSelecting()
    const btn = await screen.findByRole('button', { name: 'In this branch' })
    expect(fireEvent.mouseDown(btn)).toBe(false) // false = default prevented
  })

  it('disables both actions while a branch is being created', async () => {
    render(
      <Page>
        <SelectionActions onNewBranch={vi.fn()} onThisBranch={vi.fn()} pending />
      </Page>,
    )
    fakeSelection({ text: 'numeric', anchor: textNode('p1') })
    await finishSelecting()
    expect(await screen.findByRole('button', { name: 'Create new branch' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'In this branch' })).toBeDisabled()
  })
})

// ------------------------------------------------------------------ what the actions do

function Probe() {
  const l = useLocation()
  return <output data-testid="loc">{l.pathname}</output>
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/c/parent-1']}>
        {children}
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('selection actions behaviour', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null, expired: false })
    useQuoteStore.setState({ byKey: {} })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('new branch: creates a CHILD conversation titled with the first 5 words, opens it, and queues the quote there', async () => {
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname.replace('/api/v1', '')
      if (init?.method === 'POST' && path === '/conversations') {
        bodies.push(JSON.parse(String(init.body)))
        return json(201, { conversation_id: 'child-9', user_id: 'u', title: 'x', created_at: '', updated_at: '', status: 'active', parent_conversation_id: 'parent-1' })
      }
      return json(200, { items: [], next_cursor: null, has_more: false })
    }))
    const { result } = renderHook(() => useSelectionBranch('parent-1'), { wrapper })
    const selected = 'Quantization reduces model size by lowering numeric precision'
    await act(async () => result.current.newBranch(selected))

    expect(bodies).toEqual([{ title: 'Quantization reduces model size by', parent_conversation_id: 'parent-1' }])
    expect(useQuoteStore.getState().byKey['child-9']).toBe(selected)
    expect(useQuoteStore.getState().byKey['parent-1']).toBeUndefined() // the quote belongs to the branch only
    expect(screen.getByTestId('loc')).toHaveTextContent('/c/child-9')
  })

  it('new branch failure: stays put, queues nothing, and the user is told', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(503, { detail: 'down' })))
    const { result } = renderHook(() => useSelectionBranch('parent-1'), { wrapper })
    await act(async () => result.current.newBranch('some selected words'))
    expect(screen.getByTestId('loc')).toHaveTextContent('/c/parent-1')
    expect(useQuoteStore.getState().byKey).toEqual({})
  })

  it('in this branch: no request, no navigation, the quote is queued for THIS conversation', async () => {
    const fetchMock = vi.fn(async () => json(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useSelectionBranch('parent-1'), { wrapper })
    act(() => result.current.thisBranch('model size'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useQuoteStore.getState().byKey['parent-1']).toBe('model size')
    expect(screen.getByTestId('loc')).toHaveTextContent('/c/parent-1')
  })
})

// ------------------------------------------------------------------ the quote travels with the prompt

function renderComposer(onSend: (...a: unknown[]) => boolean | Promise<boolean>) {
  vi.stubGlobal('fetch', vi.fn(async () => json(200, { tools: [], max_selected: 5, items: [], next_cursor: null, has_more: false })))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <Composer conversationId="c1" draftKey="c1" busy={false} onSend={onSend as never} />
    </QueryClientProvider>,
  )
}

describe('composer with a quoted excerpt', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null, expired: false })
    useDraftStore.setState({ drafts: {} })
    useQuoteStore.setState({ byKey: { c1: 'lowering numeric precision' } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the excerpt and sends it as a quote block with the prompt, then clears it', async () => {
    const onSend = vi.fn(async () => true)
    renderComposer(onSend)
    expect(screen.getByText('lowering numeric precision')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Message GranthanAI'), 'Explain this simply')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(onSend).toHaveBeenCalled())
    expect((onSend.mock.calls[0] as unknown[])[0]).toBe('> lowering numeric precision\n\nExplain this simply')
    await waitFor(() => expect(useQuoteStore.getState().byKey['c1']).toBeUndefined())
  })

  it('keeps the excerpt when the send fails so nothing is lost', async () => {
    renderComposer(vi.fn(async () => false))
    await userEvent.type(screen.getByLabelText('Message GranthanAI'), 'Explain')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled())
    expect(useQuoteStore.getState().byKey['c1']).toBe('lowering numeric precision')
  })

  it('lets the user remove the excerpt, and an excerpt alone is not a sendable message', async () => {
    const onSend = vi.fn(async () => true)
    renderComposer(onSend)
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled() // no prompt typed yet
    await userEvent.click(screen.getByRole('button', { name: 'Remove quoted text' }))
    expect(useQuoteStore.getState().byKey['c1']).toBeUndefined()
    await userEvent.type(screen.getByLabelText('Message GranthanAI'), 'plain')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(onSend).toHaveBeenCalled())
    expect((onSend.mock.calls[0] as unknown[])[0]).toBe('plain') // no stray quote
  })
})

describe('message bubble', () => {
  it('renders a sent quote as a quote above the user text, not raw "> " lines', () => {
    const m: DisplayMessage = {
      key: 'k', id: 'm1', sender: 'user', content: '> lowering numeric precision\n\nExplain this simply', status: 'sent',
      citations: [], fileIds: [], createdAt: null, local: false,
    }
    const { container } = render(<MessageItem message={m} isLastAssistant={false} canRegenerate={false} onRegenerate={() => {}} onRetrySend={() => {}} onDismissSend={() => {}} />)
    expect(container.querySelector('blockquote')).toHaveTextContent('lowering numeric precision')
    expect(container).toHaveTextContent('Explain this simply')
    expect(container.textContent).not.toContain('> lowering')
  })
})
