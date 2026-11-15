import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BillingNotice, QuietNotice, quietMessage } from '@/components/billing/BillingNotice'
import { BillingBanners } from '@/components/billing/BillingBanners'
import { Composer } from '@/components/chat/Composer'
import { CustomModesSettings } from '@/components/settings/CustomModesSettings'
import { MemorySettingsPage } from '@/components/settings/MemorySettingsPage'
import { cancelRun, sendMessage } from '@/features/messages/chat-controller'
import { openConversationStream, parseNotice, SseParser } from '@/lib/streaming'
import { parseErrorBody } from '@/lib/errors'
import { useAuthStore } from '@/stores/auth.store'
import { useBillingNoticeStore } from '@/stores/billing-notice.store'
import { useChatStore } from '@/stores/chat.store'
import { useDraftStore } from '@/stores/draft.store'
import type { BillingDenied, BillingMe } from '@/types/billing'
import { denial, meCancelling, meFree, meLive, mePastDue, mePro, meSimulated, meSuspended } from './billing-fixtures'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface Call { method: string; path: string; body: unknown }
function mock(handler: (c: Call) => Response | undefined, me: BillingMe = meFree) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const call = { method: init?.method ?? 'GET', path: url.pathname.replace('/api/v1', ''), body: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined }
    calls.push(call)
    const r = handler(call)
    if (r) return r
    if (call.path === '/billing/me') return json(200, me)
    if (call.path === '/billing/me/models') return json(500, { detail: 'x' })
    if (call.path === '/tools') return json(200, { tools: [], max_selected: 5 })
    if (call.path === '/preferences') return json(200, { default_mode: null, default_tools: [], version: 1 })
    return json(200, { items: [], next_cursor: null, has_more: false })
  }))
  return calls
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const wrap = (ui: React.ReactElement, qc = client()) => (
  <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>
)
const composer = (key = 'c1') => wrap(<Composer conversationId={key === 'new' ? null : key} draftKey={key} busy={false} onSend={vi.fn(async () => true)} />)

const d = (reason: string, over: Partial<BillingDenied> = {}): BillingDenied => ({
  reason, message_key: 'k', message: `msg ${reason}`, upgrade_to: 'pro', ...over,
})

