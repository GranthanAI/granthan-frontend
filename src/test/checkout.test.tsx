import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PricingPage } from '@/pages/PricingPage'
import { SignupPage } from '@/pages/AuthPages'
import { CheckoutDialog, quoteCopy } from '@/features/billing/CheckoutDialog'
import { API_ORIGIN, loadRazorpay, simulatorPayload, simulatorUrl } from '@/features/billing/checkout-env'
import { gstinError } from '@/lib/gstin'
import { qk } from '@/lib/query-keys'
import { useAuthStore } from '@/stores/auth.store'
import type { BillingInterval, BillingMe, ChangeQuote, CheckoutResponse, PlanEntry } from '@/types/billing'
import { invoicesResponse, meFree, meMax, mePro, modelsFree, modelsPro, plansResponse } from './billing-fixtures'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const PROOF = { razorpay_payment_id: 'pay_1', razorpay_subscription_id: 'sub_1', razorpay_signature: 'sig_1' }
const SIM_PATH = '/api/v1/billing/sim/checkout/gw_1?t=tok'
const simResponse: CheckoutResponse = {
  subscription_id: 'sub_1', status: 'created', provider: 'simulator', simulator_url: SIM_PATH,
  razorpay: { key: 'rzp_test', subscription_id: 'sub_gw', name: 'GranthanAI', description: 'Pro', prefill: { email: 'a@example.com' }, notes: { billing_subscription_id: 'sub_1' } },
}
const rzpResponse: CheckoutResponse = { ...simResponse, provider: 'razorpay', simulator_url: undefined }

const STATES = [{ code: '10', name: 'Bihar' }, { code: '27', name: 'Maharashtra' }, { code: '29', name: 'Karnataka' }]
const UPGRADE_QUOTE: ChangeQuote = {
  kind: 'upgrade', amount_due_now_paise: 149900, refund_paise: 24950, effective_at: '2026-11-16T04:45:00+00:00',
  new_period_end: '2026-12-16T04:45:00+00:00', price_paise: 149900,
}

interface Opts {
  quote?: ChangeQuote
  profile?: Record<string, unknown>
  me?: BillingMe
  verified?: boolean
  checkout?: () => Response | Promise<Response>
  verify?: () => Response
  email?: string
}
interface Call { method: string; path: string; body: Record<string, unknown> | null; headers: Record<string, string> }

function mock(o: Opts = {}) {
  const calls: Call[] = []
  let me = o.me ?? meFree
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const path = url.pathname.replace('/api/v1', '')
    const method = init?.method ?? 'GET'
    const headers = (init?.headers ?? {}) as Record<string, string>
    const body = init?.body && typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    calls.push({ method, path, body, headers })
    if (path === '/billing/plans') return json(200, plansResponse)
    if (path === '/billing/me') return json(200, me)
    if (path === '/billing/me/models') return json(200, me.plan.code === 'free' ? modelsFree : modelsPro)
    if (path === '/billing/me/usage') return json(200, { from: '', to: '', days: [] })
    if (path === '/billing/invoices') return json(200, invoicesResponse)
    if (path === '/auth/me') return json(200, { id: 'u1', email: o.email ?? 'a@example.com', is_email_verified: o.verified ?? true, full_name: 'A', status: 'ACTIVE' })
    if (path === '/billing/gst-states') return json(200, { states: STATES })
    if (path === '/billing/me/billing-profile') return json(200, method === 'PUT' ? { ...body, state_name: 'x' } : (o.profile ?? { billing_email: null, state_code: null, state_name: null, gstin: null, legal_name: null }))
    if (path === '/billing/subscription/change/preview' || path === '/billing/subscription/resume/preview') return json(200, o.quote ?? UPGRADE_QUOTE)
    if (path === '/auth/resend-verification') return json(200, { message: 'sent' })
    if (path === '/billing/checkout' || path === '/billing/subscription/change' || path === '/billing/subscription/resume') return o.checkout ? o.checkout() : json(201, simResponse)
    if (path === '/billing/checkout/verify') {
      const r = o.verify ? o.verify() : json(200, { subscription_id: 'sub_1', status: 'active' })
      if (r.ok) me = mePro
      return r
    }
    return json(404, { detail: 'not mocked' })
  }))
  return calls
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const proPlan = plansResponse.plans.find((p) => p.code === 'pro')!
const maxPlan = plansResponse.plans.find((p) => p.code === 'max')!

