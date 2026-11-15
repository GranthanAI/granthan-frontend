import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AdminLayout } from '@/features/admin/AdminLayout'
import { CostsPage, PricesPage, ReconciliationPage, SettlementsPage, isProblem, parseSettlements } from '@/features/admin/MoneyPages'
import { useAuthStore } from '@/stores/auth.store'
import { mePro } from './billing-fixtures'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface Call { method: string; path: string; query: URLSearchParams; body: Record<string, unknown> | null }
function mock(role: string) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const path = url.pathname.replace('/api/v1', '')
    const method = init?.method ?? 'GET'
    calls.push({ method, path, query: url.searchParams, body: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null })
    if (path === '/auth/me') return json(200, { id: 's', email: 's@example.com', is_email_verified: true, status: 'ACTIVE', role })
    if (path === '/billing/me') return json(200, mePro)
    if (path === '/billing/admin/costs') {
      const by = url.searchParams.get('by')
      return json(200, { rows: by === 'user' ? [{ key: 'user-9', cost_micro_inr: 9_000_000, events: 40, price_paise: 100 }] : by === 'plan' ? [{ key: 'pro', cost_micro_inr: 5_000_000, events: 10, price_paise: 4990 }] : [{ key: 'groq', cost_micro_inr: 2_000_000, events: 5 }, { key: 'anthropic', cost_micro_inr: 3_000_000, events: 7 }] })
    }
    if (path === '/billing/admin/reconciliation') return json(200, { checks: [
      { check: 'ledger_balanced', status: 'ok', difference_paise: 0, details: {}, created_at: '2026-11-15T01:00:00+05:30' },
      { check: 'gateway_vs_payments', status: 'mismatch', difference_paise: 1500, details: {}, created_at: '2026-11-15T01:00:00+05:30' },
    ] })
    if (path === '/billing/admin/model-prices' && method === 'GET') return json(200, { prices: [
      { model: 'gpt-6-luna', provider: 'openai', model_group: 'smart', input_usd_per_m: '0.30', cached_input_usd_per_m: null, output_usd_per_m: '2.50', effective_from: '2026-11-01T00:00:00+05:30' },
      { model: 'gpt-6-luna', provider: 'openai', model_group: 'smart', input_usd_per_m: '0.20', cached_input_usd_per_m: null, output_usd_per_m: '2.00', effective_from: '2026-06-01T00:00:00+05:30' },
    ] })
    if (path === '/billing/admin/fx-rates' && method === 'GET') return json(200, { rates: [{ effective_from: '2026-10-24', usd_inr: '95.0000', source: 'rbi' }] })
    if (path === '/billing/admin/settlements') return body(calls)?.payment_id === 'bad' ? json(404, { detail: 'payment not found' }) : json(201, { posted: true })
    if (method === 'PUT') return json(201, { ok: true })
    return json(404, {})
  }))
  return calls
}
const body = (calls: Call[]) => calls[calls.length - 1]?.body

function renderPage(el: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin/x']}><Routes><Route path="/admin" element={<AdminLayout />}><Route path="x" element={el} /></Route></Routes></MemoryRouter>
    </QueryClientProvider>,
  )
}
beforeEach(() => useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: null, expired: false }))
afterEach(() => vi.unstubAllGlobals())

