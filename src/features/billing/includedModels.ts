import { GROUP_ORDER, groupLabel, planCopy } from '@/content/plans'
import { formatLimit } from '@/lib/format'
import type { CatalogModel, PlanEntry } from '@/types/billing'

/** Every number and name here comes from /billing/plans and /billing/models; nothing is typed in. */

export interface IncludedGroup {
  group: string
  label: string
  models: CatalogModel[]
  /** the plan's daily allowance for this group when it has its own (Advanced): a number, or -1 for unlimited */
  perDay?: number
}

/** Does this plan include this model (its whole group, or the model as an extra)? */
export const planIncludes = (plan: PlanEntry, model: CatalogModel): boolean =>
  plan.groups.includes(model.group) || plan.extra_models.includes(model.id)

/** The models a plan includes, by group in display order. Empty groups are left out. */
export function includedByGroup(plan: PlanEntry, catalog: CatalogModel[]): IncludedGroup[] {
  const out: IncludedGroup[] = []
  for (const group of GROUP_ORDER) {
    const models = catalog.filter((m) => m.group === group && planIncludes(plan, m)).sort((a, b) => a.sort_order - b.sort_order)
    if (!models.length) continue
    const perDay = group === 'best' && plan.limits.best_per_day !== 0 ? plan.limits.best_per_day : undefined
    out.push({ group, label: groupLabel(group), models, perDay })
  }
  return out
}

/** "Advanced: Claude Sonnet 5.5, GPT-6.1 Sol, 5 every day" */
export function includedLine(g: IncludedGroup): string {
  const names = g.models.map((m) => m.label).join(', ')
  const allowance = g.perDay === undefined ? '' : g.perDay === -1 ? ', unlimited every day' : `, ${formatLimit(g.perDay)} every day`
  return `${g.label}: ${names}${allowance}`
}

/** The plans a person can subscribe to (Pay as you Go is credits, not a plan to move up to), lowest first. */
export const subscribablePlans = (plans: PlanEntry[] | undefined): PlanEntry[] =>
  (Array.isArray(plans) ? plans : []).filter((p) => p.code !== 'payg' && !p.code.startsWith('org_')).sort((a, b) => a.rank - b.rank)

/** The subscribable plans that include this model, lowest first. */
export const plansIncluding = (plans: PlanEntry[] | undefined, model: CatalogModel): PlanEntry[] =>
  subscribablePlans(plans).filter((p) => planIncludes(p, model))

/** The next plan up from the one you are on, or undefined on the top plan (or when plans are unknown). */
export function nextPlanUp(plans: PlanEntry[] | undefined, currentCode: string | undefined): PlanEntry | undefined {
  const list = subscribablePlans(plans)
  const current = list.find((p) => p.code === currentCode)
  if (!current) return undefined
  return list.find((p) => p.rank > current.rank)
}

/** "Pro and Max" / "Pro, Max and Team". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
export const planNames = (plans: PlanEntry[]): string[] => plans.map((p) => planCopy(p.code).name)
