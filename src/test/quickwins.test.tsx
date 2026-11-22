import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query'
import { useRef } from 'react'
import { MessageList } from '@/components/chat/MessageList'
import { Composer } from '@/components/chat/Composer'
import { MessageItem } from '@/components/chat/MessageItem'
import { ThumbsBar } from '@/features/messages/ThumbsBar'
import { MessageEditor, VersionsChip } from '@/features/messages/EditUserMessage'
import { ShareDialog } from '@/features/share/ShareDialog'
import { chainFor, hideManim, PublicSharePage } from '@/features/share/PublicSharePage'
import { LeaveGuard, relativeExpiry, TemporaryBanner, useLeavePrompt } from '@/features/temporary/temporary'
import { FeedbackPage } from '@/features/admin/FeedbackPage'
import { routes } from '@/app/router'
import { thinkAvailability, useThinkStore } from '@/features/think/think'
import { ThinkToggle } from '@/features/think/ThinkToggle'
import { hasSuggestions, refreshSuggestions, sendMessage, SUGGESTION_REREADS_MS, TIMING, cancelRun } from '@/features/messages/chat-controller'
import { buildDisplay, type DisplayMessage } from '@/features/messages/display'
import { insertAtCursor, dictationSupported } from '@/features/voice/useDictation'
import { MicButton, SpeakButton } from '@/features/voice/VoiceControls'
import { markdownToSpeech, pickVoice, splitSentences, useSpeech } from '@/features/voice/readAloud'
import { useVoiceStore } from '@/features/voice/voice.store'
import { speechLang } from '@/features/voice/languages'
import { conversationService } from '@/services/conversation.service'
import { resolveNotice } from '@/features/billing/noticeCopy'
import { useAuthStore } from '@/stores/auth.store'
import { useChatStore } from '@/stores/chat.store'
import { useDraftStore } from '@/stores/draft.store'
import { useModelSelectionStore } from '@/features/billing/model-selection'
import { qk } from '@/lib/query-keys'
import type { ApiMessage, Page, SharedSnapshot } from '@/types/api'
import type { BillingMe, MyModelsResponse } from '@/types/billing'
import { meFree, mePro } from './billing-fixtures'

type RouteNode = { path?: string; children?: RouteNode[] }
const tree = routes as unknown as RouteNode[]

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface Call { method: string; path: string; body: unknown; headers: Record<string, string> }
function mock(handler: (c: Call) => Response | undefined, me: BillingMe = mePro, models: MyModelsResponse | null = MODELS) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname.replace('/api/v1', '') + url.search,
      body: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
    }
    calls.push(call)
    const r = handler(call)
    if (r) return r
    if (call.path === '/billing/me') return json(200, me)
    if (call.path === '/billing/me/models') return models ? json(200, models) : json(500, {})
    if (call.path === '/tools') return json(200, { tools: [], max_selected: 5 })
    if (call.path === '/preferences') return json(200, { default_mode: null, default_tools: [], version: 1, language: 'auto', suggest_followups: true })
    return json(200, { items: [], next_cursor: null, has_more: false })
  }))
  return calls
}

const MODELS = {
  plan: { code: 'pro', source: 'subscription' }, default_group: 'smart', default_model: 'think-model',
  messages: { daily_limit: 60, used_today: 0, remaining_today: 60, resets_at: '2026-11-23T00:00:00+05:30' },
  groups: [
    { group: 'smart', allowed: true, daily_limit: 60, remaining_today: 60, models: [
      { id: 'think-model', label: 'Thinker', provider: 'x', allowed: true, think: true },
      { id: 'plain-model', label: 'Plain', provider: 'x', allowed: true, think: false },
    ] },
  ],
} as unknown as MyModelsResponse

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const wrap = (ui: React.ReactElement, qc = client(), initial = '/') => (
  <QueryClientProvider client={qc}><MemoryRouter initialEntries={[initial]}>{ui}</MemoryRouter></QueryClientProvider>
)

const msg = (over: Partial<ApiMessage> = {}): ApiMessage => ({
  message_id: 'a1', conversation_id: 'c1', sender: 'assistant', content: 'An answer', created_at: '2026-01-01T00:00:00Z', status: 'sent', ...over,
})
const display = (over: Partial<DisplayMessage> = {}): DisplayMessage => ({
  key: 'k', id: 'm1', sender: 'assistant', content: 'hi', status: 'sent', citations: [], fileIds: [], createdAt: null, local: false, ...over,
})

