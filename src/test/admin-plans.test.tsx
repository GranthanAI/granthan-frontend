import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AdminLayout } from '@/features/admin/AdminLayout'
import { PlanEditorPage } from '@/features/admin/PlanEditorPage'
import { errorsFor, fromPaise, nextVersion, toPaise } from '@/features/admin/planEditorModel'
import { useAuthStore } from '@/stores/auth.store'
import { mePro } from './billing-fixtures'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const LIMITS = { messages_per_day: 60, best_per_day: 0, branches_per_tree: 200, messages_per_conversation: 200, memory_facts: 500, context_tokens: 64000, documents_per_tree: 25, file_size_mb: 50, youtube_per_month: 20, storage_mb: 2048, custom_modes: 10, mode_instruction_chars: 4000 }
const CATALOG = {
  catalog_version: '2026-11-15', currency: 'INR', gst_inclusive: true,
  model_groups: { fast: [{ id: 'm-fast', label: 'Fast One', provider: 'groq' }], smart: [{ id: 'm-smart', label: 'Smart One', provider: 'x' }, { id: 'm-smart2', label: 'Smart Two', provider: 'x' }], best: [], ultra: [] },
  base_limits: LIMITS,
  plans: [
    { code: 'free', rank: 0, default_group: 'fast', models: { groups: ['fast'], extra: [] }, limits: { ...LIMITS, messages_per_day: 25 } },
    { code: 'pro', rank: 1, default_group: 'smart', prices: { month: 49900, year: 499000 }, models: { groups: ['fast', 'smart'] }, limits: LIMITS },
    { code: 'org_pro', rank: 1, default_group: 'smart', org_only: true, models: { groups: ['fast'] }, variants: { company: {} } },
    { code: 'payg', rank: 0, default_group: 'smart', models: { groups: ['fast', 'smart', 'best', 'ultra'] }, unit_prices: { fast: 20, smart: 50, best: 400, ultra: 1200, youtube_video: 100, manim_video: 200 },
      storage_over_10gb_per_gb_month: 1000, long_message_tokens: 32000, no_credit_fast_per_day: 10, max_messages_per_minute: 30, topup_packs: [{ code: 'ind_199', price: 19900 }], org_min_topup: 500000, credit_validity_months: 12, limits: { ...LIMITS, messages_per_day: -1 } },
  ],
}
const CATALOG_RESPONSE = {
  catalog: CATALOG, catalog_version: '2026-11-15', source: 'yaml', published_at: null,
  plan_versions: [{ plan_code: 'pro', variant: null, version: 2, price_month_paise: 49900, price_year_paise: 499000, created_at: '2026-11-09T00:00:00Z', retired_at: null, active_subscribers: 7 }],
}
const PREVIEW = {
  draft_id: 'draft-1',
  diff: {
    plans: [{ plan_code: 'pro', variant: null, change: 'changed', prices: [{ interval: 'month', from: 49900, to: 59900 }],
      limits: [{ name: 'messages_per_day', from: 60, to: 65, direction: 'up' }, { name: 'memory_facts', from: 500, to: 100, direction: 'down' }, { name: 'custom_modes', from: 10, to: -1, direction: 'up' }],
      groups: { added: [], removed: [] }, extra_models: { added: [], removed: [] }, other: [] }],
    payg: { unit_prices: [{ key: 'smart', from: 50, to: 60 }], topup_packs: { added: [], removed: [], changed: [] }, other: [] },
    models: { added: [], removed: [], moved: [], relabelled: [] },
  },
  impact: { plans: [{ plan_code: 'pro', variant: null, current_version: 2, active_subscribers: 7 }], total_subscribers: 7 },
  warnings: ['A price change creates a new plan version; existing subscribers keep the old price until they change plan.', "Lowering a limit needs 'Apply limits' for existing subscribers."],
}

