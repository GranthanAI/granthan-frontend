import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EditorView } from '@codemirror/view'

const holder = vi.hoisted(() => ({ server: null as unknown }))
vi.mock('@/features/source-edits/service', async (orig) => {
  const real = await orig<typeof import('@/features/source-edits/service')>()
  const delegate = () => holder.server as import('@/features/source-edits/service').SourceEditsApi
  return {
    ...real,
    sourceEditsApi: {
      list: (...a: Parameters<typeof real.sourceEditsApi.list>) => delegate().list(...a),
      put: (...a: Parameters<typeof real.sourceEditsApi.put>) => delegate().put(...a),
      remove: (...a: Parameters<typeof real.sourceEditsApi.remove>) => delegate().remove(...a),
    },
  }
})

import Markdown from '@/components/chat/Markdown'
import { EditableResponseProvider } from '@/features/source-edits/context'
import { ResponseEditActions, ResponseEditCard } from '@/features/source-edits/ResponseEdit'
import { getBlockController, resetBlockControllers } from '@/features/source-edits/registry'
import { BlockEditController, type BlockMeta } from '@/features/source-edits/controller'
import {
  classifyFence, downloadName, downloadText, makeBlockId, safeFilename, sha256Hex,
} from '@/features/source-edits/files'
import {
  SourceEditConflictError, type SourceEditBody, type SourceEditDoc, type SourceEditsApi,
} from '@/features/source-edits/service'
import { ApiError } from '@/lib/errors'
import { useAuthStore } from '@/stores/auth.store'

const CRLF_TEXT = ['a', 'b'].join(String.fromCharCode(13, 10))
const CONV = 'c1'
const MSG = '11111111-1111-4111-8111-111111111111'
const MSG2 = '22222222-2222-4222-8222-222222222222'

/** Behaves like the real endpoint: conditional on version, identical-text retries acknowledged, owner-scoped by user. */
class FakeServer implements SourceEditsApi {
  rows = new Map<string, SourceEditDoc>()
  puts: Array<{ key: string; body: SourceEditBody }> = []
  removes = 0
  failNext: Error | null = null
  private key = (c: string, m: string, b: string) => `${c}|${m}|${b}`

  async list(c: string) {
    return { conversation_id: c, max_chars: 100000, edits: [...this.rows.values()].filter((r) => r.conversation_id === c) }
  }
  async put(c: string, m: string, b: string, body: SourceEditBody) {
    this.puts.push({ key: this.key(c, m, b), body: { ...body } })
    if (this.failNext) {
      const e = this.failNext
      this.failNext = null
      throw e
    }
    const k = this.key(c, m, b)
    const cur = this.rows.get(k)
    if (cur && cur.content === body.content) return { ...cur }
    if ((cur?.version ?? 0) !== body.version) throw new SourceEditConflictError(cur ? { ...cur } : null)
    const row: SourceEditDoc = {
      conversation_id: c, message_id: m, block_id: b, language: body.language, source_format: body.source_format,
      original_sha256: body.original_sha256, content: body.content, version: (cur?.version ?? 0) + 1,
      created_at: '2026-10-24T10:00:00Z', updated_at: '2026-10-24T10:05:00Z',
    }
    this.rows.set(k, row)
    return { ...row }
  }
  async remove(c: string, m: string, b: string, version: number) {
    const k = this.key(c, m, b)
    const cur = this.rows.get(k)
    if (!cur) return
    if (cur.version !== version) throw new SourceEditConflictError({ ...cur })
    this.removes += 1
    this.rows.delete(k)
  }
  /** Another tab/device saves first. */
  external(c: string, m: string, b: string, content: string) {
    const k = this.key(c, m, b)
    const cur = this.rows.get(k)
    this.rows.set(k, {
      conversation_id: c, message_id: m, block_id: b, language: 'python', source_format: 'code', original_sha256: '0'.repeat(64),
      content, version: (cur?.version ?? 0) + 1, created_at: '2026-10-24T10:00:00Z', updated_at: '2026-10-24T10:06:00Z',
    })
  }
}

