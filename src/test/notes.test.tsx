import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

const mockApi = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock('@/features/notes/service', async (orig) => ({
  ...(await orig<typeof import('@/features/notes/service')>()),
  notesApi: mockApi,
}))

import { NotesController } from '@/features/notes/controller'
import { getNotesController, resetNotesControllers } from '@/features/notes/registry'
import { ApiError } from '@/lib/errors'
import { NotesConflictError, type NotesApi, type NotesDoc } from '@/features/notes/service'
import { NotesTab } from '@/features/notes/NotesTab'
import { ContextPanel } from '@/components/layout/ContextPanel'
import { useUiStore } from '@/stores/ui.store'
import type { Conversation } from '@/types/api'

const doc = (content = '', version = 0, over: Partial<NotesDoc> = {}): NotesDoc => ({
  conversation_id: 'c1', content, version, updated_at: version ? '2026-10-24T10:00:00Z' : null, max_chars: 100, ...over,
})

/** A server that behaves like the real one: conditional on version, with controllable timing and failures. */
class FakeServer implements NotesApi {
  stored: NotesDoc
  puts: Array<{ content: string; version: number }> = []
  gets = 0
  inFlight = 0
  maxInFlight = 0
  fail: Error | null = null
  holds: Array<() => void> = []
  hold = false

  constructor(initial: NotesDoc = doc()) {
    this.stored = initial
  }

  async get() {
    this.gets += 1
    return { ...this.stored }
  }

  async put(_id: string, body: { content: string; version: number }) {
    this.puts.push({ ...body })
    this.inFlight += 1
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)
    try {
      if (this.hold) await new Promise<void>((resolve) => this.holds.push(resolve))
      if (this.fail) throw this.fail
      if (body.version !== this.stored.version && body.content !== this.stored.content) throw new NotesConflictError({ ...this.stored })
      if (body.content !== this.stored.content) {
        this.stored = { ...this.stored, content: body.content, version: this.stored.version + 1, updated_at: '2026-10-24T10:05:00Z' }
      }
      return { ...this.stored }
    } finally {
      this.inFlight -= 1
    }
  }

  release() {
    this.holds.shift()?.()
  }
  /** Another browser tab saves. */
  external(content: string) {
    this.stored = { ...this.stored, content, version: this.stored.version + 1 }
  }
}

const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

async function ready(server: FakeServer, debounce = 600) {
  const c = new NotesController('c1', server, debounce)
  c.retain()
  await act(async () => { await c.load() })
  return c
}

beforeEach(() => {
  vi.useFakeTimers()
  resetNotesControllers()
  vi.clearAllMocks()
  useUiStore.setState({ panelOpen: true, panelTab: 'notes' })
})
afterEach(() => vi.useRealTimers())

describe('autosave controller: debounce and unchanged text', () => {
  it('loads without writing, and sends one request for a burst of typing', async () => {
    const server = new FakeServer()
    const c = await ready(server)
    expect(server.puts).toHaveLength(0)
    for (const t of ['h', 'he', 'hel', 'hell', 'hello']) {
      c.setText(t)
      await tick(100)                                   // each keystroke is well inside the 600 ms window
    }
    expect(server.puts).toHaveLength(0)
    expect(c.getSnapshot().save).toBe('dirty')
    await tick(600)
    expect(server.puts).toEqual([{ content: 'hello', version: 0 }])
    expect(c.getSnapshot()).toMatchObject({ save: 'saved', version: 1, text: 'hello' })
  })

  it('makes no request when the text returns to what is already stored', async () => {
    const server = new FakeServer(doc('stored', 3))
    const c = await ready(server)
    c.setText('stored!')
    c.setText('stored')                                  // typed and deleted again before the pause
    await tick(2000)
    expect(server.puts).toHaveLength(0)
    expect(c.getSnapshot().save).toBe('saved')
    await act(async () => { await c.flush() })
    expect(server.puts).toHaveLength(0)
  })

  it('never exceeds the size limit the server reported', async () => {
    const c = await ready(new FakeServer(doc('', 0, { max_chars: 10 })))
    c.setText('x'.repeat(50))
    expect(c.getSnapshot().text).toHaveLength(10)
  })
})

