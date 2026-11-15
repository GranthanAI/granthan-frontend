import { Info, X } from 'lucide-react'
import { Link, useInRouterContext } from 'react-router-dom'
import { NOTICE_ACTIONS, SPEND_CAP_NOTICE, limitCopy } from '@/content/plans'
import { useBillingMe, useModelCatalog, useMyModels, usePlans, useWallet } from '@/features/billing/hooks'
import { noticeKey, resolveNotice } from '@/features/billing/noticeCopy'
import { supportEmail } from '@/lib/config'
import { formatIstTime, formatLimit } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useBillingNoticeStore } from '@/stores/billing-notice.store'
import type { BillingDenied, StreamNotice } from '@/types/billing'

const actionCls = 'inline-flex h-7 items-center rounded-md border border-current/30 px-2.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10'

function Action({ to, href, children }: { to?: string; href?: string; children: React.ReactNode }) {
  const inRouter = useInRouterContext()
  if (to) return inRouter ? <Link to={to} className={actionCls}>{children}</Link> : <a href={to} className={actionCls}>{children}</a>
  return <a href={href} className={actionCls} {...(href?.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>
}

/** Which actions each reason offers (plan 4.6). */
export function noticeActions(d: BillingDenied, payUrl: string | null | undefined) {
  const copy = limitCopy(noticeKey(d))
  const upgrade = copy?.upgrade ?? ['daily_limit', 'monthly_limit', 'model_not_in_plan', 'plan_limit', 'no_credit'].includes(d.reason)
  return {
    upgrade,
    payNow: !!payUrl && (d.reason === 'account_blocked' || d.reason === 'no_credit'),
    support: ['account_blocked', 'spend_cap', 'member_spend_cap', 'billing_unavailable'].includes(d.reason),
  }
}

/** An inline banner (never a toast, never red) saying what is included and what is next, with the actions that help. */
export function BillingNotice({ denial, onDismiss }: { denial: BillingDenied; onDismiss?: () => void }) {
  const me = useBillingMe().data
  const a = noticeActions(denial, me?.payment_action_url)
  const credits = useWallet().enabled // Pay as you Go is on: credits can be topped up and the cap raised
  const plans = usePlans().data?.plans
  const models = useMyModels().data
  const catalog = useModelCatalog().data?.models
  const notice = resolveNotice(denial, { me, plans: Array.isArray(plans) ? plans : undefined, models, catalog })
  const seePlans = a.upgrade && notice.seePlans
  const calm = !['account_blocked', 'billing_unavailable'].includes(denial.reason)
  return (
    <div role="alert" data-testid="billing-notice" data-reason={denial.reason} className={cn('mb-2 flex items-start gap-2 rounded-lg px-3 py-2 text-xs', calm ? 'bg-surface-2 text-ink-2' : 'bg-warn-soft text-warn')}>
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p>{notice.message}</p>
        {notice.soft && <p className="opacity-90">{notice.soft}</p>}
        {(seePlans || a.payNow || (a.support && !!supportEmail()) || (credits && ['no_credit', 'spend_cap'].includes(denial.reason))) && (
          <div className="flex flex-wrap gap-2">
            {credits && denial.reason === 'no_credit' && <Action to="/settings/billing">{NOTICE_ACTIONS.topUp}</Action>}
            {credits && denial.reason === 'spend_cap' && <Action to="/settings/billing">{NOTICE_ACTIONS.raiseCap}</Action>}
            {seePlans && <Action to="/pricing">{NOTICE_ACTIONS.seePlans}</Action>}
            {a.payNow && <Action href={me?.payment_action_url ?? undefined}>Pay now</Action>}
            {a.support && supportEmail() && <Action href={`mailto:${supportEmail()}`}>Contact support</Action>}
          </div>
        )}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Dismiss notice" className="rounded p-0.5 hover:bg-black/5">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/** Quiet, dismissible usage notice from the response stream: what is LEFT ("12 messages left today"). */
export function quietMessage(n: StreamNotice): string {
  if (n.metric === 'spend_cap') return n.notice_key.endsWith('threshold_100') ? SPEND_CAP_NOTICE[100] : SPEND_CAP_NOTICE[80]
  const monthly = n.metric === 'youtube'
  const noun = n.metric === 'best' ? 'Advanced answers' : monthly ? 'videos' : n.metric && n.metric !== 'messages' ? `${n.metric.replace(/_/g, ' ')}` : 'messages'
  const period = monthly ? 'this month' : 'today'
  const left = n.used != null && n.limit != null ? Math.max(0, n.limit - n.used) : null
  if (n.notice_key.endsWith('threshold_100')) {
    return n.limit != null ? `That's all ${formatLimit(n.limit)} of ${period === 'today' ? "today's" : "this month's"} ${noun}.` : `${period === 'today' ? "Today's" : "This month's"} ${noun} are all used.`
  }
  if (left !== null) return `${formatLimit(left)} ${left === 1 ? noun.replace(/s$/, '') : noun} left ${period}.`
  const m = /threshold_(\d+)$/.exec(n.notice_key)
  if (m) return `About ${100 - Number(m[1])}% of ${period === 'today' ? "today's" : "this month's"} ${noun} are left.`
  return `Your ${noun} for ${period} are being counted.`
}

export function QuietNotice({ notice, onDismiss }: { notice: StreamNotice; onDismiss: () => void }) {
  return (
    <div role="status" data-testid="quiet-notice" className={cn('mb-2 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-ink-2')}>
      <Info className="size-3.5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        {quietMessage(notice)}
        {notice.resets_at && <span className="text-ink-3"> Refreshes at {formatIstTime(notice.resets_at)}.</span>}
      </p>
      <button onClick={onDismiss} aria-label="Dismiss usage notice" className="rounded p-0.5 hover:bg-black/5">
        <X className="size-3.5" />
      </button>
    </div>
  )
}

/** What the composer shows above its box: the refusal for this composer, else a quiet usage notice. */
export function ComposerNotices({ noticeKey }: { noticeKey: string }) {
  const denied = useBillingNoticeStore((s) => s.denied[noticeKey])
  const quiet = useBillingNoticeStore((s) => s.quiet[noticeKey])
  const dismissDenied = useBillingNoticeStore((s) => s.dismissDenied)
  const dismissQuiet = useBillingNoticeStore((s) => s.dismissQuiet)
  return (
    <>
      {denied && <BillingNotice denial={denied} onDismiss={() => dismissDenied(noticeKey)} />}
      {!denied && quiet && <QuietNotice notice={quiet} onDismiss={() => dismissQuiet(noticeKey)} />}
    </>
  )
}