let server: FakeServer
const answer = (code: string, lang = 'python') => `Here you go:\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\nDone.`

function ui(content: string, opts: { conversation?: string; message?: string; enabled?: boolean; client?: QueryClient; withResponse?: boolean } = {}) {
  const client = opts.client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <EditableResponseProvider conversationId={opts.conversation ?? CONV} messageId={opts.message ?? MSG} enabled={opts.enabled ?? true}>
        <Markdown content={content} />
        {opts.withResponse && (
          <>
            <ResponseEditActions content={content} />
            <ResponseEditCard content={content} />
          </>
        )}
      </EditableResponseProvider>
    </QueryClientProvider>
  )
}

/** Replaces the editor's whole text exactly as a user's typing would (through CodeMirror's own transaction path). */
async function setEditorText(text: string, which = 0) {
  const content = (await waitFor(() => {
    const els = document.querySelectorAll('.cm-content')
    expect(els.length).toBeGreaterThan(which)
    return els[which] as HTMLElement
  }))
  const view = EditorView.findFromDOM(content.closest('.cm-editor') as HTMLElement)!
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }))
  return view
}

let captured: Blob[] = []
let clicks: Array<{ download: string }> = []

beforeEach(() => {
  server = new FakeServer()
  holder.server = server
  resetBlockControllers()
  useAuthStore.setState({ user: { id: 'u1' } as never, accessToken: 't', status: 'authenticated' } as never)
  captured = []
  clicks = []
  URL.createObjectURL = vi.fn((b: Blob) => (captured.push(b), 'blob:x'))
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ download: this.download })
  })
})
afterEach(() => vi.restoreAllMocks())

// ───────────────────────────────────────────────────────────────────────────────────────── pure helpers

describe('classification, filenames and hashing', () => {
  it('maps known languages to extensions, keeps unknown ones as editable plain source, and treats text/markdown separately', () => {
    expect(classifyFence('python')).toMatchObject({ format: 'code', ext: 'py', language: 'python' })
    expect(classifyFence('TSX')).toMatchObject({ ext: 'tsx' })
    expect(classifyFence('cpp')).toMatchObject({ ext: 'cpp' })
    expect(classifyFence('weirdlang')).toMatchObject({ format: 'code', ext: 'txt', language: 'weirdlang' })
    expect(classifyFence(undefined)).toMatchObject({ format: 'text', ext: 'txt', language: '' })
    expect(classifyFence('text')).toMatchObject({ format: 'text', ext: 'txt' })
    expect(classifyFence('md')).toMatchObject({ format: 'markdown', ext: 'md', language: 'markdown' })
    expect(classifyFence('mermaid')).toMatchObject({ ext: 'mmd' })
    expect(downloadName(classifyFence('dockerfile'))).toBe('Dockerfile')
  })

  it('never lets a hostile fence string shape the extension, the filename or the stored language', () => {
    const k = classifyFence('../../etc/passwd')
    expect(k).toMatchObject({ language: '', ext: 'txt' })
    expect(downloadName(classifyFence('py"; rm -rf /'))).toBe('snippet.txt')
    expect(classifyFence('a'.repeat(80)).language).toBe('')
  })

  it('builds safe filenames: no separators, traversal, control characters or reserved device names', () => {
    expect(safeFilename('../../etc/passwd', 'py')).toBe('etc-passwd.py')
    expect(safeFilename('C:\\Windows\\system32', 'py')).not.toMatch(/[\\/:]/)
    expect(safeFilename('CON', 'txt')).toBe('snippet.txt')
    expect(safeFilename('', 'txt')).toBe('snippet.txt')
    expect(safeFilename('a\u0000b\nc', 'txt')).toBe('a-b-c.txt')
    expect(safeFilename('x'.repeat(500), 'py').length).toBeLessThanOrEqual(64)
    expect(safeFilename('ok', '../../x')).toBe('ok.x')
  })

  it('computes SHA-256 correctly, with and without crypto.subtle', async () => {
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    expect(await sha256Hex('abc')).toBe(expected)
    vi.stubGlobal('crypto', {})
    expect(await sha256Hex('abc')).toBe(expected)
    const long = 'é✓日本語🚀'.repeat(100)
    const viaFallback = await sha256Hex(long)
    vi.unstubAllGlobals()
    expect(viaFallback).toBe(await sha256Hex(long))
  })

  it('makes stable block ids that change when the original text changes', () => {
    expect(makeBlockId('0', 3, 'a')).toBe(makeBlockId('0', 3, 'a'))
    expect(makeBlockId('0', 3, 'a')).not.toBe(makeBlockId('0', 3, 'b'))
    expect(makeBlockId('0', 3, 'a')).not.toBe(makeBlockId('1', 3, 'a'))
    expect(makeBlockId('0', 3, 'a')).toMatch(/^[A-Za-z0-9._:-]{1,80}$/)
  })
})

