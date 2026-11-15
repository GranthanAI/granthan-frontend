import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BillingNotice } from '@/components/billing/BillingNotice'
import { creditsBanner } from '@/components/billing/BillingBanners'
import { ModelPicker } from '@/components/chat/ModelPicker'
import { BillingSettings } from '@/components/settings/BillingSettings'
import { TopupDialog } from '@/features/billing/TopupDialog'
import { API_ORIGIN, simulatorPayload } from '@/features/billing/checkout-env'
import { qk } from '@/lib/query-keys'
import { useAuthStore } from '@/stores/auth.store'
import type { BillingDenied, PlanEntry, PlansResponse } from '@/types/billing'
import { FREE_LIMITS, mePro, modelsFree, plansResponse } from './billing-fixtures'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const payg: PlanEntry = {
  code: 'payg', version: 3, rank: 0, prices: {}, groups: ['fast', 'smart', 'best', 'ultra'], extra_models: [],
  limits: { ...FREE_LIMITS, messages_per_day: -1 },
  payg: {
    unit_prices: { fast: 20, smart: 50, best: 400, ultra: 1200, youtube_video: 100, manim_video: 200 },
    topup_packs: [{ code: 'ind_199', price_paise: 19900 }, { code: 'ind_499', price_paise: 49900 }], credit_validity_months: 12,
    storage_over_10gb_per_gb_month: 1000, long_message_tokens: 32000, no_credit_fast_per_day: 10, max_messages_per_minute: 30,
  },
}
const withPayg: PlansResponse = { ...plansResponse, plans: [...plansResponse.plans, payg] }
const SOON = new Date(Date.now() + 3 * 86_400_000).toISOString()
const LATER = new Date(Date.now() + 200 * 86_400_000).toISOString()
const wallet = {
  balance_paise: 123400, monthly_cap_paise: 500000, month_to_date_paise: 410000,
  lots: [{ amount_paise: 50000, remaining_paise: 30000, expires_at: SOON }, { amount_paise: 100000, remaining_paise: 93400, expires_at: LATER }],
}
const tx = (n: number) => Array.from({ length: n }, (_, i) => ({ occurred_at: `2026-11-${String(15 - (i % 14)).padStart(2, '0')}T10:00:00+05:30`, kind: i === 0 ? 'wallet_topup' : i === 1 ? 'credit_expiry' : 'payg_usage', amount_paise: i === 0 ? 49900 : -(i + 1) * 100 }))
const PROOF = { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig_1' }

interface Call { method: string; path: string; body: Record<string, unknown> | null; headers: Record<string, string> }
function mock(o: { plans?: PlansResponse; wallet?: 'off' | object | null; transactions?: unknown[]; topup?: () => Response } = {}) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname.replace('/api/v1', '')
    const method = init?.method ?? 'GET'
    const body = init?.body && typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    calls.push({ method, path, body, headers: (init?.headers ?? {}) as Record<string, string> })
    if (path === '/billing/plans') return json(200, o.plans ?? withPayg)
    if (path === '/billing/me') return json(200, mePro)
    if (path === '/billing/invoices') return json(200, { invoices: [] })
    if (path === '/billing/me/models') return json(200, modelsFree)
    if (path === '/billing/gst-states') return json(200, { states: [{ code: '27', name: 'Maharashtra' }] })
    if (path === '/billing/me/billing-profile') return json(200, { billing_email: 'a@example.com', state_code: '27', state_name: 'Maharashtra', gstin: null, legal_name: null })
    if (path === '/auth/me') return json(200, { id: 'u', email: 'a@example.com', is_email_verified: true, status: 'ACTIVE' })
    if (path === '/billing/wallet' && method === 'GET') return o.wallet === 'off' ? json(404, { detail: 'Pay as you Go is not available' }) : json(200, { wallet: o.wallet === undefined ? wallet : o.wallet })
    if (path === '/billing/wallet/transactions') return json(200, { transactions: o.transactions ?? tx(3) })
    if (path === '/billing/wallet/settings') return json(200, { monthly_cap_paise: body?.monthly_cap_paise ?? null })
    if (path === '/billing/wallet/topups') return o.topup ? o.topup() : json(201, { order_id: 'order_1', amount_paise: 19900, provider: 'simulator', simulator_url: '/api/v1/billing/sim/checkout/order_1?t=tok', razorpay: { key: 'k', order_id: 'order_1', name: 'GranthanAI', description: 'Credits', prefill: { email: 'a@example.com' }, notes: {} } })
    if (path === '/billing/wallet/topups/verify') return json(200, { balance_paise: 143300 })
    return json(404, { detail: 'not mocked' })
  }))
  return calls
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const wrap = (ui: React.ReactElement, qc = client()) => ({ qc, ...render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>) })
const post = (data: unknown, origin = API_ORIGIN) => act(() => { window.dispatchEvent(new MessageEvent('message', { origin, data })) })
const fakePopup = () => { const p = { closed: false, close: vi.fn(() => { p.closed = true }), location: { href: 'about:blank' } }; return p }