interface Call { method: string; path: string; body: Record<string, any> | null; headers: Record<string, string> }
function mock(role: string, o: { draft?: () => Response; publish?: () => Response } = {}) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname.replace('/api/v1', '')
    const method = init?.method ?? 'GET'
    calls.push({ method, path, body: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null, headers: (init?.headers ?? {}) as Record<string, string> })
    if (path === '/auth/me') return json(200, { id: 's', email: 's@example.com', is_email_verified: true, status: 'ACTIVE', role })
    if (path === '/billing/me') return json(200, mePro)
    if (path === '/billing/admin/catalog' && method === 'GET') return json(200, CATALOG_RESPONSE)
    if (path === '/billing/admin/model-prices') return json(200, { prices: [{ model: 'm-fast', provider: 'groq' }, { model: 'm-extra', provider: 'acme' }] })
    if (path === '/billing/admin/catalog/export.yaml') return new Response('catalog_version: x\n', { status: 200, headers: { 'content-type': 'application/yaml' } })
    if (path === '/billing/admin/catalog/drafts' && method === 'POST') return o.draft ? o.draft() : json(201, PREVIEW)
    if (path.endsWith('/publish')) return o.publish ? o.publish() : json(200, { catalog_version: '2026-11-16', sync: ['pro v3: new version (price change)'], limits_raised_applied: [], apply_limits: [{ audit_id: 41, plan_code: 'pro', limits_lowered: ['memory_facts'] }] })
    if (path.startsWith('/billing/admin/catalog/apply-limits/')) return json(200, { subscriptions_moved: 7 })
    return json(404, {})
  }))
  return calls
}
const saved: Blob[] = []
vi.mock('@/lib/download', async (orig) => ({ ...(await orig<typeof import('@/lib/download')>()), saveBlob: (b: Blob) => { saved.push(b) } }))

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin/plans']}><Routes><Route path="/admin" element={<AdminLayout />}><Route path="plans" element={<PlanEditorPage />} /></Route></Routes></MemoryRouter>
    </QueryClientProvider>,
  )
}
beforeEach(() => { saved.length = 0; useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: null, expired: false }) })
afterEach(() => vi.unstubAllGlobals())

const proCard = async () => within(await screen.findByRole('region', { name: 'Plan pro' }))

describe('conversion helpers', () => {
  it('rupees <-> paise', () => {
    expect(toPaise('599')).toBe(59900)
    expect(toPaise('499.50')).toBe(49950)
    expect(toPaise('0.2')).toBe(20)
    expect(toPaise('12.345')).toBeNull()
    expect(toPaise('abc')).toBeNull()
    expect(toPaise('-1')).toBeNull()
    expect(fromPaise(59900)).toBe('599')
    expect(fromPaise(49950)).toBe('499.5')
    expect(fromPaise(20)).toBe('0.2')
    expect(fromPaise(undefined)).toBe('')
  })
  it('proposes a new catalog version and maps server errors to a scope and a field', () => {
    expect(nextVersion('2026-11-15', new Date('2026-12-01T10:00:00Z'))).toBe('2026-12-01')
    expect(nextVersion('2026-12-01', new Date('2026-12-01T10:00:00Z'))).toBe('2026-12-01.1')
    expect(nextVersion('2026-12-01.1', new Date('2026-12-01T10:00:00Z'))).toBe('2026-12-01.2')
    const errs = ["plan 'pro': limit 'messages_per_day' must be an int >= 0 or -1, got -7", "plan 'pro': prices.month must be >= 0 paise, got -5", "plan 'max': limit 'x'", "model_groups: model 'm' has no effective price", 'catalog_version must change']
    expect(errorsFor(errs, 'pro', 'messages_per_day')).toHaveLength(1)
    expect(errorsFor(errs, 'pro', 'prices.month')).toHaveLength(1)
    expect(errorsFor(errs, 'pro')).toHaveLength(2)
    expect(errorsFor(errs, 'model_groups')).toHaveLength(1)
    expect(errorsFor(errs, 'catalog')).toEqual(['catalog_version must change'])
  })
})

describe('the editor: gating', () => {
  it('support can read the catalog and sees no write controls', async () => {
    mock('support')
    renderPage()
    const card = await proCard()
    expect(card.getByLabelText(/Price per month/)).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
    expect(screen.getByText(/read-only role/)).toBeInTheDocument()
    expect(screen.getByTestId('catalog-source')).toHaveTextContent('Active catalog 2026-11-15 · from yaml')
  })
})

