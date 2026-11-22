import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AdminLayout } from '@/features/admin/AdminLayout'
import { OrganisationSettings } from '@/features/org/OrgSettings'
import { StaffOrgsPage } from '@/features/org/StaffOrgPages'
import { useAuthStore } from '@/stores/auth.store'
import { mePro } from './billing-fixtures'

vi.mock('@/lib/clipboard', () => ({ copyText: vi.fn(async () => true) }))
import { copyText } from '@/lib/clipboard'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const problem = (status: number, code: string, extra: Record<string, unknown> = {}) => json(status, { status, code, detail: 'x', ...extra })
const FEATURES = { lock_modes: true, shared_modes_max: null, usage_reports: true, spend_cap: true, csv_invites: true, invite_links: true, domains: true }
const ME = (role: string, features: Partial<typeof FEATURES> = {}) => ({
  org: { id: 'org-1', name: 'Sunrise College', slug: 's', type: 'college', status: 'active', pilot_ends_at: null }, role,
  seats: { plan_code: 'org_pro', status: 'active', used: 3, bought: 10, over_by: 0, pending: null }, features: { ...FEATURES, ...features },
})
const EMPTY = { items: [], next_cursor: null }

interface Call { method: string; path: string; query: string; body: Record<string, unknown> | null; headers: Record<string, string> }
function mock(handler: (c: Call) => Response | undefined) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const c: Call = { method: init?.method ?? 'GET', path: url.pathname.replace('/api/v1', ''), query: url.search, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null, headers: (init?.headers ?? {}) as Record<string, string> }
    calls.push(c)
    return handler(c) ?? (c.method === 'GET' && !c.path.endsWith('/me') ? json(200, c.path.endsWith('domains') || c.path.endsWith('invite-links') ? { items: [] } : EMPTY) : problem(404, 'NOT_FOUND'))
  }))
  return calls
}
const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const renderSettings = () => render(<QueryClientProvider client={qc()}><MemoryRouter><OrganisationSettings /></MemoryRouter></QueryClientProvider>)
const tab = async (name: string) => userEvent.click(await screen.findByRole('tab', { name }))

beforeEach(() => useAuthStore.getState().setSession('tok'))
afterEach(() => vi.unstubAllGlobals())

