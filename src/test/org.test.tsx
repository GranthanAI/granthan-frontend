import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { JoinPage } from '@/features/org/JoinPage'
import { OrganisationSettings } from '@/features/org/OrgSettings'
import { orgErrorMessage } from '@/features/org/errors'
import { parseErrorBody } from '@/lib/errors'
import { useAuthStore } from '@/stores/auth.store'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/problem+json' } })
const problem = (status: number, code: string, detail = 'x') => json(status, { status, code, detail })

const PREVIEW = { org_name: 'Sunrise College', org_type: 'college', inviter_name: 'Asha', role: 'member', email_hint: 'a***@sunrise.edu', expires_at: '2026-12-01T00:00:00Z' }
const ME = (role: string) => ({
  org: { id: 'org-1', name: 'Sunrise College', slug: 'sunrise', type: 'college', status: 'active', pilot_ends_at: null }, role,
  seats: { plan_code: 'org_pro', status: 'active', used: 3, bought: 5, over_by: 0, pending: 4 },
  features: { lock_modes: true, shared_modes_max: null, usage_reports: true, spend_cap: true, csv_invites: true, invite_links: true, domains: false },
})

interface Call { method: string; path: string; query: string; body: unknown; headers: Record<string, string> }
function mock(handler: (c: Call) => Response | undefined) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const c: Call = { method: init?.method ?? 'GET', path: url.pathname.replace('/api/v1', ''), query: url.search, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null, headers: (init?.headers ?? {}) as Record<string, string> }
    calls.push(c)
    return handler(c) ?? problem(404, 'NOT_FOUND')
  }))
  return calls
}
const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