describe('autosave controller: save sequencing', () => {
  it('is single-flight: edits during a save wait, then go out with the version the first save returned', async () => {
    const server = new FakeServer()
    server.hold = true
    const c = await ready(server)
    c.setText('a')
    await tick(600)
    expect(server.puts).toEqual([{ content: 'a', version: 0 }])
    c.setText('ab')                                      // typed while request #1 is in the air
    c.setText('abc')
    await tick(5000)
    expect(server.puts).toHaveLength(1)                  // still only one request in flight
    server.release()                                     // #1 completes -> v1
    await tick(0)
    expect(server.puts).toEqual([{ content: 'a', version: 0 }, { content: 'abc', version: 1 }])
    server.release()
    await tick(0)
    expect(server.maxInFlight).toBe(1)                   // two requests never overlapped
    expect(server.stored).toMatchObject({ content: 'abc', version: 2 })
    expect(c.getSnapshot()).toMatchObject({ text: 'abc', save: 'saved', version: 2 })
  })

  it('an older response never overwrites newer text in the editor', async () => {
    const server = new FakeServer()
    server.hold = true
    const c = await ready(server)
    c.setText('first')
    await tick(600)
    c.setText('first, then more')
    server.release()
    await tick(0)
    expect(c.getSnapshot().text).toBe('first, then more')
    server.release()
    await tick(0)
    expect(server.stored.content).toBe('first, then more')
  })
})

describe('autosave controller: failure and conflict', () => {
  it('keeps the text when a save fails, shows an error, and Retry saves it', async () => {
    const server = new FakeServer()
    server.fail = new Error('network down')
    const c = await ready(server)
    c.setText('precious')
    await tick(600)
    expect(c.getSnapshot()).toMatchObject({ save: 'error', text: 'precious' })
    expect(c.hasUnsavedWork).toBe(true)
    server.fail = null
    await act(async () => { await c.retry() })
    expect(c.getSnapshot()).toMatchObject({ save: 'saved', text: 'precious' })
    expect(server.stored.content).toBe('precious')
  })

  it('the text survives the editor going away after a failure and is restored when it comes back', async () => {
    const server = new FakeServer()
    server.fail = new Error('offline')
    const c = getNotesController('u1', 'c1', server, 600)
    c.retain()
    await act(async () => { await c.load() })
    c.setText('draft')
    await tick(600)
    c.release()                                          // user switched conversation
    await tick(0)
    const again = getNotesController('u1', 'c1', server, 600)
    expect(again).toBe(c)
    expect(again.getSnapshot().text).toBe('draft')
  })

  it('a change made in another tab is a conflict that keeps the local text and asks which to keep', async () => {
    const server = new FakeServer(doc('base', 1))
    const c = await ready(server)
    server.external('from another tab')                  // version 2 on the server
    c.setText('my edit')
    await tick(600)
    expect(c.getSnapshot()).toMatchObject({ save: 'conflict', text: 'my edit' })
    expect(c.getSnapshot().conflict?.content).toBe('from another tab')
    expect(server.stored.content).toBe('from another tab')                 // nothing was overwritten
    await tick(5000)
    expect(server.puts).toHaveLength(1)                  // no retry loop while the conflict is unresolved
    await act(async () => { await c.keepMine() })
    expect(server.stored.content).toBe('my edit')
    expect(c.getSnapshot()).toMatchObject({ save: 'saved', conflict: null })
  })

  it('"use the other version" adopts it and drops the local text only because the user chose to', async () => {
    const server = new FakeServer(doc('base', 1))
    const c = await ready(server)
    server.external('theirs')
    c.setText('mine')
    await tick(600)
    c.useTheirs()
    expect(c.getSnapshot()).toMatchObject({ text: 'theirs', save: 'saved', version: 2, conflict: null })
  })
})

describe('autosave controller: leaving, loading and other tabs', () => {
  it('leaving the conversation flushes the pending edit immediately, not after the debounce', async () => {
    const server = new FakeServer()
    const c = await ready(server)
    c.setText('about to switch')
    expect(server.puts).toHaveLength(0)
    c.release()
    await tick(0)
    expect(server.puts).toEqual([{ content: 'about to switch', version: 0 }])
  })

  it('a failed load can be retried and local typing is never replaced by a late load', async () => {
    const server = new FakeServer(doc('server text', 2))
    const failing = vi.spyOn(server, 'get').mockRejectedValueOnce(new Error('boom'))
    const c = new NotesController('c1', server, 600)
    await act(async () => { await c.load() })
    expect(c.getSnapshot()).toMatchObject({ load: 'error' })
    failing.mockRestore()
    await act(async () => { await c.load(true) })
    expect(c.getSnapshot()).toMatchObject({ load: 'ready', text: 'server text', version: 2 })
    c.setText('local typing')
    await act(async () => { await c.load(true) })
    expect(c.getSnapshot().text).toBe('local typing')
  })

  it('refresh picks up another tab\'s save only when nothing is pending here', async () => {
    const server = new FakeServer(doc('v1', 1))
    const c = await ready(server)
    server.external('from tab B')
    await act(async () => { await c.refresh() })
    expect(c.getSnapshot()).toMatchObject({ text: 'from tab B', version: 2 })
    c.setText('typing here')
    server.external('tab B again')
    await act(async () => { await c.refresh() })
    expect(c.getSnapshot().text).toBe('typing here')       // dirty: not replaced
  })
})