beforeEach(() => {
  vi.stubEnv('VITE_SUPPORT_EMAIL', 'support@example.test')
  useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null, expired: false })
  useBillingNoticeStore.setState({ denied: {}, quiet: {}, dismissedQuiet: [] })
  useDraftStore.setState({ drafts: {} })
  useChatStore.setState({ runs: {}, citations: {} })
})
afterEach(() => {
  cancelRun('c1')
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('BillingNotice: every reason and its actions', () => {
  const RESETS = '2026-11-16T00:00:00+05:30'
  const table: Array<[string, Partial<BillingDenied>, { upgrade: boolean; resets: boolean; support: boolean }]> = [
    ['daily_limit', { resets_at: RESETS }, { upgrade: true, resets: true, support: false }],
    ['monthly_limit', { resets_at: '2026-12-01T00:00:00+05:30' }, { upgrade: true, resets: true, support: false }],
    ['model_not_in_plan', {}, { upgrade: true, resets: false, support: false }],
    ['account_blocked', {}, { upgrade: false, resets: false, support: true }],
    ['no_credit', {}, { upgrade: true, resets: false, support: false }],
    ['spend_cap', {}, { upgrade: false, resets: false, support: true }],
    ['member_spend_cap', {}, { upgrade: false, resets: false, support: true }],
    ['billing_unavailable', {}, { upgrade: false, resets: false, support: true }],
    ['plan_limit', { limit: 'file_size_mb' }, { upgrade: true, resets: false, support: false }],
  ]
  for (const [reason, over, want] of table) {
    it(`${reason}: shows the backend message and the right actions`, async () => {
      mock(() => undefined)
      render(wrap(<BillingNotice denial={d(reason, over)} />))
      const n = screen.getByTestId('billing-notice')
      expect(n).toHaveAttribute('role', 'alert')
      expect(within(n).getByText(`msg ${reason}`)).toBeInTheDocument()
      const upgrade = within(n).queryByRole('link', { name: 'Upgrade' })
      expect(!!upgrade).toBe(want.upgrade)
      if (upgrade) expect(upgrade).toHaveAttribute('href', '/pricing')
      expect(!!within(n).queryByText(/^Resets at /)).toBe(want.resets)
      expect(!!within(n).queryByRole('link', { name: 'Contact support' })).toBe(want.support)
      if (want.support) expect(within(n).getByRole('link', { name: 'Contact support' }).getAttribute('href')).toBe('mailto:support@example.test')
    })
  }

  it('shows the reset time in IST', () => {
    mock(() => undefined)
    render(wrap(<BillingNotice denial={d('daily_limit', { resets_at: '2026-11-15T18:30:00Z' })} />))
    expect(screen.getByText('Resets at 12:00 am')).toBeInTheDocument()
  })

  it('offers Pay now when the account is blocked by a failed payment', async () => {
    mock(() => undefined, mePastDue)
    render(wrap(<BillingNotice denial={d('account_blocked')} />))
    const pay = await screen.findByRole('link', { name: 'Pay now' })
    expect(pay).toHaveAttribute('href', 'https://rzp.io/i/pay-now')
  })

  it('falls back to a built-in message when the service sent none', () => {
    mock(() => undefined)
    render(wrap(<BillingNotice denial={d('daily_limit', { message: '' })} />))
    expect(screen.getByText(/today's message limit/i)).toBeInTheDocument()
  })

  it('can be dismissed', async () => {
    mock(() => undefined)
    const onDismiss = vi.fn()
    render(wrap(<BillingNotice denial={d('plan_limit')} onDismiss={onDismiss} />))
    await userEvent.click(screen.getByRole('button', { name: /dismiss notice/i }))
    expect(onDismiss).toHaveBeenCalled()
  })
})

describe('refusals from every service appear above the composer (never as a toast) and the draft is kept', () => {
  const noticeIn = () => screen.findByTestId('billing-notice')

  it('chat: messages_per_conversation / daily_limit on send restores the draft', async () => {
    mock((c) => (c.method === 'POST' && c.path.endsWith('/messages') ? json(403, denial('plan_limit', { limit: 'messages_per_conversation', message: 'Messages per conversation limit for your plan reached. Upgrade to add more.' })) : undefined))
    const qc = client()
    render(wrap(<Composer conversationId="c1" draftKey="c1" busy={false} onSend={vi.fn(async () => true)} />, qc))
    sendMessage(qc, 'c1', 'my long question')
    const n = await noticeIn()
    expect(n).toHaveAttribute('data-reason', 'plan_limit')
    expect(n).toHaveTextContent('Messages per conversation limit for your plan reached')
    expect(screen.getByRole('textbox', { name: /message granthanai/i })).toHaveValue('my long question')
    expect(useChatStore.getState().runs.c1?.pendingUser ?? null).toBeNull()
  })

  it('chat: a daily limit on send shows "Resets at"', async () => {
    mock((c) => (c.method === 'POST' && c.path.endsWith('/messages') ? json(429, denial('daily_limit', { resets_at: '2026-11-16T00:00:00+05:30' })) : undefined))
    const qc = client()
    render(wrap(<Composer conversationId="c1" draftKey="c1" busy={false} onSend={vi.fn(async () => true)} />, qc))
    sendMessage(qc, 'c1', 'hello')
    expect(await noticeIn()).toHaveTextContent('Resets at 12:00 am')
  })

  it('chat: documents_per_tree is shown the same way', async () => {
    mock((c) => (c.method === 'POST' && c.path.endsWith('/messages') ? json(403, denial('plan_limit', { limit: 'documents_per_tree', message: 'Documents per tree limit for your plan reached. Upgrade to add more.' })) : undefined))
    const qc = client()
    render(wrap(<Composer conversationId="c1" draftKey="c1" busy={false} onSend={vi.fn(async () => true)} />, qc))
    sendMessage(qc, 'c1', 'with docs', ['f1'])
    expect(await noticeIn()).toHaveTextContent('Documents per tree')
  })

  it('uploads: file_size_mb and storage_mb', async () => {
    for (const limit of ['file_size_mb', 'storage_mb']) {
      mock((c) => (c.path === '/files/upload/initiate' ? json(403, denial('plan_limit', { limit, message: `${limit} limit for your plan reached. Upgrade to add more.` })) : undefined))
      const v = render(composer())
      const input = v.container.querySelector('input[type=file]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [new File(['hello'], 'a.txt', { type: 'text/plain' })] } })
      const n = await noticeIn()
      expect(n).toHaveTextContent(`${limit} limit for your plan reached`)
      expect(within(n).getByRole('link', { name: 'Upgrade' })).toBeInTheDocument()
      v.unmount()
      useBillingNoticeStore.setState({ denied: {} })
    }
  })

  it('uploads: 402 credits.empty', async () => {
    mock((c) => (c.path === '/files/upload/initiate' ? json(402, denial('no_credit', { message: 'You are out of credits.' })) : undefined))
    const v = render(composer())
    fireEvent.change(v.container.querySelector('input[type=file]')!, { target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } })
    expect(await noticeIn()).toHaveAttribute('data-reason', 'no_credit')
  })

  it('YouTube: the monthly 429 shows the reset time', async () => {
    mock((c) => (c.path === '/files/youtube' ? json(429, denial('monthly_limit', { message: 'Monthly YouTube limit reached.', resets_at: '2026-12-01T00:00:00+05:30' })) : undefined))
    render(composer())
    await userEvent.click(screen.getByRole('button', { name: /attach youtube link/i }))
    await userEvent.type(await screen.findByLabelText('Video link 1'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }))
    const n = await noticeIn()
    expect(n).toHaveAttribute('data-reason', 'monthly_limit')
    expect(n).toHaveTextContent('Resets at 12:00 am')
  })

  it('branches_per_tree: creating a branch from selected text', async () => {
    const { useSelectionBranch } = await import('@/features/conversations/useSelectionBranch')
    mock((c) => (c.method === 'POST' && c.path === '/conversations' ? json(403, denial('plan_limit', { limit: 'branches_per_tree', message: 'Branches per tree limit for your plan reached. Upgrade to add more.' })) : undefined))
    function Probe() {
      const s = useSelectionBranch('c1')
      return <button onClick={() => void s.newBranch('some selected text')}>branch</button>
    }
    render(wrap(<><Probe /><Composer conversationId="c1" draftKey="c1" busy={false} onSend={vi.fn(async () => true)} /></>))
    await userEvent.click(screen.getByRole('button', { name: 'branch' }))
    expect(await noticeIn()).toHaveTextContent('Branches per tree limit')
  })

  it('custom modes: custom_modes and mode_instruction_chars show a notice with Upgrade in the form', async () => {
    for (const limit of ['custom_modes', 'mode_instruction_chars']) {
      mock((c) => {
        if (c.path === '/custom-modes' && c.method === 'GET') return json(200, { items: [], total: 0, limit: 100, offset: 0, max_per_user: 3, limits: { name: 60, description: 200, instructions: 4000 } })
        if (c.path === '/custom-modes' && c.method === 'POST') return json(403, denial('plan_limit', { limit, message: `${limit} limit for your plan reached. Upgrade to add more.` }))
      })
      const v = render(wrap(<CustomModesSettings />))
      await userEvent.click(await screen.findByRole('button', { name: /new mode/i }))
      await userEvent.type(screen.getByLabelText('Name'), 'Mentor')
      await userEvent.type(screen.getByLabelText('Instructions'), 'Explain.')
      await userEvent.click(screen.getByRole('button', { name: 'Create mode' }))
      const n = await noticeIn()
      expect(n).toHaveAttribute('data-reason', 'plan_limit')
      expect(within(n).getByRole('link', { name: 'Upgrade' })).toBeInTheDocument()
      expect(screen.getByLabelText('Name')).toHaveValue('Mentor') // the form is kept
      v.unmount()
    }
  })

  it('memory facts: a refused change shows the notice on the Memory page', async () => {
    const fact = { id: 'f1', category: 'preferences', statement: 'Likes tea', status: 'ACTIVE', created_at: '', updated_at: '', version: 1 }
    mock((c) => {
      if (c.path === '/memory/facts' && c.method === 'GET') return json(200, { items: [fact], memory_enabled: true, facts_used: 50, facts_limit: 50 })
      if (c.path.startsWith('/memory/facts/') && c.method !== 'GET') return json(403, denial('plan_limit', { limit: 'memory_facts', message: 'Memory facts limit for your plan reached. Upgrade to add more.' }))
    })
    render(wrap(<MemorySettingsPage />))
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }))
    const box = await screen.findByRole('textbox')
    await userEvent.clear(box)
    await userEvent.type(box, 'Likes coffee')
    await userEvent.click(screen.getByRole('button', { name: /^save/i }))
    expect(await noticeIn()).toHaveTextContent('Memory facts limit')
  })

  it('does not turn ordinary errors into a billing notice', async () => {
    mock((c) => (c.method === 'POST' && c.path.endsWith('/messages') ? json(403, { detail: 'Forbidden' }) : undefined))
    const qc = client()
    render(wrap(<Composer conversationId="c1" draftKey="c1" busy={false} onSend={vi.fn(async () => true)} />, qc))
    sendMessage(qc, 'c1', 'hello')
    await waitFor(() => expect(useChatStore.getState().runs.c1?.pendingUser?.status).toBe('failed'))
    expect(screen.queryByTestId('billing-notice')).toBeNull()
  })
})