function renderJoin(signedIn: boolean) {
  return render(
    <QueryClientProvider client={qc()}>
      <MemoryRouter initialEntries={['/join/tok123']}>
        <Routes>
          <Route path="/join/:token" element={<JoinPage signedIn={signedIn} restoring={false} />} />
          <Route path="/settings/organisation" element={<div>org settings</div>} />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const renderSettings = () => render(<QueryClientProvider client={qc()}><MemoryRouter><OrganisationSettings /></MemoryRouter></QueryClientProvider>)

beforeEach(() => useAuthStore.getState().setSession('tok'))
afterEach(() => vi.unstubAllGlobals())

describe('errors', () => {
  it('keeps the machine code from a problem+json body and maps it to copy', () => {
    const e = parseErrorBody(409, { code: 'SEATS_FULL', detail: 'Seats are full' })
    expect(e.code).toBe('SEATS_FULL')
    expect(orgErrorMessage(e)).toMatch(/no free seats/)
    expect(orgErrorMessage(parseErrorBody(409, { code: 'SOMETHING_NEW', detail: 'Server words' }))).toBe('Server words')
  })
})

describe('/join/:token', () => {
  it('shows the invitation without a session, with sign in / sign up, and previews with no auth header', async () => {
    const calls = mock((c) => (c.path === '/org/invites/preview' ? json(200, PREVIEW) : undefined))
    renderJoin(false)
    expect(await screen.findByText('Join Sunrise College')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Join Sunrise/ })).toBeNull()
    expect(calls[0]!.query).toBe('?token=tok123')
    expect(calls[0]!.headers.Authorization).toBeUndefined()
  })

  it('joins with an Idempotency-Key and goes to Settings → Organisation', async () => {
    const calls = mock((c) => {
      if (c.path === '/org/invites/preview') return json(200, PREVIEW)
      if (c.path === '/org/invites/accept') return json(200, { org_id: 'org-1', org_name: 'Sunrise College', role: 'member' })
    })
    renderJoin(true)
    await userEvent.click(await screen.findByRole('button', { name: 'Join Sunrise College' }))
    expect(await screen.findByText('org settings')).toBeInTheDocument()
    const accept = calls.find((c) => c.path === '/org/invites/accept')!
    expect(accept.body).toEqual({ token: 'tok123' })
    expect(accept.headers['Idempotency-Key']).toBeTruthy()
  })

  it.each([
    ['INVITE_EXPIRED', /expired/],
    ['INVITE_INVALID', /not valid/],
  ])('a dead link (%s) explains itself and offers no Join', async (code, text) => {
    mock((c) => (c.path === '/org/invites/preview' ? problem(404, code) : undefined))
    renderJoin(true)
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Join/ })).toBeNull()
  })

  it.each([
    ['SEATS_FULL', 409, /no free seats/],
    ['PAYMENT_DUE', 402, /payment due/],
    ['ALREADY_IN_ORG', 409, /already in an organisation/],
    ['INVITE_EMAIL_MISMATCH', 403, /different email/],
    ['EMAIL_NOT_VERIFIED', 403, /Verify your email/],
  ])('shows the %s refusal in words and stays on the page', async (code, status, text) => {
    mock((c) => {
      if (c.path === '/org/invites/preview') return json(200, PREVIEW)
      if (c.path === '/org/invites/accept') return problem(status, code)
    })
    renderJoin(true)
    await userEvent.click(await screen.findByRole('button', { name: 'Join Sunrise College' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(screen.getByRole('button', { name: 'Join Sunrise College' })).toBeEnabled()
  })
})

describe('Settings → Organisation', () => {
  it('says so when the user is in no organisation (404 is not an error)', async () => {
    mock((c) => (c.path === '/org/me' ? problem(404, 'NOT_FOUND') : undefined))
    renderSettings()
    expect(await screen.findByTestId('org-none')).toBeInTheDocument()
  })

  it('a member sees the summary and Leave, but no management tabs or seats', async () => {
    mock((c) => (c.path === '/org/me' ? json(200, ME('member')) : undefined))
    renderSettings()
    expect(await screen.findByTestId('org-summary')).toHaveTextContent('Sunrise College')
    expect(screen.getByRole('button', { name: 'Leave organisation' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByTestId('org-seats')).toBeNull()
  })

  it('an owner sees seats (with the pending decrease), the tabs, and no Leave', async () => {
    mock((c) => {
      if (c.path === '/org/me') return json(200, ME('owner'))
      if (c.path === '/org/orgs/org-1/members') return json(200, { items: [
        { user_id: 'u1', name: 'Asha', email: 'asha@sunrise.edu', role: 'owner', source: 'staff', joined_at: '2026-11-01T00:00:00Z' },
        { user_id: 'u2', name: 'Ravi', email: 'ravi@sunrise.edu', role: 'member', source: 'invite', joined_at: '2026-11-02T00:00:00Z' },
      ], next_cursor: null })
    })
    renderSettings()
    expect(await screen.findByTestId('org-seats')).toHaveTextContent('3 of 5 used · drops to 4 at the next renewal')
    expect(screen.getAllByRole('tab')).toHaveLength(5)
    expect(screen.queryByRole('button', { name: 'Leave organisation' })).toBeNull()
    expect(await screen.findAllByTestId('member-row')).toHaveLength(2)
  })

  it('invites by email with an Idempotency-Key and reports each address', async () => {
    const calls = mock((c) => {
      if (c.path === '/org/me') return json(200, ME('admin'))
      if (c.path === '/org/orgs/org-1/members') return json(200, { items: [], next_cursor: null })
      if (c.path === '/org/orgs/org-1/invites' && c.method === 'GET') return json(200, { items: [], next_cursor: null })
      if (c.path === '/org/orgs/org-1/invite-links') return json(200, { items: [] })
      if (c.path === '/org/orgs/org-1/invites' && c.method === 'POST')
        return json(200, { results: [{ email: 'a@x.edu', result: 'created', invite_id: 'i1' }, { email: 'b@x.edu', result: 'already_member', invite_id: null }], seats: { used: 3, bought: 5, open_invites: 1, warning: false, payment_due: false } })
    })
    renderSettings()
    await userEvent.click(await screen.findByRole('tab', { name: 'Invites' }))
    await userEvent.type(await screen.findByLabelText(/Email addresses/), 'a@x.edu, b@x.edu')
    await userEvent.click(screen.getByRole('button', { name: 'Send invitations' }))
    const list = await screen.findByTestId('invite-results')
    expect(list).toHaveTextContent('a@x.edu: Invitation sent')
    expect(list).toHaveTextContent('b@x.edu: Already a member')
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.body).toEqual({ emails: ['a@x.edu', 'b@x.edu'], role: 'member' })
    expect(post.headers['Idempotency-Key']).toBeTruthy()
  })

  it('saves the spend cap in paise', async () => {
    const calls = mock((c) => {
      if (c.path === '/org/me') return json(200, ME('owner'))
      if (c.path === '/org/orgs/org-1/members') return json(200, { items: [], next_cursor: null })
      if (c.path === '/org/orgs/org-1/policies') return json(200, { version: 1, lock_modes: false, approved_mode_ids: [], member_spend_cap_paise: null, updated_at: null })
    })
    renderSettings()
    await userEvent.click(await screen.findByRole('tab', { name: 'Policies' }))
    await userEvent.type(await screen.findByLabelText(/Most one member/), '250')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ lock_modes: false, approved_mode_ids: [], member_spend_cap_paise: 25000 })
  })
})
