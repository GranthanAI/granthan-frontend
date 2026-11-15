import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Composer } from '@/components/chat/Composer'
import { MessageItem } from '@/components/chat/MessageItem'
import { meterLevel } from '@/components/chat/UsageMeter'
import { adoptNewChatModel, useModelSelectionStore } from '@/features/billing/model-selection'
import { buildDisplay } from '@/features/messages/display'
import { cancelRun, regenerate, sendMessage } from '@/features/messages/chat-controller'
import { useAuthStore } from '@/stores/auth.store'
import { useChatStore } from '@/stores/chat.store'
import { useDraftStore } from '@/stores/draft.store'
import type { ApiMessage } from '@/types/api'
import type { BillingMe, MyModelsResponse } from '@/types/billing'
import { meFree, meMax, mePro, modelsFree, modelsMax, modelsPro, plansResponse } from './billing-fixtures'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface Setup {
  me?: BillingMe
  models?: MyModelsResponse | 'fail'
  defaultModel?: string
  plans?: boolean
}

/** Mocks only the HTTP boundary and records what the app sends. */
function mockApi({ me = meFree, models = modelsFree, defaultModel = 'auto', plans = false }: Setup = {}) {
  const sent: Array<{ path: string; method: string; body: Record<string, unknown> | null }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname.replace('/api/v1', '')
      const method = init?.method ?? 'GET'
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
      sent.push({ path, method, body })
      if (path === '/billing/me') return json(200, me)
      if (plans && path === '/billing/plans') return json(200, plansResponse)
      if (path === '/billing/me/models') return models === 'fail' ? json(500, { detail: 'x' }) : json(200, models)
      if (path === '/preferences' && method === 'PATCH') return json(200, { default_mode: null, default_tools: [], version: 2, ...body })
      if (path === '/preferences') return json(200, { default_mode: null, default_tools: [], version: 1, default_model: defaultModel })
      if (path === '/tools') return json(200, { tools: [], max_selected: 5 })
      if (method === 'POST' && path.endsWith('/regenerate')) return json(202, { message_id: 'a2', response_message_id: 'a2', conversation_id: 'c1', sender: 'assistant', content: '', created_at: '', status: 'pending' })
      if (method === 'POST' && path.endsWith('/messages')) return json(202, { message_id: 'm1', response_message_id: 'a1', conversation_id: 'c1', sender: 'user', content: 'x', created_at: '', status: 'sent' })
      if (path.startsWith('/stream/')) return json(503, { detail: 'down' })
      return json(200, { items: [], next_cursor: null, has_more: false })
    }),
  )
  return { sent }
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

function renderComposer(key = 'c1', qc = newClient()) {
  const view = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Composer conversationId={key === 'new' ? null : key} draftKey={key} busy={false} onSend={vi.fn(async () => true)} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { qc, ...view }
}

const pickerButton = () => screen.findByRole('button', { name: /^model,/i })
const open = async () => userEvent.click(await pickerButton())

beforeEach(() => {
  useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null, expired: false })
  useModelSelectionStore.setState({ modelByKey: {} })
  useDraftStore.setState({ drafts: {} })
  useChatStore.setState({ runs: {}, citations: {} })
})
afterEach(() => {
  cancelRun('c1')
  vi.unstubAllGlobals()
})

