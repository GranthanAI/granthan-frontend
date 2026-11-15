import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BillingNotice, quietMessage } from '@/components/billing/BillingNotice'
import { MessageItem } from '@/components/chat/MessageItem'
import { LIMIT_COPY, PLAN_COPY, YES_ROWS } from '@/content/plans'
import { buildRows } from '@/features/billing/planTable'
import { PricingPage } from '@/pages/PricingPage'
import { useAuthStore } from '@/stores/auth.store'
import type { BillingDenied, PlanEntry, PlansResponse } from '@/types/billing'
import { FREE_LIMITS, MAX_LIMITS, PRO_LIMITS, meFree, plansResponse } from './billing-fixtures'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const payg: PlanEntry = {
  code: 'payg', version: 3, rank: 0, prices: {}, groups: ['fast', 'smart', 'best', 'ultra'], extra_models: [],
  limits: { ...FREE_LIMITS, messages_per_day: -1, best_per_day: -1, branches_per_tree: -1, messages_per_conversation: -1, memory_facts: -1,
    context_tokens: -1, documents_per_tree: -1, file_size_mb: 100, youtube_per_month: -1, storage_mb: -1, custom_modes: -1, mode_instruction_chars: 8000 },
  payg: {
    unit_prices: { fast: 20, smart: 50, best: 400, ultra: 1200, youtube_video: 100, manim_video: 200 },
    topup_packs: [{ code: 'ind_199', price_paise: 19900 }], credit_validity_months: 12,
    storage_over_10gb_per_gb_month: 1000, long_message_tokens: 32000, no_credit_fast_per_day: 10, max_messages_per_minute: 30,
  },
}
const withPayg: PlansResponse = { ...plansResponse, plans: [...plansResponse.plans, payg] }
const sheet = (plans: PlanEntry[]) => Object.fromEntries(buildRows(plans).map((r) => [r.key, r]))