describe('the editor: building a draft', () => {
  it('prices are typed in rupees and sent as paise; Unlimited sends -1; the version is proposed', async () => {
    const calls = mock('billing_admin')
    renderPage()
    const card = await proCard()
    const month = card.getByLabelText('Price per month (₹, GST included)')
    expect(month).toHaveValue('499')
    await userEvent.clear(month)
    await userEvent.type(month, '599')
    expect(card.getByText('Stored as 59900 paise')).toBeInTheDocument()
    const modes = card.getByLabelText('Custom modes: Unlimited')
    await userEvent.click(modes)
    expect(card.getByLabelText('Custom modes')).toBeDisabled()
    await userEvent.clear(card.getByLabelText('Messages per day'))
    await userEvent.type(card.getByLabelText('Messages per day'), '65')
    expect(screen.getByLabelText(/Catalog version/)).toHaveValue(nextVersion('2026-11-15'))
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await screen.findByTestId('preview')
    const body = calls.find((c) => c.path === '/billing/admin/catalog/drafts')!.body!
    const pro = body.catalog.plans.find((p: { code: string }) => p.code === 'pro')
    expect(pro.prices).toEqual({ month: 59900, year: 499000 })
    expect(pro.limits.custom_modes).toBe(-1)
    expect(pro.limits.messages_per_day).toBe(65)
    expect(body.catalog.catalog_version).toBe(nextVersion('2026-11-15'))
    expect(calls.find((c) => c.path === '/billing/admin/catalog/drafts')!.headers['Idempotency-Key']).toBeTruthy()
    // unticking Unlimited brings back a number to edit
    await userEvent.click(card.getByLabelText('Custom modes: Unlimited'))
    expect(card.getByLabelText('Custom modes')).toBeEnabled()
  })

  it('group checkboxes and the Pay as you Go tab (paise from rupees, packs)', async () => {
    const calls = mock('billing_admin')
    renderPage()
    const card = await proCard()
    await userEvent.click(card.getByLabelText('Pro includes best'))
    await userEvent.click(screen.getByRole('tab', { name: 'Pay as you Go' }))
    const payg = within(await screen.findByRole('region', { name: 'Pay as you Go' }))
    const smart = payg.getByLabelText('Smart (₹)')
    expect(smart).toHaveValue('0.5')
    await userEvent.clear(smart)
    await userEvent.type(smart, '0.60')
    await userEvent.click(payg.getByRole('button', { name: 'Add a pack' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await screen.findByTestId('preview')
    const body = calls.find((c) => c.path === '/billing/admin/catalog/drafts')!.body!
    expect(body.catalog.plans.find((p: { code: string }) => p.code === 'pro').models.groups).toEqual(['fast', 'smart', 'best'])
    const sent = body.catalog.plans.find((p: { code: string }) => p.code === 'payg')
    expect(sent.unit_prices.smart).toBe(60)
    expect(sent.topup_packs).toHaveLength(2)
  })

  it('the Models tab only offers ids from the price book, and reorders', async () => {
    const calls = mock('billing_admin')
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: 'Models' }))
    const smart = within(await screen.findByRole('region', { name: 'Smart models' }))
    await userEvent.click(smart.getByRole('button', { name: 'Move m-smart2 up' }))
    const add = within(screen.getByRole('region', { name: 'Fast models' })).getByLabelText('Add a model to fast')
    expect(within(add).getAllByRole('option').map((o) => o.textContent)).toEqual(['Add a model from the price book…', 'm-extra']) // m-fast is already listed
    await userEvent.selectOptions(add, 'm-extra')
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await screen.findByTestId('preview')
    const groups = calls.find((c) => c.path === '/billing/admin/catalog/drafts')!.body!.catalog.model_groups
    expect(groups.smart.map((m: { id: string }) => m.id)).toEqual(['m-smart2', 'm-smart'])
    expect(groups.fast.map((m: { id: string }) => m.id)).toEqual(['m-fast', 'm-extra'])
    expect(groups.fast[1].provider).toBe('acme')
  })

  it("shows the server's validation errors inline, per field", async () => {
    mock('billing_admin', { draft: () => new Response(JSON.stringify({ code: 'VALIDATION_FAILED', detail: 'x', errors: ["plan 'pro': limit 'messages_per_day' must be an int >= 0 or -1, got -7", "plan 'pro': prices.month must be >= 0 paise, got -5", "model_groups: model 'zzz' has no effective price in the price book", 'catalog_version must change (it is still 2026-11-15)'] }), { status: 422, headers: { 'content-type': 'application/problem+json' } }) })
    renderPage()
    const card = await proCard()
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByRole('list', { name: 'Draft errors' })).toHaveTextContent('catalog_version must change')
    expect(card.getAllByRole('alert').map((a) => a.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining("limit 'messages_per_day' must be an int"),
      expect.stringContaining('prices.month must be >= 0 paise'),
    ]))
    expect(screen.queryByTestId('preview')).toBeNull()
  })
})