describe('model picker', () => {
  it('lists included models by group with a description; models the plan lacks sit in an "On Pro" section, not greyed or locked', async () => {
    mockApi({ models: modelsFree })
    renderComposer()
    await open()
    const dialog = await screen.findByRole('dialog', { name: 'Models' })
    const groups = within(dialog).getAllByRole('group').map((g) => g.getAttribute('aria-label'))
    expect(groups).toEqual(['Fast', 'On Pro', 'With credits'])
    expect(within(dialog).getByText('Quick, everyday answers.')).toBeInTheDocument()
    expect(within(dialog).queryByRole('radio', { name: /auto/i })).toBeNull()
    expect(within(dialog).getByRole('radio', { name: /llama fast/i })).toBeEnabled()
    // not included: a normal button with a small plan badge, never a padlock or a link
    expect(within(dialog).queryByRole('link')).toBeNull()
    const pro = within(within(dialog).getByRole('group', { name: 'On Pro' })).getAllByRole('button')
    expect(pro.map((b) => b.textContent)).toEqual(['Llama SmartSmartPro', 'Best OneAdvancedPro'])
    expect(within(dialog).getByRole('group', { name: 'With credits' })).toHaveTextContent('Ultra One')
    expect(within(dialog).queryByRole('radio', { name: /llama smart/i })).toBeNull()
    expect(dialog.innerHTML).not.toMatch(/lucide-lock/)
  })

  it('choosing a model the plan lacks opens a friendly comparison with See plans, not an error', async () => {
    mockApi({ models: modelsFree })
    renderComposer()
    await open()
    await userEvent.click(await screen.findByRole('button', { name: /best one/i }))
    const info = await screen.findByRole('dialog', { name: 'About Best One' })
    expect(info).toHaveTextContent('Best One is included with Pro.')
    expect(within(info).getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/pricing')
    expect(screen.queryByRole('alert')).toBeNull()
    // the choice did not change
    expect(useModelSelectionStore.getState().modelByKey).toEqual({})
  })

  it('names the plans and the Advanced allowance from /billing/plans', async () => {
    const models = {
      ...modelsFree,
      groups: modelsFree.groups.map((g) =>
        g.group === 'best' ? { ...g, models: [{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', provider: 'anthropic', allowed: false }] } : g,
      ),
    }
    mockApi({ models, plans: true })
    renderComposer()
    await open()
    await userEvent.click(await screen.findByRole('button', { name: /claude sonnet 5\.5/i }))
    const info = await screen.findByRole('dialog', { name: 'About Claude Sonnet 5.5' })
    expect(info).toHaveTextContent('Claude Sonnet 5.5 is included with Pro and Max: Advanced answers every day: 5 on Pro, 15 on Max.')
  })

  it('unlocks Smart on Pro and shows the Advanced answers left on Max', async () => {
    mockApi({ models: modelsPro })
    const first = renderComposer()
    await open()
    expect(await screen.findByRole('radio', { name: /llama smart/i })).toBeEnabled()
    expect(screen.getByTestId('advanced-line')).toHaveTextContent('4 Advanced answers left today · refreshes at 12:00 am')
    first.unmount()

    mockApi({ models: modelsMax })
    renderComposer()
    await open()
    expect(await screen.findByText('8 Advanced answers left today · refreshes at 12:00 am')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /best one/i })).toBeEnabled()
  })

  it('at 0 the allowance line says Smart continues', async () => {
    const used = { ...modelsPro, groups: modelsPro.groups.map((g) => (g.group === 'best' ? { ...g, remaining_today: 0 } : g)) }
    mockApi({ models: used })
    renderComposer()
    await open()
    expect(await screen.findByTestId('advanced-line')).toHaveTextContent("Today's Advanced answers are used · Smart continues · refreshes at 12:00 am")
    expect(screen.getByRole('radio', { name: /best one/i })).toBeEnabled() // still selectable: the answer continues on Smart
  })

  it('is hidden when /billing/me/models fails', async () => {
    mockApi({ models: 'fail' })
    renderComposer()
    await screen.findByRole('button', { name: /modes/i })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('button', { name: /^model,/i })).toBeNull()
  })

  it('new chats start on preferences.default_model', async () => {
    mockApi({ models: modelsPro, defaultModel: 'llama-smart' })
    renderComposer('new')
    expect(await screen.findByRole('button', { name: 'Model, Llama Smart' })).toBeInTheDocument()
  })

  it('a saved default the plan no longer allows shows the default model', async () => {
    mockApi({ models: modelsFree, defaultModel: 'best-1' })
    renderComposer('new')
    expect(await screen.findByRole('button', { name: 'Model, Llama Fast' })).toBeInTheDocument()
  })

  it('the choice is kept per conversation', async () => {
    mockApi({ models: modelsPro })
    const a = renderComposer('c1')
    await open()
    await userEvent.click(await screen.findByRole('radio', { name: /llama smart/i }))
    expect(await screen.findByRole('button', { name: 'Model, Llama Smart' })).toBeInTheDocument()
    expect(useModelSelectionStore.getState().modelByKey).toEqual({ c1: 'llama-smart' })
    a.unmount()
    renderComposer('c2')
    expect(await screen.findByRole('button', { name: 'Model, Llama Fast' })).toBeInTheDocument()
  })

  it('the new-chat choice moves to the conversation that was created', () => {
    useModelSelectionStore.getState().setModel('new', 'llama-smart')
    adoptNewChatModel('new', 'c9')
    expect(useModelSelectionStore.getState().modelByKey).toEqual({ c9: 'llama-smart' })
  })

  it('"Set as default" saves the preference', async () => {
    const { sent } = mockApi({ models: modelsPro })
    renderComposer('c1')
    await open()
    await userEvent.click(await screen.findByRole('radio', { name: /llama smart/i }))
    await open()
    await userEvent.click(await screen.findByRole('button', { name: /set as default/i }))
    await waitFor(() => expect(sent.find((r) => r.method === 'PATCH' && r.path === '/preferences')?.body).toMatchObject({ default_model: 'llama-smart' }))
  })
})

describe('the chosen model is sent', () => {
  it('on send, and not at all when none was chosen', async () => {
    const { sent } = mockApi()
    const qc = newClient()
    sendMessage(qc, 'c1', 'hello')
    await waitFor(() => expect(sent.some((r) => r.path === '/conversations/c1/messages' && r.method === 'POST')).toBe(true))
    expect(sent.find((r) => r.method === 'POST')?.body).not.toHaveProperty('model')
    cancelRun('c1')
    useChatStore.setState({ runs: {}, citations: {} })

    useModelSelectionStore.getState().setModel('c1', 'llama-smart')
    sendMessage(qc, 'c1', 'again')
    await waitFor(() => expect(sent.filter((r) => r.method === 'POST')).toHaveLength(2))
    expect(sent.filter((r) => r.method === 'POST')[1]?.body).toMatchObject({ content: 'again', model: 'llama-smart' })
  })

  it('on regenerate', async () => {
    const { sent } = mockApi()
    useModelSelectionStore.getState().setModel('c1', 'llama-smart')
    expect(regenerate(newClient(), 'c1', 'a0')).toBe(true)
    await waitFor(() => expect(sent.some((r) => r.path.endsWith('/a0/regenerate'))).toBe(true))
    expect(sent.find((r) => r.path.endsWith('/regenerate'))?.body).toEqual({ model: 'llama-smart' })
  })

  it('a chosen model the plan no longer allows is sent as the default model', async () => {
    const { sent } = mockApi()
    const qc = newClient()
    qc.setQueryData(['billing', 'me', 'models'], modelsFree)
    useModelSelectionStore.getState().setModel('c1', 'best-1')
    sendMessage(qc, 'c1', 'hi')
    await waitFor(() => expect(sent.some((r) => r.method === 'POST')).toBe(true))
    expect(sent.find((r) => r.method === 'POST')?.body).toMatchObject({ model: 'llama-fast' })
  })
})

describe('usage meter', () => {
  it('shows what is LEFT, the refresh time and the Advanced answers left', async () => {
    mockApi({ me: meMax, models: modelsMax })
    renderComposer()
    const meter = await screen.findByTestId('usage-meter')
    expect(meter).toHaveTextContent('60 messages left today · refreshes at 12:00 am · 8 Advanced left')
    expect(meter).toHaveAttribute('data-level', 'ok')
  })

  it('is calm until under 10% is left, then amber; never red', () => {
    expect(meterLevel(0, 80)).toBe('ok')
    expect(meterLevel(72, 80)).toBe('ok') // exactly 10% left
    expect(meterLevel(73, 80)).toBe('low')
    expect(meterLevel(80, 80)).toBe('low')
    expect(meterLevel(90, 80)).toBe('low')
  })

  it('counts down from the plan: 33 a day, 31 used is 2 left, amber', async () => {
    const me = { ...meFree, usage_today: { ...meFree.usage_today, total: 31 } }
    mockApi({ me: { ...me, limits: { ...me.limits, messages_per_day: 33 } } })
    renderComposer()
    const meter = await screen.findByTestId('usage-meter')
    expect(meter).toHaveTextContent('2 messages left today · refreshes at 12:00 am')
    expect(meter).toHaveAttribute('data-level', 'low')
    expect(meter.className).toMatch(/text-warn/)
    expect(meter.className).not.toMatch(/danger|red/)
  })

  it('at 0 says none are left (amber, not red) and is hidden when unlimited', async () => {
    const full = { ...mePro, usage_today: { ...mePro.usage_today, total: 10 }, limits: { ...mePro.limits, messages_per_day: 10 } }
    mockApi({ me: full })
    const v = renderComposer()
    const meter = await screen.findByTestId('usage-meter')
    expect(meter).toHaveTextContent('No messages left today · refreshes at 12:00 am')
    expect(meter.className).toMatch(/text-warn/)
    expect(meter.className).not.toMatch(/danger/)
    v.unmount()
    mockApi({ me: { ...mePro, limits: { ...mePro.limits, messages_per_day: -1 } } })
    renderComposer()
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('usage-meter')).toBeNull()
  })
})

