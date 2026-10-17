import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ContextPanel } from '@/components/layout/ContextPanel'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'
import type { Conversation } from '@/types/api'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const conversation: Conversation = {
  conversation_id: 'c1', user_id: 'u', title: 'Handbook chat', created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z', status: 'active', parent_conversation_id: null,
}

const record = (id: string, filename: string, status: string) => ({
  document_id: id, conversation_id: null, owner_id: 'u', filename, content_type: 'application/pdf',
  size_bytes: 10, status, current_version: 1, created_at: '', updated_at: '',
})

function mock({ listed = [] as unknown[], files = {} as Record<string, unknown>, messages = [] as unknown[] }) {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const path = new URL(input).pathname.replace('/api/v1', '')
    if (path === '/files') return json(200, { items: listed, next_cursor: null })
    const fm = /^\/files\/([^/]+)$/.exec(path)
    if (fm) return files[fm[1]!] ? json(200, files[fm[1]!]) : json(404, { message: 'nope' })
    if (path.endsWith('/messages')) return json(200, { items: messages, next_cursor: null, has_more: false })
    if (path.startsWith('/graph')) return json(200, [])
    return json(200, {})
  }))
}

const msg = (id: string, fileIds: string[]) => ({
  message_id: id, conversation_id: 'c1', sender: 'user', content: 'q', created_at: '2026-01-01T00:00:00Z',
  status: 'sent', file_ids: fileIds,
})

function renderPanel() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ContextPanel conversation={conversation} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null, expired: false })
  useUiStore.setState({ panelOpen: true, panelTab: 'files' })
})
afterEach(() => vi.unstubAllGlobals())

describe('right panel: Files tab', () => {
  it('shows a document attached to a message even though the file has no conversation_id', async () => {
    // Uploaded from the new-chat screen: File Service never learned the conversation, so list-by-conversation is empty.
    mock({ listed: [], files: { 'doc-1': record('doc-1', 'handbook.pdf', 'READY') }, messages: [msg('m1', ['doc-1'])] })
    renderPanel()
    expect(await screen.findByText('handbook.pdf')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })

  it('merges files listed by conversation with files attached to messages, without duplicates', async () => {
    mock({
      listed: [{ document_id: 'doc-1', filename: 'handbook.pdf', status: 'READY' }],
      files: { 'doc-1': record('doc-1', 'handbook.pdf', 'READY'), 'doc-2': record('doc-2', 'notes.txt', 'PROCESSING') },
      messages: [msg('m1', ['doc-1']), msg('m2', ['doc-1', 'doc-2'])],
    })
    renderPanel()
    expect(await screen.findByText('notes.txt')).toBeInTheDocument()
    expect(screen.getAllByText('handbook.pdf')).toHaveLength(1)
    expect(screen.getByText('Processing for search')).toBeInTheDocument()
  })

  it('hides deleted documents and shows the empty state when nothing is attached', async () => {
    mock({ files: { 'doc-9': record('doc-9', 'gone.pdf', 'DELETED') }, messages: [msg('m1', ['doc-9'])] })
    renderPanel()
    expect(await screen.findByText('No files in this conversation')).toBeInTheDocument()
    expect(screen.queryByText('gone.pdf')).not.toBeInTheDocument()
  })
})
