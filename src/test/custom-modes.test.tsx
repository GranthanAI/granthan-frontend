import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { AiPreferencesSettings, CustomModesSettings } from '@/pages/SettingsPage'
import { Composer } from '@/components/chat/Composer'
import { useModeSelectionStore, useToolSelectionStore } from '@/features/tools/useTools'
import { useAuthStore } from '@/stores/auth.store'
import { useDraftStore } from '@/stores/draft.store'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const MODE_ID = '3f2c1c2e-0000-4000-8000-000000000001'
const mode = (over: Record<string, unknown> = {}) => ({
  mode_id: MODE_ID, mode_ref: `custom:${MODE_ID}`, name: 'Code reviewer', description: 'Strict reviews',
  instructions: 'Review code strictly.', execution_style: 'direct', status: 'active', version: 1,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', archived_at: null, ...over,
})
const list = (items: unknown[], over: Record<string, unknown> = {}) => ({
  items, total: items.length, limit: 100, offset: 0, max_per_user: 3, limits: { name: 60, description: 200, instructions: 4000 }, ...over,
})
const prefs = (over: Record<string, unknown> = {}) => ({
  default_mode: null, default_tools: [], answer_length: 'balanced', tone: 'professional', language: 'auto',
  personal_instructions: '', citations: 'show', document_context: 'conversation', version: 1, updated_at: null,
  default_mode_available: true,
  options: { answer_length: ['concise', 'balanced', 'detailed'], tone: ['professional', 'friendly', 'simple'], citations: ['show', 'hide'],
    document_context: ['conversation', 'attached_only'], languages: [{ code: 'auto', name: 'Auto' }], personal_instructions_max: 1000 },
  ...over,
})
const toolsBody = { tools: [], max_selected: 5, modes: [{ id: 'tutor', name: 'Tutor', description: 'Teaches' }] }

interface Call { method: string; path: string; body: unknown }
function mock(handler: (c: Call) => Response | undefined) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const call = { method: init?.method ?? 'GET', path: url.pathname.replace('/api/v1', ''), body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    return handler(call) ?? json(404, { detail: 'not mocked' })
  }))
  return calls
}

function renderPage(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
  return qc
}

beforeEach(() => {
  useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null, expired: false })
  useToolSelectionStore.setState({ byKey: {} })
  useModeSelectionStore.setState({ modeByKey: {} })
  useDraftStore.setState({ drafts: {} })
})
afterEach(() => vi.unstubAllGlobals())

describe('Custom modes settings', () => {
  it('lists the server\'s modes and shows an empty state', async () => {
    mock((c) => (c.path === '/custom-modes' ? json(200, list([])) : undefined))
    renderPage(<CustomModesSettings />)
    expect(await screen.findByText('No custom modes yet')).toBeInTheDocument()
  })

  it('creates a mode with the entered values and only reports success after the server confirms', async () => {
    const calls = mock((c) => {
      if (c.path === '/custom-modes' && c.method === 'GET') return json(200, list([]))
      if (c.path === '/custom-modes' && c.method === 'POST') return json(201, mode({ name: 'Mentor' }))
    })
    renderPage(<CustomModesSettings />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /new mode/i }))
    expect(screen.getByRole('button', { name: 'Create mode' })).toBeDisabled()           // nothing entered yet
    await user.type(screen.getByLabelText('Name'), '  Mentor ')
    await user.type(screen.getByLabelText('Instructions'), 'Explain like a mentor.')
    await user.click(screen.getByRole('radio', { name: 'Smart' }))
    await user.click(screen.getByRole('button', { name: 'Create mode' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Mentor', description: '', instructions: 'Explain like a mentor.', execution_style: 'smart' })
  })

  it('shows a server error and keeps the form (no false success)', async () => {
    mock((c) => {
      if (c.method === 'GET') return json(200, list([]))
      return json(409, { detail: { code: 'name_taken', message: 'You already have a custom mode with that name.' } })
    })
    renderPage(<CustomModesSettings />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /new mode/i }))
    await user.type(screen.getByLabelText('Name'), 'Dup')
    await user.type(screen.getByLabelText('Instructions'), 'x')
    await user.click(screen.getByRole('button', { name: 'Create mode' }))
    expect(await screen.findByText(/already have a custom mode with that name/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Dup')
  })

  it('edits with the version it read and, on a conflict, keeps the user\'s edits and offers the latest', async () => {
    let served = mode()
    const calls = mock((c) => {
      if (c.method === 'GET') return json(200, list([served]))
      if (c.method === 'PATCH') return json(409, { detail: { code: 'version_conflict', message: 'This mode was changed elsewhere. Reload and try again.', current_version: 2 } })
    })
    renderPage(<CustomModesSettings />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Edit custom mode Code reviewer' }))
    const field = screen.getByLabelText('Instructions')
    await user.clear(field)
    await user.type(field, 'My edit')
    served = mode({ version: 2, instructions: 'Edited elsewhere' })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(/changed elsewhere/i)).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ version: 1, instructions: 'My edit' })
    expect(screen.getByLabelText('Instructions')).toHaveValue('My edit')            // unsaved changes preserved
    await user.click(await screen.findByRole('button', { name: 'Load latest' }))
    await waitFor(() => expect(screen.getByLabelText('Instructions')).toHaveValue('Edited elsewhere'))
  })

  it('archives only after confirmation', async () => {
    const calls = mock((c) => {
      if (c.method === 'GET') return json(200, list([mode()]))
      if (c.method === 'DELETE') return json(200, mode({ status: 'archived', version: 2 }))
    })
    renderPage(<CustomModesSettings />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Archive custom mode Code reviewer' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === `/custom-modes/${MODE_ID}`)).toBe(true))
  })

  it('explains the per-user limit and disables creation at it', async () => {
    mock((c) => (c.method === 'GET' ? json(200, list([mode(), mode({ mode_id: 'b', mode_ref: 'custom:b', name: 'B' })], { max_per_user: 2 })) : undefined))
    renderPage(<CustomModesSettings />)
    expect(await screen.findByText(/reached the limit of 2/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new mode/i })).toBeDisabled()
  })

  it('shows a load error with retry instead of an empty list', async () => {
    mock(() => json(403, { detail: 'forbidden' }))
    renderPage(<CustomModesSettings />)
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.queryByText('No custom modes yet')).not.toBeInTheDocument()
  })

  it('does not keep modes or drafts in browser storage', async () => {
    mock((c) => (c.method === 'GET' ? json(200, list([mode()])) : undefined))
    renderPage(<CustomModesSettings />)
    await screen.findByText('Code reviewer')
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
    expect(stored).not.toContain('Review code strictly')
  })
})

