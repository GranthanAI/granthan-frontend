/**
 * Marketing and limit copy: the ONLY place for it. Numbers, prices and limits never live here: they come from billing's
 * API (/billing/plans). This file holds labels, the yes/no rows and the words for each limit message_key.
 */

export interface PlanCopy {
  name: string
  bestFor: string
  support: string
}

export const PLAN_COPY: Record<string, PlanCopy> = {
  free: { name: 'Free', bestFor: 'Trying it out', support: 'Help centre' },
  pro: { name: 'Pro', bestFor: 'Students and regular learners', support: 'Email' },
  max: { name: 'Max', bestFor: 'Power users who want top models', support: 'Priority email' },
  payg: { name: 'Pay as you Go', bestFor: 'Heavy or irregular users', support: 'Email' },
}

export const planCopy = (code: string): PlanCopy => PLAN_COPY[code] ?? { name: code.charAt(0).toUpperCase() + code.slice(1), bestFor: '', support: '' }

/** Rows that are the same "Yes" on every plan (the plan sheet). */
export const YES_ROWS: ReadonlyArray<{ label: string; detail?: string }> = [
  { label: 'Built-in modes', detail: 'Auto, Tutor, Code, Web search, Smart' },
  { label: 'Preferences', detail: 'including Hinglish' },
  { label: 'Notes' },
  { label: 'Mermaid diagrams' },
  { label: 'Exports', detail: 'PDF, Markdown, ZIP' },
]

export const ROW_LABELS = {
  priceMonth: 'Price per month',
  priceYear: 'Yearly option',
  models: 'Models',
  messagesPerDay: 'Messages per day',
  bestPerDay: 'Best-model messages per day',
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
  notIncluded: 'Not included',
  notYet: 'Not yet',
  unlimited: 'Unlimited',
  fullWindow: "Model's full window",
  bestThenSmart: (n: string) => `${n}, then switches to Smart`,
  paygPrice: 'Pay for what you use',
} as const

/** What each message_key says and offers. The API's own message is the fallback for any key not listed. */
export interface LimitCopy {
  message: string
  /** a second line under the message */
  hint?: string
  /** show Upgrade (default: decided by the reason) */
  upgrade?: boolean
  /** show "Resets at <time>" when billing sent resets_at */
  resets?: boolean
}

export const LIMIT_COPY: Record<string, LimitCopy> = {
  'limit.daily': { message: "You've reached today's message limit for your plan.", upgrade: true, resets: true },
  'limit.monthly': { message: "You've used this month's allowance for your plan.", upgrade: true, resets: true },
  'limit.best_switched': { message: "You've used today's Best-model messages, so this answer uses a Smart model." },
  'limit.messages_per_conversation': {
    message: 'This conversation is full. Branch from any message to continue; your context comes with you.',
    hint: 'Branch from a message',
    upgrade: false,
  },
  'limit.per_minute': { message: "You're sending messages too quickly. Please wait a moment.", upgrade: false, resets: true },
  'credits.empty': { message: 'Top up to continue.', hint: 'Fast models stay available for 10 messages a day' },
  'credits.spend_cap': { message: 'Monthly spend cap reached. Sending is paused until the cap is raised or next month.' },
  'credits.member_cap': { message: "Your organisation's monthly limit for you has been reached. Ask your organisation admin to raise it." },
}

export const limitCopy = (messageKey: string | undefined | null): LimitCopy | null => (messageKey ? (LIMIT_COPY[messageKey] ?? null) : null)

/** Quiet usage notices from the stream, by metric (80% / 100%). */
export const SPEND_CAP_NOTICE = {
  80: "You've used 80% of your monthly spend cap.",
  100: 'You\'ve reached your monthly spend cap. Sending is paused until the cap is raised or next month.',
} as const