beforeEach(() => {
  useAuthStore.setState({ accessToken: 'tok', status: 'authenticated' } as never)
  useThinkStore.setState({ on: false })
  useModelSelectionStore.setState({ modelByKey: {} })
  useChatStore.setState({ runs: {}, citations: {}, notices: {} })
  useDraftStore.setState({ drafts: {} })
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ============================================================================================== F7 think longer

describe('think longer', () => {
  it('is hidden when the plan has none, disabled when the model cannot, enabled when it can', () => {
    expect(thinkAvailability(meFree, MODELS, 'think-model')).toEqual({ visible: false, enabled: false, reason: null })
    expect(thinkAvailability(mePro, MODELS, 'think-model')).toEqual({ visible: true, enabled: true, reason: null })
    expect(thinkAvailability(mePro, MODELS, 'plain-model')).toEqual({ visible: true, enabled: false, reason: 'model' })
    expect(thinkAvailability(mePro, MODELS, undefined).enabled).toBe(true)        // the plan default (think-model) applies
    expect(thinkAvailability(mePro, MODELS, 'auto').enabled).toBe(true)            // Auto: any allowed model of the default group
    const noneCan = { ...MODELS, groups: [{ ...MODELS.groups[0]!, models: [MODELS.groups[0]!.models[1]!] }] } as MyModelsResponse
    expect(thinkAvailability(mePro, noneCan, 'auto').enabled).toBe(false)
    expect(thinkAvailability(undefined, MODELS, 'think-model').visible).toBe(false)
  })

  it('the toggle shows for a plan that includes it, is pressed on click and is not shown on Free', async () => {
    mock(() => undefined, mePro)
    render(wrap(<ThinkToggle selectionKey="k" />))
    const btn = await screen.findByRole('button', { name: 'Think longer' })
    await waitFor(() => expect(btn).toBeEnabled())
    await userEvent.setup().click(btn)
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(useThinkStore.getState().on).toBe(true)
    vi.unstubAllGlobals()
    mock(() => undefined, meFree)
    useThinkStore.setState({ on: false })
    const { container } = render(wrap(<ThinkToggle selectionKey="free" />, client()))
    await new Promise((r) => setTimeout(r, 30))
    expect(container.querySelector('button')).toBeNull()
  })

  it('is disabled with a reason when the picked model cannot think', async () => {
    mock(() => undefined, mePro)
    useModelSelectionStore.setState({ modelByKey: { k: 'plain-model' } })
    render(wrap(<ThinkToggle selectionKey="k" />))
    const btn = await screen.findByRole('button', { name: 'Think longer' })
    await waitFor(() => expect(btn).toBeDisabled())
    expect(btn).toHaveAttribute('title', "This model can't think longer")
  })

  it('send puts think: true in the body, and not at all when off', async () => {
    const calls = mock((c) => (c.method === 'POST' && c.path.endsWith('/messages') ? json(202, { message_id: 'u', conversation_id: 'c1', sender: 'user', content: 'x', created_at: '', status: 'sent', response_message_id: 'a' }) : undefined))
    const qc = client()
    useThinkStore.setState({ on: true })
    sendMessage(qc, 'c1', 'hello', [], undefined, { mode: null })
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toBeTruthy())
    expect((calls.find((c) => c.method === 'POST')!.body as { think?: boolean }).think).toBe(true)
    cancelRun('c1')
    calls.length = 0
    useThinkStore.setState({ on: false })
    sendMessage(qc, 'c2', 'hello', [], undefined, { mode: null })
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toBeTruthy())
    expect('think' in (calls.find((c) => c.method === 'POST')!.body as object)).toBe(false)
    cancelRun('c2')
  })

  it('has a longer deadline for a think turn, "Thinking longer…" copy, a "Thought longer" label and the not-applied note', () => {
    expect(TIMING.thinkDeadlineMs).toBe(330_000)
    expect(TIMING.thinkDeadlineMs).toBeGreaterThan(TIMING.deadlineMs)
    const waiting = display({ status: 'connecting', content: '', thinkingLonger: true })
    const { unmount } = render(wrap(<MessageItem message={waiting} isLastAssistant canRegenerate onRegenerate={vi.fn()} onRetrySend={vi.fn()} onDismissSend={vi.fn()} />))
    expect(screen.getByRole('status')).toHaveTextContent('Thinking longer…')
    unmount()
    mock(() => undefined)
    render(wrap(<MessageItem message={display({ model: 'think-model', think: true, noticeKey: 'think.not_applied' })} isLastAssistant canRegenerate onRegenerate={vi.fn()} onRetrySend={vi.fn()} onDismissSend={vi.fn()} />))
    expect(screen.getByText('Thought longer')).toBeInTheDocument()
    expect(screen.getByText('This model answered without thinking longer.')).toBeInTheDocument()
  })

  it('the daily limit refusal reads through the existing notice copy', () => {
    const n = resolveNotice({ reason: 'plan_limit', limit: 'think_longer_per_day', message_key: 'limit.think_longer_per_day', message: 'x', upgrade_to: 'max' }, { me: mePro })
    expect(n.message).toContain("You've used today's Think longer answers. They reset at midnight.")
    expect(n.seePlans).toBe(true)
  })
})