beforeEach(() => useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null, expired: false }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('hidden when Pay as you Go is off', () => {
  it('a 404 from the wallet shows no credits UI and no error', async () => {
    mock({ wallet: 'off' })
    wrap(<BillingSettings />)
    await screen.findByText('Billing details')
    await new Promise((r) => setTimeout(r, 80))
    expect(screen.queryByText('Credits')).toBeNull()
    expect(screen.queryByText('Monthly spend cap')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('plans without payg: the wallet is never even asked', async () => {
    const calls = mock({ plans: plansResponse })
    wrap(<BillingSettings />)
    await screen.findByText('Billing details')
    await new Promise((r) => setTimeout(r, 80))
    expect(screen.queryByText('Credits')).toBeNull()
    expect(calls.some((c) => c.path.startsWith('/billing/wallet'))).toBe(false)
  })
})

describe('Settings → Billing → Credits', () => {
  it('shows the balance, what expires soon and when, and the spend cap with its usage', async () => {
    mock()
    wrap(<BillingSettings />)
    expect(await screen.findByTestId('credits-balance')).toHaveTextContent('₹1,234')
    const soon = new Date(SOON)
    expect(screen.getByTestId('credits-expiring')).toHaveTextContent('₹300')
    expect(screen.getByTestId('credits-expiring')).toHaveTextContent(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }).format(soon))
    expect(screen.getByTestId('cap-usage')).toHaveTextContent('₹4,100 of ₹5,000 used this month')
  })

  it('lists transactions by kind, 10 to a page', async () => {
    mock({ transactions: tx(23) })
    wrap(<BillingSettings />)
    const list = await screen.findByRole('list', { name: 'Credit transactions' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(10)
    expect(within(list).getByText('Top-up')).toBeInTheDocument()
    expect(within(list).getByText('Credits expired')).toBeInTheDocument()
    expect(within(list).getByText('+₹499')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Credit transactions' })).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('edits the spend cap in whole rupees (sent as paise) and can remove it', async () => {
    const calls = mock()
    wrap(<BillingSettings />)
    const input = await screen.findByLabelText(/cap in rupees/i)
    expect(input).toHaveValue('5000')
    await userEvent.clear(input)
    await userEvent.type(input, '7500.5')
    expect(await screen.findByText('Enter a whole number of rupees.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save cap' })).toBeDisabled()
    await userEvent.clear(input)
    await userEvent.type(input, '7500')
    await userEvent.click(screen.getByRole('button', { name: 'Save cap' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/billing/wallet/settings' && c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.path === '/billing/wallet/settings')!.body).toEqual({ monthly_cap_paise: 750000 })
    await userEvent.click(screen.getByRole('button', { name: 'Remove cap' }))
    await waitFor(() => expect(calls.filter((c) => c.path === '/billing/wallet/settings')).toHaveLength(2))
    expect(calls.filter((c) => c.path === '/billing/wallet/settings')[1]!.body).toEqual({ monthly_cap_paise: null })
  })
})

describe('top-up through the simulator', () => {
  it('ignores a message from the wrong origin or source, then verifies once with an Idempotency-Key and refreshes wallet, plan, models, usage', async () => {
    const popup = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    const calls = mock()
    const { qc } = wrap(<TopupDialog onClose={() => {}} />)
    qc.setQueryData(qk.walletTransactions, { transactions: [] })
    qc.setQueryData(qk.billingModels, modelsFree)
    qc.setQueryData(qk.billingMe, mePro)
    qc.setQueryData(qk.billingUsage(), { from: '', to: '', days: [] })
    await userEvent.click(await screen.findByRole('radio', { name: /₹199/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Pay ₹199' }))
    await waitFor(() => expect(popup.location.href).toBe(`${API_ORIGIN}/api/v1/billing/sim/checkout/order_1?t=tok`))
    const start = calls.find((c) => c.path === '/billing/wallet/topups')!
    expect(start.body).toEqual({ pack_code: 'ind_199', state_code: '27', email: 'a@example.com' })
    expect(start.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)

    await post({ source: 'granthan-sim-checkout', ...PROOF }, 'https://evil.example')
    await post({ source: 'not-ours', ...PROOF })
    expect(calls.some((c) => c.path === '/billing/wallet/topups/verify')).toBe(false)

    await post({ source: 'granthan-sim-checkout', ...PROOF })
    await post({ source: 'granthan-sim-checkout', ...PROOF }) // a duplicate does not verify twice
    expect(await screen.findByTestId('topup-success')).toBeInTheDocument()
    const verify = calls.filter((c) => c.path === '/billing/wallet/topups/verify')
    expect(verify).toHaveLength(1)
    expect(verify[0]!.body).toEqual(PROOF)
    expect(verify[0]!.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(verify[0]!.headers['Idempotency-Key']).not.toBe(start.headers['Idempotency-Key'])
    await waitFor(() => {
      expect(qc.getQueryState(qk.walletTransactions)?.isInvalidated).toBe(true)
      expect(qc.getQueryState(qk.billingModels)?.isInvalidated).toBe(true)
      expect(qc.getQueryState(qk.billingUsage())?.isInvalidated).toBe(true)
      expect(qc.getQueryState(qk.billingMe)?.isInvalidated).toBe(true)
      expect(calls.slice(calls.indexOf(verify[0]!) + 1).map((c) => c.path)).toContain('/billing/wallet')
    })
    expect(popup.close).toHaveBeenCalled()
  })

  it('an order proof is accepted (order id, no subscription id) and a subscription proof still is', () => {
    expect(simulatorPayload({ origin: API_ORIGIN, data: { source: 'granthan-sim-checkout', ...PROOF } })).toEqual(PROOF)
    expect(simulatorPayload({ origin: API_ORIGIN, data: { source: 'granthan-sim-checkout', razorpay_payment_id: 'p', razorpay_signature: 's' } })).toBeNull()
    expect(simulatorPayload({ origin: API_ORIGIN, data: { source: 'granthan-sim-checkout', razorpay_payment_id: 'p', razorpay_signature: 's', razorpay_subscription_id: 'sub' } })).not.toBeNull()
  })

  it('closes the popup and shows the error when the top-up cannot start', async () => {
    const popup = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    mock({ topup: () => json(404, { detail: 'Pay as you Go is not available' }) })
    wrap(<TopupDialog onClose={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Pay ₹199' }))
    expect(await screen.findByText(/not available/i)).toBeInTheDocument()
    expect(popup.close).toHaveBeenCalled()
  })
})

describe('notices and banners', () => {
  const d = (over: Partial<BillingDenied>): BillingDenied => ({ reason: 'no_credit', message_key: 'credits.empty', message: 'api', upgrade_to: null, ...over })

  it('no_credit: Top up (to Settings → Billing) with the Fast hint', async () => {
    mock()
    wrap(<BillingNotice denial={d({})} />)
    expect(await screen.findByRole('link', { name: 'Top up' })).toHaveAttribute('href', '/settings/billing')
    expect(screen.getByText('Top up to continue.')).toBeInTheDocument()
  })

  it('spend_cap: Raise your cap', async () => {
    mock()
    wrap(<BillingNotice denial={d({ reason: 'spend_cap', message_key: 'credits.spend_cap' })} />)
    expect(await screen.findByRole('link', { name: 'Raise your cap' })).toHaveAttribute('href', '/settings/billing')
  })

  it('member_spend_cap: ask your organisation admin, no top-up or cap action', async () => {
    mock()
    wrap(<BillingNotice denial={d({ reason: 'member_spend_cap', message_key: 'credits.member_cap' })} />)
    expect(screen.getByText(/Ask your organisation admin to raise it/)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 60))
    expect(screen.queryByRole('link', { name: 'Top up' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Raise your cap' })).toBeNull()
  })

  it('with Pay as you Go off there is no Top up action', async () => {
    mock({ wallet: 'off' })
    wrap(<BillingNotice denial={d({})} />)
    await new Promise((r) => setTimeout(r, 80))
    expect(screen.queryByRole('link', { name: 'Top up' })).toBeNull()
  })

  it('credits expiring within 7 days make a banner; later ones do not', () => {
    const now = Date.now()
    const b = creditsBanner(wallet, now)!
    expect(b.id).toBe('credits_expiring')
    expect(b.text).toMatch(/^₹300 of your credits expire on /)
    expect(creditsBanner({ ...wallet, lots: [wallet.lots[1]!] }, now)).toBeNull()
    expect(creditsBanner({ ...wallet, lots: [{ amount_paise: 1, remaining_paise: 0, expires_at: SOON }] }, now)).toBeNull()
    expect(creditsBanner(null, now)).toBeNull()
  })
})

describe('the model picker', () => {
  it('credit-funded models say "uses credits" with the per-message price from the API', async () => {
    const models = { ...modelsFree, groups: modelsFree.groups.map((g) => (g.group === 'ultra' ? { ...g, allowed: true, funded_by: 'credits', models: g.models.map((m) => ({ ...m, allowed: true })) } : g)) }
    mock()
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const path = new URL(input).pathname.replace('/api/v1', '')
      if (path === '/billing/me/models') return json(200, models)
      if (path === '/billing/plans') return json(200, withPayg)
      if (path === '/preferences') return json(200, { default_mode: null, default_tools: [], version: 1 })
      return json(404, {})
    }))
    wrap(<ModelPicker selectionKey="c1" />)
    await userEvent.click(await screen.findByRole('button', { name: /^model,/i }))
    const ultra = await screen.findByRole('radio', { name: /ultra one/i })
    await waitFor(() => expect(ultra).toHaveTextContent('uses credits · ₹12 per message'))
  })
})