function renderDialog(kind: 'subscribe' | 'change' | 'resume', plan: PlanEntry | null, interval: BillingInterval = 'month', onClose = vi.fn()) {
  const qc = client()
  const view = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><CheckoutDialog kind={kind} plan={plan} interval={interval} onClose={onClose} /></MemoryRouter>
    </QueryClientProvider>,
  )
  return { qc, onClose, view }
}

function fakePopup() {
  const p = { closed: false, close: vi.fn(() => { p.closed = true }), location: { href: 'about:blank' } }
  return p
}

/** Posts a message to the page as the browser would: with the sender's origin. */
const post = (data: unknown, origin = API_ORIGIN) => act(() => { window.dispatchEvent(new MessageEvent('message', { origin, data })) })
const fillState = async () => userEvent.selectOptions(await screen.findByRole('combobox'), '27')
const verifyCalls = (calls: Call[]) => calls.filter((c) => c.path === '/billing/checkout/verify')

beforeEach(() => {
  useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null, expired: false })
  delete window.Razorpay
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete window.Razorpay
})

describe('simulator helpers', () => {
  it('builds the popup URL from the API origin and refuses anything that is not a path', () => {
    expect(simulatorUrl(SIM_PATH)).toBe(`${API_ORIGIN}${SIM_PATH}`)
    for (const bad of [undefined, '', 'https://evil.example/x', '//evil.example/x', 'javascript:alert(1)', 'billing/sim']) expect(simulatorUrl(bad)).toBeNull()
  })
  it('accepts a message only from the API origin with the simulator source', () => {
    expect(simulatorPayload({ origin: API_ORIGIN, data: { source: 'granthan-sim-checkout', ...PROOF } })).toEqual(PROOF)
    expect(simulatorPayload({ origin: 'https://evil.example', data: { source: 'granthan-sim-checkout', ...PROOF } })).toBeNull()
    expect(simulatorPayload({ origin: API_ORIGIN, data: { source: 'something-else', ...PROOF } })).toBeNull()
    expect(simulatorPayload({ origin: API_ORIGIN, data: PROOF })).toBeNull()
    expect(simulatorPayload({ origin: API_ORIGIN, data: { source: 'granthan-sim-checkout', razorpay_payment_id: 'x' } })).toBeNull()
    expect(simulatorPayload({ origin: API_ORIGIN, data: 'granthan-sim-checkout' })).toBeNull()
  })
})

describe('GST details', () => {
  it('GSTIN: optional, 15 characters, the first two digits match the state', () => {
    expect(gstinError('', '27')).toBeNull()
    expect(gstinError('27ABCDE1234F1Z5', '27')).toBeNull()
    expect(gstinError('27ABCDE1234F1Z5', '29')).toMatch(/first two digits/)
    expect(gstinError('27ABCDE1234', '27')).toMatch(/15 characters/)
    expect(gstinError('27abcde1234f1z5'.replace('z', '!'), '27')).toMatch(/valid GSTIN/)
  })

  it('requires a state before anything is sent', async () => {
    const calls = mock()
    renderDialog('subscribe', proPlan)
    await userEvent.click(await screen.findByRole('button', { name: /pay ₹499/i }))
    expect(await screen.findByText(/choose your state/i)).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/billing/checkout')).toBe(false)
  })

  it('blocks a GSTIN that does not match the state', async () => {
    const calls = mock()
    renderDialog('subscribe', proPlan)
    await fillState()
    await userEvent.type(screen.getByLabelText(/gstin/i), '29ABCDE1234F1Z5')
    expect(await screen.findByText(/first two digits/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /pay ₹499/i }))
    expect(calls.some((c) => c.path === '/billing/checkout')).toBe(false)
  })
})