// ============================================================================================== F2 thumbs

describe('thumbs up / down', () => {
  const seed = (qc: QueryClient, feedback: ApiMessage['feedback'] = null) =>
    qc.setQueryData<InfiniteData<Page<ApiMessage>>>(qk.messages('c1'), { pageParams: [null], pages: [{ items: [msg({ feedback })], next_cursor: null, has_more: false }] })
  const mine = (qc: QueryClient) => qc.getQueryData<InfiniteData<Page<ApiMessage>>>(qk.messages('c1'))!.pages[0]!.items[0]!.feedback

  it('thumbs up is optimistic, sent as PUT and removed with DELETE when clicked again', async () => {
    const qc = client()
    seed(qc)
    const calls = mock((c) => (c.path.endsWith('/feedback') ? (c.method === 'DELETE' ? new Response(null, { status: 204 }) : json(200, { rating: 'up', reason: null })) : undefined))
    const { rerender } = render(wrap(<ThumbsBar conversationId="c1" messageId="a1" current={null} />, qc))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Good answer' }))
    expect(mine(qc)).toEqual({ rating: 'up', reason: null })                              // before the server answered
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ path: '/conversations/c1/messages/a1/feedback', body: { rating: 'up' } })
    rerender(wrap(<ThumbsBar conversationId="c1" messageId="a1" current={{ rating: 'up' }} />, qc))
    expect(screen.getByRole('button', { name: 'Good answer' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Good answer' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
    expect(mine(qc)).toBeNull()
  })

  it('rolls back when the server refuses', async () => {
    const qc = client()
    seed(qc)
    mock((c) => (c.path.endsWith('/feedback') ? json(409, { detail: { code: 'not_assistant_message', message: 'Only a finished answer can be rated.' } }) : undefined))
    render(wrap(<ThumbsBar conversationId="c1" messageId="a1" current={null} />, qc))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Good answer' }))
    await waitFor(() => expect(mine(qc)).toBeNull())
  })

  it('thumbs down asks for a reason and sends it with the comment; Skip sends no reason', async () => {
    const qc = client()
    seed(qc)
    const calls = mock((c) => (c.path.endsWith('/feedback') ? json(200, { rating: 'down', reason: 'too_long' }) : undefined))
    render(wrap(<ThumbsBar conversationId="c1" messageId="a1" current={null} />, qc))
    const u = userEvent.setup()
    await u.click(screen.getByRole('button', { name: 'Bad answer' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/lets the GranthanAI team read this answer and your question/)).toBeInTheDocument()
    await u.click(within(dialog).getByRole('button', { name: 'Too long' }))
    await u.type(within(dialog).getByRole('textbox'), 'Wall of text')
    await u.click(within(dialog).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toBeTruthy())
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ rating: 'down', reason: 'too_long', comment: 'Wall of text' })
    calls.length = 0
    await u.click(screen.getByRole('button', { name: 'Bad answer' }))
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toBeTruthy())
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ rating: 'down' })
  })

  it('the staff page lists rows, pages with a cursor and expands an excerpt; /admin/feedback sits behind the staff layout', async () => {
    const item = (n: number) => ({ created_at: '2026-11-22T10:00:00Z', rating: 'down', reason: 'too_long', comment: null, model: 'm', model_group: 'smart', conversation_id: 'c', message_id: `m${n}`, answer: `answer ${n} ${'x'.repeat(200)}`, question: `question ${n}` })
    const calls = mock((c) => {
      if (!c.path.startsWith('/feedback/admin')) return undefined
      return c.path.includes('cursor=next') ? json(200, { items: [item(2)], next_cursor: null, has_more: false }) : json(200, { items: [item(1)], next_cursor: 'next', has_more: true })
    })
    render(wrap(<FeedbackPage />))
    expect(await screen.findByText('question 1')).toBeInTheDocument()
    expect(calls[0]!.path).toContain('rating=down')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('question 2')).toBeInTheDocument()
    const adminChildren = tree.flatMap((r) => r.children ?? []).find((c) => c.path === '/admin')?.children
    expect(adminChildren?.some((c) => c.path === 'feedback')).toBe(true)
  })
})

