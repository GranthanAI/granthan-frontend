import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AdminLayout } from '@/features/admin/AdminLayout'
import { StaffOrgsPage } from '@/features/org/StaffOrgPages'
import { useAuthStore } from '@/stores/auth.store'
import { mePro } from './billing-fixtures'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const ORG = { id: 'org-1', name: 'Sunrise College', slug: 'sunrise', type: 'college', legal_name: null, billing_email: 'b@sunrise.edu', status: 'pilot', pilot_ends_at: '2026-12-10T00:00:00Z', created_at: '2026-11-01T00:00:00Z' }

interface Call { method: string; path: string; body: Record<string, unknown> | null; headers: Record<string, string> }
function mock(role: string) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const path = url.pathname.replace('/api/v1', '')
    const method = init?.method ?? 'GET'
    calls.push({ method, path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null, headers: (init?.headers ?? {}) as Record<string, string> })
    if (path === '/auth/me') return json(200, { id: 's', email: 's@example.com', is_email_verified: true, status: 'ACTIVE', role })
    if (path === '/billing/me') return json(200, mePro)
    if (path === '/org/admin/orgs') return json(200, { items: [ORG], next_cursor: null })
    if (path === '/org/admin/orgs/org-1') return json(200, { ...ORG, active_count: 7, seat_state: { plan_code: 'org_pro', variant: 'college', seats_bought: 25, status: 'active', period_end: null, source: 'staff' } })
    if (path === '/org/admin/orgs/org-1/members') return json(200, { items: [{ user_id: 'u1', name: 'Asha', email: 'a@x.edu', role: 'owner', source: 'staff', joined_at: '2026-11-01T00:00:00Z' }], next_cursor: null })
    if (method === 'POST') return json(200, ORG)
    return json(404, {})
  }))
  return calls
}

function renderPage() {
  useAuthStore.getState().setSession('tok')
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin/orgs']}>
        <Routes><Route path="/admin" element={<AdminLayout />}><Route path="orgs" element={<StaffOrgsPage />} /></Route></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
afterEach(() => vi.unstubAllGlobals())

describe('staff organisations', () => {
  it('is hidden from non-staff (the ordinary 404 page, no org call)', async () => {
    const calls = mock('user')
    renderPage()
    await waitFor(() => expect(screen.queryByTestId('admin-shell')).toBeNull())
    expect(calls.some((c) => c.path.startsWith('/org/admin'))).toBe(false)
  })

  it('support can read an organisation (seats, members) but sees no write buttons', async () => {
    mock('support')
    renderPage()
    await userEvent.click(await screen.findByText('Sunrise College'))
    expect(await screen.findByTestId('staff-seats')).toHaveTextContent('org_pro (college), 25 seats, active, set by staff')
    expect(screen.getByText(/Asha/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Suspend' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New organisation' })).toBeNull()
    expect(screen.getByText(/need the admin staff role/)).toBeInTheDocument()
  })

  it('billing_admin is read-only here too: organisation writes need role admin', async () => {
    mock('billing_admin')
    renderPage()
    await userEvent.click(await screen.findByText('Sunrise College'))
    await screen.findByTestId('staff-seats')
    expect(screen.queryByRole('button', { name: 'Suspend' })).toBeNull()
  })

  it('admin suspends with a reason and an Idempotency-Key', async () => {
    const calls = mock('admin')
    renderPage()
    await userEvent.click(await screen.findByText('Sunrise College'))
    await userEvent.click(await screen.findByRole('button', { name: 'Suspend' }))
    const confirm = screen.getAllByRole('button', { name: /Suspend organisation/ }).pop()!
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/Reason/), 'unpaid invoice')
    await userEvent.click(confirm)
    await waitFor(() => expect(calls.some((c) => c.path === '/org/admin/orgs/org-1/suspend')).toBe(true))
    const c = calls.find((x) => x.path === '/org/admin/orgs/org-1/suspend')!
    expect(c.method).toBe('POST')
    expect(c.body).toEqual({ reason: 'unpaid invoice' })
    expect(c.headers['Idempotency-Key']).toBeTruthy()
  })

  it('closing needs the typed word as well as a reason', async () => {
    mock('admin')
    renderPage()
    await userEvent.click(await screen.findByText('Sunrise College'))
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    await userEvent.type(screen.getByLabelText(/Reason/), 'contract ended')
    expect(screen.getAllByRole('button', { name: /Close organisation/ }).pop()).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/Type CLOSE/), 'CLOSE')
    expect(screen.getAllByRole('button', { name: /Close organisation/ }).pop()).toBeEnabled()
  })
})
