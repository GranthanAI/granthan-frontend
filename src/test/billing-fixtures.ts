import type { BillingMe, InvoicesResponse, MyModelsResponse, PlanLimits, PlansResponse } from '@/types/billing'

const RESETS = '2026-11-16T00:00:00+05:30'
export const FREE_LIMITS: PlanLimits = {
  messages_per_day: 25, best_per_day: 0, branches_per_tree: 20, messages_per_conversation: 50, memory_facts: 50,
  context_tokens: 8000, documents_per_tree: 3, file_size_mb: 10, youtube_per_month: 3, storage_mb: 100,
  custom_modes: 3, mode_instruction_chars: 1000,
}
export const PRO_LIMITS: PlanLimits = {
  ...FREE_LIMITS, messages_per_day: 60, branches_per_tree: 100, messages_per_conversation: 200, memory_facts: 200,
  context_tokens: 32000, documents_per_tree: 10, file_size_mb: 50, youtube_per_month: 30, storage_mb: 2048,
  custom_modes: 10, mode_instruction_chars: 3000, best_per_day: 5,
}
export const MAX_LIMITS: PlanLimits = {
  ...PRO_LIMITS, messages_per_day: 80, best_per_day: 15, memory_facts: -1, context_tokens: 128000,
  file_size_mb: 100, youtube_per_month: 100, storage_mb: 10240, custom_modes: -1,
}

const base: BillingMe = {
  plan: { code: 'free', version: 1, interval: null, source: 'default' },
  status: 'free',
  current_period_end: null,
  grace_until: null,
  cancel_at_period_end: false,
  pending_change: null,
  limits: FREE_LIMITS,
  payment_mode: 'live',
  payment_action_url: null,
  usage_today: { total: 0, fast: 0, smart: 0, best: 0, ultra: 0, resets_at: RESETS },
  usage_month: { youtube_videos: 0 },
  wallet: null,
}
const make = (o: Partial<BillingMe>): BillingMe => ({ ...base, ...o })

export const meFree = make({ usage_today: { ...base.usage_today, total: 31, fast: 31 } })
export const mePro = make({
  plan: { code: 'pro', version: 1, interval: 'month', source: 'subscription' },
  status: 'active',
  current_period_end: '2026-12-15T10:00:00+05:30',
  limits: PRO_LIMITS,
  usage_today: { ...base.usage_today, total: 10, fast: 6, smart: 4 },
})
export const meMax = make({
  plan: { code: 'max', version: 1, interval: 'year', source: 'subscription' },
  status: 'active',
  current_period_end: '2027-11-15T10:00:00+05:30',
  limits: MAX_LIMITS,
  usage_today: { ...base.usage_today, total: 20, fast: 10, smart: 4, best: 4, ultra: 2 },
})
export const mePastDue = make({ ...mePro, status: 'past_due', grace_until: '2026-11-20T00:00:00+05:30', payment_action_url: 'https://rzp.io/i/pay-now' })
export const meSuspended = make({ ...mePro, status: 'suspended' })
export const meCancelling = make({ ...mePro, status: 'cancelling', cancel_at_period_end: true })
export const meSimulated = make({ payment_mode: 'simulated' })
export const meLive = make({ payment_mode: 'live' })

