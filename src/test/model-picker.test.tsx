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
import { meFree, meMax, mePro, modelsFree, modelsMax, modelsPro } from './billing-fixtures'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface Setup {
  me?: BillingMe
  models?: MyModelsResponse | 'fail'
  defaultModel?: string
}

/** Mocks only the HTTP boundary and records what the app sends. */
function mockApi({ me = meFree, models = modelsFree, defaultModel = 'auto' }: Setup = {}) {
  const sent: Array<{ path: string; method: string; body: Record<string, unknown> | null }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname.replace('/api/v1', '')
      const method = init?.method ?? 'GET'
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
      sent.push({ path, method, body })
      if (path === '/billing/me') return json(200, me)
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
  it('lists Auto first, then Fast, Smart, Best, Ultra with labels from the API; locked models say which plan unlocks them', async () => {
    mockApi({ models: modelsFree })
    renderComposer()
    await open()
    const dialog = await screen.findByRole('dialog', { name: 'Models' })
    const groups = within(dialog).getAllByRole('group').map((g) => g.getAttribute('aria-label'))
    expect(groups).toEqual(['Fast', 'Smart', 'Best', 'Ultra'])
    const radios = within(dialog).getAllByRole('radio')
    expect(radios[0]).toHaveAccessibleName(/auto/i)
    expect(within(dialog).getByRole('radio', { name: /llama fast/i })).toBeEnabled()
    const locked = within(dialog).getByRole('link', { name: /llama smart/i })
    expect(locked).toHaveTextContent('Available on Pro')
    expect(locked).toHaveAttribute('href', '/pricing')
    expect(within(dialog).getByRole('link', { name: /best one/i })).toHaveTextContent('Available on Max')
    // A locked model is not selectable.
    expect(within(dialog).queryByRole('radio', { name: /llama smart/i })).toBeNull()
  })

  it('unlocks Smart on Pro and shows how many Best messages are left on Max', async () => {
    mockApi({ models: modelsPro })
    const first = renderComposer()
    await open()
    expect(await screen.findByRole('radio', { name: /llama smart/i })).toBeEnabled()
    first.unmount()

    mockApi({ models: modelsMax })
    renderComposer()
    await open()
    expect(await screen.findByText('8 Best left today')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /best one/i })).toBeEnabled()
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

  it('a saved default the plan no longer allows shows as Auto', async () => {
    mockApi({ models: modelsFree, defaultModel: 'best-1' })
    renderComposer('new')
    expect(await screen.findByRole('button', { name: 'Model, Auto' })).toBeInTheDocument()
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
    expect(await screen.findByRole('button', { name: 'Model, Auto' })).toBeInTheDocument()
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
    useModelSelectionStore.getState().setModel('c1', 'auto')
    expect(regenerate(newClient(), 'c1', 'a0')).toBe(true)
    await waitFor(() => expect(sent.some((r) => r.path.endsWith('/a0/regenerate'))).toBe(true))
    expect(sent.find((r) => r.path.endsWith('/regenerate'))?.body).toEqual({ model: 'auto' })
  })

  it('a chosen model the plan no longer allows is sent as auto', async () => {
    const { sent } = mockApi()
    const qc = newClient()
    qc.setQueryData(['billing', 'me', 'models'], modelsFree)
    useModelSelectionStore.getState().setModel('c1', 'best-1')
    sendMessage(qc, 'c1', 'hi')
    await waitFor(() => expect(sent.some((r) => r.method === 'POST')).toBe(true))
    expect(sent.find((r) => r.method === 'POST')?.body).toMatchObject({ model: 'auto' })
  })
})

describe('usage meter', () => {
  it('shows the count, the reset time and Best left', async () => {
    mockApi({ me: meMax, models: modelsMax })
    renderComposer()
    const meter = await screen.findByTestId('usage-meter')
    expect(meter).toHaveTextContent('20 of 80 messages today · resets 12:00 am · 8 Best left today')
    expect(meter).toHaveAttribute('data-level', 'ok')
  })

  it('is amber from 80% and red at 100%', () => {
    expect(meterLevel(63, 80)).toBe('ok')
    expect(meterLevel(64, 80)).toBe('warn')
    expect(meterLevel(79, 80)).toBe('warn')
    expect(meterLevel(80, 80)).toBe('full')
    expect(meterLevel(90, 80)).toBe('full')
  })

  it('renders the warn and full levels, and the free count', async () => {
    const me = { ...meFree, usage_today: { ...meFree.usage_today, total: 31 } }
    mockApi({ me: { ...me, limits: { ...me.limits, messages_per_day: 35 } } })
    renderComposer()
    const meter = await screen.findByTestId('usage-meter')
    expect(meter).toHaveTextContent('31 of 35 messages today')
    expect(meter).toHaveAttribute('data-level', 'warn')
    expect(meter.className).toMatch(/text-warn/)
  })

  it('is red when the limit is reached and hidden when unlimited', async () => {
    const full = { ...mePro, limits: { ...mePro.limits, messages_per_day: 10 } }
    mockApi({ me: full })
    const v = renderComposer()
    expect((await screen.findByTestId('usage-meter')).className).toMatch(/text-danger/)
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
    expect(screen.queryByText(/Best-model messages/)).toBeNull()
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
    expect(await screen.findByText("You've used today's Best-model messages, so this answer uses a Smart model.")).toBeInTheDocument()
  })
})