describe('costs', () => {
  it('by provider by default, with a total in rupees; plan and heavy users on request', async () => {
    const calls = mock('support')
    renderPage(<CostsPage />)
    const table = await screen.findByRole('table', { name: 'Costs' })
    expect(within(table).getByText('anthropic')).toBeInTheDocument()
    expect(screen.getByTestId('cost-total')).toHaveTextContent('₹5') // 5,000,000 µINR
    await userEvent.click(screen.getByRole('radio', { name: 'By plan' }))
    expect(await screen.findByText('pro')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Heavy users' }))
    expect(await screen.findByText('user-9')).toBeInTheDocument()
    const last = calls.filter((c) => c.path === '/billing/admin/costs').pop()!
    expect(last.query.get('by')).toBe('user')
    expect(last.query.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('reconciliation', () => {
  it('shows the run and highlights what differs', async () => {
    mock('support')
    renderPage(<ReconciliationPage />)
    const list = await screen.findByRole('list', { name: 'Checks' })
    const [ok, bad] = within(list).getAllByRole('listitem')
    expect(ok).toHaveAttribute('data-problem', 'false')
    expect(bad).toHaveAttribute('data-problem', 'true')
    expect(bad).toHaveTextContent('difference ₹15')
    expect(isProblem({ check: 'x', status: 'ok', difference_paise: 0, details: {}, created_at: '' })).toBe(false)
    expect(isProblem({ check: 'x', status: 'ok', difference_paise: 1, details: {}, created_at: '' })).toBe(true)
  })
})

describe('settlements import', () => {
  it('parses CSV lines and reports bad ones', () => {
    const r = parseSettlements('payment_id,fee_paise,fee_gst_paise\npay-1,236,42\n\npay-2,abc,1\n pay-3 , 10 , 2 ')
    expect(r.lines).toEqual([{ payment_id: 'pay-1', fee_paise: 236, fee_gst_paise: 42 }, { payment_id: 'pay-3', fee_paise: 10, fee_gst_paise: 2 }])
    expect(r.bad).toEqual([4])
  })

  it('support cannot import; billing_admin imports each line with a reason and sees per-line results', async () => {
    mock('support')
    const v = renderPage(<SettlementsPage />)
    expect(await screen.findByText(/needs the billing_admin role/)).toBeInTheDocument()
    v.unmount()
    const calls = mock('billing_admin')
    renderPage(<SettlementsPage />)
    await userEvent.type(await screen.findByLabelText('Settlement CSV'), 'pay-1,236,42{enter}bad,1,1')
    await userEvent.click(screen.getByRole('button', { name: /Import 2 settlements/ }))
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByRole('button', { name: 'Import' })).toBeDisabled()
    await userEvent.type(within(dlg).getByLabelText(/reason/i), 'Razorpay report 15 Nov')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Import' }))
    const results = await screen.findByRole('list', { name: 'Import results' })
    await waitFor(() => expect(within(results).getAllByRole('listitem')).toHaveLength(2))
    expect(results).toHaveTextContent('pay-1: posted')
    expect(results).toHaveTextContent('bad: payment not found')
    expect(calls.filter((c) => c.path === '/billing/admin/settlements')[0]!.body).toEqual({ payment_id: 'pay-1', fee_paise: 236, fee_gst_paise: 42, reason: 'Razorpay report 15 Nov' })
  })
})

describe('model prices and FX', () => {
  it('lists the effective-dated history; support cannot add rows', async () => {
    mock('support')
    renderPage(<PricesPage />)
    const prices = await screen.findByRole('table', { name: 'Model prices' })
    expect(within(prices).getAllByText('gpt-6-luna')).toHaveLength(2) // history, newest first
    expect(within(prices).getByText('1 Nov 2026')).toBeInTheDocument()
    expect(within(await screen.findByRole('table', { name: 'FX rates' })).getByText('95.0000')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add a price row' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add a rate' })).toBeNull()
  })

  it('adding a row PUTs a new effective-dated row (history is never edited)', async () => {
    const calls = mock('billing_admin')
    renderPage(<PricesPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Add a rate' }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText('₹ per US$'), '96.5')
    await userEvent.type(within(dlg).getByLabelText(/reason/i), 'monthly RBI rate')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Add rate' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/billing/admin/fx-rates' && c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ usd_inr: '96.5', source: 'admin', reason: 'monthly RBI rate' })
  })

  it('a model price needs numbers, and sends the group and an IST effective time', async () => {
    const calls = mock('billing_admin')
    renderPage(<PricesPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Add a price row' }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText('Model id'), 'gpt-7')
    await userEvent.type(within(dlg).getByLabelText('Provider'), 'openai')
    await userEvent.type(within(dlg).getByLabelText('Input $/M'), 'abc')
    await userEvent.type(within(dlg).getByLabelText('Output $/M'), '3.5')
    await userEvent.type(within(dlg).getByLabelText(/reason/i), 'new model')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Add price' }))
    expect(await within(dlg).findByText(/Fill in the model/)).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    await userEvent.clear(within(dlg).getByLabelText('Input $/M'))
    await userEvent.type(within(dlg).getByLabelText('Input $/M'), '1.25')
    await userEvent.selectOptions(within(dlg).getByLabelText('Group'), 'best')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Add price' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/billing/admin/model-prices' && c.method === 'PUT')).toBe(true))
    const b = calls.find((c) => c.method === 'PUT')!.body!
    expect(b).toMatchObject({ model: 'gpt-7', provider: 'openai', group: 'best', input_usd_per_m: '1.25', output_usd_per_m: '3.5', cached_input_usd_per_m: null })
    expect(String(b.effective_from)).toMatch(/T00:00:00\+05:30$/)
  })
})