describe('the comparison table: every row of the plan sheet, in order', () => {
  it('has the rows in the sheet order', () => {
    expect(buildRows(withPayg.plans).map((r) => r.label)).toEqual([
      'Best for', 'Price per month', 'Yearly option', 'Models', 'Messages per day', 'Best-model messages per day', 'Ultra models',
      'Branches per tree', 'Messages per conversation', 'Memory facts', 'How much each answer can read', 'Documents per tree',
      'File size per upload', 'YouTube videos per month', 'Total storage', 'Custom modes', 'Instruction length per mode',
      'Built-in modes (Auto, Tutor, Code, Web search, Smart)', 'Preferences (including Hinglish)', 'Notes', 'Mermaid diagrams',
      'Exports (PDF, Markdown, ZIP)', 'Manim videos', 'Deep research', 'Support',
    ])
  })

  it('numbers and prices come from the API plans', () => {
    const r = sheet(withPayg.plans)
    expect(r.priceMonth!.cells).toEqual({ free: '₹0', pro: '₹499', max: '₹1,499', payg: 'Pay for what you use' })
    expect(r.priceYear!.cells).toMatchObject({ free: '—', pro: '₹4,990', max: '₹14,990' })
    expect(r.models!.cells).toMatchObject({ free: 'Fast', pro: 'Fast, Smart', max: 'Fast, Smart, Best, Ultra', payg: 'Fast, Smart, Best, Ultra' })
    expect(r.messagesPerDay!.cells).toMatchObject({ free: '25', pro: '60', max: '80', payg: 'Unlimited' })
    expect(r.ultra!.cells).toMatchObject({ free: '—', pro: '—', payg: 'Yes' })
    expect(r.fileSize!.cells).toMatchObject({ free: '10 MB', pro: '50 MB', max: '100 MB', payg: '100 MB' })
    expect(r.instructionLength!.cells).toMatchObject({ free: '1,000 characters', payg: '8,000 characters' })
  })

  it('Best-model messages: "12, then switches to Smart", not included, unlimited', () => {
    const c = sheet(withPayg.plans).bestPerDay!.cells
    expect(c).toEqual({ free: 'Not included', pro: 'Not included', max: '12, then switches to Smart', payg: 'Unlimited' })
  })

  it('-1 reads Unlimited and reading -1 reads "Model\'s full window"', () => {
    const r = sheet(withPayg.plans)
    expect(r.branches!.cells).toMatchObject({ payg: 'Unlimited', free: '20' })
    expect(r.memoryFacts!.cells).toMatchObject({ max: 'Unlimited', payg: 'Unlimited' })
    expect(r.reading!.cells).toEqual({ free: '8k tokens', pro: '32k tokens', max: '128k tokens', payg: "Model's full window" })
    expect(PRO_LIMITS.context_tokens).toBe(32000)
    expect(MAX_LIMITS.custom_modes).toBe(-1)
    expect(r.customModes!.cells).toMatchObject({ max: 'Unlimited', payg: 'Unlimited' })
  })

  it('Pay as you Go YouTube, storage and Manim show their unit prices from the API', () => {
    const r = sheet(withPayg.plans)
    expect(r.youtube!.cells).toMatchObject({ free: '3', pro: '30', payg: 'Unlimited (₹1 each)' })
    expect(r.storage!.cells).toMatchObject({ free: '100 MB', pro: '2 GB', max: '10 GB', payg: 'Unlimited (₹10/GB/month above 10 GB)' })
    expect(r.manim!.cells).toMatchObject({ free: 'Unlimited', pro: 'Unlimited', max: 'Unlimited', payg: 'Unlimited (₹2 each)' })
  })

  it('the yes rows are Yes on every plan; deep research is Not yet; support and "Best for" come from plans.ts', () => {
    const r = sheet(withPayg.plans)
    for (const y of YES_ROWS) expect(Object.values(r[y.label]!.cells)).toEqual(['Yes', 'Yes', 'Yes', 'Yes'])
    expect(Object.values(r.deepResearch!.cells)).toEqual(['Not yet', 'Not yet', 'Not yet', 'Not yet'])
    expect(r.support!.cells).toEqual({ free: 'Help centre', pro: 'Email', max: 'Priority email', payg: 'Email' })
    expect(r.bestFor!.cells).toEqual({ free: 'Trying it out', pro: 'Students and regular learners', max: 'Power users who want top models', payg: 'Heavy or irregular users' })
    expect(PLAN_COPY.payg!.bestFor).toBe('Heavy or irregular users')
  })

  it('without payg in the API there are no payg cells and no unit prices are invented', () => {
    const r = sheet(plansResponse.plans)
    expect(Object.keys(r.messagesPerDay!.cells)).toEqual(['free', 'pro', 'max'])
    expect(r.youtube!.cells).not.toHaveProperty('payg')
  })
})

describe('the pricing page table', () => {
  beforeEach(() => useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null, expired: false }))
  afterEach(() => vi.unstubAllGlobals())
  const renderPricing = (plans: PlansResponse) => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, plans)))
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/pricing']}><Routes><Route path="/pricing" element={<PricingPage />} /></Routes></MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('renders every row, and the Pay as you Go column only when the API lists it', async () => {
    renderPricing(withPayg)
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Feature', 'Free', 'Pro', 'Max', 'Pay as you Go'])
    expect(within(table).getByRole('row', { name: /Total storage/ })).toHaveTextContent('Unlimited (₹10/GB/month above 10 GB)')
    expect(within(table).getByRole('row', { name: /Deep research/ })).toHaveTextContent('Not yet')
    expect(within(table).getAllByRole('row').length).toBe(26) // header + 25 rows
  })

  it('without payg the column is absent', async () => {
    renderPricing(plansResponse)
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Feature', 'Free', 'Pro', 'Max'])
  })
})