describe('unverified email', () => {
  it('blocks checkout and offers to resend', async () => {
    const calls = mock({ verified: false })
    renderDialog('subscribe', proPlan)
    expect(await screen.findByTestId('verify-step')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay/i })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /resend email/i }))
    await waitFor(() => expect(calls.some((c) => c.path === '/auth/resend-verification')).toBe(true))
    expect(calls.some((c) => c.path === '/billing/checkout')).toBe(false)
  })
})

describe('simulator checkout', () => {
  it('opens the popup inside the click, points it at the API origin, verifies once with an Idempotency-Key, and unlocks the plan', async () => {
    const popup = fakePopup()
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    const calls = mock()
    const { qc } = renderDialog('subscribe', proPlan)
    // queries the rest of the app holds: all of them must be marked stale after the payment
    qc.setQueryData(qk.billingModels, modelsFree)
    qc.setQueryData(qk.billingInvoices, invoicesResponse)
    qc.setQueryData(qk.billingUsage(), { from: '', to: '', days: [] })
    await fillState()
    await userEvent.type(screen.getByLabelText(/business name/i), ' Acme ')
    await userEvent.type(screen.getByLabelText(/gstin/i), '27abcde1234f1z5')
    await userEvent.click(screen.getByRole('button', { name: /pay ₹499/i }))

    expect(open).toHaveBeenCalledWith('about:blank', expect.any(String), expect.any(String)) // synchronous, before any answer
    await waitFor(() => expect(popup.location.href).toBe(`${API_ORIGIN}${SIM_PATH}`))
    const checkout = calls.find((c) => c.path === '/billing/checkout')!
    expect(checkout.body).toEqual({ plan_code: 'pro', interval: 'month', state_code: '27', email: 'a@example.com', legal_name: 'Acme', gstin: '27ABCDE1234F1Z5' })
    expect(checkout.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)

    await post({ source: 'granthan-sim-checkout', ...PROOF })
    await post({ source: 'granthan-sim-checkout', ...PROOF }) // a duplicate message must not verify twice
    expect(await screen.findByTestId('checkout-success')).toBeInTheDocument()
    const v = verifyCalls(calls)
    expect(v).toHaveLength(1)
    expect(v[0]!.body).toEqual(PROOF)
    expect(v[0]!.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(v[0]!.headers['Idempotency-Key']).not.toBe(checkout.headers['Idempotency-Key'])
    expect(popup.close).toHaveBeenCalled()

    // the plan, models, usage and invoices are refetched so the picker unlocks at once
    await waitFor(() => {
      expect(calls.slice(calls.indexOf(v[0]!) + 1).map((c) => c.path)).toContain('/billing/me') // mounted: refetched now
      for (const key of [qk.billingModels, qk.billingInvoices, qk.billingUsage()]) expect(qc.getQueryState(key)?.isInvalidated).toBe(true)
    })
  })

  it('ignores a message from the wrong origin', async () => {
    vi.spyOn(window, 'open').mockReturnValue(fakePopup() as unknown as Window)
    const calls = mock()
    renderDialog('subscribe', proPlan)
    await fillState()
    await userEvent.click(screen.getByRole('button', { name: /pay ₹499/i }))
    await screen.findByText(/complete the payment/i)
    await post({ source: 'granthan-sim-checkout', ...PROOF }, 'https://evil.example')
    await new Promise((r) => setTimeout(r, 60))
    expect(verifyCalls(calls)).toHaveLength(0)
    expect(screen.queryByTestId('checkout-success')).toBeNull()
  })

  it('ignores a message with the wrong source, and unrelated messages', async () => {
    vi.spyOn(window, 'open').mockReturnValue(fakePopup() as unknown as Window)
    const calls = mock()
    renderDialog('subscribe', proPlan)
    await fillState()
    await userEvent.click(screen.getByRole('button', { name: /pay ₹499/i }))
    await screen.findByText(/complete the payment/i)
    await post({ source: 'react-devtools', ...PROOF })
    await post('hello')
    await post(null)
    await new Promise((r) => setTimeout(r, 60))
    expect(verifyCalls(calls)).toHaveLength(0)
  })

  it('removes the message listener after success and on unmount', async () => {
    vi.spyOn(window, 'open').mockReturnValue(fakePopup() as unknown as Window)
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    mock()
    renderDialog('subscribe', proPlan)
    await fillState()
    await userEvent.click(screen.getByRole('button', { name: /pay ₹499/i }))
    await screen.findByText(/complete the payment/i)
    const added = add.mock.calls.filter((c) => c[0] === 'message').length
    expect(added).toBeGreaterThan(0)
    await post({ source: 'granthan-sim-checkout', ...PROOF })
    await screen.findByTestId('checkout-success')
    expect(remove.mock.calls.filter((c) => c[0] === 'message').length).toBe(added)
  })

  it('removes the listener when the dialog unmounts mid-payment', async () => {
    vi.spyOn(window, 'open').mockReturnValue(fakePopup() as unknown as Window)
    const remove = vi.spyOn(window, 'removeEventListener')
    const calls = mock()
    const view = renderDialog('subscribe', proPlan)
    await fillState()
    await userEvent.click(screen.getByRole('button', { name: /pay ₹499/i }))
    await screen.findByText(/complete the payment/i)
    view.view.unmount()
    expect(remove.mock.calls.some((c) => c[0] === 'message')).toBe(true)
    await post({ source: 'granthan-sim-checkout', ...PROOF })
    expect(verifyCalls(calls)).toHaveLength(0)
  })

  it('closes the popup when starting the checkout fails and shows the error', async () => {
    const popup = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    mock({ checkout: () => json(422, { detail: 'GSTIN is not valid for this state' }) })
    renderDialog('subscribe', proPlan)
    await fillState()
    await userEvent.click(screen.getByRole('button', { name: /pay ₹499/i }))
    expect(await screen.findByText(/GSTIN is not valid for this state/)).toBeInTheDocument()
    expect(popup.close).toHaveBeenCalled()
    expect(popup.location.href).toBe('about:blank')
  })

  it('a failed verify keeps the attempt: retry reuses the same Idempotency-Key and the same proof', async () => {
    vi.spyOn(window, 'open').mockReturnValue(fakePopup() as unknown as Window)
    let n = 0
    const calls = mock({ verify: () => (++n === 1 ? json(502, { detail: 'x' }) : json(200, { subscription_id: 'sub_1', status: 'active' })) })
    renderDialog('subscribe', proPlan)
    await fillState()
    await userEvent.click(screen.getByRole('button', { name: /pay ₹499/i }))
    await screen.findByText(/complete the payment/i)
    await post({ source: 'granthan-sim-checkout', ...PROOF })
    await userEvent.click(await screen.findByRole('button', { name: /try again/i }))
    expect(await screen.findByTestId('checkout-success')).toBeInTheDocument()
    const v = verifyCalls(calls)
    expect(v).toHaveLength(2)
    expect(v[1]!.headers['Idempotency-Key']).toBe(v[0]!.headers['Idempotency-Key'])
    expect(v[1]!.body).toEqual(v[0]!.body)
  })

  it('shows a button when the browser blocks the pop-up, and opening it works', async () => {
    const popup = fakePopup()
    const open = vi.spyOn(window, 'open').mockReturnValueOnce(null).mockReturnValue(popup as unknown as Window)
    mock()
    renderDialog('subscribe', proPlan)
    await fillState()
    await userEvent.click(screen.getByRole('button', { name: /pay ₹499/i }))
    await userEvent.click(await screen.findByRole('button', { name: /open payment window/i }))
    expect(open).toHaveBeenLastCalledWith(`${API_ORIGIN}${SIM_PATH}`, expect.any(String), expect.any(String))
  })

  it('says "Payment not completed" when the popup is closed without paying, and Try again starts over', async () => {
    const popup = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    const calls = mock()
    renderDialog('subscribe', proPlan)
    await fillState()
    await userEvent.click(screen.getByRole('button', { name: /pay ₹499/i }))
    await screen.findByText(/complete the payment/i)
    popup.closed = true
    expect(await screen.findByText(/payment not completed/i, undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(verifyCalls(calls)).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(calls.filter((c) => c.path === '/billing/checkout')).toHaveLength(2))
  })
})

describe('Razorpay checkout', () => {
  function stubRazorpay() {
    const instances: Array<Record<string, unknown>> = []
    const open = vi.fn()
    window.Razorpay = function (this: unknown, options: Record<string, unknown>) {
      instances.push(options)
      return { open }
    } as unknown as typeof window.Razorpay
    return { instances, open }
  }

  it('opens the Razorpay modal with the server options and verifies the handler result', async () => {
    const popup = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    const { instances, open } = stubRazorpay()
    const calls = mock({ checkout: () => json(201, rzpResponse) })
    renderDialog('subscribe', proPlan)
    await fillState()
    await userEvent.click(screen.getByRole('button', { name: /pay ₹499/i }))
    await waitFor(() => expect(open).toHaveBeenCalled())
    expect(popup.close).toHaveBeenCalled() // the blank popup is not needed
    expect(instances[0]).toMatchObject({
      key: 'rzp_test', subscription_id: 'sub_gw', name: 'GranthanAI', prefill: { email: 'a@example.com' }, notes: { billing_subscription_id: 'sub_1' },
    })
    await act(async () => { (instances[0]!.handler as (r: unknown) => void)(PROOF) })
    expect(await screen.findByTestId('checkout-success')).toBeInTheDocument()
    expect(verifyCalls(calls)).toHaveLength(1)
    expect(verifyCalls(calls)[0]!.headers['Idempotency-Key']).toBeTruthy()
  })

  it('shows "Payment not completed" when the modal is dismissed', async () => {
    vi.spyOn(window, 'open').mockReturnValue(fakePopup() as unknown as Window)
    const { instances, open } = stubRazorpay()
    const calls = mock({ checkout: () => json(201, rzpResponse) })
    renderDialog('subscribe', proPlan)
    await fillState()
    await userEvent.click(screen.getByRole('button', { name: /pay ₹499/i }))
    await waitFor(() => expect(open).toHaveBeenCalled())
    act(() => { ((instances[0]!.modal as { ondismiss: () => void }).ondismiss)() })
    expect(await screen.findByText(/payment not completed/i)).toBeInTheDocument()
    expect(verifyCalls(calls)).toHaveLength(0)
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('loads checkout.js once and reports a script that fails to load', async () => {
    const appended: HTMLScriptElement[] = []
    vi.spyOn(document.head, 'appendChild').mockImplementation(((n: Node) => { appended.push(n as HTMLScriptElement); return n }) as never)
    const first = loadRazorpay(5000)
    const second = loadRazorpay(5000)
    expect(appended).toHaveLength(1)
    expect(appended[0]!.src).toBe('https://checkout.razorpay.com/v1/checkout.js')
    appended[0]!.onerror?.(new Event('error'))
    await expect(first).rejects.toThrow(/could not load/i)
    await expect(second).rejects.toThrow()
  })

  it('times out when the script never loads', async () => {
    vi.spyOn(document.head, 'appendChild').mockImplementation(((n: Node) => n) as never)
    await expect(loadRazorpay(20)).rejects.toThrow(/too long/i)
  })

  it('shows the load error and a retry when the script cannot load', async () => {
    const popup = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    vi.spyOn(document.head, 'appendChild').mockImplementation(((n: Node) => { setTimeout(() => (n as HTMLScriptElement).onerror?.(new Event('error')), 0); return n }) as never)
    mock({ checkout: () => json(201, rzpResponse) })
    renderDialog('subscribe', proPlan)
    await fillState()
    await userEvent.click(screen.getByRole('button', { name: /pay ₹499/i }))
    expect(await screen.findByText(/could not load the payment window/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})

describe('change plan and resume', () => {
  it('upgrade: says what is paid now and that unused days go back', async () => {
    vi.spyOn(window, 'open').mockReturnValue(fakePopup() as unknown as Window)
    const calls = mock({ me: mePro })
    renderDialog('change', maxPlan)
    const copy = await screen.findByTestId('change-copy')
    expect(copy).toHaveTextContent("You'll pay ₹1,499 now for a new period; ₹249.50 for unused days goes back to your original payment method.")
    await userEvent.click(screen.getByRole('button', { name: /pay ₹1,499/i }))
    await waitFor(() => expect(calls.some((c) => c.path === '/billing/subscription/change')).toBe(true))
    expect(calls.find((c) => c.path === '/billing/subscription/change')!.body).toEqual({ plan_code: 'max', interval: 'month' })
    expect(calls.find((c) => c.path === '/billing/subscription/change')!.headers['Idempotency-Key']).toBeTruthy()
  })

  it('downgrade: starts on the period end and asks to authorise the new mandate', async () => {
    mock({ me: meMax, quote: { kind: 'downgrade', amount_due_now_paise: 0, refund_paise: 0, effective_at: '2027-11-15T10:00:00+05:30', new_period_end: '2028-11-15T10:00:00+05:30', price_paise: 499000 } })
    renderDialog('change', proPlan, 'year')
    expect(await screen.findByTestId('change-copy')).toHaveTextContent('Starts on 15 Nov 2027; authorise the new mandate now.')
    expect(screen.getByRole('button', { name: /schedule and authorise/i })).toBeInTheDocument()
  })

  it('resume posts to /subscription/resume and runs the same flow', async () => {
    vi.spyOn(window, 'open').mockReturnValue(fakePopup() as unknown as Window)
    const calls = mock({ me: { ...mePro, status: 'cancelling', cancel_at_period_end: true } })
    renderDialog('resume', null)
    await userEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/billing/subscription/resume')).toBe(true))
    await post({ source: 'granthan-sim-checkout', ...PROOF })
    expect(await screen.findByTestId('checkout-success')).toBeInTheDocument()
  })

  it('quoteCopy wording is built from the quote only', () => {
    expect(quoteCopy(UPGRADE_QUOTE)).toBe("You'll pay ₹1,499 now for a new period; ₹249.50 for unused days goes back to your original payment method.")
    expect(quoteCopy({ ...UPGRADE_QUOTE, refund_paise: 0 })).toBe("You'll pay ₹1,499 now for a new period.")
    expect(quoteCopy({ ...UPGRADE_QUOTE, kind: 'downgrade', amount_due_now_paise: 0, refund_paise: 0, effective_at: '2026-12-15T10:00:00+05:30' })).toBe('Starts on 15 Dec 2026; authorise the new mandate now.')
  })
})

describe('pricing page', () => {
  const renderPricing = (status: 'authenticated' | 'anonymous') => {
    useAuthStore.setState({ status, accessToken: status === 'authenticated' ? 'tok' : null, user: null, expired: false })
    const qc = client()
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/pricing']}>
          <Routes>
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/signup" element={<p>signup page</p>} />
            <Route path="/login" element={<p>login page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('works signed out: GST-inclusive prices, limit rows, Unlimited, and the monthly/yearly toggle', async () => {
    mock()
    renderPricing('anonymous')
    expect(await screen.findByText('Plans and pricing')).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('[data-plan=pro]')).not.toBeNull())
    expect(screen.getByText(/include GST/i)).toBeInTheDocument()
    const proCard = document.querySelector('[data-plan=pro]') as HTMLElement
    expect(within(proCard).getByText('₹499')).toBeInTheDocument()
    const cell = (row: string, plan: string) => document.querySelector(`[data-row=${row}] [data-plan=${plan}]`)
    expect(cell('messagesPerDay', 'pro')).toHaveTextContent('60')
    expect(cell('bestPerDay', 'free')).toHaveTextContent('—')
    expect(cell('bestPerDay', 'pro')).toHaveTextContent('5 included daily · continues on Smart')
    expect(cell('memoryFacts', 'max')).toHaveTextContent('Unlimited')
    const maxCard = document.querySelector('[data-plan=max]') as HTMLElement
    await userEvent.click(screen.getByRole('radio', { name: 'Yearly' }))
    expect(within(proCard).getByText('₹4,990')).toBeInTheDocument()
    expect(within(maxCard).getByText('₹14,990')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument()
  })

  it('signed out: Upgrade goes to sign-up (and back to /pricing afterwards)', async () => {
    const calls = mock()
    renderPricing('anonymous')
    await userEvent.click(await screen.findByRole('button', { name: /upgrade to pro/i }))
    expect(await screen.findByText('signup page')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/billing/checkout')).toBe(false)
  })

  it('signed in on Free: Upgrade opens the checkout dialog', async () => {
    mock({ me: meFree })
    renderPricing('authenticated')
    await userEvent.click(await screen.findByRole('button', { name: /upgrade to max/i }))
    expect(await screen.findByRole('dialog', { name: /subscribe to max/i })).toBeInTheDocument()
  })

  it('marks the current plan and offers Upgrade / Downgrade for the others', async () => {
    mock({ me: mePro })
    renderPricing('authenticated')
    const proCard = (await waitFor(() => {
      const el = document.querySelector('[data-plan=pro]') as HTMLElement
      expect(within(el).getByText('Current plan', { selector: 'span' })).toBeInTheDocument()
      return el
    }))
    expect(within(proCard).getByRole('button', { name: /pro: current plan/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /upgrade to max/i })).toBeEnabled()
    await userEvent.click(screen.getByRole('radio', { name: 'Yearly' }))
    // same plan, other interval: no longer "current"
    expect(within(document.querySelector('[data-plan=pro]') as HTMLElement).queryByRole('button', { name: /current plan/i })).toBeNull()
  })

  it('shows an error with Try again when the plans cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(500, { detail: 'x' })))
    renderPricing('anonymous')
    expect(await screen.findByText(/could not load plans/i, undefined, { timeout: 6000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})

describe('signed-out upgrade comes back to /pricing after sign-up', () => {
  it('sign-up returns to the page the user came from', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const path = new URL(input).pathname.replace('/api/v1', '')
      if (path === '/auth/register') return json(201, { id: 'u1', email: 'a@example.com', status: 'ACTIVE', is_email_verified: true })
      if (path === '/auth/login') return json(200, { access_token: 'tok', token_type: 'bearer' })
      if (path === '/auth/me') return json(200, { id: 'u1', email: 'a@example.com', status: 'ACTIVE', is_email_verified: true, full_name: 'Asha' })
      return json(404, { detail: 'x' })
    }))
    useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null, expired: false })
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={[{ pathname: '/signup', state: { from: '/pricing' } }]}>
          <Routes>
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/pricing" element={<p>pricing page</p>} />
            <Route path="/" element={<p>home page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await userEvent.type(screen.getByLabelText('Full name'), 'Asha Rao')
    await userEvent.type(screen.getByLabelText('Email'), 'a@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'Str0ng!Passw0rd')
    await userEvent.type(screen.getByLabelText(/confirm/i), 'Str0ng!Passw0rd')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText('pricing page')).toBeInTheDocument()
  })
})
