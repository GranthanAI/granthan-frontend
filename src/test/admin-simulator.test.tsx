import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AdminLayout } from '@/features/admin/AdminLayout'
import { SimulatorPage } from '@/features/admin/SimulatorPage'
import { useAuthStore } from '@/stores/auth.store'
import { meLive, meSimulated } from './billing-fixtures'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface Call { method: string; path: string; body: Record<string, unknown> | null; query: URLSearchParams; headers: Record<string, string> }
function mock(role: string, me = meSimulated, fail = false) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const path = url.pathname.replace('/api/v1', '')
    const method = init?.method ?? 'GET'
    calls.push({ method, path, query: url.searchParams, body: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null, headers: (init?.headers ?? {}) as Record<string, string> })
    if (path === '/auth/me') return json(200, { id: 's', email: 's@example.com', is_email_verified: true, status: 'ACTIVE', role })
    if (path === '/billing/me') return json(200, me)
    if (path === '/billing/sim/state') return json(200, { subscriptions: [{ id: 'sub_SIM1', status: 'active', next_outcome: null }], payments: [{ id: 'pay_1' }], refunds: [{ id: 'rfnd_1', status: 'pending' }], pending_webhooks: [] })
    if (method === 'POST' && path.startsWith('/billing/sim/')) return fail ? json(404, { detail: 'unknown simulated subscription' }) : json(200, { id: 'x', status: 'ok' })
    return json(404, {})
  }))
  return calls
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin/simulator']}><Routes><Route path="/admin" element={<AdminLayout />}><Route path="simulator" element={<SimulatorPage />} /></Route></Routes></MemoryRouter>
    </QueryClientProvider>,
  )
}
const show = async () => {
  await userEvent.type(await screen.findByLabelText('User id'), 'user-1')
  await userEvent.click(screen.getByRole('button', { name: 'Show simulated state' }))
  return screen.findByTestId('sim-state')
}

beforeEach(() => useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: null, expired: false }))
afterEach(() => vi.unstubAllGlobals())

describe('simulator tools', () => {
  it('are offered only when payments are simulated', async () => {
    mock('billing_admin', meLive)
    renderPage()
    expect(await screen.findByText(/Payments are live/)).toBeInTheDocument()
    expect(screen.queryByLabelText('User id')).toBeNull()
  })

  it("shows a user's simulated state", async () => {
    const calls = mock('billing_admin')
    renderPage()
    const state = await show()
    expect(within(state).getByText('sub_SIM1')).toBeInTheDocument()
    expect(within(state).getByText(/rfnd_1/)).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/billing/sim/state')!.query.get('user_id')).toBe('user-1')
  })

  it('next-charge outcome, renew now, customer cancel, fail refund and settle now: each confirms, then posts', async () => {
    const calls = mock('billing_admin')
    renderPage()
    await show()
    const done = async (button: string | RegExp, confirmTitle: RegExp, path: string, body?: Record<string, unknown>) => {
      await userEvent.click(screen.getByRole('button', { name: button }))
      const dlg = await screen.findByRole('dialog', { name: confirmTitle })
      expect(calls.some((c) => c.method === 'POST' && c.path === path)).toBe(false) // nothing yet: it asks first
      await userEvent.click(within(dlg).getByRole('button', { name: 'Do it' }))
      await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === path)).toBe(true))
      const c = calls.filter((x) => x.method === 'POST' && x.path === path).pop()!
      expect(c.headers['Idempotency-Key']).toBeTruthy()
      if (body) expect(c.body).toEqual(body)
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    }
    await userEvent.selectOptions(screen.getByLabelText('Next charge outcome for sub_SIM1'), 'fail')
    await done('Set next charge', /Next charge fail for sub_SIM1/, '/billing/sim/subscriptions/sub_SIM1/next-charge', { outcome: 'fail' })
    await done('Renew now', /Renew sub_SIM1 now/, '/billing/sim/subscriptions/sub_SIM1/renew-now')
    await done('Customer cancel', /Customer cancels sub_SIM1/, '/billing/sim/subscriptions/sub_SIM1/customer-cancel')
    await done('Fail refund', /Fail refund rfnd_1/, '/billing/sim/refunds/rfnd_1/fail')
    await done('Settle now', /Settle now/, '/billing/sim/settle-now')
    expect(await screen.findByText(/Done: Settle now/)).toBeInTheDocument()
  })

  it('a refusal is shown in the dialog and nothing is claimed', async () => {
    mock('billing_admin', meSimulated, true)
    renderPage()
    await show()
    await userEvent.click(screen.getByRole('button', { name: 'Renew now' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Do it' }))
    expect(await screen.findByText('unknown simulated subscription')).toBeInTheDocument()
    expect(screen.queryByText(/^Done:/)).toBeNull()
  })

  it('support can look but not act', async () => {
    mock('support')
    renderPage()
    await show()
    for (const name of ['Set next charge', 'Renew now', 'Customer cancel', 'Fail refund', 'Settle now']) expect(screen.queryByRole('button', { name })).toBeNull()
  })
})
