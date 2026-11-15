import { useBillingMe, useMyModels } from '@/features/billing/hooks'
import { formatIstTime, formatLimit } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Calm by default; amber only when under 10% is left (never red). */
export type MeterLevel = 'ok' | 'low'
export const meterLevel = (used: number, limit: number): MeterLevel =>
  limit > 0 && (limit - used) / limit < 0.1 ? 'low' : 'ok'

/** "41 messages left today · refreshes at 12:00 am", plus the Advanced answers left. Hidden when unlimited or unknown. */
export function UsageMeter() {
  const me = useBillingMe().data
  const models = useMyModels().data
  if (!me?.limits || !me.usage_today) return null
  const limit = me.limits.messages_per_day
  if (typeof limit !== 'number' || limit < 0) return null
  const used = me.usage_today.total
  const left = Math.max(0, limit - used)
  const level = meterLevel(used, limit)
  const best = models?.groups.find((g) => g.group === 'best')
  const bestLine = best?.allowed && best.daily_limit > 0 ? `${formatLimit(best.remaining_today)} Advanced left` : null
  return (
    <span data-testid="usage-meter" data-level={level} className={cn('text-xs', level === 'low' ? 'font-medium text-warn' : 'text-ink-3')}>
      {left === 0 ? 'No messages left today' : `${formatLimit(left)} ${left === 1 ? 'message' : 'messages'} left today`} · refreshes at {formatIstTime(me.usage_today.resets_at)}
      {bestLine && <> · {bestLine}</>}
    </span>
  )
}
