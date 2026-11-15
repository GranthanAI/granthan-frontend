import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AdminLayout } from '@/features/admin/AdminLayout'
import { AccountsPage, microInr } from '@/features/admin/AccountsPage'
import { useAuthStore } from '@/stores/auth.store'
import { mePro } from './billing-fixtures'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const ACCOUNT = { id: 'acc-1', owner_type: 'user', owner_id: 'user-1', billing_email: 'ada@example.com', legal_name: null, gstin: null, state_code: '27', blocked_at: null }
const detail = (over: Record<string, unknown> = {}) => ({
  account: ACCOUNT,
  overrides: [{ id: 'ov-1', plan_code: 'max', reason: 'beta tester', starts_at: '2026-11-01T00:00:00+05:30', expires_at: '2026-12-01T00:00:00+05:30', ended_at: null }],
  subscriptions: [{ id: 's1', status: 'active', interval: 'month', plan_code: 'pro', version: 2, current_period_end: '2026-12-01T10:00:00+05:30', grace_until: null }],
  history: [{ from_status: 'incomplete', to_status: 'active', trigger: 'payment', at: '2026-11-01T10:00:00+05:30' }],
  payments: [{ id: 'pay-1', gateway_payment_id: 'pay_x', purpose: 'subscription', method: 'upi', amount_paise: 49900, status: 'captured', captured_at: '2026-11-01T10:00:00+05:30' }],
  invoices: [
    { id: 'i1', number: 'GA/2627/000001', kind: 'tax_invoice', total_paise: 49900, status: 'paid', issued_at: '2026-11-01T10:00:00+05:30' },
    { id: 'c1', number: 'CN/2627/000001', kind: 'credit_note', total_paise: 24950, status: 'issued', issued_at: '2026-11-05T10:00:00+05:30' },
  ],
  this_month: { usage_events: 12, cost_micro_inr: 535_593_000, revenue_paise: 42288, margin_micro_inr: -112_713_000 },
  ...over,
})

interface Call { method: string; path: string; body: Record<string, unknown> | null; headers: Record<string, string>; query: string }
function mock(role: string, d = detail()) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const path = url.pathname.replace('/api/v1', '')
    const method = init?.method ?? 'GET'
    calls.push({ method, path, query: url.search, body: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null, headers: (init?.headers ?? {}) as Record<string, string> })
    if (path === '/auth/me') return json(200, { id: 'staff', email: 's@example.com', is_email_verified: true, status: 'ACTIVE', role })
    if (path === '/billing/me') return json(200, mePro)
    if (path === '/billing/admin/accounts') return json(200, { accounts: url.searchParams.get('q') === 'nobody' ? [] : [ACCOUNT] })
    if (path === '/billing/admin/accounts/acc-1') return json(200, d)
    if (method === 'POST' && path.startsWith('/billing/admin/')) return json(path.endsWith('/refunds') || path.endsWith('/overrides') ? 201 : 200, { ok: true })
    return json(404, {})
  }))
  return calls
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin/accounts']}>
        <Routes><Route path="/admin" element={<AdminLayout />}><Route path="accounts" element={<AccountsPage />} /></Route></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const open = async () => {
  await userEvent.type(await screen.findByLabelText(/email, user id or account id/i), 'ada')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await userEvent.click(await screen.findByRole('button', { name: /ada@example.com/ }))
  return screen.findByTestId('account-detail')
}
const dialog = () => screen.findByRole('dialog')

beforeEach(() => useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: null, expired: false }))
afterEach(() => vi.unstubAllGlobals())

describe('accounts: search and detail', () => {
  it('searches by email, user id or account id and shows a no-result message', async () => {
    const calls = mock('support')
    renderPage()
    await userEvent.type(await screen.findByLabelText(/email, user id or account id/i), 'nobody')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText(/No account matches/)).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/billing/admin/accounts')!.query).toContain('q=nobody')
  })

  it('the detail shows plan, status and history, payments, invoices and credit notes apart, overrides, this month, block state', async () => {
    mock('support')
    renderPage()
    const d = await open()
    expect(within(d).getByText((_, el) => el?.tagName === 'LI' && /^pro v2 · month · active · to 1 Dec 2026$/.test(el.textContent ?? ''))).toBeInTheDocument()
    expect(within(d).getByText(/incomplete → active \(payment\)/)).toBeInTheDocument()
    expect(within(d).getByRole('list', { name: 'Payments' })).toHaveTextContent('₹499 · subscription · upi · captured')
    const invoices = within(d).getByRole('list', { name: 'Invoices' })
    const notes = within(d).getByRole('list', { name: 'Credit notes' })
    expect(invoices).toHaveTextContent('GA/2627/000001')
    expect(invoices).not.toHaveTextContent('CN/2627/000001')
    expect(notes).toHaveTextContent('CN/2627/000001')
    expect(notes).toHaveTextContent('₹249.50')
    expect(within(d).getByText(/max · 1 Nov 2026 → 1 Dec 2026 · active/)).toBeInTheDocument()
    expect(within(d).getByTestId('this-month')).toHaveTextContent('12 model calls · cost ₹535.59 · revenue ₹422.88 · margin -₹112.71')
    expect(within(d).getByTestId('block-state')).toHaveTextContent('Not blocked')
  })

  it('µINR converts to rupees', () => {
    expect(microInr(535_593_000)).toBe('₹535.59')
    expect(microInr(0)).toBe('₹0')
  })

  it('support is read-only: no action buttons anywhere', async () => {
    mock('support')
    renderPage()
    const d = await open()
    for (const name of ['Block', 'Unblock', 'Grant override', 'End', 'Refund']) expect(within(d).queryByRole('button', { name })).toBeNull()
  })
})

