import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { routes } from '@/app/router'
import { PENDING_INVITE_TTL_MS, afterAuthPath, clearPendingInvite, pendingInviteToken, savePendingInvite } from '@/features/org/pendingInvite'
import { useAuthStore } from '@/stores/auth.store'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const problem = (status: number, code: string) => json(status, { status, code, detail: 'x' })
const PREVIEW = { org_name: 'Sunrise College', org_type: 'college', inviter_name: 'Asha', role: 'member', email_hint: null, expires_at: '2026-12-01T00:00:00Z' }
const USER = { id: 'u1', email: 'new@sunrise.edu', full_name: 'New Student', is_email_verified: true, status: 'ACTIVE' }
const ME = { org: { id: 'org-1', name: 'Sunrise College', slug: 's', type: 'college', status: 'active', pilot_ends_at: null }, role: 'member',
  seats: { plan_code: 'org_pro', status: 'active', used: 1, bought: 5, over_by: 0, pending: null }, features: { lock_modes: true, shared_modes_max: null, usage_reports: true, spend_cap: false, csv_invites: true, invite_links: true, domains: true } }

function mock(over: (path: string, method: string) => Response | undefined = () => undefined) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname.replace('/api/v1', '')
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${path}`)
    const custom = over(path, method)
    if (custom) return custom
    if (path === '/org/invites/preview') return json(200, PREVIEW)
    if (path === '/auth/register') return json(201, { ...USER, status: 'PENDING_VERIFICATION' })
    if (path === '/auth/verify-email') return json(200, { message: 'ok' })
    if (path === '/auth/login') return json(200, { access_token: 'tok', token_type: 'bearer' })
    if (path === '/auth/me') return json(200, USER)
    if (path === '/org/invites/accept') return json(200, { org_id: 'org-1', org_name: 'Sunrise College', role: 'member' })
    if (path === '/org/me') return json(200, ME)
    return problem(404, 'NOT_FOUND')
  }))
  return calls
}

/** One browser tab: a fresh router and query cache, the same localStorage. */
function openTab(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

beforeEach(() => { localStorage.clear(); useAuthStore.getState().setAnonymous() })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('pending invite storage', () => {
  it('keeps {token, savedAt} for 24 hours and then forgets it', () => {
    savePendingInvite('abc', 1_000)
    expect(JSON.parse(localStorage.getItem('pendingOrgInvite')!)).toMatchObject({ token: 'abc', savedAt: 1_000 })
    expect(pendingInviteToken(1_000 + PENDING_INVITE_TTL_MS)).toBe('abc')
    expect(pendingInviteToken(1_001 + PENDING_INVITE_TTL_MS)).toBeNull()
    expect(localStorage.getItem('pendingOrgInvite')).toBeNull()
  })
  it('opening the same link again does not extend the 24 hours; a different link replaces it', () => {
    savePendingInvite('abc', 1_000)
    savePendingInvite('abc', 5_000)
    expect(JSON.parse(localStorage.getItem('pendingOrgInvite')!).savedAt).toBe(1_000)
    savePendingInvite('other', 6_000)
    expect(pendingInviteToken(6_000)).toBe('other')
  })
  it('sends the user to the join page once, then falls back', () => {
    savePendingInvite('abc')
    expect(afterAuthPath('/')).toBe('/join/abc')
    expect(afterAuthPath('/')).toBe('/')
    expect(pendingInviteToken()).toBe('abc') // still kept until an accept or a final error
  })
  it('ignores a corrupt value', () => {
    localStorage.setItem('pendingOrgInvite', '{not json')
    expect(pendingInviteToken()).toBeNull()
    expect(afterAuthPath('/x')).toBe('/x')
  })
  it('never writes the token to the console', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    savePendingInvite('secret-token-value')
    afterAuthPath('/')
    clearPendingInvite()
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain('secret-token-value')
    spies.forEach((s) => s.mockRestore())
  })
})

describe('the invite survives signup and verification in another tab', { timeout: 30_000 }, () => {
  it('signed out -> signup -> verify in a new tab -> login -> join page -> accept clears it', async () => {
    const calls = mock()
    // Tab 1: the link, opened signed out.
    openTab('/join/tok123')
    await screen.findByText('Join Sunrise College')
    expect(pendingInviteToken()).toBe('tok123')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await userEvent.type(await screen.findByLabelText('Full name'), 'New Student')
    await userEvent.type(screen.getByLabelText('Email'), 'new@sunrise.edu')
    await userEvent.type(screen.getByLabelText('Password'), 'Str0ng!Passw0rd')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Str0ng!Passw0rd')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await screen.findByText('Verify your email')
    cleanup()

    // Tab 2: the verification page, no router state, same localStorage.
    expect(pendingInviteToken()).toBe('tok123')
    const tab2 = openTab('/verify-email?email=new%40sunrise.edu')
    await userEvent.type(await screen.findByLabelText('Verification code'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    await screen.findByText('Welcome back')
    expect(tab2.state.location.state?.from).toBeUndefined()

    // Login lands on the join page, not on the chat.
    await userEvent.type(screen.getByLabelText('Email'), 'new@sunrise.edu')
    await userEvent.type(screen.getByLabelText('Password'), 'Str0ng!Passw0rd')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(tab2.state.location.pathname).toBe('/join/tok123'))
    await userEvent.click(await screen.findByRole('button', { name: 'Join Sunrise College' }))
    await waitFor(() => expect(tab2.state.location.pathname).toBe('/settings/organisation'))
    expect(pendingInviteToken()).toBeNull()
    expect(calls).toContain('POST /org/invites/accept')
  })

  it('a pending token older than 24 hours is dropped, so login goes to the chat', async () => {
    mock()
    localStorage.setItem('pendingOrgInvite', JSON.stringify({ token: 'old', savedAt: Date.now() - PENDING_INVITE_TTL_MS - 1000 }))
    const router = openTab('/login')
    await userEvent.type(await screen.findByLabelText('Email'), 'new@sunrise.edu')
    await userEvent.type(screen.getByLabelText('Password'), 'Str0ng!Passw0rd')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(localStorage.getItem('pendingOrgInvite')).toBeNull()
  })

  it.each(['INVITE_INVALID', 'INVITE_EXPIRED', 'ALREADY_IN_ORG'])('%s on accept clears the stored token', async (code) => {
    mock((path) => (path === '/org/invites/accept' ? problem(409, code) : undefined))
    useAuthStore.getState().setSession('tok')
    savePendingInvite('tok123')
    openTab('/join/tok123')
    await userEvent.click(await screen.findByRole('button', { name: 'Join Sunrise College' }))
    await screen.findByRole('alert')
    expect(pendingInviteToken()).toBeNull()
  })

  it('a refusal that a retry could fix (SEATS_FULL) keeps the token', async () => {
    mock((path) => (path === '/org/invites/accept' ? problem(409, 'SEATS_FULL') : undefined))
    useAuthStore.getState().setSession('tok')
    savePendingInvite('tok123')
    openTab('/join/tok123')
    await userEvent.click(await screen.findByRole('button', { name: 'Join Sunrise College' }))
    await screen.findByRole('alert')
    expect(pendingInviteToken()).toBe('tok123')
  })

  it('a dead link clears the stored token', async () => {
    mock((path) => (path === '/org/invites/preview' ? problem(404, 'INVITE_INVALID') : undefined))
    savePendingInvite('tok123')
    openTab('/join/tok123')
    await screen.findByText(/not valid/)
    await waitFor(() => expect(pendingInviteToken()).toBeNull())
  })
})