describe('registry: isolation', () => {
  it('one controller per user and conversation, so notes cannot appear in another conversation or account', () => {
    const api = new FakeServer()
    const a = getNotesController('u1', 'c1', api)
    expect(getNotesController('u1', 'c1', api)).toBe(a)
    expect(getNotesController('u1', 'c2', api)).not.toBe(a)
    expect(getNotesController('u2', 'c1', api)).not.toBe(a)
    resetNotesControllers()
    expect(getNotesController('u1', 'c1', api)).not.toBe(a)
  })
})

// ───────────────────────────────────────────────────────────────────────────────────── component

function wrap(ui: React.ReactElement) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

function serverFor(docs: Record<string, NotesDoc>) {
  const puts: Array<{ id: string; content: string; version: number }> = []
  mockApi.get.mockImplementation(async (id: string) => ({ ...(docs[id] ?? doc('', 0, { conversation_id: id })) }))
  mockApi.put.mockImplementation(async (id: string, body: { content: string; version: number }) => {
    puts.push({ id, ...body })
    docs[id] = { ...(docs[id] ?? doc('', 0)), conversation_id: id, content: body.content, version: body.version + 1, updated_at: '2026-10-24T10:00:00Z' }
    return { ...docs[id]! }
  })
  return puts
}

const flushUi = () => tick(0)