describe('preview, publish, apply limits', () => {
  const savePreview = async (role = 'billing_admin', o: Parameters<typeof mock>[1] = {}) => {
    const calls = mock(role, o)
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }))
    await screen.findByTestId('preview')
    return calls
  }

  it("renders the server's diff: rises green, falls amber, plus impact and warnings", async () => {
    await savePreview()
    const pro = within(screen.getByTestId('diff-pro'))
    expect(pro.getByText(/month price: ₹499 → ₹599/)).toBeInTheDocument()
    const up = pro.getByText(/Messages per day: 60 → 65 \(higher\)/)
    const down = pro.getByText(/Memory facts: 500 → 100 \(lower\)/)
    expect(up).toHaveAttribute('data-direction', 'up')
    expect(up.className).toMatch(/text-ok/)
    expect(down).toHaveAttribute('data-direction', 'down')
    expect(down.className).toMatch(/text-warn/)
    expect(pro.getByText(/Custom modes: 10 → Unlimited/)).toBeInTheDocument()
    expect(within(screen.getByTestId('diff-payg')).getByText(/smart price: ₹0.50 → ₹0.60/)).toBeInTheDocument()
    expect(screen.getByTestId('impact')).toHaveTextContent('7 active subscribers')
    expect(screen.getByRole('list', { name: 'Warnings' })).toHaveTextContent('creates a new plan version')
  })

  it('publish needs a reason and the typed word, then offers apply-limits for the decrease with its own reason', async () => {
    const calls = await savePreview()
    await userEvent.click(screen.getByRole('button', { name: 'Publish…' }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText(/reason/i), 'plan sheet v2')
    expect(within(dlg).getByRole('button', { name: 'Publish' })).toBeDisabled() // not typed yet
    await userEvent.type(within(dlg).getByLabelText('Type PUBLISH to confirm'), 'PUBLISH')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Publish' }))
    const published = await screen.findByTestId('published')
    expect(calls.find((c) => c.path === '/billing/admin/catalog/drafts/draft-1/publish')!.body).toEqual({ reason: 'plan sheet v2' })
    expect(within(published).getByTestId('apply-limits')).toHaveTextContent('Memory facts')
    await userEvent.click(within(published).getByRole('button', { name: 'Apply limits to existing subscribers' }))
    const dlg2 = await screen.findByRole('dialog')
    expect(within(dlg2).getByRole('button', { name: 'Apply limits' })).toBeDisabled()
    await userEvent.type(within(dlg2).getByLabelText(/reason/i), 'agreed with support')
    await userEvent.click(within(dlg2).getByRole('button', { name: 'Apply limits' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/billing/admin/catalog/apply-limits/41')).toBe(true))
    expect(calls.find((c) => c.path === '/billing/admin/catalog/apply-limits/41')!.body).toEqual({ reason: 'agreed with support' })
    expect(await within(published).findByText('Applied')).toBeInTheDocument()
  })

  it('a 409 says someone published a newer catalog and offers a reload', async () => {
    const calls = await savePreview('billing_admin', { publish: () => json(409, { code: 'CATALOG_CONFLICT', detail: 'changed', errors: undefined }) })
    await userEvent.click(screen.getByRole('button', { name: 'Publish…' }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText(/reason/i), 'go ahead')
    await userEvent.type(within(dlg).getByLabelText('Type PUBLISH to confirm'), 'PUBLISH')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Publish' }))
    expect(await screen.findByText('Someone published a newer catalog; reload and reapply your changes.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(calls.filter((c) => c.path === '/billing/admin/catalog' && c.method === 'GET').length).toBeGreaterThan(1))
    expect(screen.queryByText(/Someone published/)).toBeNull()
  })

  it('support never sees Publish', async () => {
    mock('support')
    renderPage()
    await screen.findByRole('region', { name: 'Plan pro' })
    expect(screen.queryByRole('button', { name: 'Publish…' })).toBeNull()
  })
})

describe('export and history', () => {
  it('downloads plans.yaml', async () => {
    mock('support')
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Download plans.yaml/ }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(await saved[0]!.text()).toContain('catalog_version')
  })

  it('lists plan versions with subscribers', async () => {
    mock('support')
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: 'History' }))
    const table = await screen.findByRole('table', { name: 'Plan versions' })
    expect(within(table).getByText('v2')).toBeInTheDocument()
    expect(table).toHaveTextContent('₹499')
    expect(table).toHaveTextContent('current')
  })
})