describe('F3 invite links', () => {
  const DOMAIN = { domain: 'sunrise.edu', status: 'verified', include_subdomains: false, auto_join: false, verified_at: '2026-11-01T00:00:00Z', verify_method: 'dns', added_at: null, dns_record: null }
  const LINK = { link_id: 'l1', created_at: '2026-11-20T00:00:00Z', expires_at: '2026-12-01T00:00:00Z', max_uses: 50, uses: 7, domain_restricted: true, status: 'open' }

  it('creates a link with the chosen limits, restricted to the verified domain, and copies it', async () => {
    const calls = mock((c) => {
      if (c.path === '/org/me') return json(200, ME('owner'))
      if (c.path === '/org/orgs/org-1/domains') return json(200, { items: [DOMAIN] })
      if (c.path === '/org/orgs/org-1/invite-links' && c.method === 'POST') return json(200, { link_id: 'l2', url: 'http://app/join/abc', max_uses: 25, expires_at: '2026-12-01T00:00:00Z', domain_restricted: true })
    })
    renderSettings()
    await tab('Invites')
    const uses = await screen.findByLabelText(/Most people who can join/)
    await userEvent.clear(uses); await userEvent.type(uses, '25')
    const days = screen.getByLabelText(/Expires after/)
    await userEvent.clear(days); await userEvent.type(days, '7')
    const box = screen.getByRole('checkbox', { name: /verified domain/ })
    await waitFor(() => expect(box).toBeEnabled())
    await userEvent.click(box)
    await userEvent.click(screen.getByRole('button', { name: 'Create link' }))
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('http://app/join/abc'))
    const post = calls.find((c) => c.path.endsWith('/invite-links') && c.method === 'POST')!
    expect(post.body).toEqual({ max_uses: 25, expires_in_days: 7, domain_restricted: true })
    expect(post.headers['Idempotency-Key']).toBeTruthy()
  })

  it('the domain restriction is disabled until a domain is verified', async () => {
    mock((c) => (c.path === '/org/me' ? json(200, ME('admin')) : undefined))
    renderSettings()
    await tab('Invites')
    expect(await screen.findByRole('checkbox', { name: /verified domain/ })).toBeDisabled()
  })

  it.each([['0', '1', /Enter a number from 1 to 5000/], ['5001', '1', /Enter a number from 1 to 5000/], ['10', '0', /Enter a number from 1 to 30/], ['10', '31', /Enter a number from 1 to 30/]])('rejects %s uses / %s days before calling the API', async (u, d, msg) => {
    const calls = mock((c) => (c.path === '/org/me' ? json(200, ME('admin')) : undefined))
    renderSettings()
    await tab('Invites')
    const uses = await screen.findByLabelText(/Most people who can join/)
    await userEvent.clear(uses); await userEvent.type(uses, u)
    const days = screen.getByLabelText(/Expires after/)
    await userEvent.clear(days); await userEvent.type(days, d)
    expect(screen.getByText(msg)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create link' })).toBeDisabled()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('lists uses / max, expiry, status, restriction; copies via the url route; revokes', async () => {
    const calls = mock((c) => {
      if (c.path === '/org/me') return json(200, ME('admin'))
      if (c.path === '/org/orgs/org-1/invite-links' && c.method === 'GET') return json(200, { items: [LINK] })
      if (c.path === '/org/orgs/org-1/invite-links/l1/url') return json(200, { link_id: 'l1', url: 'http://app/join/zzz' })
      if (c.method === 'DELETE') return new Response(null, { status: 204 })
    })
    renderSettings()
    await tab('Invites')
    const row = await screen.findByTestId('link-row')
    expect(row).toHaveTextContent('Open · 7/50 used · expires')
    expect(row).toHaveTextContent('domain only')
    await userEvent.click(within(row).getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('http://app/join/zzz'))
    await userEvent.click(within(row).getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/invite-links/l1'))).toBe(true))
  })
})

describe('F4 transfer ownership', () => {
  const MEMBERS = { items: [
    { user_id: 'u1', name: 'Asha', email: 'a@x.edu', role: 'owner', source: 'staff', joined_at: '2026-11-01T00:00:00Z' },
    { user_id: 'u2', name: 'Ravi', email: 'r@x.edu', role: 'admin', source: 'invite', joined_at: '2026-11-02T00:00:00Z' },
    { user_id: 'u3', name: 'Mina', email: 'm@x.edu', role: 'member', source: 'invite', joined_at: '2026-11-03T00:00:00Z' },
  ], next_cursor: null }

  it('only the owner sees it, and only on admins; the dialog names the person', async () => {
    const calls = mock((c) => {
      if (c.path === '/org/me') return json(200, ME('owner'))
      if (c.path === '/org/orgs/org-1/members') return json(200, MEMBERS)
      if (c.path === '/org/orgs/org-1/transfer-ownership') return json(200, { owner_id: 'u2', previous_owner_id: 'u1', previous_owner_role: 'admin' })
    })
    renderSettings()
    const rows = await screen.findAllByTestId('member-row')
    expect(screen.getAllByRole('button', { name: 'Make owner' })).toHaveLength(1)
    expect(within(rows[1]!).getByRole('button', { name: 'Make owner' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Make owner' }))
    expect(await screen.findByText('Make Ravi the owner?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Transfer ownership' }))
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/transfer-ownership'))).toBe(true))
    const t = calls.find((c) => c.path.endsWith('/transfer-ownership'))!
    expect(t.body).toEqual({ to_user_id: 'u2' })
    expect(t.headers['Idempotency-Key']).toBeTruthy()
  })

  it('an admin never sees Make owner', async () => {
    mock((c) => (c.path === '/org/me' ? json(200, ME('admin')) : c.path === '/org/orgs/org-1/members' ? json(200, MEMBERS) : undefined))
    renderSettings()
    await screen.findAllByTestId('member-row')
    expect(screen.queryByRole('button', { name: 'Make owner' })).toBeNull()
  })

  it.each([['LAST_OWNER', /keep an owner/], ['VALIDATION_ERROR', /./]])('%s is shown in words', async (code, text) => {
    mock((c) => {
      if (c.path === '/org/me') return json(200, ME('owner'))
      if (c.path === '/org/orgs/org-1/members') return json(200, MEMBERS)
      if (c.path.endsWith('/transfer-ownership')) return problem(code === 'LAST_OWNER' ? 409 : 422, code)
    })
    renderSettings()
    await userEvent.click(await screen.findByRole('button', { name: 'Make owner' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Transfer ownership' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
  })
})

describe('F5 no organisation, domain match, join requests', () => {
  const MATCH = { org_id: 'org-9', org_name: 'Sunrise College', org_type: 'college', can_request: true, pending_request_id: null }

  it('with a domain match: names the org and requests to join', async () => {
    const calls = mock((c) => {
      if (c.path === '/org/me') return problem(404, 'NOT_FOUND')
      if (c.path === '/org/me/domain-match') return json(200, MATCH)
      if (c.path === '/org/join-requests' && c.method === 'POST') return json(201, { id: 'r1', org_id: 'org-9', status: 'pending' })
    })
    renderSettings()
    expect(await screen.findByTestId('domain-match')).toHaveTextContent('Sunrise College is on GranthanAI')
    await userEvent.click(screen.getByRole('button', { name: 'Request to join' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/org/join-requests' && c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.path === '/org/join-requests')!.headers['Idempotency-Key']).toBeTruthy()
  })

  it('a pending request shows its state and can be cancelled', async () => {
    const calls = mock((c) => {
      if (c.path === '/org/me') return problem(404, 'NOT_FOUND')
      if (c.path === '/org/me/domain-match') return json(200, { ...MATCH, pending_request_id: 'r1' })
      if (c.method === 'DELETE') return new Response(null, { status: 204 })
    })
    renderSettings()
    expect(await screen.findByTestId('request-pending')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request to join' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel request' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/org/join-requests/r1')).toBe(true))
  })

  it('no match: the ask-your-admin text', async () => {
    mock((c) => (c.path === '/org/me' || c.path === '/org/me/domain-match' ? problem(404, 'NOT_FOUND') : undefined))
    renderSettings()
    expect(await screen.findByText(/ask your admin to invite you/)).toBeInTheDocument()
    expect(screen.queryByTestId('domain-match')).toBeNull()
  })

  it('owner/admin: pending requests with name and email; approve and decline; seat refusal in words', async () => {
    const calls = mock((c) => {
      if (c.path === '/org/me') return json(200, ME('admin'))
      if (c.path === '/org/orgs/org-1/join-requests' && c.method === 'GET') return json(200, { items: [
        { id: 'r1', user_id: 'u5', name: 'Kiran', email: 'k@sunrise.edu', domain: 'sunrise.edu', status: 'pending', created_at: '2026-11-20T00:00:00Z' },
        { id: 'r2', user_id: 'u6', name: 'Lata', email: 'l@sunrise.edu', domain: 'sunrise.edu', status: 'pending', created_at: '2026-11-20T00:00:00Z' }], next_cursor: null })
      if (c.path.endsWith('/r1/approve')) return problem(409, 'SEATS_FULL')
      if (c.path.endsWith('/r2/decline')) return json(200, { id: 'r2', status: 'declined' })
    })
    renderSettings()
    await tab('Join requests')
    const rows = await screen.findAllByTestId('join-request-row')
    expect(rows[0]).toHaveTextContent('Kiran')
    expect(rows[0]).toHaveTextContent('k@sunrise.edu')
    await userEvent.click(within(rows[0]!).getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no free seats/)
    await userEvent.click(within(rows[1]!).getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/r2/decline'))).toBe(true))
  })
})

describe('F6 domains', () => {
  const PENDING = { domain: 'sunrise.edu', status: 'pending', include_subdomains: false, auto_join: false, verified_at: null, verify_method: null, added_at: '2026-11-20T00:00:00Z', dns_record: { type: 'TXT', host: '@', value: 'granthan-verify=abc123' } }
  const VERIFIED = { ...PENDING, domain: 'ok.edu', status: 'verified', verified_at: '2026-11-21T00:00:00Z', verify_method: 'dns', dns_record: null }
  const open = async (items: unknown[], extra: (c: Call) => Response | undefined = () => undefined) => {
    const calls = mock((c) => (c.path === '/org/me' ? json(200, ME('owner')) : c.path === '/org/orgs/org-1/domains' && c.method === 'GET' ? json(200, { items }) : extra(c)))
    renderSettings()
    await tab('Domains')
    return calls
  }

  it('adds a domain with include-subdomains', async () => {
    const calls = await open([], (c) => (c.method === 'POST' ? json(201, { domain: 'sunrise.edu', status: 'pending', include_subdomains: true, dns_record: PENDING.dns_record, instructions: '' }) : undefined))
    await userEvent.type(await screen.findByLabelText('Domain'), ' Sunrise.EDU ')
    await userEvent.click(screen.getByRole('checkbox', { name: /Include subdomains/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Add domain' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ domain: 'sunrise.edu', include_subdomains: true })
  })

  it.each([['PUBLIC_EMAIL_DOMAIN', /public email provider/], ['DOMAIN_TAKEN', /already verified this domain/]])('%s is shown in words', async (code, text) => {
    await open([], (c) => (c.method === 'POST' ? problem(409, code) : undefined))
    await userEvent.type(await screen.findByLabelText('Domain'), 'gmail.com')
    await userEvent.click(screen.getByRole('button', { name: 'Add domain' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
  })

  it('a pending domain shows the TXT record with copy buttons and the hourly-checks note', async () => {
    await open([PENDING])
    const rec = await screen.findByTestId('dns-record')
    expect(rec).toHaveTextContent('TXT')
    expect(rec).toHaveTextContent('@')
    expect(rec).toHaveTextContent('granthan-verify=abc123')
    await userEvent.click(screen.getByRole('button', { name: 'Copy value' }))
    expect(copyText).toHaveBeenCalledWith('granthan-verify=abc123')
    await userEvent.click(screen.getByRole('button', { name: 'Copy host' }))
    expect(copyText).toHaveBeenCalledWith('@')
    expect(screen.getByText(/every hour for 7 days/)).toBeInTheDocument()
  })

  it('Verify now: not found shows the copy and keeps the expected record; found refreshes', async () => {
    let verified = false
    const calls = await open([PENDING], (c) => (c.path.endsWith('/verify') ? (verified ? json(200, { ...VERIFIED, domain: 'sunrise.edu' }) : problem(409, 'VALIDATION_ERROR')) : undefined))
    await userEvent.click(await screen.findByRole('button', { name: 'Verify now' }))
    expect(await screen.findByText(/could not find that record yet/)).toBeInTheDocument()
    expect(screen.getByTestId('dns-record')).toHaveTextContent('granthan-verify=abc123')
    verified = true
    await userEvent.click(screen.getByRole('button', { name: 'Verify now' }))
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith('/domains/sunrise.edu/verify'))).toHaveLength(2))
    expect(calls.find((c) => c.path.endsWith('/verify'))!.headers['Idempotency-Key']).toBeTruthy()
  })

  it('a verified domain has auto-join and subdomain toggles (PATCH) and a confirmed delete', async () => {
    const calls = await open([VERIFIED], (c) => (c.method === 'PATCH' ? json(200, VERIFIED) : c.method === 'DELETE' ? new Response(null, { status: 204 }) : undefined))
    await userEvent.click(await screen.findByRole('checkbox', { name: /join automatically/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ auto_join: true })
    await userEvent.click(within(screen.getByTestId('domain-row')).getByRole('checkbox', { name: /Include subdomains$/ }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2))
    expect(calls.filter((c) => c.method === 'PATCH')[1]!.body).toEqual({ include_subdomains: true })
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false) // not before the confirmation
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' }).pop()!)
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/domains/ok.edu'))).toBe(true))
  })
})

describe('F7 gating shows a plan note instead of hiding', () => {
  it('everything off: each feature says it is available on Org Pro and above', async () => {
    mock((c) => (c.path === '/org/me' ? json(200, ME('admin', { lock_modes: false, spend_cap: false, usage_reports: false, csv_invites: false, invite_links: false, domains: false })) : c.path.endsWith('/policies') ? json(200, { version: 1, lock_modes: false, approved_mode_ids: [], member_spend_cap_paise: null, updated_at: null, updated_by: null }) : undefined))
    renderSettings()
    await tab('Invites')
    expect(await screen.findByText(/Bulk invites from a file: available on Org Pro and above/)).toBeInTheDocument()
    expect(screen.getByText(/Invite links: available on Org Pro and above/)).toBeInTheDocument()
    await tab('Domains')
    expect(await screen.findByText(/Email domains and auto-join: available on Org Pro/)).toBeInTheDocument()
    await tab('Join requests')
    expect(await screen.findByText(/Join requests from your domain: available/)).toBeInTheDocument()
    await tab('Policies')
    expect(await screen.findByText(/Locking members to approved modes: available/)).toBeInTheDocument()
    expect(screen.getByText(/A monthly spend cap per member: available/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Most one member/)).toBeNull()
    await tab('Usage')
    expect(await screen.findByText(/Usage reports: available/)).toBeInTheDocument()
  })

  it('everything on: no plan notes and the controls are there', async () => {
    mock((c) => (c.path === '/org/me' ? json(200, ME('admin')) : c.path.endsWith('/policies') ? json(200, { version: 1, lock_modes: false, approved_mode_ids: [], member_spend_cap_paise: null, updated_at: null, updated_by: null }) : undefined))
    renderSettings()
    await tab('Policies')
    expect(await screen.findByLabelText(/Most one member/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /approved modes/ })).toBeInTheDocument()
    expect(screen.queryByTestId('not-in-plan')).toBeNull()
  })
})

describe('F8 staff screens', () => {
  const ORG = { id: 'org-1', name: 'Sunrise College', slug: 's', type: 'college', legal_name: null, billing_email: 'b@x.edu', status: 'pilot', pilot_ends_at: '2026-12-10T00:00:00Z', created_at: '2026-11-01T00:00:00Z' }
  const M = (n: number) => ({ user_id: `u${n}`, name: `Person ${n}`, email: `p${n}@x.edu`, role: 'member', source: 'staff', joined_at: '2026-11-01T00:00:00Z' })
  function staff(role: string, extra: (c: Call) => Response | undefined = () => undefined) {
    const calls = mock((c) => {
      if (c.path === '/auth/me') return json(200, { id: 's', email: 's@example.com', is_email_verified: true, status: 'ACTIVE', role })
      if (c.path === '/billing/me') return json(200, mePro)
      if (c.path === '/org/admin/orgs') return json(200, { items: [ORG], next_cursor: null })
      if (c.path === '/org/admin/orgs/org-1') return json(200, { ...ORG, active_count: 60, seat_state: null })
      if (c.path === '/org/admin/orgs/org-1/members' && c.method === 'GET') return c.query.includes('cursor=c1') ? json(200, { items: [M(51)], next_cursor: null }) : json(200, { items: Array.from({ length: 50 }, (_, i) => M(i + 1)), next_cursor: 'c1' })
      if (c.path === '/org/admin/orgs/org-1/audit') return json(200, { items: [{ id: 'a1', action: 'staff_suspend', actor_label: 'GranthanAI staff', actor_kind: 'staff', target_type: 'org', target_id: 'org-1', reason: 'unpaid invoice', at: '2026-11-20T00:00:00Z' }], next_cursor: null })
      return extra(c)
    })
    useAuthStore.getState().setSession('tok')
    render(<QueryClientProvider client={qc()}><MemoryRouter initialEntries={['/admin/orgs']}><Routes><Route path="/admin" element={<AdminLayout />}><Route path="orgs" element={<StaffOrgsPage />} /></Route></Routes></MemoryRouter></QueryClientProvider>)
    return calls
  }
  const openOrg = async () => userEvent.click(await screen.findByText('Sunrise College'))
  const submit = async (label: RegExp | string, reason: string) => {
    await userEvent.type(screen.getByLabelText(/Reason/), reason)
    await userEvent.click(screen.getAllByRole('button', { name: label }).pop()!)
  }

  it('members are paged: Load more fetches the next cursor', async () => {
    const calls = staff('support')
    await openOrg()
    expect(await screen.findAllByText(/Person \d+ ·/)).toHaveLength(50)
    await userEvent.click(screen.getByRole('button', { name: 'Load more members' }))
    expect(await screen.findByText(/Person 51 ·/)).toBeInTheDocument()
    expect(calls.some((c) => c.query.includes('cursor=c1'))).toBe(true)
    expect(screen.queryByRole('button', { name: 'Load more members' })).toBeNull()
  })

  it('support reads the audit log with staff reasons and sees no write buttons', async () => {
    staff('support')
    await openOrg()
    await userEvent.click(await screen.findByRole('button', { name: 'Show audit log' }))
    expect(await screen.findByTestId('staff-audit')).toHaveTextContent('staff_suspend')
    expect(screen.getByTestId('staff-audit')).toHaveTextContent('“unpaid invoice”')
    for (const name of ['Add member', 'Verify domain by hand', 'Resend owner invite']) expect(screen.queryByRole('button', { name })).toBeNull()
  })

  it('admin adds a member by user id with a reason; UNKNOWN_USER is shown in words', async () => {
    let known = false
    const calls = staff('admin', (c) => (c.method === 'POST' && c.path.endsWith('/org-1/members') ? (known ? json(201, { id: 'm', org_id: 'org-1', user_id: 'u9', role: 'admin', status: 'active', source: 'staff', joined_at: 'x' }) : problem(404, 'UNKNOWN_USER')) : undefined))
    await openOrg()
    await userEvent.click(await screen.findByRole('button', { name: 'Add member' }))
    await userEvent.type(screen.getByLabelText('User id'), '11111111-1111-1111-1111-111111111111')
    await submit(/Add member/, 'pilot owner asked')
    expect(await screen.findByRole('alert')).toHaveTextContent(/No GranthanAI account was found/)
    known = true
    await userEvent.click(screen.getAllByRole('button', { name: /Add member/ }).pop()!)
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/org-1/members'))).toHaveLength(2))
    const post = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/org-1/members'))[1]!
    expect(post.body).toEqual({ user_id: '11111111-1111-1111-1111-111111111111', role: 'member', reason: 'pilot owner asked' })
    expect(post.headers['Idempotency-Key']).toBeTruthy()
  })

  it('manual domain verify and resend owner invite go through the reason dialog', async () => {
    const calls = staff('admin', (c) => (c.method === 'POST' ? json(200, {}) : undefined))
    await openOrg()
    await userEvent.click(await screen.findByRole('button', { name: 'Verify domain by hand' }))
    await userEvent.type(screen.getByLabelText(/Domain/), 'Sunrise.edu')
    expect(screen.getAllByRole('button', { name: /Verify domain/ }).pop()).toBeDisabled() // no reason yet
    await submit(/Verify domain$/, 'college IT is slow')
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/domains/sunrise.edu/manual-verify'))).toBe(true))
    expect(calls.find((c) => c.path.endsWith('/manual-verify'))!.body).toEqual({ reason: 'college IT is slow' })
    await userEvent.click(await screen.findByRole('button', { name: 'Resend owner invite' }))
    await userEvent.type(screen.getByLabelText('Invite id'), 'inv-1')
    await submit(/Resend invite/, 'owner lost the email')
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/invites/inv-1/resend'))).toBe(true))
    expect(calls.find((c) => c.path.endsWith('/invites/inv-1/resend'))!.body).toEqual({ reason: 'owner lost the email' })
  })
})
