import { useBillingMe, useMyModels } from '@/features/billing/hooks'
import { formatIstTime } from '@/lib/format'
import { cn } from '@/lib/utils'

export type MeterLevel = 'ok' | 'warn' | 'full'
export const meterLevel = (used: number, limit: number): MeterLevel =>
  limit > 0 && used >= limit ? 'full' : limit > 0 && used / limit >= 0.8 ? 'warn' : 'ok'

/** "31 of 80 messages today · resets 12:00 am", plus Best remaining. Amber from 80%, red at 100%. Hidden when unlimited or unknown. */
export function UsageMeter() {
  const me = useBillingMe().data
  const models = useMyModels().data
  if (!me?.limits || !me.usage_today) return null
  const limit = me.limits.messages_per_day
  if (typeof limit !== 'number' || limit < 0) return null
  const used = me.usage_today.total
  const level = meterLevel(used, limit)
  const best = models?.groups.find((g) => g.group === 'best')
  const bestLine = best?.allowed && best.daily_limit > 0 ? `${best.remaining_today} Best left today` : null
  return (
    <span
      data-testid="usage-meter"
      data-level={level}
      className={cn('text-xs', level === 'full' ? 'font-medium text-danger' : level === 'warn' ? 'font-medium text-warn' : 'text-ink-3')}
    >
      {used} of {limit} messages today · resets {formatIstTime(me.usage_today.resets_at)}
      {bestLine && <> · {bestLine}</>}
    </span>
  )
}