describe('accounts: billing_admin actions', () => {
  it('block: a reason is required and it is posted with an Idempotency-Key', async () => {
    const calls = mock('billing_admin')
    renderPage()
    const d = await open()
    await userEvent.click(within(d).getByRole('button', { name: 'Block' }))
    const dlg = await dialog()
    expect(within(dlg).getByRole('button', { name: 'Block account' })).toBeDisabled()
    await userEvent.type(within(dlg).getByLabelText(/reason/i), 'chargeback abuse')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Block account' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/billing/admin/accounts/acc-1/block')).toBe(true))
    const c = calls.find((x) => x.path === '/billing/admin/accounts/acc-1/block')!
    expect(c.body).toEqual({ reason: 'chargeback abuse' })
    expect(c.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('unblock shows for a blocked account', async () => {
    const calls = mock('billing_admin', detail({ account: { ...ACCOUNT, blocked_at: '2026-11-10T00:00:00Z', blocked_reason: 'abuse' } }))
    renderPage()
    const d = await open()
    expect(within(d).getByTestId('block-state')).toHaveTextContent('Blocked')
    expect(within(d).getByText('Blocked because: abuse')).toBeInTheDocument()
    await userEvent.click(within(d).getByRole('button', { name: 'Unblock' }))
    await userEvent.type(within(await dialog()).getByLabelText(/reason/i), 'resolved')
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Unblock' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/billing/admin/accounts/acc-1/unblock')).toBe(true))
  })

  it('grant override: plan, duration and reason; sent for the account owner', async () => {
    const calls = mock('billing_admin')
    renderPage()
    const d = await open()
    await userEvent.click(within(d).getByRole('button', { name: 'Grant override' }))
    const dlg = await dialog()
    await userEvent.selectOptions(within(dlg).getByLabelText('Plan'), 'max')
    await userEvent.selectOptions(within(dlg).getByLabelText('For'), '14')
    await userEvent.type(within(dlg).getByLabelText(/reason/i), 'launch partner')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Grant override' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/billing/admin/overrides')).toBe(true))
    const body = calls.find((c) => c.path === '/billing/admin/overrides')!.body!
    expect(body).toMatchObject({ owner_type: 'user', owner_id: 'user-1', plan_code: 'max', reason: 'launch partner' })
    const days = (new Date(body.expires_at as string).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(13.9)
    expect(days).toBeLessThan(14.1)
  })

  it('end an override', async () => {
    const calls = mock('billing_admin')
    renderPage()
    const d = await open()
    await userEvent.click(within(d).getByRole('button', { name: 'End' }))
    await userEvent.type(within(await dialog()).getByLabelText(/reason/i), 'no longer needed')
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'End override' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/billing/admin/overrides/ov-1/end')).toBe(true))
    expect(calls.find((c) => c.path === '/billing/admin/overrides/ov-1/end')!.body).toEqual({ reason: 'no longer needed' })
  })

  it('refund: rupees are sent as paise, cannot exceed the payment, and the credit note is pointed to', async () => {
    const calls = mock('billing_admin')
    renderPage()
    const d = await open()
    await userEvent.click(within(d).getByRole('button', { name: 'Refund' }))
    const dlg = await dialog()
    const amount = within(dlg).getByLabelText('Amount in rupees')
    expect(amount).toHaveValue('499')
    await userEvent.clear(amount)
    await userEvent.type(amount, '600')
    expect(within(dlg).getByText(/Between ₹0.01 and ₹499/)).toBeInTheDocument()
    await userEvent.type(within(dlg).getByLabelText(/reason/i), 'goodwill')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Refund' }))
    expect(await within(dlg).findByText(/Enter an amount between/)).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/billing/admin/refunds')).toBe(false)
    await userEvent.clear(amount)
    await userEvent.type(amount, '249.50')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Refund' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/billing/admin/refunds')).toBe(true))
    expect(calls.find((c) => c.path === '/billing/admin/refunds')!.body).toEqual({ payment_id: 'pay-1', amount_paise: 24950, reason: 'goodwill' })
    expect(await screen.findByText(/credit note appears under Credit notes/)).toBeInTheDocument()
  })
})
