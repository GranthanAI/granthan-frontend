/**
 * Marketing and allowance copy: the ONLY place for it. Numbers, prices and allowances never live here: they come from
 * billing's API (/billing/plans, /billing/models, /billing/me). This file holds labels, the yes/no rows and the words for
 * each message_key.
 */

export interface PlanCopy {
  name: string
  bestFor: string
  support: string
}

export const PLAN_COPY: Record<string, PlanCopy> = {
  free: { name: 'Free', bestFor: 'Trying it out', support: 'Help centre' },
  pro: { name: 'Pro', bestFor: 'Students and regular learners', support: 'Email' },
  max: { name: 'Max', bestFor: 'Power users who want the most Advanced answers', support: 'Priority email' },
  payg: { name: 'Pay as you Go', bestFor: 'Heavy or irregular users', support: 'Email' },
}

/** User-facing group names. The internal id of Advanced stays "best" in every API and event. */
export const GROUP_ORDER = ['fast', 'smart', 'best', 'ultra'] as const
export const GROUP_LABELS: Record<string, string> = { fast: 'Fast', smart: 'Smart', best: 'Advanced', ultra: 'Ultra' }
export const GROUP_DESCRIPTIONS: Record<string, string> = {
  fast: 'Quick, everyday answers.',
  smart: 'Careful reasoning for studying and explanations.',
  best: 'The most capable models, for hard problems, long documents and exam prep.',
  ultra: 'Frontier models, paid per answer with credits.',
}
export const groupLabel = (group: string): string => GROUP_LABELS[group] ?? group.charAt(0).toUpperCase() + group.slice(1)

export const planCopy = (code: string): PlanCopy => PLAN_COPY[code] ?? { name: code.charAt(0).toUpperCase() + code.slice(1), bestFor: '', support: '' }

/** Rows that are the same "Yes" on every plan (the plan sheet). */
export const YES_ROWS: ReadonlyArray<{ label: string; detail?: string }> = [
  { label: 'Built-in modes', detail: 'Auto, Tutor, Code, Web search, Smart' },
  { label: 'Preferences', detail: 'including Hinglish' },
  { label: 'Notes' },
  { label: 'Mermaid diagrams' },
  { label: 'Exports', detail: 'PDF, Markdown, ZIP' },
]

/** How Pay as you Go works (words only: prices, packs and validity come from the API). */
export const PAYG_COPY = {
  how: 'Top up credits and use them whenever a message needs more than your plan includes. No subscription.',
  ultra: 'Ultra models are included.',
  validity: (months: number) => `Credits are valid for ${months} months.`,
  perMessage: (price: string) => `uses credits · ${price} per message`,
  topUp: 'Top up credits',
} as const

export const ROW_LABELS = {
  priceMonth: 'Price per month',
  priceYear: 'Yearly option',
  models: 'Models included',
  messagesPerDay: 'Messages every day',
  bestPerDay: 'Advanced answers every day',
  ultra: 'Ultra models',
  branches: 'Branches per tree',
  messagesPerConversation: 'Messages per conversation',
  memoryFacts: 'Memory facts',
  reading: 'How much each answer can read',
  documents: 'Documents per tree',
  fileSize: 'File size per upload',
  youtube: 'YouTube videos per month',
  storage: 'Total storage',
  customModes: 'Custom modes',
  instructionLength: 'Instruction length per mode',
  manim: 'Manim videos',
  deepResearch: 'Deep research',
  support: 'Support',
  bestFor: 'Best for',
} as const

export const WORDS = {
  yes: 'Yes',
  no: '—',
  notIncluded: '—',
  notYet: 'Not yet',
  unlimited: 'Unlimited',
  fullWindow: "Model's full window",
  bestThenSmart: (n: string) => `${n} included daily · continues on Smart`,
  withCredits: 'With credits',
  paygPrice: 'Pay for what you use',
} as const

/**
 * What each message_key says. Templates use {placeholders} that BillingNotice fills with the API's own numbers, times and
 * model names (features/billing/noticeCopy.ts); nothing here is a count, a price or a time.
 *   {limit} the plan's number for this allowance   {size} a size (MB / GB)   {time} when it refreshes ("12:00 am", IST)
 *   {date} the refresh date   {n} Advanced answers a day   {model} a model's name   {what} what a monthly allowance counts
 *   {fast} the Fast messages a day that stay available without credits   {plan}/{planLimit} the next plan and its number
 * `fix` is the one next step ("Start a new tree"); "or see plans for more" is added only when a bigger plan exists.
 */
