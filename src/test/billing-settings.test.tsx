import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BillingSettings } from '@/components/settings/BillingSettings'
import { AiPreferencesSettings } from '@/components/settings/AiPreferencesSettings'
import { MemorySettingsPage } from '@/components/settings/MemorySettingsPage'
import { DeleteAccount } from '@/pages/SettingsPage'
import { LoginPage } from '@/pages/AuthPages'
import { PublicOnly, RequireAuth } from '@/app/router'
import { useAuthStore } from '@/stores/auth.store'
import type { BillingMe } from '@/types/billing'
import { invoicesResponse, meCancelling, meFree, meMax, mePastDue, mePro, modelsPro, plansResponse } from './billing-fixtures'

const saved = vi.hoisted(() => ({ blobs: [] as Array<{ blob: Blob; name: string }> }))
vi.mock('@/lib/download', async (orig) => ({
  ...(await orig<typeof import('@/lib/download')>()),
  saveBlob: (blob: Blob, name: string) => { saved.blobs.push({ blob, name }) },
}))

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface Call { method: string; path: string; body: Record<string, unknown> | null; headers: Record<string, string> }
interface Opts {
  me?: BillingMe
  invoices?: unknown
  handler?: (c: Call) => Response | undefined
}

function mock(o: Opts = {}) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname.replace('/api/v1', ''),
      body: init?.body && typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      headers: (init?.headers ?? {}) as Record<string, string>,
    }
    calls.push(call)
    const r = o.handler?.(call)
    if (r) return r
    if (call.path === '/billing/me') return json(200, o.me ?? meFree)
    if (call.path === '/billing/plans') return json(200, plansResponse)
    if (call.path === '/billing/invoices') return json(200, o.invoices ?? invoicesResponse)
    if (call.path === '/billing/me/models') return json(200, modelsPro)
    if (call.path === '/billing/subscription/resume/preview') return json(200, { kind: 'resume', amount_due_now_paise: 0, refund_paise: 0, effective_at: '2026-12-15T10:00:00+05:30', new_period_end: '2027-01-15T10:00:00+05:30', price_paise: 49900 })
    if (call.path === '/billing/gst-states') return json(200, { states: [{ code: '10', name: 'Bihar' }, { code: '27', name: 'Maharashtra' }] })
    if (call.path === '/billing/me/billing-profile') return json(200, { billing_email: 'asha@example.com', state_code: '10', state_name: 'Bihar', gstin: null, legal_name: null })
    if (call.path === '/auth/me') return json(200, { id: 'u1', email: 'asha@example.com', is_email_verified: true, full_name: 'Asha', status: 'ACTIVE' })
    if (call.path === '/tools') return json(200, { tools: [], max_selected: 5 })
    if (call.path === '/custom-modes') return json(200, { items: [], total: 0, limit: 100, offset: 0, max_per_user: 3, limits: { name: 60, description: 200, instructions: 4000 } })
    return json(404, { detail: 'not mocked' })
  }))
  return calls
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const page = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={client()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)

beforeEach(() => {
  saved.blobs.length = 0
  useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null, expired: false })
})
afterEach(() => vi.unstubAllGlobals())