describe('Notes tab', () => {
  it('shows a loading state, then an empty editor with guidance', async () => {
    serverFor({})
    render(wrap(<NotesTab conversationId="c1" />))
    expect(screen.getByLabelText('Loading notes')).toBeTruthy()
    await flushUi()
    const box = screen.getByLabelText('Notes for this conversation') as HTMLTextAreaElement
    expect(box.value).toBe('')
    expect(box.placeholder).toContain('Markdown works')
    expect(screen.getByText(/not sent to the assistant/i)).toBeTruthy()
  })

  it('autosaves after a pause (one request for a burst), shows Saving then Saved, and not on every keystroke', async () => {
    const puts = serverFor({})
    render(wrap(<NotesTab conversationId="c1" />))
    await flushUi()
    const box = screen.getByLabelText('Notes for this conversation')
    for (const t of ['#', '# P', '# Plan', '# Plan\n- [ ] one']) {
      fireEvent.change(box, { target: { value: t } })
      await tick(150)
    }
    expect(puts).toHaveLength(0)
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    await tick(700)
    expect(puts).toEqual([{ id: 'c1', content: '# Plan\n- [ ] one', version: 0 }])
    expect(screen.getByText('Saved')).toBeTruthy()
  })

  it('shows Couldn\'t save with Retry when a save fails, and keeps the text', async () => {
    serverFor({})
    mockApi.put.mockRejectedValueOnce(new Error('offline'))
    render(wrap(<NotesTab conversationId="c1" />))
    await flushUi()
    fireEvent.change(screen.getByLabelText('Notes for this conversation'), { target: { value: 'keep me' } })
    await tick(700)
    expect(screen.getByRole('alert').textContent).toContain("Couldn't save")
    expect((screen.getByLabelText('Notes for this conversation') as HTMLTextAreaElement).value).toBe('keep me')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await flushUi()
    expect(screen.getByText('Saved')).toBeTruthy()
  })

  it('offers a clear choice on a conflict and keeps the text visible', async () => {
    serverFor({})
    mockApi.put.mockRejectedValueOnce(new NotesConflictError(doc('other tab text', 4)))
    render(wrap(<NotesTab conversationId="c1" />))
    await flushUi()
    fireEvent.change(screen.getByLabelText('Notes for this conversation'), { target: { value: 'my text' } })
    await tick(700)
    expect(screen.getByText(/changed in another tab/i)).toBeTruthy()
    expect((screen.getByLabelText('Notes for this conversation') as HTMLTextAreaElement).value).toBe('my text')
    expect(screen.getByRole('button', { name: 'Keep mine' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use the other version' }))
    await flushUi()
    expect((screen.getByLabelText('Notes for this conversation') as HTMLTextAreaElement).value).toBe('other tab text')
  })

  it('switching conversation shows that conversation\'s notes only and flushes the pending edit of the one left', async () => {
    const docs = { c1: doc('notes of one', 2, { conversation_id: 'c1' }), c2: doc('notes of two', 5, { conversation_id: 'c2' }) }
    const puts = serverFor(docs)
    const view = render(wrap(<NotesTab key="c1" conversationId="c1" />))
    await flushUi()
    const box = () => screen.getByLabelText('Notes for this conversation') as HTMLTextAreaElement
    expect(box().value).toBe('notes of one')
    fireEvent.change(box(), { target: { value: 'notes of one, edited' } })
    view.rerender(wrap(<NotesTab key="c2" conversationId="c2" />))             // switched before the pause elapsed
    await flushUi()
    expect(box().value).toBe('notes of two')                                    // never the other conversation's text
    expect(puts).toEqual([{ id: 'c1', content: 'notes of one, edited', version: 2 }])   // saved to ITS conversation
    expect(docs.c2.content).toBe('notes of two')
  })

  it('two editors on the same conversation share one document and one save', async () => {
    const puts = serverFor({})
    render(wrap(<><NotesTab conversationId="c1" /><NotesTab conversationId="c1" /></>))
    await flushUi()
    const boxes = screen.getAllByLabelText('Notes for this conversation') as HTMLTextAreaElement[]
    fireEvent.change(boxes[0]!, { target: { value: 'typed in the first' } })
    expect(boxes[1]!.value).toBe('typed in the first')
    await tick(700)
    expect(puts).toHaveLength(1)
    expect(mockApi.get).toHaveBeenCalledTimes(1)
  })

  it('previews Markdown (headings, lists, checkboxes, code) and cannot run script or unsafe links', async () => {
    vi.useRealTimers()                                  // the preview is lazy-loaded: real timers keep that import simple
    serverFor({ c1: doc('', 0) })
    render(wrap(<NotesTab conversationId="c1" />))
    const box = await screen.findByLabelText('Notes for this conversation')
    const hostile = [
      '# Title', '- [ ] open task', '- [x] done task', '```js', 'const x = 1', '```',
      '<script>window.__pwned = true</script>', '<img src=x onerror="window.__pwned = true">',
      '[click me](javascript:window.__pwned=true)', '<a href="javascript:alert(1)">raw</a>',
    ].join(String.fromCharCode(10))
    fireEvent.change(box, { target: { value: hostile } })
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }))
    const preview = screen.getByTestId('notes-preview')
    await waitFor(() => expect(preview.querySelector('h1')?.textContent).toBe('Title'), { timeout: 4000 })
    expect(preview.querySelectorAll('input[type="checkbox"]').length).toBe(2)
    expect(preview.querySelector('pre code')?.textContent).toContain('const x = 1')
    expect(preview.querySelector('script')).toBeNull()
    expect(preview.querySelector('[onerror]')).toBeNull()
    expect([...preview.querySelectorAll('a')].every((a) => !/^\s*javascript:/i.test(a.getAttribute('href') ?? ''))).toBe(true)
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })

  it('the Write and Preview controls are real toggle buttons reachable by keyboard', async () => {
    serverFor({})
    render(wrap(<NotesTab conversationId="c1" />))
    await flushUi()
    const write = screen.getByRole('button', { name: /Write/ })
    const preview = screen.getByRole('button', { name: /Preview/ })
    expect(write.getAttribute('aria-pressed')).toBe('true')
    expect(preview.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByLabelText('Notes for this conversation').tagName).toBe('TEXTAREA')
  })
})

describe('load errors', () => {
  it('explains a 404 instead of showing a bare Not Found, and Retry loads again', async () => {
    vi.useRealTimers()
    mockApi.get.mockRejectedValueOnce(new ApiError('not_found', 'Not Found', 404))
    mockApi.get.mockResolvedValue(doc('now available', 1))
    render(wrap(<NotesTab conversationId="c1" />))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/aren't available for this conversation/)
    expect(alert.textContent).not.toMatch(/^Notes could not be loaded \(Not Found\)/)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(((await screen.findByLabelText('Notes for this conversation')) as HTMLTextAreaElement).value).toBe('now available')
  })
})

describe('right sidebar', () => {
  const conv: Conversation = {
    conversation_id: 'c1', user_id: 'u', title: 'T', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    status: 'active', parent_conversation_id: null,
  }

  it('shows Notes in place of Memory and keeps the other tabs', async () => {
    serverFor({})
    render(wrap(<ContextPanel conversation={conv} />))
    await flushUi()
    const names = screen.getAllByRole('tab').map((t) => t.textContent?.trim())
    expect(names).toEqual(['Details', 'Files', 'Artifacts', 'Notes'])
    expect(screen.queryByRole('tab', { name: /Memory/ })).toBeNull()
    expect(screen.getByLabelText('Notes for this conversation')).toBeTruthy()
  })
})