describe('SSE notice events', () => {
  it('parses a notice frame and keeps ordinary frames flowing', () => {
    const seen: Array<[string, string]> = []
    const p = new SseParser((data, event) => seen.push([event, data]))
    p.push('event: notice\ndata: {"notice_key":"usage.threshold_80","metric":"messages","used":20,"limit":25}\n\n')
    p.push('data: {"event_type":"chat.response.chunk","content":"hi"}\n\n')
    expect(seen.map((s) => s[0])).toEqual(['notice', 'message'])
    expect(parseNotice(JSON.parse(seen[0]![1]))).toEqual({ notice_key: 'usage.threshold_80', metric: 'messages', used: 20, limit: 25, resets_at: undefined })
  })

  it('ignores a notice without a key and untyped fields', () => {
    expect(parseNotice({ metric: 'messages' })).toBeNull()
    expect(parseNotice(null)).toBeNull()
    expect(parseNotice({ notice_key: 'x', used: 'a', limit: {} })).toEqual({ notice_key: 'x', metric: undefined, used: undefined, limit: undefined, resets_at: undefined })
  })

  it('routes `event: notice` to onNotice and never to onEvent', async () => {
    const frames =
      ': ok\n\n' +
      'event: notice\ndata: {"notice_key":"usage.threshold_80","metric":"messages","used":20,"limit":25}\n\n' +
      'data: {"event_id":"1","event_type":"chat.response.chunk","content":"hi","sequence_number":1}\n\n'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(frames, { status: 200, headers: { 'content-type': 'text/event-stream' } })))
    const onEvent = vi.fn()
    const onNotice = vi.fn()
    const s = await openConversationStream('c1', { onEvent, onNotice }, new AbortController().signal, { messageId: 'a1', since: '0' })
    await s.closed
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(onNotice.mock.calls[0]![0]).toMatchObject({ notice_key: 'usage.threshold_80', used: 20, limit: 25 })
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent.mock.calls[0]![0]).toMatchObject({ content: 'hi' })
  })

  it('without an onNotice handler a notice frame is simply ignored', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(': ok\n\nevent: notice\ndata: {"notice_key":"usage.threshold_80"}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })))
    const onEvent = vi.fn()
    const s = await openConversationStream('c1', { onEvent }, new AbortController().signal, { messageId: 'a1', since: '0' })
    await s.closed
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('shows a quiet dismissible banner, and the same notice is not shown again once dismissed', async () => {
    mock(() => undefined)
    render(composer())
    const n = { notice_key: 'usage.threshold_80', metric: 'messages', used: 20, limit: 25 }
    useBillingNoticeStore.getState().showQuiet('c1', n)
    const banner = await screen.findByTestId('quiet-notice')
    expect(banner).toHaveTextContent("You've used 80% of today's messages.")
    expect(banner).toHaveAttribute('role', 'status') // quiet: not an alert
    await userEvent.click(screen.getByRole('button', { name: /dismiss usage notice/i }))
    expect(screen.queryByTestId('quiet-notice')).toBeNull()
    useBillingNoticeStore.getState().showQuiet('c1', n)
    expect(screen.queryByTestId('quiet-notice')).toBeNull() // same key + metric: stays dismissed
    useBillingNoticeStore.getState().showQuiet('c1', { ...n, notice_key: 'usage.threshold_100' })
    expect(await screen.findByTestId('quiet-notice')).toHaveTextContent("You've used all of today's messages.")
  })

  it('writes sensible text for other metrics', () => {
    expect(quietMessage({ notice_key: 'usage.threshold_80', metric: 'best' })).toBe("You've used 80% of today's Best-model messages.")
    expect(quietMessage({ notice_key: 'usage.other', used: 3, limit: 4 })).toBe("You've used 3 of 4 today's messages.")
    mock(() => undefined)
    render(wrap(<QuietNotice notice={{ notice_key: 'usage.threshold_80', resets_at: '2026-11-15T18:30:00Z' }} onDismiss={() => {}} />))
    expect(screen.getByText(/Resets at 12:00 am/)).toBeInTheDocument()
  })
})