describe('limit copy by message_key', () => {
  const wrap = (ui: React.ReactElement, plans: PlansResponse = withPayg) => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const path = new URL(input).pathname
      return path.endsWith('/billing/me') ? json(200, meFree) : path.endsWith('/billing/plans') ? json(200, plans) : json(404, {})
    }))
    useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: null, expired: false })
    return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
  }
  afterEach(() => vi.unstubAllGlobals())
  const d = (over: Partial<BillingDenied>): BillingDenied => ({ reason: 'plan_limit', message_key: 'x', message: 'API says so', upgrade_to: 'pro', ...over })
  const notice = () => screen.getByTestId('billing-notice')
  const upgrade = () => within(notice()).queryByRole('link', { name: 'Upgrade' })

  it('limit.daily and limit.monthly: our words, Upgrade, and when it resets', () => {
    for (const [reason, key, text] of [['daily_limit', 'limit.daily', "You've reached today's message limit for your plan."], ['monthly_limit', 'limit.monthly', "You've used this month's allowance for your plan."]] as const) {
      const v = wrap(<BillingNotice denial={d({ reason, message_key: key, resets_at: '2026-11-15T18:30:00Z' })} />)
      expect(notice()).toHaveTextContent(text)
      expect(notice()).not.toHaveTextContent('API says so')
      expect(upgrade()).toBeInTheDocument()
      expect(notice()).toHaveTextContent('Resets at 12:00 am')
      v.unmount()
    }
  })

  it('limit.messages_per_conversation: "This conversation is full", a Branch hint, no Upgrade', () => {
    wrap(<BillingNotice denial={d({ limit: 'messages_per_conversation', message_key: 'limit.messages_per_conversation' })} />)
    expect(notice()).toHaveTextContent('This conversation is full. Branch from any message to continue; your context comes with you.')
    expect(notice()).toHaveTextContent('Branch from a message')
    expect(upgrade()).toBeNull()
  })

  it('limit.per_minute: "too quickly", no Upgrade, shows resets_at', () => {
    wrap(<BillingNotice denial={d({ reason: 'rate_limit', message_key: 'limit.per_minute', resets_at: '2026-11-15T18:31:00Z' })} />)
    expect(notice()).toHaveTextContent("You're sending messages too quickly. Please wait a moment.")
    expect(notice()).toHaveTextContent('Resets at 12:01 am')
    expect(upgrade()).toBeNull()
  })

  it('every other plan_limit key: the API message and an Upgrade action', () => {
    for (const limit of ['file_size_mb', 'branches_per_tree', 'custom_modes']) {
      const v = wrap(<BillingNotice denial={d({ limit, message_key: `limit.${limit}`, message: `${limit} reached. Upgrade to add more.` })} />)
      expect(notice()).toHaveTextContent(`${limit} reached. Upgrade to add more.`)
      expect(upgrade()).toBeInTheDocument()
      v.unmount()
    }
  })

  it('credits.empty: "Top up to continue." with the Fast-messages hint (the number from the API)', async () => {
    wrap(<BillingNotice denial={d({ reason: 'no_credit', message_key: 'credits.empty' })} />)
    expect(notice()).toHaveTextContent('Top up to continue.')
    expect(await screen.findByText('Fast models stay available for 10 messages a day')).toBeInTheDocument()
  })

  it('credits.spend_cap and member_cap: our words', () => {
    wrap(<BillingNotice denial={d({ reason: 'spend_cap', message_key: 'credits.spend_cap' })} />)
    expect(notice()).toHaveTextContent('Monthly spend cap reached. Sending is paused until the cap is raised or next month.')
  })

  it('an unknown key falls back to the API message', () => {
    wrap(<BillingNotice denial={d({ reason: 'plan_limit', message_key: 'limit.brand_new', message: 'Something new happened.' })} />)
    expect(notice()).toHaveTextContent('Something new happened.')
  })

  it('limit.best_switched is the downgrade line under an answer', async () => {
    wrap(<MessageItem message={{ key: 'a', id: 'a1', sender: 'assistant', content: 'Hi', status: 'sent', citations: [], fileIds: [], createdAt: null, local: false, model: 'm', noticeKey: 'limit.best_switched' }} isLastAssistant canRegenerate onRegenerate={() => {}} onRetrySend={() => {}} onDismissSend={() => {}} />)
    expect(await screen.findByRole('note')).toHaveTextContent(LIMIT_COPY['limit.best_switched']!.message)
  })

  it('spend cap notices from the stream at 80% and 100%', () => {
    expect(quietMessage({ notice_key: 'usage.threshold_80', metric: 'spend_cap' })).toBe("You've used 80% of your monthly spend cap.")
    expect(quietMessage({ notice_key: 'usage.threshold_100', metric: 'spend_cap' })).toBe("You've reached your monthly spend cap. Sending is paused until the cap is raised or next month.")
  })
})
