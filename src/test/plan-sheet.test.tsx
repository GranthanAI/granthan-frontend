import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BillingNotice, quietMessage } from '@/components/billing/BillingNotice'
import { MessageItem } from '@/components/chat/MessageItem'
import { PLAN_COPY, YES_ROWS } from '@/content/plans'
import { buildRows } from '@/features/billing/planTable'
import { PricingPage } from '@/pages/PricingPage'
import { useAuthStore } from '@/stores/auth.store'
import type { BillingDenied, PlanEntry, PlansResponse } from '@/types/billing'
import { FREE_LIMITS, MAX_LIMITS, PRO_LIMITS, catalogResponse, meFree, mePro, plansResponse } from './billing-fixtures'

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
      'Best for', 'Price per month', 'Yearly option', 'Models included', 'Messages every day', 'Advanced answers every day', 'Ultra models',
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
    expect(r.models!.cells).toEqual({ free: 'Fast', pro: 'Fast, Smart, Advanced', max: 'Fast, Smart, Advanced', payg: 'Fast, Smart, Advanced, Ultra' })
    expect(r.messagesPerDay!.cells).toMatchObject({ free: '25', pro: '60', max: '80', payg: 'Unlimited' })
    expect(r.ultra!.cells).toEqual({ free: 'With credits', pro: 'With credits', max: 'With credits', payg: 'With credits' })
    expect(r.fileSize!.cells).toMatchObject({ free: '10 MB', pro: '50 MB', max: '100 MB', payg: '100 MB' })
    expect(r.instructionLength!.cells).toMatchObject({ free: '1,000 characters', payg: '8,000 characters' })
  })

  it('Advanced answers every day: "5 included daily · continues on Smart", a dash when not included, unlimited', () => {
    const c = sheet(withPayg.plans).bestPerDay!.cells
    expect(c).toEqual({ free: '—', pro: '5 included daily · continues on Smart', max: '15 included daily · continues on Smart', payg: 'Unlimited' })
  })

  it('with the model catalog the Models row says which models of a group a plan includes', () => {
    const rows = Object.fromEntries(buildRows(withPayg.plans, catalogResponse.models).map((r) => [r.key, r]))
    expect(rows.models!.cells).toEqual({
      free: 'Fast, Smart (3 of 5 models)', pro: 'Fast, Smart, Advanced', max: 'Fast, Smart, Advanced', payg: 'Fast, Smart, Advanced, Ultra',
    })
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
    expect(r.bestFor!.cells).toEqual({ free: 'Trying it out', pro: 'Students and regular learners', max: 'Power users who want the most Advanced answers', payg: 'Heavy or irregular users' })
    expect(PLAN_COPY.payg!.bestFor).toBe('Heavy or irregular users')
  })

  it('without payg in the API there are no payg cells and no unit prices are invented', () => {
    const r = sheet(plansResponse.plans)
    expect(r.ultra!.cells).toEqual({ free: '—', pro: '—', max: '—' }) // credits are not on offer
    expect(Object.keys(r.messagesPerDay!.cells)).toEqual(['free', 'pro', 'max'])
    expect(r.youtube!.cells).not.toHaveProperty('payg')
  })
})

describe('the pricing page table', () => {
  beforeEach(() => useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null, expired: false }))
  afterEach(() => vi.unstubAllGlobals())
  const renderPricing = (plans: PlansResponse) => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => (new URL(input).pathname.endsWith('/billing/models') ? json(200, catalogResponse) : json(200, plans))))
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

