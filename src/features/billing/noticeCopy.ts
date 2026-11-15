import { GENERIC_NOTICE, REASON_FALLBACK, REASON_KEYS, limitCopy, planCopy } from '@/content/plans'
import { formatIstDay, formatIstTime, formatLimit, formatMb } from '@/lib/format'
import type { BillingDenied, BillingMe, CatalogModel, MyModelsResponse, PlanEntry } from '@/types/billing'
import { joinNames, nextPlanUp, planNames, plansIncluding } from './includedModels'

export interface NoticeContext {
  me?: BillingMe
  plans?: PlanEntry[]
  models?: MyModelsResponse
  catalog?: CatalogModel[]
}

export interface ResolvedNotice {
  message: string
  /** a soft second line (what the next plan includes), only when it can be written from the API's numbers */
  soft?: string
  /** offer "See plans": a bigger plan exists */
  seePlans: boolean
}

type Vars = Record<string, string | undefined>

/** Fills {placeholders}; null when one cannot be filled (we never print a made-up number). */
export function fill(template: string, vars: Vars): string | null {
  let missing = false
  const out = template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k]
    if (v === undefined || v === '') missing = true
    return v ?? ''
  })
  return missing ? null : out
}

const modelLabel = (id: string | undefined, ctx: NoticeContext): string | undefined => {
  if (!id) return undefined
  return ctx.catalog?.find((m) => m.id === id)?.label ?? ctx.models?.groups.flatMap((g) => g.models).find((m) => m.id === id)?.label
}

/**
 * The key a denial is worded by: billing's message_key when we have words for it, a plan_limit's own `limit`, else (only
 * when the service sent no message of its own) the one its reason maps to. '' = show the service's own message.
 */
export function noticeKey(d: BillingDenied): string {
  if (d.message_key && limitCopy(d.message_key)) return d.message_key
  if (d.reason === 'plan_limit' && d.limit && limitCopy(`limit.${d.limit}`)) return `limit.${d.limit}`
  if (!d.message) return REASON_KEYS[d.reason] ?? ''
  return ''
}

/** Everything a notice says, from our words and the API's numbers. Falls back to the service's own (equally plain) message. */
export function resolveNotice(d: BillingDenied, ctx: NoticeContext): ResolvedNotice {
  const key = noticeKey(d)
  const copy = limitCopy(key)
  const next = nextPlanUp(ctx.plans, ctx.me?.plan.code)
  const bigger = !!d.upgrade_to || !!next
  const fallback = d.message || REASON_FALLBACK[d.reason] || GENERIC_NOTICE
  if (!copy) return { message: fallback, seePlans: bigger }

  const limits = ctx.me?.limits
  const name = key.startsWith('limit.') ? key.slice('limit.'.length) : ''
  const own = limits && name in limits ? (limits as unknown as Record<string, number>)[name] : undefined
  const best = ctx.models?.groups.find((g) => g.group === 'best')
  const reset = d.resets_at ?? ctx.me?.usage_today.resets_at ?? ctx.models?.messages.resets_at
  const requested = d.model
  const including = plansIncluding(ctx.plans, { id: requested ?? '', label: '', provider: '', group: ctx.catalog?.find((m) => m.id === requested)?.group ?? '', sort_order: 0 })
  const vars: Vars = {
    limit: key === 'limit.daily' ? num(limits?.messages_per_day) : num(own ?? undefined),
    size: own !== undefined && own !== null ? formatMb(own) : undefined,
    time: formatIstTime(reset) || undefined,
    date: formatIstDay(reset) || undefined,
    what: d.reason === 'monthly_limit' || key === 'limit.monthly' ? 'YouTube videos' : undefined,
    n: best && best.daily_limit > 0 ? formatLimit(best.daily_limit) : pos(limits?.best_per_day),
    model: modelLabel(requested, ctx),
    plans: requested && including.length ? joinNames(planNames(including)) : undefined,
    fast: ctx.plans?.find((p) => p.code === 'payg')?.payg ? String(ctx.plans.find((p) => p.code === 'payg')!.payg!.no_credit_fast_per_day) : undefined,
  }
  const base = fill(copy.message, vars)
  if (base === null) return { message: fallback, seePlans: copy.upgrade !== false && bigger }

  const wantsPlans = copy.upgrade !== false && bigger
  const message = copy.fix ? `${base} ${copy.fix}${wantsPlans ? ', or see plans for more.' : '.'}` : base
  let soft: string | undefined
  if (copy.soft && next && key === 'limit.daily') {
    soft = fill(copy.soft, { plan: planCopy(next.code).name, planLimit: num(next.limits.messages_per_day) }) ?? undefined
  }
  return { message, soft, seePlans: wantsPlans }
}

const pos = (n: number | undefined | null): string | undefined => (typeof n === 'number' && n > 0 ? formatLimit(n) : undefined)
const num = (n: number | undefined | null): string | undefined => (typeof n === 'number' && n >= 0 ? formatLimit(n) : undefined)

/** The text under the answer when an Advanced request was served by a Smart model. */
export function bestSwitchedText(ctx: NoticeContext & { answeredBy?: string }): string | null {
  const copy = limitCopy('limit.best_switched')
  if (!copy) return null
  const best = ctx.models?.groups.find((g) => g.group === 'best')
  const n = best && best.daily_limit > 0 ? formatLimit(best.daily_limit) : pos(ctx.me?.limits.best_per_day)
  return fill(copy.message, {
    n,
    model: modelLabel(ctx.answeredBy, ctx) ?? ctx.answeredBy,
    time: formatIstTime(ctx.models?.messages.resets_at ?? ctx.me?.usage_today.resets_at) || undefined,
  })
}