describe('Settings → Billing', () => {
  it('Free: shows the plan and an Upgrade link, no cancel', async () => {
    mock({ me: meFree })
    page(<BillingSettings />)
    const s = await screen.findByTestId('plan-summary')
    expect(s).toHaveTextContent('Plan')
    expect(s).toHaveTextContent('Free')
    expect(screen.getByTestId('plan-status')).toHaveTextContent('Free')
    expect(screen.getByRole('link', { name: 'Upgrade' })).toHaveAttribute('href', '/pricing')
    expect(screen.queryByRole('button', { name: /cancel subscription/i })).toBeNull()
    expect(screen.getByText('Live')).toBeInTheDocument()
  })

  it('Pro active: plan, price, renewal date, change plan, billing email', async () => {
    mock({ me: mePro })
    page(<BillingSettings />)
    const s = await screen.findByTestId('plan-summary')
    expect(s).toHaveTextContent('Pro · monthly · ₹499')
    expect(screen.getByTestId('plan-status')).toHaveTextContent('Active')
    expect(s).toHaveTextContent('Renews on')
    expect(s).toHaveTextContent('15 Dec 2026')
    expect(screen.getByRole('link', { name: 'Change plan' })).toHaveAttribute('href', '/pricing')
    expect(await screen.findByDisplayValue('asha@example.com')).toBeInTheDocument()
  })

  it('Max shows Unlimited where the plan has no cap', async () => {
    mock({ me: meMax })
    page(<BillingSettings />)
    const limits = await screen.findByRole('list', { name: 'What your plan includes' })
    expect(within(limits).getByText('Saved memory facts').nextSibling).toHaveTextContent('Unlimited')
    expect(within(limits).getByText('Advanced answers every day').nextSibling).toHaveTextContent('15')
  })

  it('past due: failed payment with Pay now', async () => {
    mock({ me: mePastDue })
    page(<BillingSettings />)
    expect(await screen.findByTestId('plan-status')).toHaveTextContent('Payment failed')
    expect(screen.getByRole('link', { name: 'Pay now' })).toHaveAttribute('href', 'https://rzp.io/i/pay-now')
    expect(screen.getByText('20 Nov 2026')).toBeInTheDocument()
  })

  it('cancel: the confirmation states the access-until date, then posts with an Idempotency-Key', async () => {
    const calls = mock({ me: mePro, handler: (c) => (c.path === '/billing/subscription/cancel' ? json(200, { subscription_id: 's1', status: 'cancelling' }) : undefined) })
    page(<BillingSettings />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel subscription' }))
    const dialog = await screen.findByRole('dialog', { name: /cancel your subscription/i })
    expect(dialog).toHaveTextContent('You keep Pro until 15 Dec 2026.')
    expect(calls.some((c) => c.path === '/billing/subscription/cancel')).toBe(false) // nothing yet
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel subscription' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/billing/subscription/cancel')).toBe(true))
    const c = calls.find((x) => x.path === '/billing/subscription/cancel')!
    expect(c.method).toBe('POST')
    expect(c.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    // the plan summary is refetched
    await waitFor(() => expect(calls.filter((x) => x.path === '/billing/me').length).toBeGreaterThan(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('cancel: a failure is shown in the dialog and nothing is claimed', async () => {
    mock({ me: mePro, handler: (c) => (c.path === '/billing/subscription/cancel' ? json(409, { detail: 'Already ending.' }) : undefined) })
    page(<BillingSettings />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel subscription' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel subscription' }))
    expect(await within(dialog).findByText('Already ending.')).toBeInTheDocument()
  })

  it('cancelling: shows the end date and Resume, which posts to /subscription/resume', async () => {
    const calls = mock({ me: meCancelling })
    vi.spyOn(window, 'open').mockReturnValue({ closed: false, close: vi.fn(), location: { href: '' } } as unknown as Window)
    page(<BillingSettings />)
    expect(await screen.findByText('Access until')).toBeInTheDocument()
    expect(screen.getByText(/Your plan ends on 15 Dec 2026/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel subscription' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
    const dialog = await screen.findByRole('dialog', { name: /resume pro/i })
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/billing/subscription/resume' && c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.path === '/billing/subscription/resume')!.headers['Idempotency-Key']).toBeTruthy()
  })

  it('lists invoices and credit notes separately', async () => {
    mock({ me: mePro })
    page(<BillingSettings />)
    await screen.findByText('GA/2026/0001')
    const invoices = screen.getByRole('heading', { name: 'Invoices' }).closest('section')!
    const notes = screen.getByRole('heading', { name: 'Credit notes' }).closest('section')!
    expect(within(invoices).getByText('GA/2026/0001')).toBeInTheDocument()
    expect(within(invoices).getByText('₹499')).toBeInTheDocument()
    expect(within(invoices).queryByText('GA/CN/2026/0001')).toBeNull()
    expect(within(notes).getByText('GA/CN/2026/0001')).toBeInTheDocument()
    expect(within(notes).getByText(/against GA\/2026\/0001/)).toBeInTheDocument()
    expect(within(notes).queryByText('GA/2026/0001')).toBeNull()
  })

  it('downloads the PDF through the authenticated helper (Authorization header, saved as a file)', async () => {
    const calls = mock({
      me: mePro,
      handler: (c) => (c.path === '/billing/invoices/inv-1/pdf' ? new Response(new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }), { status: 200 }) : undefined),
    })
    page(<BillingSettings />)
    await userEvent.click(await screen.findByRole('button', { name: 'Download PDF GA/2026/0001' }))
    await waitFor(() => expect(saved.blobs).toHaveLength(1))
    const call = calls.find((c) => c.path === '/billing/invoices/inv-1/pdf')!
    expect(call.headers.Authorization).toBe('Bearer tok')
    expect(saved.blobs[0]!.name).toBe('GA-2026-0001.pdf')
    expect(saved.blobs[0]!.blob.size).toBeGreaterThan(0)
  })

  it('a PDF that is not ready is disabled, and a failed download is reported', async () => {
    const inv = { ...invoicesResponse.invoices[0]!, id: 'inv-2', number: 'GA/2026/0002', pdf_ready: false }
    mock({ me: mePro, invoices: { invoices: [invoicesResponse.invoices[0]!, inv] }, handler: (c) => (c.path === '/billing/invoices/inv-1/pdf' ? json(404, { detail: 'invoice pdf not ready' }) : undefined) })
    page(<BillingSettings />)
    expect(await screen.findByRole('button', { name: 'Download PDF GA/2026/0002' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Download PDF GA/2026/0001' }))
    expect(await screen.findByText(/Could not download GA\/2026\/0001/)).toBeInTheDocument()
    expect(saved.blobs).toHaveLength(0)
  })

  it('shows an error with Retry when billing cannot be loaded', async () => {
    mock({ handler: (c) => (c.path === '/billing/me' ? json(500, { detail: 'x' }) : undefined) })
    page(<BillingSettings />)
    expect(await screen.findByText(/could not load your billing details/i, undefined, { timeout: 5000 })).toBeInTheDocument()
  })
})

describe('Settings → AI preferences: default model', () => {
  const prefs = (over: Record<string, unknown> = {}) => ({
    default_mode: null, default_tools: [], answer_length: 'balanced', tone: 'professional', language: 'auto', personal_instructions: '',
    citations: 'show', document_context: 'conversation', default_model: 'auto', version: 1, updated_at: null, default_mode_available: true,
    options: { answer_length: ['concise', 'balanced', 'detailed'], tone: ['professional', 'friendly', 'simple'], citations: ['show', 'hide'], document_context: ['conversation', 'attached_only'], languages: [{ code: 'auto', name: 'Auto' }], personal_instructions_max: 1000 },
    ...over,
  })

  it('offers the models the plan allows, and saves the choice', async () => {
    const calls = mock({
      handler: (c) => {
        if (c.path === '/preferences' && c.method === 'GET') return json(200, prefs())
        if (c.path === '/preferences' && c.method === 'PATCH') return json(200, prefs({ ...c.body, version: 2 }))
      },
    })
    page(<AiPreferencesSettings />)
    const select = await screen.findByLabelText('Default model')
    const options = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Llama Fast (Fast)', 'Llama Smart (Smart)', 'Best One (Advanced)'])
    await userEvent.selectOptions(select, 'llama-smart')
    await userEvent.click(screen.getByRole('button', { name: 'Save preferences' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ default_model: 'llama-smart', version: 1 })
  })

  it('is hidden when the model list cannot be loaded', async () => {
    mock({ handler: (c) => (c.path === '/preferences' ? json(200, prefs()) : c.path === '/billing/me/models' ? json(500, { detail: 'x' }) : undefined) })
    page(<AiPreferencesSettings />)
    await screen.findByLabelText('Default response mode')
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByLabelText('Default model')).toBeNull()
  })
})

describe('Settings → Memory: facts used', () => {
  const list = (over: Record<string, unknown>) => ({ items: [], memory_enabled: true, ...over })
  it('shows "N of M facts used"', async () => {
    mock({ handler: (c) => (c.path === '/memory/facts' ? json(200, list({ facts_used: 5, facts_limit: 50 })) : undefined) })
    page(<MemorySettingsPage />)
    expect(await screen.findByTestId('facts-used')).toHaveTextContent('5 of 50 facts used')
  })
  it('says Unlimited for -1 and shows nothing when limits are off', async () => {
    mock({ handler: (c) => (c.path === '/memory/facts' ? json(200, list({ facts_used: 7, facts_limit: -1 })) : undefined) })
    const v = page(<MemorySettingsPage />)
    expect(await screen.findByTestId('facts-used')).toHaveTextContent('7 facts used · Unlimited')
    v.unmount()
    mock({ handler: (c) => (c.path === '/memory/facts' ? json(200, list({ facts_used: 7, facts_limit: null })) : undefined) })
    page(<MemorySettingsPage />)
    await screen.findByText('Use and learn memory')
    expect(screen.queryByTestId('facts-used')).toBeNull()
  })
})

describe('Settings → Security: delete account', () => {
  function renderApp() {
    return render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={['/settings/security']}>
          <Routes>
            <Route element={<PublicOnly />}><Route path="/login" element={<LoginPage />} /></Route>
            <Route element={<RequireAuth />}><Route path="/settings/security" element={<DeleteAccount />} /></Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }
  const openDialog = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Delete account' }))
    return screen.findByRole('dialog', { name: /delete your account/i })
  }

  it('explains what happens', async () => {
    mock()
    renderApp()
    const d = await openDialog()
    expect(d).toHaveTextContent('Your subscription is cancelled.')
    expect(d).toHaveTextContent('deleted after 30 days')
    expect(d).toHaveTextContent("can't be undone")
    expect(within(d).getByRole('button', { name: 'Delete my account' })).toBeDisabled() // needs the password
  })

  it('success: sends the password, clears the session and lands on /login with a confirmation', async () => {
    const calls = mock({ handler: (c) => (c.path === '/auth/me' && c.method === 'DELETE' ? new Response(null, { status: 204 }) : undefined) })
    renderApp()
    const d = await openDialog()
    await userEvent.type(within(d).getByLabelText('Confirm with your password'), 'Correct-Horse-9!')
    await userEvent.click(within(d).getByRole('button', { name: 'Delete my account' }))
    expect(await screen.findByText('Your account has been deleted.')).toBeInTheDocument()
    const del = calls.find((c) => c.method === 'DELETE' && c.path === '/auth/me')!
    expect(del.body).toEqual({ password: 'Correct-Horse-9!' })
    expect(del.headers.Authorization).toBe('Bearer tok')
    expect(useAuthStore.getState().status).toBe('anonymous')
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(screen.getByRole('heading', { name: /welcome back|sign in/i })).toBeInTheDocument()
  })

  it('wrong password: the 401 is shown inline and the user stays signed in', async () => {
    const calls = mock({
      handler: (c) => {
        if (c.path === '/auth/me' && c.method === 'DELETE') return json(401, { detail: 'Incorrect password.' })
        if (c.path === '/auth/refresh') return json(200, { access_token: 'tok2', token_type: 'bearer' })
      },
    })
    renderApp()
    const d = await openDialog()
    await userEvent.type(within(d).getByLabelText('Confirm with your password'), 'wrong-password')
    await userEvent.click(within(d).getByRole('button', { name: 'Delete my account' }))
    expect(await within(d).findByText('That password is not correct.')).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'DELETE' && c.path === '/auth/me').length).toBeGreaterThanOrEqual(1)
    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(screen.getByRole('dialog', { name: /delete your account/i })).toBeInTheDocument()
    // and it can try again
    expect(within(d).getByRole('button', { name: 'Delete my account' })).toBeEnabled()
  })

  it('cancel closes the dialog without calling the API', async () => {
    const calls = mock()
    renderApp()
    const d = await openDialog()
    await userEvent.click(within(d).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })
})

void act
