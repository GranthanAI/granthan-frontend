import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { AiPreferencesSettings, MemorySettingsPage, DocumentsSettings, SecuritySettings } from '@/pages/SettingsPage'
import { normalizePreferences } from '@/features/preferences/usePreferences'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const prefs = (over: Record<string, unknown> = {}) => ({
  default_mode: null,
  default_tools: [],
  answer_length: 'balanced',
  tone: 'professional',
  language: 'auto',
  personal_instructions: '',
  citations: 'show',
  document_context: 'conversation',
  version: 1,
  updated_at: null,
  options: {
    answer_length: ['concise', 'balanced', 'detailed'],
    tone: ['professional', 'friendly', 'simple'],
    citations: ['show', 'hide'],
    document_context: ['conversation', 'attached_only'],
    languages: [{ code: 'auto', name: 'Auto' }, { code: 'en', name: 'English' }],
    personal_instructions_max: 1000,
  },
  ...over,
})

const toolsBody = {
  tools: [{ id: 'web_search', name: 'Web Search', description: '', version: '1', parameters: [], auto_runnable: true }],
  max_selected: 5,
  modes: [{ id: 'research', name: 'Research' }],
}

interface Call { method: string; path: string; body: unknown }

function mock(handler: (c: Call) => Response | undefined) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      const call = { method: init?.method ?? 'GET', path: url.pathname.replace('/api/v1', ''), body: init?.body ? JSON.parse(String(init.body)) : undefined }
      calls.push(call)
      return handler(call) ?? json(404, { detail: 'not mocked' })
    }),
  )
  return calls
}

function renderPage(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('normalizePreferences', () => {
  it('fills missing fields with defaults', () => {
    const p = normalizePreferences({ tone: 'friendly' } as never)
    expect(p.tone).toBe('friendly')
    expect(p.answer_length).toBe('balanced')
    expect(p.default_tools).toEqual([])
  })
})

describe('AI preferences page', () => {
  it('saves only the changed fields together with the version', async () => {
    const calls = mock((c) => {
      if (c.path === '/tools') return json(200, toolsBody)
      if (c.path === '/preferences' && c.method === 'GET') return json(200, prefs({ version: 3 }))
      if (c.path === '/preferences' && c.method === 'PATCH') return json(200, prefs({ version: 4, tone: 'friendly' }))
    })
    renderPage(<AiPreferencesSettings />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'Friendly' }))
    await user.click(screen.getByRole('button', { name: 'Save preferences' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ version: 3, tone: 'friendly' })
  })

  it('Save is disabled until something changes', async () => {
    mock((c) => (c.path === '/tools' ? json(200, toolsBody) : c.path === '/preferences' ? json(200, prefs()) : undefined))
    renderPage(<AiPreferencesSettings />)
    expect(await screen.findByRole('button', { name: 'Save preferences' })).toBeDisabled()
  })

  it('explains a version conflict and reloads the latest values', async () => {
    mock((c) => {
      if (c.path === '/tools') return json(200, toolsBody)
      if (c.method === 'GET') return json(200, prefs())
      if (c.method === 'PATCH') return json(409, { detail: { message: 'changed', current_version: 9 } })
    })
    renderPage(<AiPreferencesSettings />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'Simple' }))
    await user.click(screen.getByRole('button', { name: 'Save preferences' }))
    expect(await screen.findByText(/changed somewhere else/i)).toBeInTheDocument()
  })

  it('warns about a saved default mode the backend no longer offers', async () => {
    mock((c) => {
      if (c.path === '/tools') return json(200, toolsBody)
      if (c.path === '/preferences') return json(200, prefs({ default_mode: 'retired_mode', default_tools: ['gone_tool'] }))
    })
    renderPage(<AiPreferencesSettings />)
    expect(await screen.findByText(/no longer available; Auto is used/i)).toBeInTheDocument()
    expect(screen.getByText(/gone_tool/)).toBeInTheDocument()
  })

  it('offers only the modes and tools the backend returns', async () => {
    mock((c) => (c.path === '/tools' ? json(200, toolsBody) : c.path === '/preferences' ? json(200, prefs()) : undefined))
    renderPage(<AiPreferencesSettings />)
    expect(await screen.findByRole('option', { name: 'Research' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Web Search' })).toBeInTheDocument()
  })
})

describe('Memory page', () => {
  const fact = { id: 'f1', category: 'preference', statement: 'Prefers Python', importance: 0.5, created_at: null, conversation_id: null }

  it('lists facts and pausing is sent to the server', async () => {
    const calls = mock((c) => {
      if (c.path === '/memory/facts' && c.method === 'GET') return json(200, { items: [fact], memory_enabled: true })
      if (c.path === '/memory/settings' && c.method === 'PUT') return json(200, { memory_enabled: false })
    })
    renderPage(<MemorySettingsPage />)
    expect(await screen.findByText('Prefers Python')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('switch', { name: /use and learn memory/i }))
    await waitFor(() => expect(screen.getByText(/Paused:/)).toBeInTheDocument())
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ memory_enabled: false })
  })

  it('deletes a fact only after confirmation', async () => {
    const calls = mock((c) => {
      if (c.path === '/memory/facts' && c.method === 'GET') return json(200, { items: [fact], memory_enabled: true })
      if (c.method === 'DELETE') return new Response(null, { status: 204 })
    })
    renderPage(<MemorySettingsPage />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /delete memory: prefers python/i }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('Prefers Python')).not.toBeInTheDocument())
    expect(calls.find((c) => c.method === 'DELETE')!.path).toBe('/memory/facts/f1')
  })

  it('shows an error instead of an empty list when loading fails', async () => {
    mock(() => json(403, { detail: 'forbidden' }))
    renderPage(<MemorySettingsPage />)
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.queryByText(/nothing saved yet/i)).not.toBeInTheDocument()
  })
})

describe('Documents page', () => {
  it('shows the server-provided reason for a failed document and offers retry only for it', async () => {
    mock((c) => {
      if (c.path === '/files') return json(200, { items: [
        { document_id: 'd1', filename: 'scan.pdf', status: 'FAILED' },
        { document_id: 'd2', filename: 'ok.pdf', status: 'READY' },
      ], next_cursor: null })
      if (c.path === '/files/d1/status') return json(200, { document_id: 'd1', status: 'FAILED', retry_count: 1, error_code: 'NO_TEXT', error_message: 'No readable text was found.' })
    })
    renderPage(<DocumentsSettings />)
    expect(await screen.findByText('No readable text was found.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1)
  })
})

describe('Security page', () => {
  it('lists devices, marks this one and lets only others be signed out', async () => {
    mock((c) => {
      if (c.path === '/auth/sessions' && c.method === 'GET') return json(200, [
        { id: 's1', device: 'PC', browser: 'Chrome', os: 'Windows', ip_address: '1.2.3.4', created_at: '', last_seen: '2026-01-01T00:00:00Z', expires_at: '', is_current: true },
        { id: 's2', device: 'Phone', browser: 'Safari', os: 'iOS', ip_address: null, created_at: '', last_seen: '2026-01-01T00:00:00Z', expires_at: '', is_current: false },
      ])
    })
    renderPage(<SecuritySettings />)
    expect(await screen.findByText('This device')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Sign out other devices' })).toBeInTheDocument()
  })
})