describe('real browser download', () => {
  it('downloads exactly the given text as UTF-8 bytes (indentation, tabs, CRLF, Unicode preserved) under the given name', async () => {
    const text = 'def f():\r\n\treturn "héllo ✓ 日本語 🚀"  \r\n'
    downloadText('snippet.py', text)
    expect(clicks).toEqual([{ download: 'snippet.py' }])
    const bytes = new Uint8Array(await captured[0]!.arrayBuffer())
    expect([...bytes]).toEqual([...new TextEncoder().encode(text)])
    expect(bytes[0]).not.toBe(0xef) // no BOM
    expect(captured[0]!.type).toContain('utf-8')
    expect(document.querySelector('a[download]')).toBeNull() // the temporary anchor is removed
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────── controller

const meta = (over: Partial<BlockMeta> = {}): BlockMeta => ({
  conversationId: CONV, messageId: MSG, blockId: 'b1', language: 'python', format: 'code', original: 'print(1)\n', ...over,
})

describe('BlockEditController', () => {
  it('saves a first edit, then updates with the returned version; saving unchanged text sends nothing', async () => {
    const c = new BlockEditController(meta(), server)
    c.startEdit()
    c.setDraft('print(2)\n')
    await c.save()
    expect(server.puts).toHaveLength(1)
    expect(server.puts[0]!.body).toMatchObject({ content: 'print(2)\n', version: 0, language: 'python', source_format: 'code' })
    expect(server.puts[0]!.body.original_sha256).toBe(await sha256Hex('print(1)\n'))
    expect(c.getSnapshot()).toMatchObject({ version: 1, saved: 'print(2)\n', save: 'saved' })
    await c.save()
    expect(server.puts).toHaveLength(1)
    c.setDraft('print(3)\n')
    await c.save()
    expect(server.puts[1]!.body.version).toBe(1)
    expect(c.getSnapshot().version).toBe(2)
  })

  it('does not create an edit when the text equals the original', async () => {
    const c = new BlockEditController(meta(), server)
    c.startEdit()
    await c.save()
    expect(server.puts).toHaveLength(0)
  })

  it('keeps the draft after a network failure and the retry sends the same request (no duplicate, nothing lost)', async () => {
    const c = new BlockEditController(meta(), server)
    c.startEdit()
    c.setDraft('x = 1\n')
    server.failNext = new ApiError('network', 'Cannot reach the server.')
    await c.save()
    expect(c.getSnapshot()).toMatchObject({ save: 'error', draft: 'x = 1\n', version: 0 })
    await c.save()
    expect(server.puts).toHaveLength(2)
    expect(server.puts[1]!.body).toEqual(server.puts[0]!.body)
    expect(server.rows.size).toBe(1)
    expect(c.getSnapshot()).toMatchObject({ save: 'saved', version: 1 })
  })

  it('a retry after a lost response (the server did save) is acknowledged without a second version', async () => {
    const c = new BlockEditController(meta(), server)
    c.startEdit()
    c.setDraft('x = 1\n')
    await server.put(CONV, MSG, 'b1', { content: 'x = 1\n', version: 0, language: 'python', source_format: 'code', original_sha256: 'a'.repeat(64) })
    await c.save() // client never saw that response: sends version 0 again
    expect(c.getSnapshot()).toMatchObject({ save: 'saved', version: 1, saved: 'x = 1\n' })
    expect([...server.rows.values()][0]!.version).toBe(1)
  })

  it('a stale save conflicts without overwriting; keepMine saves over, useTheirs adopts the other version', async () => {
    const c = new BlockEditController(meta(), server)
    c.startEdit()
    c.setDraft('mine\n')
    server.external(CONV, MSG, 'b1', 'theirs\n') // another tab saved first
    await c.save()
    expect(c.getSnapshot().save).toBe('conflict')
    expect(c.getSnapshot().draft).toBe('mine\n')
    expect(server.rows.get(`${CONV}|${MSG}|b1`)!.content).toBe('theirs\n')
    await c.keepMine()
    expect(server.rows.get(`${CONV}|${MSG}|b1`)).toMatchObject({ content: 'mine\n', version: 2 })

    const d = new BlockEditController(meta({ blockId: 'b2' }), server)
    d.startEdit()
    d.setDraft('mine2\n')
    server.external(CONV, MSG, 'b2', 'theirs2\n')
    await d.save()
    d.useTheirs()
    expect(d.getSnapshot()).toMatchObject({ draft: 'theirs2\n', saved: 'theirs2\n', version: 1, save: 'idle', conflict: null })
  })

  it('is single-flight: edits made during a save wait, and go out with the version the response returned', async () => {
    const c = new BlockEditController(meta(), server)
    c.startEdit()
    c.setDraft('one\n')
    const first = c.save()
    const second = c.save()
    expect(second).toBe(first)
    c.setDraft('two\n')
    await first
    expect(server.puts).toHaveLength(1)
    expect(c.dirty).toBe(true)
    await c.save()
    expect(server.puts.map((p) => p.body.version)).toEqual([0, 1])
  })

  it('reset drops unsaved changes; revert discards the saved edit via a versioned delete', async () => {
    const c = new BlockEditController(meta(), server)
    c.startEdit()
    c.setDraft('edit\n')
    await c.save()
    c.setDraft('more\n')
    c.resetDraft()
    expect(c.getSnapshot().draft).toBe('edit\n')
    await c.revertToOriginal()
    expect(server.removes).toBe(1)
    expect(c.getSnapshot()).toMatchObject({ saved: null, version: 0, draft: 'print(1)\n', editing: false })
  })

  it('hydrate never overwrites text being edited and never goes back to an older version', async () => {
    const c = new BlockEditController(meta(), server)
    c.startEdit()
    c.setDraft('typing...\n')
    c.hydrate({ ...server.rows.get('x')!, content: 'remote', version: 5 } as SourceEditDoc)
    expect(c.getSnapshot()).toMatchObject({ draft: 'typing...\n', version: 0 })
    c.close()
    c.hydrate({ content: 'v3', version: 3, updated_at: 'now' } as SourceEditDoc)
    c.hydrate({ content: 'v2', version: 2, updated_at: 'now' } as SourceEditDoc)
    expect(c.getSnapshot()).toMatchObject({ saved: 'v3', version: 3 })
  })
})

describe('registry isolation', () => {
  it('keeps state separate per user, conversation, message and block, and clears on a user change', () => {
    const a = getBlockController('u1', meta(), server)
    expect(getBlockController('u1', meta(), server)).toBe(a)
    expect(getBlockController('u2', meta(), server)).not.toBe(a)
    expect(getBlockController('u1', meta({ conversationId: 'c2' }), server)).not.toBe(a)
    expect(getBlockController('u1', meta({ messageId: MSG2 }), server)).not.toBe(a)
    expect(getBlockController('u1', meta({ blockId: 'other' }), server)).not.toBe(a)
    act(() => useAuthStore.setState({ user: { id: 'u2' } as never }))
    expect(getBlockController('u1', meta(), server)).not.toBe(a)
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────── the rendered block

describe('code block UI', () => {
  it('offers Edit, Copy and Download for a final answer, and only Copy/Download (no editing) while it streams', async () => {
    const { unmount } = render(ui(answer('print(1)')))
    const block = await screen.findByTestId('source-block')
    expect(within(block).getByRole('button', { name: 'Edit code' })).toBeInTheDocument()
    expect(within(block).getByRole('button', { name: 'Copy code' })).toBeInTheDocument()
    expect(within(block).getByRole('button', { name: 'Download code' })).toBeInTheDocument()
    expect(within(block).getByTestId('source-filename').textContent).toBe('snippet.py')
    expect(within(block).getByText('python')).toBeInTheDocument()
    unmount()
    render(ui(answer('print(1)'), { enabled: false }))
    const streaming = await screen.findByTestId('source-block')
    expect(within(streaming).queryByRole('button', { name: 'Edit code' })).toBeNull()
    expect(within(streaming).getByRole('button', { name: 'Download code' })).toBeInTheDocument()
    expect(server.puts).toHaveLength(0)
  })

  it('edit → save → the edited source shows with an Edited badge, the original stays reachable, and nothing else changes', async () => {
    const code = "def greet(name):\n\treturn f'héllo {name} ✓ 日本語'"
    render(ui(answer(code)))
    await userEvent.click(await screen.findByRole('button', { name: 'Edit code' }))
    const edited = "def greet(name):\n\treturn f'bonjour {name} ✓ 日本語 🚀'  \n"
    await setEditorText(edited)
    await waitFor(() => expect(screen.getByTestId('edit-status').textContent).toContain('Unsaved changes'))
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(screen.getByTestId('edit-status').textContent).toContain('Saved'))
    expect(server.puts[0]!.body.content).toBe(edited) // exact text, trailing spaces and newline included
    await userEvent.click(screen.getByRole('button', { name: /Close/ }))
    expect(await screen.findByTestId('edited-badge')).toHaveTextContent('Edited · v1')
    expect(screen.getByTestId('source-block').textContent).toContain('bonjour')
    await userEvent.click(screen.getByRole('button', { name: /Show original/ }))
    expect(screen.getByTestId('source-block').textContent).toContain('héllo')
    expect(screen.getByTestId('source-block').textContent).not.toContain('bonjour')
    expect(screen.getByText('Done.')).toBeInTheDocument() // the rest of the answer is untouched
  })

  it('persists across a reload: a fresh page/session restores the saved edit and Download gives exactly those bytes', async () => {
    const first = render(ui(answer('print(1)')))
    await userEvent.click(await screen.findByRole('button', { name: 'Edit code' }))
    const text = 'print("änderung ✓")\n\tindented\n'
    await setEditorText(text)
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(server.rows.size).toBe(1))
    first.unmount()
    resetBlockControllers() // a reload loses all in-memory client state
    render(ui(answer('print(1)'), { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }))
    expect(await screen.findByTestId('edited-badge')).toHaveTextContent('Edited · v1')
    await userEvent.click(screen.getByRole('button', { name: 'Download code' }))
    expect(clicks.at(-1)).toEqual({ download: 'snippet.py' })
    const bytes = new Uint8Array(await captured.at(-1)!.arrayBuffer())
    expect([...bytes]).toEqual([...new TextEncoder().encode(text)])
    expect(await sha256Hex(new TextDecoder().decode(bytes))).toBe(await sha256Hex(server.rows.values().next().value!.content))
  })

  it('shows Retry after a network failure, keeps the text, and the retry saves it once', async () => {
    render(ui(answer('a = 1')))
    await userEvent.click(await screen.findByRole('button', { name: 'Edit code' }))
    await setEditorText('a = 2')
    server.failNext = new ApiError('network', 'Cannot reach the server.')
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(screen.getByTestId('edit-status').textContent).toContain("Couldn't save"))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByTestId('edit-status').textContent).toContain('Saved'))
    expect(server.puts).toHaveLength(2)
    expect(server.rows.size).toBe(1)
  })

  it('on a conflict keeps the user text on screen and offers Keep mine / Use the other version / Copy mine', async () => {
    render(ui(answer('a = 1')))
    await userEvent.click(await screen.findByRole('button', { name: 'Edit code' }))
    await setEditorText('mine')
    const id = [...server.puts].length // none yet
    expect(id).toBe(0)
    const blockId = makeBlockId('0', 3, 'a = 1')
    server.external(CONV, MSG, blockId, 'theirs')
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('saved elsewhere')
    expect(within(alert).getByRole('button', { name: 'Keep mine' })).toBeInTheDocument()
    expect(within(alert).getByRole('button', { name: 'Use the other version' })).toBeInTheDocument()
    expect(within(alert).getByRole('button', { name: 'Copy mine' })).toBeInTheDocument()
    expect(server.rows.get(`${CONV}|${MSG}|${blockId}`)!.content).toBe('theirs') // nothing overwritten
    await userEvent.click(within(alert).getByRole('button', { name: 'Keep mine' }))
    await waitFor(() => expect(server.rows.get(`${CONV}|${MSG}|${blockId}`)!.content).toBe('mine'))
  })

  it('keeps an unsaved draft when the conversation is switched away and back, and never shows it in another conversation', async () => {
    const first = render(ui(answer('a = 1'), { conversation: 'c1' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Edit code' }))
    await setEditorText('draft in c1')
    first.unmount()
    render(ui(answer('a = 1'), { conversation: 'c2' }))
    expect((await screen.findByTestId('source-block')).textContent).not.toContain('draft in c1')
    expect(screen.queryByTestId('edit-status')).toBeNull()
    cleanup()
    render(ui(answer('a = 1'), { conversation: 'c1' }))
    await waitFor(() => expect(screen.getByTestId('edit-status').textContent).toContain('Unsaved changes'))
    expect(document.querySelector('.cm-content')!.textContent).toContain('draft in c1')
    expect(server.puts).toHaveLength(0) // leaving never saved or lost it silently
  })

  it('edits several blocks independently and identical blocks in different messages independently', async () => {
    const two = '```js\nlet a = 1\n```\n\ntext\n\n```js\nlet a = 1\n```'
    render(ui(two))
    const buttons = await screen.findAllByRole('button', { name: 'Edit code' })
    expect(buttons).toHaveLength(2)
    await userEvent.click(buttons[0]!)
    await setEditorText('let a = 100')
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(server.rows.size).toBe(1))
    const blocks = screen.getAllByTestId('source-block')
    expect(blocks[1]!.textContent).toContain('let a = 1')
    expect(blocks[1]!.textContent).not.toContain('let a = 100')
    expect(blocks[1]!.querySelector('[data-testid="edited-badge"]')).toBeNull()
    expect(new Set([...server.rows.values()].map((r) => r.block_id)).size).toBe(1)
  })

  it('unknown languages download as .txt and stay editable', async () => {
    render(ui(answer('weird stuff', 'zzzlang')))
    const block = await screen.findByTestId('source-block')
    expect(within(block).getByTestId('source-filename').textContent).toBe('snippet.txt')
    expect(within(block).getByRole('button', { name: 'Edit code' })).toBeInTheDocument()
    await userEvent.click(within(block).getByRole('button', { name: 'Download code' }))
    expect(clicks.at(-1)).toEqual({ download: 'snippet.txt' })
  })

  it('entering and leaving edit mode does not touch the server or re-render the answer text', async () => {
    render(ui(answer('a = 1')))
    await userEvent.click(await screen.findByRole('button', { name: 'Edit code' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(server.puts).toHaveLength(0)
    expect(screen.getByText('Done.')).toBeInTheDocument()
  })

  it('is operable from the keyboard with an accessible name and Ctrl+S', async () => {
    render(ui(answer('a = 1')))
    const edit = await screen.findByRole('button', { name: 'Edit code' })
    edit.focus()
    await userEvent.keyboard('{Enter}')
    const content = await waitFor(() => {
      const el = document.querySelector('.cm-content') as HTMLElement
      expect(el).not.toBeNull()
      return el
    })
    expect(content.getAttribute('aria-label')).toBe('Edit python code')
    expect(content.getAttribute('role')).toBe('textbox')
    expect(content.getAttribute('aria-multiline')).toBe('true')
    await setEditorText('a = 5')
    fireEvent.keyDown(content, { key: 's', ctrlKey: true })
    await waitFor(() => expect(server.puts).toHaveLength(1))
  })

  it('keeps CRLF line endings of a saved edit exactly (the editor joins lines with the original separator)', async () => {
    const blockId = makeBlockId('0', 3, 'a = 1')
    server.external(CONV, MSG, blockId, CRLF_TEXT)
    render(ui(answer('a = 1')))
    await screen.findByTestId('edited-badge')
    await userEvent.click(screen.getByRole('button', { name: 'Edit code' }))
    const view = await setEditorText(CRLF_TEXT)
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: 'c' } }))
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(server.puts.at(-1)!.body.content).toBe(CRLF_TEXT + 'c'))
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────── documents (text / Markdown)

describe('response as a document', () => {
  const md = '# Plan\n\n- [ ] step one\n\n[x](javascript:alert(1))\n'

  it('downloads the answer as .md, edits it as a separate copy, and keeps the original message visible and unchanged', async () => {
    render(ui(md, { withResponse: true }))
    await userEvent.click(screen.getByRole('button', { name: 'Download response as Markdown' }))
    expect(clicks.at(-1)).toEqual({ download: 'response.md' })
    expect(new TextDecoder().decode(await captured.at(-1)!.arrayBuffer())).toBe(md)
    await userEvent.click(screen.getByRole('button', { name: 'Edit response as a document' }))
    const card = await screen.findByTestId('response-edit-card')
    expect(card.textContent).toContain('the answer above is unchanged')
    const next = '# Plan v2\n\n- [x] step one\n\n<script>window.__pwned = 1</script>\n'
    await setEditorText(next)
    await userEvent.click(within(card).getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(server.puts.at(-1)!.body).toMatchObject({ content: next, source_format: 'markdown', language: 'markdown' }))
    await userEvent.click(within(card).getByRole('button', { name: /Close/ }))
    expect(await within(card).findByRole('heading', { name: 'Plan v2' })).toBeInTheDocument()
    expect(card.querySelector('script')).toBeNull() // Markdown source is canonical; HTML is never rendered
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
    expect(document.querySelectorAll('h1')).toHaveLength(2) // the original answer is still rendered above
    await userEvent.click(within(card).getByRole('button', { name: 'Download my copy' }))
    expect(new TextDecoder().decode(await captured.at(-1)!.arrayBuffer())).toBe(next)
  })

  it('keeps unsafe URLs out of the rendered preview', async () => {
    render(ui(md, { withResponse: true }))
    await screen.findByText('Plan')
    expect([...document.querySelectorAll('a')].every((a) => !/^\s*javascript:/i.test(a.getAttribute('href') ?? ''))).toBe(true)
  })

  it('shows no document editing while the answer streams', async () => {
    render(ui(md, { withResponse: true, enabled: false }))
    await screen.findByText('Plan')
    expect(screen.queryByRole('button', { name: 'Edit response as a document' })).toBeNull()
    expect(screen.queryByTestId('response-edit-card')).toBeNull()
  })

  it('two chat windows on the same message share one controller; another conversation does not', async () => {
    const a = getBlockController('u1', { ...meta({ blockId: 'response', format: 'markdown', language: 'markdown' }) }, server)
    const b = getBlockController('u1', { ...meta({ blockId: 'response', format: 'markdown', language: 'markdown' }) }, server)
    expect(a).toBe(b)
    expect(getBlockController('u1', { ...meta({ blockId: 'response', conversationId: 'c9' }) }, server)).not.toBe(a)
  })
})