describe('the pricing page cards and "Which model should I use?"', () => {
  beforeEach(() => useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null, expired: false }))
  afterEach(() => vi.unstubAllGlobals())
  const renderPricing = (plans: PlansResponse) => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => (new URL(input).pathname.endsWith('/billing/models') ? json(200, catalogResponse) : json(200, plans))))
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/pricing']}><Routes><Route path="/pricing" element={<PricingPage />} /></Routes></MemoryRouter>
      </QueryClientProvider>,
    )
  }
  const lines = (plan: string) => within(screen.getByRole('list', { name: `${plan} models` })).getAllByRole('listitem').map((li) => li.textContent)

  it('each card lists Models included BY GROUP with the real names and the Advanced allowance from the API', async () => {
    renderPricing(withPayg)
    await screen.findAllByTestId('models-included')
    expect(lines('Free')).toEqual(['Fast: GPT-OSS 20B, Gemini 2.5 Flash-Lite', 'Smart: GPT-OSS 120B, Claude Haiku 5.5, GPT-6 Luna'])
    expect(lines('Pro')).toEqual([
      'Fast: GPT-OSS 20B, Gemini 2.5 Flash-Lite',
      'Smart: GPT-OSS 120B, Claude Haiku 5.5, GPT-6 Luna, Gemini 3.1 Flash-Lite, Gemini 2.5 Flash',
      'Advanced: Claude Sonnet 5.5, GPT-6.1 Sol, 5 every day',
    ])
    expect(lines('Max')[2]).toBe('Advanced: Claude Sonnet 5.5, GPT-6.1 Sol, 15 every day')
    expect(lines('Pay as you Go').at(-1)).toBe('Ultra: Claude Opus 5.5')
    expect(screen.getAllByText('Models included').length).toBeGreaterThanOrEqual(3)
  })

  it('explains the four groups with the one-line descriptions and which plans include each', async () => {
    renderPricing(withPayg)
    const section = await screen.findByTestId('which-model')
    expect(within(section).getByRole('heading', { name: 'Which model should I use?' })).toBeInTheDocument()
    const item = (g: string) => section.querySelector(`[data-group="${g}"]`)!
    expect(item('fast')).toHaveTextContent('Fast')
    expect(item('fast')).toHaveTextContent('Quick, everyday answers.')
    expect(item('fast')).toHaveTextContent('Included with Free, Pro and Max')
    expect(item('smart')).toHaveTextContent('Careful reasoning for studying and explanations.')
    expect(item('smart')).toHaveTextContent('Included with Free (some of these), Pro and Max')
    expect(item('best')).toHaveTextContent('Advanced')
    expect(item('best')).toHaveTextContent('The most capable models, for hard problems, long documents and exam prep.')
    expect(item('best')).toHaveTextContent('Included with Pro and Max')
    expect(item('ultra')).toHaveTextContent('Frontier models, paid per answer with credits.')
    expect(item('ultra')).toHaveTextContent('With credits on any plan')
    expect(section.textContent).not.toMatch(/\bBest\b/)
  })
})

