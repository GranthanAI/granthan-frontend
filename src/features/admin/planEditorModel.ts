/** The plan editor's pure parts: the catalog shape (plans.yaml as JSON), money in rupees <-> paise, and mapping the server's errors to fields. */

export const LIMIT_KEYS = [
  'messages_per_day', 'best_per_day', 'branches_per_tree', 'messages_per_conversation', 'memory_facts', 'context_tokens',
  'documents_per_tree', 'file_size_mb', 'youtube_per_month', 'storage_mb', 'custom_modes', 'mode_instruction_chars',
  'think_longer_per_day',
] as const
export type LimitKey = (typeof LIMIT_KEYS)[number]

export const LIMIT_LABELS: Record<LimitKey, string> = {
  messages_per_day: 'Messages per day',
  best_per_day: 'Advanced answers every day',
  branches_per_tree: 'Branches per tree',
  messages_per_conversation: 'Messages per conversation',
  memory_facts: 'Memory facts',
  context_tokens: 'Context (tokens read per answer)',
  documents_per_tree: 'Documents per tree',
  file_size_mb: 'File size per upload (MB)',
  youtube_per_month: 'YouTube videos per month',
  storage_mb: 'Total storage (MB)',
  custom_modes: 'Custom modes',
  mode_instruction_chars: 'Instruction length (characters)',
  think_longer_per_day: 'Think longer answers per day',
}

export const GROUPS = ['fast', 'smart', 'best', 'ultra'] as const
export const UNLIMITED = -1

export interface CatalogPlan {
  code: string
  rank: number
  default_group: string
  org_only?: boolean
  models: { groups: string[]; extra?: string[] }
  prices?: { month?: number; year?: number }
  limits?: Record<string, number>
  variants?: Record<string, unknown>
  [k: string]: unknown
}
export interface CatalogPayg extends CatalogPlan {
  unit_prices: Record<string, number>
  storage_over_10gb_per_gb_month: number
  long_message_tokens: number
  no_credit_fast_per_day: number
  max_messages_per_minute: number
  topup_packs: Array<{ code: string; price: number }>
  org_min_topup: number
  credit_validity_months: number
}
export interface CatalogModelItem { id: string; label: string; provider: string }
export interface Catalog {
  catalog_version: string
  currency: string
  gst_inclusive: boolean
  model_groups: Record<string, CatalogModelItem[]>
  base_limits: Record<string, number>
  plans: Array<CatalogPlan | CatalogPayg>
}

export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** "599" or "599.50" (rupees, at most two decimals) -> paise; null when it is not an amount. */
export function toPaise(rupees: string): number | null {
  const t = rupees.trim()
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null
  return Math.round(Number(t) * 100)
}
/** paise -> rupees text without trailing zeros ("599", "0.2", "499.5"). */
export function fromPaise(paise: number | undefined | null): string {
  if (paise == null) return ''
  const r = (paise / 100).toFixed(2)
  return r.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

/** A proposed catalog_version: today's date, or today's date with a suffix when that is already the version. */
export function nextVersion(current: string, now = new Date()): string {
  const day = now.toISOString().slice(0, 10)
  if (current !== day && !current.startsWith(`${day}.`)) return day
  const n = Number(current.split('.')[1] ?? '0') + 1
  return `${day}.${n}`
}

export function setLimit(plan: { limits?: Record<string, number> }, key: string, value: number) {
  plan.limits = { ...(plan.limits ?? {}), [key]: value }
}

/** Server error strings ("plan 'pro': limit 'x' ...", "model_groups: ...") for one scope, optionally one field. */
export function errorsFor(errors: string[], scope: string, field?: string): string[] {
  const prefix = scope === 'model_groups' ? 'model_groups' : scope === 'catalog' ? '' : `plan '${scope}'`
  return errors.filter((e) => {
    if (scope === 'catalog') return !e.startsWith("plan '") && !e.startsWith('model_groups')
    if (!e.startsWith(prefix)) return false
    if (!field) return true
    return e.includes(`'${field}'`) || e.includes(`.${field}`) || e.includes(`${field} `)
  })
}