type Group = MyModelsResponse['groups'][number]
const g = (group: string, allowed: boolean, models: Array<[string, string]>, extra: Partial<Group> = {}): Group => ({
  group,
  allowed,
  daily_limit: -1,
  remaining_today: -1,
  models: models.map(([id, label]) => ({ id, label, provider: 'groq', allowed })),
  ...extra,
})
export const modelsFree: MyModelsResponse = {
  plan: { code: 'free', source: 'default' },
  default_group: 'fast',
  messages: { daily_limit: 25, used_today: 0, remaining_today: 25, resets_at: RESETS },
  groups: [
    g('fast', true, [['llama-fast', 'Llama Fast']]),
    g('smart', false, [['llama-smart', 'Llama Smart']], { upgrade_to: 'pro' }),
    g('best', false, [['best-1', 'Best One']], { upgrade_to: 'pro', daily_limit: 0, remaining_today: 0 }),
    g('ultra', false, [['ultra-1', 'Ultra One']], { upgrade_to: 'payg' }),
  ],
}
export const modelsPro: MyModelsResponse = {
  ...modelsFree,
  plan: { code: 'pro', source: 'subscription' },
  groups: [
    g('fast', true, [['llama-fast', 'Llama Fast']]),
    g('smart', true, [['llama-smart', 'Llama Smart']]),
    g('best', true, [['best-1', 'Best One']], { daily_limit: 5, remaining_today: 4 }),
    g('ultra', false, [['ultra-1', 'Ultra One']], { upgrade_to: 'payg' }),
  ],
}
export const modelsMax: MyModelsResponse = {
  ...modelsFree,
  plan: { code: 'max', source: 'subscription' },
  groups: [
    g('fast', true, [['llama-fast', 'Llama Fast']]),
    g('smart', true, [['llama-smart', 'Llama Smart']]),
    g('best', true, [['best-1', 'Best One']], { daily_limit: 15, remaining_today: 8 }),
    g('ultra', true, [['ultra-1', 'Ultra One']]),
  ],
}

export const plansResponse: PlansResponse = {
  catalog_version: 3,
  currency: 'INR',
  gst_inclusive: true,
  plans: [
    { code: 'free', version: 1, rank: 0, prices: {}, groups: ['fast'], extra_models: ['openai/gpt-oss-120b', 'claude-haiku-5-5', 'gpt-6-luna'], limits: FREE_LIMITS },
    { code: 'pro', version: 1, rank: 1, prices: { month: 49900, year: 499000 }, groups: ['fast', 'smart', 'best'], extra_models: [], limits: PRO_LIMITS },
    { code: 'max', version: 1, rank: 2, prices: { month: 149900, year: 1499000 }, groups: ['fast', 'smart', 'best'], extra_models: [], limits: MAX_LIMITS },
  ],
}

export const invoicesResponse: InvoicesResponse = {
  invoices: [
    { id: 'inv-1', number: 'GA/2026/0001', kind: 'tax_invoice', issued_at: '2026-11-01T10:00:00+05:30', taxable_paise: 42288, cgst_paise: 3806, sgst_paise: 3806, igst_paise: 0, total_paise: 49900, status: 'issued', original_number: null, pdf_ready: true },
    { id: 'cn-1', number: 'GA/CN/2026/0001', kind: 'credit_note', issued_at: '2026-11-05T10:00:00+05:30', taxable_paise: 10000, cgst_paise: 900, sgst_paise: 900, igst_paise: 0, total_paise: 11800, status: 'issued', original_number: 'GA/2026/0001', pdf_ready: true },
  ],
}

/** A service's refusal body, as conversation/file/memory-service send it. */
export const denial = (reason: string, extra: Record<string, unknown> = {}) => ({
  detail: { code: 'billing_denied', reason, message_key: 'x', message: `backend says ${reason}`, upgrade_to: 'pro', ...extra },
})

/** The public model catalog (/billing/models) with the real names. */
export const catalogResponse = {
  models: [
    { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', provider: 'groq', group: 'fast', sort_order: 0 },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', provider: 'google', group: 'fast', sort_order: 1 },
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', provider: 'groq', group: 'smart', sort_order: 2 },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', provider: 'anthropic', group: 'smart', sort_order: 3 },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', provider: 'openai', group: 'smart', sort_order: 4 },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', provider: 'google', group: 'smart', sort_order: 5 },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google', group: 'smart', sort_order: 6 },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', provider: 'anthropic', group: 'best', sort_order: 7 },
    { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', provider: 'openai', group: 'best', sort_order: 8 },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', provider: 'anthropic', group: 'ultra', sort_order: 9 },
  ],
}