describe('limit copy by message_key', () => {
  const wrap = (ui: React.ReactElement, plans: PlansResponse = withPayg, me = meFree) => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const path = new URL(input).pathname
      return path.endsWith('/billing/me') ? json(200, me)
        : path.endsWith('/billing/plans') ? json(200, plans)
        : path.endsWith('/billing/models') ? json(200, catalogResponse)
        : json(404, {})
    }))
    useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: null, expired: false })
    return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
  }
  afterEach(() => vi.unstubAllGlobals())
  const d = (over: Partial<BillingDenied>): BillingDenied => ({ reason: 'plan_limit', message_key: 'x', message: 'API says so', upgrade_to: 'pro', ...over })
  const notice = () => screen.getByTestId('billing-notice')
  const seePlans = () => within(notice()).queryByRole('link', { name: 'See plans' })

  it('limit.daily: all of today\'s messages, when they refresh, a soft line about the next plan, See plans', async () => {
    wrap(<BillingNotice denial={d({ reason: 'daily_limit', message_key: 'limit.daily', resets_at: '2026-11-15T18:30:00Z' })} />)
    expect(await screen.findByText("That's all 25 of today's messages. They refresh at 12:00 am.")).toBeInTheDocument()
    expect(await screen.findByText('Pro includes 60 every day.')).toBeInTheDocument()
    expect(notice()).not.toHaveTextContent('API says so')
    expect(seePlans()).toBeInTheDocument()
  })

  it('limit.daily: no soft line and no See plans when there is no bigger plan', async () => {
    const top = { ...meFree, plan: { ...meFree.plan, code: 'max' } }
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const path = new URL(input).pathname
      return path.endsWith('/billing/me') ? json(200, top) : path.endsWith('/billing/plans') ? json(200, plansResponse) : json(404, {})
    }))
    useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: null, expired: false })
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><BillingNotice denial={d({ reason: 'daily_limit', message_key: 'limit.daily', upgrade_to: null, resets_at: '2026-11-15T18:30:00Z' })} /></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByText(/That's all 25 of today's messages/)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 40))
    expect(notice()).not.toHaveTextContent('includes')
    expect(seePlans()).toBeNull()
  })

  it('limit.monthly: this month, and the date it refreshes', async () => {
    wrap(<BillingNotice denial={d({ reason: 'monthly_limit', message_key: 'limit.monthly', resets_at: '2026-12-01T00:00:00+05:30' })} />)
    expect(await screen.findByText("This month's YouTube videos are used. They refresh on 1 Dec.")).toBeInTheDocument()
    expect(seePlans()).toBeInTheDocument()
  })

  it('limit.messages_per_conversation: full length, branch from a message, no See plans', async () => {
    wrap(<BillingNotice denial={d({ limit: 'messages_per_conversation', message_key: 'limit.messages_per_conversation' })} />)
    expect(await screen.findByText('This conversation has reached its full length. Branch from any message to continue; your context comes with you.')).toBeInTheDocument()
    expect(seePlans()).toBeNull()
  })

  it('limit.per_minute: a calm "give it a moment", no See plans', async () => {
    wrap(<BillingNotice denial={d({ reason: 'rate_limit', message_key: 'limit.per_minute', resets_at: '2026-11-15T18:31:00Z' })} />)
    expect(await screen.findByText("You're sending quickly. Give it a moment and try again.")).toBeInTheDocument()
    expect(seePlans()).toBeNull()
  })

  it('every plan_limit key says what is full, the next step, and "see plans" only when a bigger plan exists', async () => {
    const expected: Record<string, string> = {
      branches_per_tree: 'This tree has all 20 of its branches. Start a new tree, or see plans for more.',
      documents_per_tree: 'This tree has all 3 of its documents. Remove one, or see plans for more.',
      custom_modes: 'You have all 3 custom modes your plan includes. Remove one, or see plans for more.',
      mode_instruction_chars: 'That instruction is longer than the 1,000 characters your plan includes. Shorten it, or see plans for more.',
      file_size_mb: 'This file is larger than the 10 MB each upload includes on your plan. Choose a smaller file, or see plans for more.',
      storage_mb: 'Your 100 MB of storage is full. Delete files you no longer need, or see plans for more.',
      memory_facts: 'Your 50 memory facts are all in use. Remove the ones you don\'t need, or see plans for more.',
    }
    for (const [limit, text] of Object.entries(expected)) {
      const v = wrap(<BillingNotice denial={d({ limit, message_key: `limit.${limit}` })} />)
      expect(await screen.findByText(text)).toBeInTheDocument()
      expect(seePlans()).toBeInTheDocument()
      v.unmount()
    }
    const v = wrap(<BillingNotice denial={d({ limit: 'branches_per_tree', message_key: 'limit.branches_per_tree', upgrade_to: null })} />, { ...plansResponse, plans: [plansResponse.plans[2]!] })
    expect(await screen.findByText('This tree has all 20 of its branches. Start a new tree.')).toBeInTheDocument()
    expect(seePlans()).toBeNull()
    v.unmount()
  })

  it('credits.empty: top up, and the Fast messages a day come from the API', async () => {
    wrap(<BillingNotice denial={d({ reason: 'no_credit', message_key: 'credits.empty' })} />)
    expect(await screen.findByText('Your credits are used up. Top up to keep going; Fast models stay available for 10 messages a day.')).toBeInTheDocument()
  })

  it('credits.spend_cap and member_cap: our words, no "limit"', async () => {
    wrap(<BillingNotice denial={d({ reason: 'spend_cap', message_key: 'credits.spend_cap' })} />)
    expect(notice()).toHaveTextContent('Your monthly spend cap is reached, so credits are paused. Raise the cap, or they continue next month.')
    wrap(<BillingNotice denial={d({ reason: 'member_spend_cap', message_key: 'credits.member_cap' })} />)
    expect(screen.getAllByTestId('billing-notice')[1]).toHaveTextContent("Your share of your organisation's monthly credits is used. Ask your organisation admin to add more.")
  })

  it('model_not_in_plan: "{model} is included with {plans}." from the catalog and plans', async () => {
    wrap(<BillingNotice denial={d({ reason: 'model_not_in_plan', message_key: 'plan.model_not_included', model: 'claude-sonnet-5-5' })} />)
    expect(await screen.findByText('Claude Sonnet 5.5 is included with Pro and Max.')).toBeInTheDocument()
  })

  it('model_not_in_plan without a model name falls back to the service message, never a made-up name', async () => {
    wrap(<BillingNotice denial={d({ reason: 'model_not_in_plan', message_key: 'plan.model_not_included', message: 'This model is included with a bigger plan.' })} />)
    expect(await screen.findByText('This model is included with a bigger plan.')).toBeInTheDocument()
  })

  it('an unknown key falls back to the API message', () => {
    wrap(<BillingNotice denial={d({ reason: 'plan_limit', message_key: 'limit.brand_new', message: 'Something new happened.' })} />)
    expect(notice()).toHaveTextContent('Something new happened.')
  })

  it('limit.best_switched is the downgrade line under an answer, with the API numbers and the model that answered', async () => {
    wrap(<MessageItem message={{ key: 'a', id: 'a1', sender: 'assistant', content: 'Hi', status: 'sent', citations: [], fileIds: [], createdAt: null, local: false, model: 'claude-haiku-5-5', noticeKey: 'limit.best_switched' }} isLastAssistant canRegenerate onRegenerate={() => {}} onRetrySend={() => {}} onDismissSend={() => {}} />, withPayg, mePro)
    expect(await screen.findByText("Today's 5 Advanced answers are used, so this one comes from Claude Haiku 5.5 (Smart). Advanced refreshes at 12:00 am.")).toBeInTheDocument()
  })

  it('spend cap notices from the stream at 80% and 100%', () => {
    expect(quietMessage({ notice_key: 'usage.threshold_80', metric: 'spend_cap' })).toBe("You've used 80% of your monthly spend cap.")
    expect(quietMessage({ notice_key: 'usage.threshold_100', metric: 'spend_cap' })).toBe("You've reached your monthly spend cap, so credits are paused until you raise it or next month.")
  })
})
