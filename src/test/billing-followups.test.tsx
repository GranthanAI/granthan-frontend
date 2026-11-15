import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BillingSettings } from '@/components/settings/BillingSettings'
import { BillingNotice } from '@/components/billing/BillingNotice'
import { CheckoutDialog, quoteCopy } from '@/features/billing/CheckoutDialog'
import { fieldErrors, gstinError } from '@/lib/gstin'
import { parseErrorBody } from '@/lib/errors'
import { useAuthStore } from '@/stores/auth.store'
import type { ChangeQuote } from '@/types/billing'
import { mePro, plansResponse } from './billing-fixtures'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const STATES = [{ code: '10', name: 'Bihar' }, { code: '27', name: 'Maharashtra' }, { code: '29', name: 'Karnataka' }]
const q = (over: Partial<ChangeQuote>): ChangeQuote => ({
  kind: 'upgrade', amount_due_now_paise: 149900, refund_paise: 24950, effective_at: '2026-11-16T04:45:00+00:00',
  new_period_end: '2026-12-16T04:45:00+00:00', price_paise: 149900, ...over,
})
const maxPlan = plansResponse.plans.find((p) => p.code === 'max')!
const proPlan = plansResponse.plans.find((p) => p.code === 'pro')!

interface Call { method: string; path: string; body: Record<string, unknown> | null }
function mock(o: { quote?: ChangeQuote; profile?: Record<string, unknown>; put?: () => Response; statesFail?: boolean } = {}) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname.replace('/api/v1', '')
    const method = init?.method ?? 'GET'
    const body = init?.body && typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    calls.push({ method, path, body })
    if (path === '/billing/me') return json(200, mePro)
    if (path === '/billing/plans') return json(200, plansResponse)
    if (path === '/billing/invoices') return json(200, { invoices: [] })
    if (path === '/billing/me/models') return json(500, {})
    if (path === '/auth/me') return json(200, { id: 'u', email: 'a@example.com', is_email_verified: true, status: 'ACTIVE' })
    if (path === '/billing/gst-states') return o.statesFail ? json(500, {}) : json(200, { states: STATES })
    if (path === '/billing/me/billing-profile')
      return method === 'PUT' ? (o.put ? o.put() : json(200, { ...body, state_name: 'x' })) : json(200, o.profile ?? { billing_email: null, state_code: null, state_name: null, gstin: null, legal_name: null })
    if (path.endsWith('/preview')) return json(200, o.quote ?? q({}))
    return json(404, { detail: 'not mocked' })
  }))
  return calls
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={client()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)