describe('custom modes in mode selection and defaults', () => {
  it('the composer menu offers custom modes next to the built-in ones and sends the custom reference', async () => {
    mock((c) => {
      if (c.path === '/tools') return json(200, toolsBody)
      if (c.path === '/custom-modes') return json(200, list([mode()]))
      if (c.path === '/preferences') return json(200, prefs())
    })
    const onSend = vi.fn(async () => true)
    renderPage(<Composer conversationId="c1" draftKey="c1" busy={false} onSend={onSend} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^tools/i }))
    expect(await screen.findByRole('radio', { name: /tutor/i })).toBeInTheDocument()
    await user.click(await screen.findByRole('radio', { name: /code reviewer/i }))
    await user.type(screen.getByLabelText('Message GranthanAI'), 'review this')
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('review this', [], undefined, `custom:${MODE_ID}`))
  })

  it('a stored custom mode that was archived is dropped with a notice once the list has loaded', async () => {
    useModeSelectionStore.setState({ modeByKey: { c1: `custom:${MODE_ID}` } })
    mock((c) => {
      if (c.path === '/tools') return json(200, toolsBody)
      if (c.path === '/custom-modes') return json(200, list([]))
      if (c.path === '/preferences') return json(200, prefs())
    })
    renderPage(<Composer conversationId="c1" draftKey="c1" busy={false} onSend={vi.fn(async () => true)} />)
    await waitFor(() => expect(useModeSelectionStore.getState().modeByKey['c1']).toBeUndefined())
  })

  it('a stored custom mode is kept while the custom-mode list is still loading', async () => {
    useModeSelectionStore.setState({ modeByKey: { c1: `custom:${MODE_ID}` } })
    mock((c) => {
      if (c.path === '/tools') return json(200, toolsBody)
      if (c.path === '/custom-modes') return new Promise<Response>(() => {}) as unknown as Response
      if (c.path === '/preferences') return json(200, prefs())
    })
    renderPage(<Composer conversationId="c1" draftKey="c1" busy={false} onSend={vi.fn(async () => true)} />)
    await new Promise((r) => setTimeout(r, 150))
    expect(useModeSelectionStore.getState().modeByKey['c1']).toBe(`custom:${MODE_ID}`)
  })

  it('AI preferences can set a custom mode as the default and warns when the saved one was archived', async () => {
    const calls = mock((c) => {
      if (c.path === '/tools') return json(200, toolsBody)
      if (c.path === '/custom-modes') return json(200, list([mode()]))
      if (c.path === '/preferences' && c.method === 'GET') return json(200, prefs({ default_mode: 'custom:gone', default_mode_available: false, version: 2 }))
      if (c.path === '/preferences' && c.method === 'PATCH') return json(200, prefs({ default_mode: `custom:${MODE_ID}`, version: 3 }))
    })
    renderPage(<AiPreferencesSettings />)
    expect(await screen.findByText(/no longer available; Auto is used instead/i)).toBeInTheDocument()
    const user = userEvent.setup()
    await user.selectOptions(await screen.findByLabelText('Default response mode'), `custom:${MODE_ID}`)
    await user.click(screen.getByRole('button', { name: 'Save preferences' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ version: 2, default_mode: `custom:${MODE_ID}` })
  })
})