export interface LimitCopy {
  message: string
  /** what to do next; ", or see plans for more." is appended only when a bigger plan exists */
  fix?: string
  /** a soft second line, shown only when it can be filled (e.g. what the next plan includes) */
  soft?: string
  /** show "See plans" (default: decided by the reason) */
  upgrade?: boolean
}

export const LIMIT_COPY: Record<string, LimitCopy> = {
  'limit.daily': {
    message: "That's all {limit} of today's messages. They refresh at {time}.",
    soft: '{plan} includes {planLimit} every day.',
    upgrade: true,
  },
  'limit.monthly': { message: "This month's {what} are used. They refresh on {date}.", upgrade: true },
  'limit.best_switched': {
    message: "Today's {n} Advanced answers are used, so this one comes from {model} (Smart). Advanced refreshes at {time}.",
  },
  'limit.per_minute': { message: "You're sending quickly. Give it a moment and try again.", upgrade: false },
  'limit.messages_per_conversation': {
    message: 'This conversation has reached its full length.',
    fix: 'Branch from any message to continue; your context comes with you',
    upgrade: false,
  },
  'limit.branches_per_tree': { message: 'This tree has all {limit} of its branches.', fix: 'Start a new tree' },
  'limit.documents_per_tree': { message: 'This tree has all {limit} of its documents.', fix: 'Remove one' },
  'limit.custom_modes': { message: 'You have all {limit} custom modes your plan includes.', fix: 'Remove one' },
  'limit.mode_instruction_chars': { message: 'That instruction is longer than the {limit} characters your plan includes.', fix: 'Shorten it' },
  'limit.file_size_mb': { message: 'This file is larger than the {size} each upload includes on your plan.', fix: 'Choose a smaller file' },
  'limit.storage_mb': { message: 'Your {size} of storage is full.', fix: 'Delete files you no longer need' },
  'limit.memory_facts': { message: 'Your {limit} memory facts are all in use.', fix: "Remove the ones you don't need" },
  'limit.youtube_per_month': { message: "This month's {limit} YouTube videos are used. They refresh on {date}.", upgrade: true },
  'credits.empty': {
    message: 'Your credits are used up. Top up to keep going; Fast models stay available for {fast} messages a day.',
  },
  'credits.spend_cap': { message: 'Your monthly spend cap is reached, so credits are paused. Raise the cap, or they continue next month.' },
  'credits.member_cap': { message: "Your share of your organisation's monthly credits is used. Ask your organisation admin to add more." },
  'plan.model_not_included': { message: '{model} is included with {plans}.', upgrade: true },
}

export const limitCopy = (messageKey: string | undefined | null): LimitCopy | null => (messageKey ? (LIMIT_COPY[messageKey] ?? null) : null)

/** When billing sent no message_key we know the reason: the same words. */
export const REASON_KEYS: Record<string, string> = {
  daily_limit: 'limit.daily',
  monthly_limit: 'limit.monthly',
  model_not_in_plan: 'plan.model_not_included',
  no_credit: 'credits.empty',
  spend_cap: 'credits.spend_cap',
  member_spend_cap: 'credits.member_cap',
  rate_limit: 'limit.per_minute',
}
/** Reasons with fixed words and no template. */
export const REASON_FALLBACK: Record<string, string> = {
  account_blocked: "Your account can't send messages right now. Please contact support.",
  billing_unavailable: 'Fast models are available for a few minutes while we reconnect. Please try again shortly.',
  plan_limit: "Your plan's allowance for this is all used.",
}
export const GENERIC_NOTICE = "We can't send this message right now. Please try again in a moment."

/** Quiet usage notices from the stream, by metric (80% / 100%). */
export const NOTICE_ACTIONS = {
  topUp: 'Top up',
  raiseCap: 'Raise your cap',
  askAdmin: 'Ask your organisation admin to add more.',
  seePlans: 'See plans',
} as const

export const SPEND_CAP_NOTICE = {
  80: "You've used 80% of your monthly spend cap.",
  100: "You've reached your monthly spend cap, so credits are paused until you raise it or next month.",
} as const

/** The pricing page's own words. */
export const POPULAR_PLAN = 'pro'
export const PRICING_COPY = {
  subtitle: 'Start free. Move to a bigger plan when you want more messages, more capable models and more room to learn.',
  popular: 'Most popular',
  paygTagline: 'Top up credits, spend them as you go',
  footnote: 'You can change or cancel a plan at any time from Settings → Billing.',
  included: 'Models included',
  whichTitle: 'Which model should I use?',
  whichIntro: 'You pick the model for every conversation. Here is what each group is for and which plans include it.',
  seePlans: 'See plans',
  withCreditsOnly: 'With credits',
} as const
