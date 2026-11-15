import { PLAN_COPY, ROW_LABELS, WORDS, YES_ROWS, planCopy } from '@/content/plans'
import { formatLimit, formatPaise } from '@/lib/format'
import type { PlanEntry } from '@/types/billing'

export interface TableRow {
  key: string
  label: string
  /** plan code -> text */
  cells: Record<string, string>
  /** a "Yes for every plan" row */
  yes?: boolean
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const rupees = (paise: number) => formatPaise(paise)

function reading(n: number): string {
  if (n === -1) return WORDS.fullWindow
  return `${Math.round(n / 1000)}k tokens`
}
function size(mb: number): string {
  if (mb === -1) return WORDS.unlimited
  return mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : `${formatLimit(mb)} MB`
}

/**
 * The comparison table: every row of the plan sheet, in order. Numbers come from the API's plans (limits, prices, payg unit
 * prices); only the labels and the yes/no rows come from content/plans.ts. -1 reads "Unlimited".
 */
export function buildRows(plans: PlanEntry[]): TableRow[] {
  const by = (fn: (p: PlanEntry) => string): Record<string, string> => Object.fromEntries(plans.map((p) => [p.code, fn(p)]))
  const L = (p: PlanEntry) => p.limits
  const unit = (p: PlanEntry, key: string) => p.payg?.unit_prices[key]
  const each = (p: PlanEntry, key: string, base: string) => (unit(p, key) != null ? `${base} (${rupees(unit(p, key)!)} each)` : base)
  const rows: TableRow[] = [
    { key: 'bestFor', label: ROW_LABELS.bestFor, cells: by((p) => planCopy(p.code).bestFor) },
    {
      key: 'priceMonth', label: ROW_LABELS.priceMonth,
      cells: by((p) => (p.code === 'payg' ? WORDS.paygPrice : p.prices.month != null ? rupees(p.prices.month) : '₹0')),
    },
    { key: 'priceYear', label: ROW_LABELS.priceYear, cells: by((p) => (p.prices.year != null ? rupees(p.prices.year) : WORDS.no)) },
    { key: 'models', label: ROW_LABELS.models, cells: by((p) => p.groups.map(cap).join(', ')) },
    { key: 'messagesPerDay', label: ROW_LABELS.messagesPerDay, cells: by((p) => formatLimit(L(p).messages_per_day)) },
    {
      key: 'bestPerDay', label: ROW_LABELS.bestPerDay,
      cells: by((p) => {
        const n = L(p).best_per_day
        return n === 0 ? WORDS.notIncluded : n === -1 ? WORDS.unlimited : WORDS.bestThenSmart(formatLimit(n))
      }),
    },
    { key: 'ultra', label: ROW_LABELS.ultra, cells: by((p) => (p.groups.includes('ultra') ? WORDS.yes : WORDS.no)) },
    { key: 'branches', label: ROW_LABELS.branches, cells: by((p) => formatLimit(L(p).branches_per_tree)) },
    { key: 'messagesPerConversation', label: ROW_LABELS.messagesPerConversation, cells: by((p) => formatLimit(L(p).messages_per_conversation)) },
    { key: 'memoryFacts', label: ROW_LABELS.memoryFacts, cells: by((p) => formatLimit(L(p).memory_facts)) },
    { key: 'reading', label: ROW_LABELS.reading, cells: by((p) => reading(L(p).context_tokens)) },
    { key: 'documents', label: ROW_LABELS.documents, cells: by((p) => formatLimit(L(p).documents_per_tree)) },
    { key: 'fileSize', label: ROW_LABELS.fileSize, cells: by((p) => size(L(p).file_size_mb)) },
    {
      key: 'youtube', label: ROW_LABELS.youtube,
      cells: by((p) => (L(p).youtube_per_month === -1 ? each(p, 'youtube_video', WORDS.unlimited) : formatLimit(L(p).youtube_per_month))),
    },
    {
      key: 'storage', label: ROW_LABELS.storage,
      cells: by((p) => {
        const mb = L(p).storage_mb
        if (mb !== -1) return size(mb)
        const over = p.payg?.storage_over_10gb_per_gb_month
        return over != null ? `${WORDS.unlimited} (${rupees(over)}/GB/month above 10 GB)` : WORDS.unlimited
      }),
    },
    { key: 'customModes', label: ROW_LABELS.customModes, cells: by((p) => formatLimit(L(p).custom_modes)) },
    { key: 'instructionLength', label: ROW_LABELS.instructionLength, cells: by((p) => `${formatLimit(L(p).mode_instruction_chars)} characters`) },
  ]
  for (const y of YES_ROWS) rows.push({ key: y.label, label: y.detail ? `${y.label} (${y.detail})` : y.label, cells: by(() => WORDS.yes), yes: true })
  rows.push({ key: 'manim', label: ROW_LABELS.manim, cells: by((p) => each(p, 'manim_video', WORDS.unlimited)), yes: true })
  rows.push({ key: 'deepResearch', label: ROW_LABELS.deepResearch, cells: by(() => WORDS.notYet) })
  rows.push({ key: 'support', label: ROW_LABELS.support, cells: by((p) => planCopy(p.code).support) })
  return rows
}

export const knownPlanOrder = Object.keys(PLAN_COPY)