beforeEach(() => useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null, expired: false }))
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('plan change and resume copy comes from the server quote', () => {
  it('upgrade, with the refund for unused days', () => {
    expect(quoteCopy(q({}))).toBe("You'll pay ₹1,499 now for a new period; ₹249.50 for unused days goes back to your original payment method.")
  })
  it('upgrade with nothing to refund leaves the refund clause out', () => {
    expect(quoteCopy(q({ refund_paise: 0 }))).toBe("You'll pay ₹1,499 now for a new period.")
  })
  it('an interval change that charges now reads as an upgrade; one that starts later as a downgrade', () => {
    expect(quoteCopy(q({ kind: 'interval_change', amount_due_now_paise: 499000 }))).toContain("You'll pay ₹4,990 now")
    expect(quoteCopy(q({ kind: 'interval_change', amount_due_now_paise: 0, refund_paise: 0, effective_at: '2026-12-15T10:00:00+05:30' }))).toBe('Starts on 15 Dec 2026; authorise the new mandate now.')
  })
  it('downgrade starts at effective_at', () => {
    expect(quoteCopy(q({ kind: 'downgrade', amount_due_now_paise: 0, refund_paise: 0, effective_at: '2027-11-15T10:00:00+05:30' }))).toBe('Starts on 15 Nov 2027; authorise the new mandate now.')
  })
  it('resume starts when the paid period ends', () => {
    expect(quoteCopy(q({ kind: 'resume', amount_due_now_paise: 0, refund_paise: 0, effective_at: '2026-12-15T10:00:00+05:30' }))).toContain('starts on 15 Dec 2026')
  })

  it('the dialog asks billing for the numbers (it never computes them) and the button carries the quoted amount', async () => {
    const calls = mock({ quote: q({ amount_due_now_paise: 123400, refund_paise: 5000 }) })
    wrap(<CheckoutDialog kind="change" plan={maxPlan} interval="month" onClose={() => {}} />)
    expect(await screen.findByTestId('change-copy')).toHaveTextContent("You'll pay ₹1,234 now for a new period; ₹50 for unused days goes back")
    expect(screen.getByRole('button', { name: 'Pay ₹1,234' })).toBeEnabled()  // not the catalog price ₹1,499
    const preview = calls.find((c) => c.path === '/billing/subscription/change/preview')!
    expect(preview.method).toBe('POST')
    expect(preview.body).toEqual({ plan_code: 'max', interval: 'month' })
  })

  it('resume previews through /subscription/resume/preview', async () => {
    const calls = mock({ quote: q({ kind: 'resume', amount_due_now_paise: 0, refund_paise: 0, effective_at: '2026-12-15T10:00:00+05:30' }) })
    wrap(<CheckoutDialog kind="resume" interval="month" onClose={() => {}} />)
    expect(await screen.findByTestId('change-copy')).toHaveTextContent('15 Dec 2026')
    expect(calls.some((c) => c.path === '/billing/subscription/resume/preview')).toBe(true)
  })

  it('a refused preview (the same plan) is shown and nothing can be paid', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const path = new URL(input).pathname.replace('/api/v1', '')
      if (path.endsWith('/preview')) return json(409, { detail: 'You are already on this plan.' })
      if (path === '/billing/me') return json(200, mePro)
      if (path === '/billing/plans') return json(200, plansResponse)
      if (path === '/auth/me') return json(200, { id: 'u', email: 'a@example.com', is_email_verified: true, status: 'ACTIVE' })
      return json(200, { states: [], billing_email: null })
    }))
    wrap(<CheckoutDialog kind="change" plan={proPlan} interval="month" onClose={() => {}} />)
    expect(await screen.findByText('You are already on this plan.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pay|schedule/i })).toBeDisabled()
  })
})

describe('the GST state list comes from the API', () => {
  it('the checkout dialog lists exactly what billing returns and prefills from the saved profile', async () => {
    mock({ profile: { billing_email: 'acme@example.com', state_code: '27', state_name: 'Maharashtra', gstin: '27ABCDE1234F1Z5', legal_name: 'Acme' } })
    wrap(<CheckoutDialog kind="subscribe" plan={proPlan} interval="month" onClose={() => {}} />)
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('27'))
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select your state…', 'Bihar (10)', 'Maharashtra (27)', 'Karnataka (29)'])
    expect(screen.getByLabelText(/gstin/i)).toHaveValue('27ABCDE1234F1Z5')
    expect(screen.getByLabelText(/business name/i)).toHaveValue('Acme')
  })

  it('there is no copy of the list in the app', async () => {
    const mod = await import('@/lib/gstin')
    expect(Object.keys(mod)).not.toContain('GST_STATES')
  })
})