describe('an error body from a service becomes a typed denial', () => {
  it('503 billing_unavailable is kept', () => {
    expect(parseErrorBody(503, denial('billing_unavailable')).billingDenial?.reason).toBe('billing_unavailable')
  })
})

describe('app-wide banners', () => {
  const show = async (me: BillingMe) => {
    mock(() => undefined, me)
    render(wrap(<BillingBanners />))
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
  }
  const none = async () => {
    await new Promise((r) => setTimeout(r, 60))
    expect(screen.queryByTestId('billing-banners')).toBeNull()
  }

  it('simulated payments', async () => {
    await show(meSimulated)
    expect(await screen.findByText('Payments are simulated — no real money')).toBeInTheDocument()
  })

  it('live payments and a healthy account show nothing', async () => {
    await show(meLive)
    await none()
  })

  it('past_due: "Payment failed" with Pay now', async () => {
    await show(mePastDue)
    expect(await screen.findByText('Payment failed. Pay now to keep Pro.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pay now' })).toHaveAttribute('href', 'https://rzp.io/i/pay-now')
  })

  it('suspended', async () => {
    await show(meSuspended)
    expect(await screen.findByText(/Your Pro plan is suspended/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Contact support' })).toBeInTheDocument()
  })

  it('cancelling: "Pro ends on <date>" with Resume', async () => {
    await show(meCancelling)
    expect(await screen.findByText('Pro ends on 15 Dec 2026')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Resume' })).toHaveAttribute('href', '/settings/billing')
  })

  it('an active Pro account with live payments has no banner', async () => {
    await show(mePro)
    await none()
  })
})