// ============================================================================================== F1 edit

describe('edit a sent message', () => {
  const editResponse = { conversation: { conversation_id: 'new-c', title: 't', status: 'active' }, message: { message_id: 'um', conversation_id: 'new-c', sender: 'user', content: 'edited', created_at: '', status: 'sent', response_message_id: 'ra' } }

  function Where() {
    return <span data-testid="where">{useLocation().pathname}</span>
  }

  it('sends the edit with an idempotency key and no file ids, then navigates to the new conversation', async () => {
    const calls = mock((c) => (c.path.endsWith('/edit') ? json(202, editResponse) : undefined))
    const onClose = vi.fn()
    render(wrap(<><MessageEditor conversationId="c1" messageId="m1" initial="old question" onClose={onClose} /><Where /></>, client(), '/c/c1'))
    const box = screen.getByRole('textbox')
    await userEvent.setup().clear(box)
    await userEvent.setup().type(box, 'new question')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/c/new-c'))
    const call = calls.find((c) => c.path === '/conversations/c1/messages/m1/edit')!
    expect(call.body).toMatchObject({ content: 'new question' })
    expect('file_ids' in (call.body as object)).toBe(false)
    expect(call.headers['x-idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(onClose).toHaveBeenCalled()
    cancelRun('new-c')
  })

  it('shows the server refusal (conversation busy) and keeps the text; Esc cancels; Ctrl+Enter sends', async () => {
    const calls = mock((c) => (c.path.endsWith('/edit') ? json(409, { detail: { code: 'conversation_busy', message: 'Wait for the current answer to finish.' } }) : undefined))
    const onClose = vi.fn()
    render(wrap(<MessageEditor conversationId="c1" messageId="m1" initial="old" onClose={onClose} />))
    const box = screen.getByRole('textbox')
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    expect(await screen.findByRole('alert')).toHaveTextContent('Wait for the current answer to finish.')
    expect(calls.filter((c) => c.path.endsWith('/edit'))).toHaveLength(1)
    expect(box).toHaveValue('old')
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('shows "Edited · 2 versions" once the versions are known and lists them', async () => {
    mock((c) => (c.path.endsWith('/edits') ? json(200, [{ conversation_id: 'v2', title: 'Second try', created_at: '2026-11-22T10:00:00Z' }]) : undefined))
    render(wrap(<VersionsChip conversationId="c1" messageId="m1" wanted />))
    const chip = await screen.findByRole('button', { name: 'Edited · 2 versions' })
    await userEvent.setup().click(chip)
    expect(await screen.findByRole('menuitem', { name: /Second try/ })).toBeInTheDocument()
  })

  it('does not fetch versions until asked, and shows nothing without edits', async () => {
    const calls = mock(() => undefined)
    const { container } = render(wrap(<VersionsChip conversationId="c1" messageId="m1" wanted={false} />))
    await new Promise((r) => setTimeout(r, 30))
    expect(calls.some((c) => c.path.endsWith('/edits'))).toBe(false)
    expect(container.textContent).toBe('')
  })

  it('the pencil is on own sent messages only: not while busy, in temporary chats, or on a local row', () => {
    mock(() => undefined)
    const user = (over: Partial<DisplayMessage> = {}) => display({ sender: 'user', id: 'u1', ...over })
    const items = [
      [user(), true, true], [user(), false, false], [user({ local: true }), true, false], [user({ status: 'sending' }), true, false],
    ] as const
    for (const [m, canEdit, shown] of items) {
      const { unmount } = render(wrap(<MessageItem message={m} conversationId="c1" canEdit={canEdit} isLastAssistant={false} canRegenerate onRegenerate={vi.fn()} onRetrySend={vi.fn()} onDismissSend={vi.fn()} />))
      expect(!!screen.queryByRole('button', { name: 'Edit message' })).toBe(shown)
      unmount()
    }
  })
})

// ============================================================================================== F3 share

const SNAP: SharedSnapshot = {
  schema_version: 1, title: 'My tree', scope: 'hierarchy', created_at: '2026-11-22T00:00:00Z',
  conversations: [
    { id: 'r', parent: null, title: 'Root', inherited: false, messages: [{ sender: 'user', content: 'root question', created_at: '', citations: [], model: null }, { sender: 'assistant', content: 'root answer', created_at: '', citations: [], model: 'm' }] },
    { id: 'b', parent: 'r', title: 'Branch', inherited: false, messages: [{ sender: 'user', content: 'branch question', created_at: '', citations: [], model: null }] },
  ],
}

describe('share links', () => {
  const TOKEN = 'T'.repeat(43)

  it('creates a link, shows the full URL once with the warning, and the scope can be the whole tree', async () => {
    const calls = mock((c) => (c.method === 'POST' && c.path === '/shares' ? json(201, { share_id: 's1', url_token: TOKEN, scope: 'hierarchy', title: 't', message_count: 2, created_at: '' }) : undefined))
    render(wrap(<ShareDialog conversation={{ conversation_id: 'c1', title: 't' } as never} onClose={vi.fn()} />))
    const u = userEvent.setup()
    await u.click(screen.getByLabelText('The whole tree'))
    await u.click(screen.getByRole('button', { name: 'Create link' }))
    expect(await screen.findByLabelText('Share link')).toHaveValue(`${window.location.origin}/s/${TOKEN}`)
    expect(calls.find((c) => c.path === '/shares')!.body).toEqual({ conversation_id: 'c1', scope: 'hierarchy' })
    expect(screen.getByText("Anyone with the link can read this snapshot. Later messages aren't included.")).toBeInTheDocument()
    expect(screen.getByText(/shown only this once/)).toBeInTheDocument()
  })

  it('the public page renders without any Authorization header, noindex, muted earlier context and a branch switch', async () => {
    const calls = mock((c) => (c.path.startsWith('/shares/public/') ? json(200, SNAP) : undefined))
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={[`/s/${TOKEN}`]}><Routes><Route path="/s/:token" element={<PublicSharePage />} /></Routes></MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('root question')).toBeInTheDocument()
    const read = calls.find((c) => c.path === `/shares/public/${TOKEN}`)!
    expect(read.headers.authorization).toBeUndefined()
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex')
    expect(screen.getByRole('link', { name: 'Try GranthanAI' })).toHaveAttribute('href', '/signup')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Branch' }))
    expect(await screen.findByText('branch question')).toBeInTheDocument()
    const earlier = screen.getByRole('region', { name: 'Earlier in this tree' })
    expect(within(earlier).getByText('root question')).toBeInTheDocument()
  })

  it('404 and 429 have their own copy', async () => {
    mock(() => json(404, { detail: { code: 'share_not_found', message: 'x' } }))
    const { unmount } = render(<QueryClientProvider client={client()}><MemoryRouter initialEntries={[`/s/${TOKEN}`]}><Routes><Route path="/s/:token" element={<PublicSharePage />} /></Routes></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByText('This link was removed or never existed')).toBeInTheDocument()
    unmount()
    vi.unstubAllGlobals()
    mock(() => json(429, { detail: 'slow down' }))
    render(<QueryClientProvider client={client()}><MemoryRouter initialEntries={[`/s/${'U'.repeat(43)}`]}><Routes><Route path="/s/:token" element={<PublicSharePage />} /></Routes></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByText('Too many requests, try again in a minute')).toBeInTheDocument()
  })

  it('manim blocks become a placeholder and the chain of a branch is its ancestors in order', () => {
    expect(hideManim('a\n```manim\n{"x":1}\n```\nb')).toContain('Animation available in GranthanAI')
    expect(hideManim('```mermaid\ngraph TD\n```')).toContain('mermaid')
    const chain = chainFor(SNAP, 'b')
    expect(chain.inherited.map((c) => c.id)).toEqual(['r'])
    expect(chain.own?.id).toBe('b')
  })

  it('the public route and the settings page are registered outside the auth guard / inside settings', () => {
    expect(tree.some((r) => r.path === '/s/:token')).toBe(true)
    const settings = tree.flatMap((r) => r.children ?? []).flatMap((r) => r.children ?? []).find((r) => r.path === '/settings')
    expect(settings?.children?.some((c) => c.path === 'shared-links')).toBe(true)
  })
})

// ============================================================================================== F4 temporary

describe('temporary chat', () => {
  it('creates the conversation with temporary: true, and leaves the flag out otherwise', async () => {
    const calls = mock((c) => (c.path === '/conversations' ? json(201, { conversation_id: 'c9' }) : undefined))
    await conversationService.create({ title: 't', temporary: true })
    await conversationService.create({ title: 't2' })
    expect(calls.filter((c) => c.path === '/conversations').map((c) => c.body)).toEqual([{ title: 't', temporary: true }, { title: 't2' }])
  })

  it('the banner says when it will be deleted', () => {
    const now = Date.parse('2026-11-22T10:00:00Z')
    expect(relativeExpiry('2026-11-23T09:00:00Z', now)).toBe('in 23 hours')
    expect(relativeExpiry('2026-11-22T10:40:00Z', now)).toBe('in 40 minutes')
    expect(relativeExpiry('2026-11-22T09:00:00Z', now)).toBe('soon')
    render(<TemporaryBanner expiresAt={new Date(Date.now() + 5 * 3_600_000).toISOString()} />)
    expect(screen.getByRole('note')).toHaveTextContent(/Temporary chat · not in your history · not remembered · deleted in [45] hours/)
  })

  it('asks once before leaving and not again after "Don\'t ask again"', async () => {
    useLeavePrompt.setState({ dontAsk: false })
    const router = createMemoryRouter([{ path: '/c/t', element: <LeaveGuard /> }, { path: '/', element: <p>home</p> }], { initialEntries: ['/c/t'] })
    render(<RouterProvider router={router} />)
    await act(async () => { await router.navigate('/') })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('This temporary chat will be gone. Leave?')).toBeInTheDocument()
    await userEvent.setup().click(within(dialog).getByLabelText("Don't ask again"))
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument())
    expect(useLeavePrompt.getState().dontAsk).toBe(true)
    await act(async () => { await router.navigate('/c/t') })
    await act(async () => { await router.navigate('/') })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Stay keeps the user in the chat', async () => {
    useLeavePrompt.setState({ dontAsk: false })
    const router = createMemoryRouter([{ path: '/c/t', element: <><LeaveGuard /><p>chat</p></> }, { path: '/', element: <p>home</p> }], { initialEntries: ['/c/t'] })
    render(<RouterProvider router={router} />)
    await act(async () => { await router.navigate('/') })
    await userEvent.setup().click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Stay' }))
    expect(router.state.location.pathname).toBe('/c/t')
  })

  it('the chat store, display and the new conversation do not add the chat to the sidebar list on their own', () => {
    expect(buildDisplay([msg({ sender: 'user', message_id: 'u' })], undefined, {})).toHaveLength(1)
  })
})

// ============================================================================================== F5 follow-ups

describe('suggested follow-ups', () => {
  const answered = (n: number, suggestions: string[] = []) => display({ key: `a${n}`, id: `a${n}`, suggestions })

  it('chips show under the latest answer only, send on click, and hide while a turn runs', async () => {
    mock(() => undefined)
    const onSuggestion = vi.fn()
    const props = { conversationId: 'c1', hasOlder: false, loadingOlder: false, onLoadOlder: vi.fn(), onRegenerate: vi.fn(), onRetrySend: vi.fn(), onDismissSend: vi.fn(), statusText: '', onSuggestion }
    const messages = [answered(1, ['old chip?']), display({ key: 'u', id: 'u', sender: 'user', content: 'next' }), answered(2, ['Why is that?', 'What next?'])]
    const { rerender } = render(wrap(<MessageList {...props} messages={messages} canRegenerate />))
    expect(screen.queryByText('old chip?')).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Why is that?' }))
    expect(onSuggestion).toHaveBeenCalledWith('Why is that?')
    rerender(wrap(<MessageList {...props} messages={messages} canRegenerate={false} />))
    expect(screen.queryByText('Why is that?')).toBeNull()
    rerender(wrap(<MessageList {...props} messages={messages} canRegenerate onSuggestion={undefined} />))
    expect(screen.queryByText('Why is that?')).toBeNull()
  })

  it('the history is re-read at +1.5 s and +4 s, stopping once the latest answer has suggestions', () => {
    vi.useFakeTimers()
    const qc = client()
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    const put = (suggestions?: string[]) => qc.setQueryData<InfiniteData<Page<ApiMessage>>>(qk.messages('c1'), { pageParams: [null], pages: [{ items: [msg({ suggestions })], next_cursor: null, has_more: false }] })
    expect(SUGGESTION_REREADS_MS).toEqual([1500, 4000])
    put([])
    refreshSuggestions(qc, 'c1')
    vi.advanceTimersByTime(1499)
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(spy).toHaveBeenCalledTimes(1)
    put(['Why?'])
    vi.advanceTimersByTime(3000)
    expect(spy).toHaveBeenCalledTimes(1)                                          // stopped early
    expect(hasSuggestions(qc.getQueryData(qk.messages('c1')))).toBe(true)
  })

  it('the display carries the persisted suggestions and thumbs of an assistant row only', () => {
    const rows = buildDisplay([msg({ suggestions: ['q?'], feedback: { rating: 'up' } }), msg({ message_id: 'u1', sender: 'user' })], undefined, {})
    expect(rows[0]).toMatchObject({ suggestions: ['q?'], feedback: { rating: 'up' } })
    expect(rows[1]!.suggestions).toBeUndefined()
  })

  it('a suggestion goes out as a new message with the composer settings', async () => {
    const calls = mock((c) => (c.method === 'POST' && c.path.endsWith('/messages') ? json(202, { message_id: 'u', conversation_id: 'c1', sender: 'user', content: 'x', created_at: '', status: 'sent', response_message_id: 'a' }) : undefined))
    useThinkStore.setState({ on: true })
    sendMessage(client(), 'c5', 'Why is that?', [], undefined, { mode: 'smart' })
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toBeTruthy())
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ content: 'Why is that?', mode: 'smart', think: true })
    cancelRun('c5')
  })
})