describe('Settings → Billing → Billing details', () => {
  const open = async (profile?: Record<string, unknown>, put?: () => Response) => {
    const calls = mock({ profile, put })
    wrap(<BillingSettings />)
    await screen.findByText('Billing details')
    await screen.findByRole('option', { name: 'Maharashtra (27)' })
    return calls
  }

  it('loads the saved details, says they apply to future invoices, and saves through the API', async () => {
    const calls = await open({ billing_email: 'old@example.com', state_code: '10', state_name: 'Bihar', gstin: null, legal_name: null })
    expect(screen.getByText(/applies to future invoices only|apply to future invoices only/i)).toBeInTheDocument() // the section description
    expect(screen.getByLabelText('Billing email')).toHaveValue('old@example.com')
    expect(screen.getByRole('combobox')).toHaveValue('10')
    await userEvent.clear(screen.getByLabelText('Billing email'))
    await userEvent.type(screen.getByLabelText('Billing email'), 'new@example.com')
    await userEvent.selectOptions(screen.getByRole('combobox'), '27')
    await userEvent.type(screen.getByLabelText(/gstin/i), '27abcde1234f1z5')
    await userEvent.type(screen.getByLabelText(/legal name/i), 'Acme Pvt Ltd')
    await userEvent.click(screen.getByRole('button', { name: 'Save billing details' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ billing_email: 'new@example.com', state_code: '27', gstin: '27ABCDE1234F1Z5', legal_name: 'Acme Pvt Ltd' })
  })

  it('validates like the server: GSTIN shape and state, legal name when a GSTIN is given, a state is required', async () => {
    const calls = await open()
    const save = screen.getByRole('button', { name: 'Save billing details' })
    await userEvent.type(screen.getByLabelText('Billing email'), 'a@example.com')
    expect(save).toBeDisabled() // no state yet
    await userEvent.selectOptions(screen.getByRole('combobox'), '27')
    expect(save).toBeEnabled()
    await userEvent.type(screen.getByLabelText(/gstin/i), '29ABCDE1234F1Z5')
    expect(await screen.findByText(/first two digits of the GSTIN must match/i)).toBeInTheDocument()
    expect(save).toBeDisabled()
    await userEvent.clear(screen.getByLabelText(/gstin/i))
    await userEvent.type(screen.getByLabelText(/gstin/i), '27ABCDE1234F1Z5')
    expect(await screen.findByText('Required when a GSTIN is given.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/legal name/i), 'Acme')
    expect(save).toBeEnabled()
    await userEvent.clear(screen.getByLabelText('Billing email'))
    await userEvent.type(screen.getByLabelText('Billing email'), 'nope')
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false) // nothing was sent while invalid
  })

  it("shows the server's per-field problems inline", async () => {
    await open({ billing_email: 'a@example.com', state_code: '27', state_name: 'Maharashtra', gstin: null, legal_name: null },
      () => new Response(JSON.stringify({ code: 'VALIDATION_FAILED', detail: 'x', errors: ['gstin: is not a valid GSTIN (15 characters)', 'billing_email: is not a valid email address'] }), { status: 422, headers: { 'content-type': 'application/problem+json' } }))
    await userEvent.type(screen.getByLabelText(/gstin/i), '27ABCDE1234F1Z5')
    await userEvent.type(screen.getByLabelText(/legal name/i), 'Acme')
    await userEvent.click(screen.getByRole('button', { name: 'Save billing details' }))
    expect(await screen.findByText('is not a valid GSTIN (15 characters)')).toBeInTheDocument()
    expect(screen.getByText('is not a valid email address')).toBeInTheDocument()
  })
})

describe('helpers', () => {
  it('GSTIN rules match the server', () => {
    expect(gstinError('', '27')).toBeNull()
    expect(gstinError('27ABCDE1234F1Z5', '27')).toBeNull()
    expect(gstinError('27ABCDE1234F1Z5', '29')).toMatch(/first two digits/)
    expect(gstinError('27ABCDE', '27')).toMatch(/15 characters/)
  })
  it('billing 422 errors are keyed by field', () => {
    expect(fieldErrors(['gstin: bad', 'legal_name: required: when set', 'gstin: later'])).toEqual({ gstin: 'bad', legal_name: 'required: when set' })
    const e = parseErrorBody(422, { code: 'VALIDATION_FAILED', detail: 'a', errors: ['state_code: no'] })
    expect(e.problemErrors).toEqual(['state_code: no'])
  })
})

describe('the support address comes only from VITE_SUPPORT_EMAIL', () => {
  const denial = { reason: 'account_blocked', message_key: 'account.blocked', message: 'Blocked', upgrade_to: null }
  it('unset: no Contact support link', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', '')
    mock()
    wrap(<BillingNotice denial={denial} />)
    expect(screen.queryByRole('link', { name: 'Contact support' })).toBeNull()
  })
  it('set: the link uses it', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', 'help@example.test')
    mock()
    wrap(<BillingNotice denial={denial} />)
    expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', 'mailto:help@example.test')
  })
})
