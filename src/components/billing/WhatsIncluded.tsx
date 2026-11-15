import { GROUP_DESCRIPTIONS, WORDS, groupLabel } from '@/content/plans'
import { useBillingMe, useModelCatalog, usePlans } from '@/features/billing/hooks'
import { includedByGroup, includedLine } from '@/features/billing/includedModels'
import { formatLimit } from '@/lib/format'

/**
 * "What's included" for the plan you are on: the models by group with their real names, and the daily allowances. All of it
 * from /billing/plans, /billing/models and /billing/me. `credits` adds the Ultra line (what credits add on top of a plan).
 */
export function WhatsIncluded({ credits }: { credits?: boolean }) {
  const me = useBillingMe().data
  const rawPlans = usePlans().data?.plans
  const catalog = useModelCatalog().data?.models
  const plan = Array.isArray(rawPlans) ? rawPlans.find((p) => p.code === me?.plan.code) : undefined
  if (!plan || !Array.isArray(catalog)) return null
  const groups = includedByGroup(plan, catalog).filter((g) => g.group !== 'ultra')
  const ultra = catalog.filter((m) => m.group === 'ultra')
  const msgs = plan.limits.messages_per_day
  return (
    <div data-testid="whats-included" className="space-y-2 text-sm">
      <p className="text-ink-2">
        {msgs === -1 ? 'Unlimited messages every day' : `${formatLimit(msgs)} messages every day`}
        {plan.limits.best_per_day > 0 && `, of which up to ${formatLimit(plan.limits.best_per_day)} Advanced`}
        {plan.limits.best_per_day > 0 && '. After that, answers continue on Smart.'}
      </p>
      <ul className="space-y-1" aria-label="Models included">
        {groups.map((g) => (
          <li key={g.group} title={GROUP_DESCRIPTIONS[g.group]}>{includedLine(g)}</li>
        ))}
        {(credits || plan.groups.includes('ultra')) && ultra.length > 0 && (
          <li title={GROUP_DESCRIPTIONS.ultra}>{groupLabel('ultra')}: {ultra.map((m) => m.label).join(', ')} · {WORDS.withCredits.toLowerCase()}</li>
        )}
      </ul>
    </div>
  )
}