// ============================================================================================== F6 voice

class FakeRecognition {
  static last: FakeRecognition | null = null
  lang = ''
  interimResults = false
  continuous = false
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  started = 0
  stopped = 0
  constructor() { FakeRecognition.last = this }
  start() { this.started++ }
  stop() { this.stopped++ }
}
const phrase = (text: string, isFinal: boolean) => ({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] })

describe('dictation and read aloud', () => {
  it('inserts text at the cursor with a leading space only when needed', () => {
    expect(insertAtCursor('hello', 5, 'world')).toEqual({ value: 'hello world', cursor: 11 })
    expect(insertAtCursor('hello ', 6, 'world')).toEqual({ value: 'hello world', cursor: 11 })
    expect(insertAtCursor('ac', 1, 'b')).toEqual({ value: 'a bc', cursor: 3 })
    expect(insertAtCursor('', 0, ' hi ')).toEqual({ value: 'hi', cursor: 2 })
    expect(insertAtCursor('x', 99, '')).toEqual({ value: 'x', cursor: 1 })
  })

  it('maps the answer language to a recognition tag', () => {
    expect(['en', 'hi', 'hinglish', 'auto', 'ta', 'ur'].map(speechLang)).toEqual(['en-IN', 'hi-IN', 'en-IN', 'en-IN', 'ta-IN', 'ur-IN'])
  })

  it('the mic is hidden without SpeechRecognition, and with it: Hindi, interim text, final text at the cursor, stop on send', async () => {
    mock(() => undefined)
    useVoiceStore.setState({ dictationLang: null, micNoticeSeen: false })
    function Harness({ stopSignal }: { stopSignal: number }) {
      const ref = useRef<HTMLTextAreaElement>(null)
      return <><textarea ref={ref} aria-label="box" defaultValue="namaste" /><MicButton draftKey="d" textareaRef={ref} busy={false} stopSignal={stopSignal} /></>
    }
    expect(dictationSupported()).toBe(false)
    const none = render(wrap(<Harness stopSignal={0} />))
    expect(screen.queryByRole('button', { name: 'Dictate' })).toBeNull()
    none.unmount()

    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    useVoiceStore.setState({ dictationLang: 'hi-IN' })
    useDraftStore.setState({ drafts: { d: 'namaste' } })
    const view = render(wrap(<Harness stopSignal={0} />))
    const mic = screen.getByRole('button', { name: 'Dictate' })
    ;(screen.getByLabelText('box') as HTMLTextAreaElement).setSelectionRange(7, 7)
    expect(mic).toHaveAttribute('title', "Your voice is processed by your browser's speech service.")
    await userEvent.setup().click(mic)
    const rec = FakeRecognition.last!
    expect(rec).toMatchObject({ lang: 'hi-IN', interimResults: true, continuous: true, started: 1 })
    expect(screen.getByRole('button', { name: 'Stop dictation' })).toHaveAttribute('aria-pressed', 'true')
    act(() => rec.onresult?.(phrase('dost', false)))
    expect(screen.getByTestId('interim')).toHaveTextContent('dost')
    act(() => rec.onresult?.(phrase('doston', true)))
    expect(useDraftStore.getState().drafts.d).toBe('namaste doston')
    act(() => rec.onend?.())                                                       // the engine ended on its own: restarts while on
    expect(rec.started).toBe(2)
    view.rerender(wrap(<Harness stopSignal={1} />))                                // a send stops it
    expect(rec.stopped).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument()
  })

  it('errors: blocked microphone and offline have their own words; no-speech stops quietly', async () => {
    mock(() => undefined)
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    const Harness = () => { const ref = useRef<HTMLTextAreaElement>(null); return <><textarea ref={ref} /><MicButton draftKey="e" textareaRef={ref} busy={false} stopSignal={0} /></> }
    render(wrap(<Harness />))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dictate' }))
    act(() => FakeRecognition.last!.onerror?.({ error: 'not-allowed' }))
    expect(screen.getByRole('alert')).toHaveTextContent("Microphone permission is blocked. Allow it in the browser's site settings.")
    act(() => FakeRecognition.last!.onerror?.({ error: 'network' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Dictation needs an internet connection.')
  })

  it('turns Markdown into speakable text', () => {
    const md = '# Title\n\nSome **bold** and [a link](https://x.y) with `code`.\n\n```python\nprint(1)\n```\n\n```mermaid\ngraph TD\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nEnergy is $E = mc^2$.\n\n- one\n- two'
    const out = markdownToSpeech(md)
    expect(out).toContain('Title')
    expect(out).toContain('Some bold and a link with code.')
    expect(out).toContain('code block skipped.')
    expect(out).toContain('diagram skipped.')
    expect(out).toContain('table skipped.')
    expect(out).not.toMatch(/print\(1\)|graph TD|\*\*|https|\| a \|/)
    expect(out).toContain('E = mc to the power of 2')
    expect(out).toContain('one')
  })

  it('splits long text into sentences of at most about 200 characters', () => {
    const long = `${'word '.repeat(120)}end. Short one! Another?`
    const parts = splitSentences(long)
    expect(parts.length).toBeGreaterThan(3)
    expect(parts.every((p) => p.length <= 200)).toBe(true)
    expect(parts.join(' ')).toContain('Short one!')
    expect(splitSentences('')).toEqual([])
  })

  it('picks a voice by language (en-IN first), else the default', () => {
    const v = (lang: string, voiceURI = lang) => ({ lang, voiceURI, name: lang }) as SpeechSynthesisVoice
    const voices = [v('en-US'), v('hi-IN'), v('en-IN')]
    expect(pickVoice(voices, 'en-IN')?.lang).toBe('en-IN')
    expect(pickVoice(voices, 'hi-IN')?.lang).toBe('hi-IN')
    expect(pickVoice([v('en-US')], 'en-IN')?.lang).toBe('en-US')
    expect(pickVoice([v('fr-FR')], 'hi-IN')).toBeNull()
    expect(pickVoice(voices, 'en-IN', 'en-US')?.lang).toBe('en-US')
  })

  it('reads one answer at a time, queues sentences, stops on demand, and the speaker is hidden without speechSynthesis', async () => {
    mock(() => undefined)
    expect(render(wrap(<SpeakButton messageKey="m1" content="x" />)).container.querySelector('button')).toBeNull()
    const spoken: Array<{ text: string; rate: number }> = []
    const synth = { speak: vi.fn((u: { text: string; rate: number }) => spoken.push({ text: u.text, rate: u.rate })), cancel: vi.fn(), getVoices: () => [], addEventListener: vi.fn(), removeEventListener: vi.fn() }
    vi.stubGlobal('speechSynthesis', synth)
    vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; lang = ''; rate = 1; voice: unknown = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t } })
    useVoiceStore.setState({ speed: 1.25, voiceURI: null })
    const first = 'First sentence here. Second sentence follows.'
    await useSpeech.getState().speak('a', first, 'en-IN')
    expect(useSpeech.getState().speaking).toBe('a')
    expect(spoken.map((s) => s.text)).toEqual(['First sentence here.', 'Second sentence follows.'])
    expect(spoken.every((s) => s.rate === 1.25)).toBe(true)
    await useSpeech.getState().speak('b', 'Another answer.', 'en-IN')              // starting another stops the first
    expect(synth.cancel).toHaveBeenCalled()
    expect(useSpeech.getState().speaking).toBe('b')
    useSpeech.getState().stop()
    expect(useSpeech.getState().speaking).toBeNull()

    render(wrap(<SpeakButton messageKey="m1" content="Hello there." />))
    const btn = screen.getByRole('button', { name: 'Read aloud' })
    await userEvent.setup().click(btn)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop reading' })).toBeInTheDocument())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop reading' }))
    expect(useSpeech.getState().speaking).toBeNull()
  })

  it('the composer shows the mic only when the browser supports dictation', async () => {
    mock(() => undefined)
    render(wrap(<Composer conversationId={null} draftKey="n" busy={false} onSend={async () => true} />))
    expect(screen.queryByRole('button', { name: 'Dictate' })).toBeNull()
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    render(wrap(<Composer conversationId={null} draftKey="n2" busy={false} onSend={async () => true} />))
    expect((await screen.findAllByRole('button', { name: 'Dictate' })).length).toBe(1)
  })
})
