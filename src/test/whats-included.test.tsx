import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WhatsIncluded } from '@/components/billing/WhatsIncluded'
import { GENERIC_NOTICE, GROUP_DESCRIPTIONS, GROUP_LABELS, LIMIT_COPY, NOTICE_ACTIONS, PRICING_COPY, REASON_FALLBACK, ROW_LABELS, SPEND_CAP_NOTICE, WORDS } from '@/content/plans'
import { useAuthStore } from '@/stores/auth.store'
import { catalogResponse, meFree, meMax, mePro, plansResponse } from './billing-fixtures'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const BANNED = [/\blimit\b/i, /\blimited\b/i, /\brestricted\b/i, /\blocked\b/i, /\bblocked\b/i, /\bdenied\b/i, /\bquota\b/i, /\bnot allowed\b/i, /\bonly\b/i, /\bexceeded\b/i, /\binsufficient\b/i, /upgrade required/i]

describe('the wording rules hold for every user-facing string in content/plans.ts', () => {
  const strings = [
    ...Object.values(LIMIT_COPY).flatMap((c) => [c.message, c.fix, c.soft].filter((x): x is string => !!x)),
    ...Object.entries(REASON_FALLBACK).filter(([k]) => k !== 'account_blocked').map(([, v]) => v), // a genuinely blocked account may say so
    GENERIC_NOTICE,
    ...Object.values(GROUP_DESCRIPTIONS),
    ...Object.values(GROUP_LABELS),
    ...Object.values(SPEND_CAP_NOTICE),
    ...Object.values(NOTICE_ACTIONS),
    ...Object.values(ROW_LABELS),
    ...[PRICING_COPY.subtitle, PRICING_COPY.whichIntro, PRICING_COPY.whichTitle, WORDS.withCredits, WORDS.bestThenSmart('5')],
  ]
  it.each(strings.map((s) => [s]))('%s', (text) => {
    const words = text.replace(/\{\w+\}/g, '') // {placeholders} are variable names, not copy
    for (const rx of BANNED) expect(words, String(rx)).not.toMatch(rx)
  })

  it('Advanced is the user-facing name of the "best" group; the other three keep theirs', () => {
    expect(GROUP_LABELS).toEqual({ fast: 'Fast', smart: 'Smart', best: 'Advanced', ultra: 'Ultra' })
    expect(GROUP_DESCRIPTIONS).toEqual({
      fast: 'Quick, everyday answers.',
      smart: 'Careful reasoning for studying and explanations.',
      best: 'The most capable models, for hard problems, long documents and exam prep.',
      ultra: 'Frontier models, paid per answer with credits.',
    })
  })
})

describe('Settings → Billing: What is included for the current plan', () => {
  beforeEach(() => useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: null, expired: false }))
  afterEach(() => vi.unstubAllGlobals())
  const show = (me: typeof meFree, credits = false) => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const path = new URL(input).pathname
      return path.endsWith('/billing/me') ? json(200, me) : path.endsWith('/billing/plans') ? json(200, plansResponse) : path.endsWith('/billing/models') ? json(200, catalogResponse) : json(404, {})
    }))
    return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><WhatsIncluded credits={credits} /></MemoryRouter></QueryClientProvider>)
  }
  const items = () => within(screen.getByRole('list', { name: 'Models included' })).getAllByRole('listitem').map((li) => li.textContent)

  it('Free: Fast, three Smart models, the daily messages, no Advanced', async () => {
    show(meFree)
    await screen.findByTestId('whats-included')
    expect(screen.getByText('25 messages every day')).toBeInTheDocument()
    expect(items()).toEqual(['Fast: GPT-OSS 20B, Gemini 2.5 Flash-Lite', 'Smart: GPT-OSS 120B, Claude Haiku 5.5, GPT-6 Luna'])
  })

  it('Pro: Advanced with its daily allowance from the API, and what happens after', async () => {
    show(mePro)
    await screen.findByTestId('whats-included')
    expect(screen.getByText('60 messages every day, of which up to 5 Advanced. After that, answers continue on Smart.')).toBeInTheDocument()
    expect(items()[2]).toBe('Advanced: Claude Sonnet 5.5, GPT-6.1 Sol, 5 every day')
  })

  it('Max, in the wallet: 15 Advanced a day, and Ultra with credits', async () => {
    show(meMax, true)
    await screen.findByTestId('whats-included')
    expect(screen.getByText('80 messages every day, of which up to 15 Advanced. After that, answers continue on Smart.')).toBeInTheDocument()
    expect(items()).toContain('Advanced: Claude Sonnet 5.5, GPT-6.1 Sol, 15 every day')
    expect(items().at(-1)).toBe('Ultra: Claude Opus 5.5 · with credits')
  })
})