describe('answered-by label and downgrade notice', () => {
  const assistant = (over: Partial<ApiMessage>): ApiMessage => ({
    message_id: 'a1', conversation_id: 'c1', sender: 'assistant', content: 'The answer.', created_at: '2026-11-15T10:00:00Z', status: 'completed', ...over,
  })
  const renderMsg = (m: ApiMessage) => {
    mockApi({ models: modelsMax })
    const [display] = buildDisplay([m], undefined, {})
    render(
      <QueryClientProvider client={newClient()}>
        <MessageItem message={display!} isLastAssistant canRegenerate onRegenerate={vi.fn()} onRetrySend={vi.fn()} onDismissSend={vi.fn()} />
      </QueryClientProvider>,
    )
  }

  it('says which model answered, using the label from the catalog', async () => {
    renderMsg(assistant({ model: 'llama-smart', model_group: 'smart' }))
    expect(await screen.findByText('Answered by Llama Smart')).toBeInTheDocument()
    expect(screen.queryByText(/Advanced answers are used/)).toBeNull()
  })

  it('falls back to the model id when the label is unknown, and shows nothing when there is no model', async () => {
    renderMsg(assistant({ model: 'mystery-9' }))
    expect(await screen.findByText('Answered by mystery-9')).toBeInTheDocument()
  })

  it('has no label for a message without a model', async () => {
    renderMsg(assistant({}))
    await screen.findByText('The answer.')
    expect(screen.queryByText(/Answered by/)).toBeNull()
  })

  it('explains the downgrade when notice_key is limit.best_switched', async () => {
    renderMsg(assistant({ model: 'llama-smart', billing: { downgraded: true, notice_key: 'limit.best_switched' } }))
    expect(await screen.findByText("Today's 15 Advanced answers are used, so this one comes from Llama Smart (Smart). Advanced refreshes at 12:00 am.")).toBeInTheDocument()
  })
})
