import { AlertCircle, Info, X } from 'lucide-react'
import { Link, useInRouterContext } from 'react-router-dom'
import { NOTICE_ACTIONS, SPEND_CAP_NOTICE, limitCopy } from '@/content/plans'
import { useBillingMe, usePlans, useWallet } from '@/features/billing/hooks'
import { supportEmail } from '@/lib/config'
import { formatIstTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useBillingNoticeStore } from '@/stores/billing-notice.store'
import type { BillingDenied, StreamNotice } from '@/types/billing'

const actionCls = 'inline-flex h-7 items-center rounded-md border border-current/30 px-2.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10'

function Action({ to, href, children }: { to?: string; href?: string; children: React.ReactNode }) {
  const inRouter = useInRouterContext()
  if (to) return inRouter ? <Link to={to} className={actionCls}>{children}</Link> : <a href={to} className={actionCls}>{children}</a>
  return <a href={href} className={actionCls} {...(href?.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>
}

const FALLBACK: Record<string, string> = {
  daily_limit: "You've reached today's message limit for your plan.",
  monthly_limit: "You've reached this month's limit for your plan.",
  model_not_in_plan: "That model isn't included in your plan.",
  account_blocked: 'Your account is blocked from using this feature right now.',
  no_credit: "You're out of credits.",
  spend_cap: "You've reached your spending cap.",
  member_spend_cap: "You've reached your spending cap for this workspace.",
  billing_unavailable: 'Billing is temporarily unavailable. Please try again in a moment.',
  plan_limit: 'This limit for your plan has been reached. Upgrade to add more.',
}

/** Which actions each reason offers (plan 4.6). `resets` shows "Resets at <IST time>" when billing gave a time. */
export function noticeActions(d: BillingDenied, payUrl: string | null | undefined) {
  const copy = limitCopy(d.message_key)
  const upgrade = copy?.upgrade ?? ['daily_limit', 'monthly_limit', 'model_not_in_plan', 'plan_limit', 'no_credit'].includes(d.reason)
  return {
    upgrade,
    resets: (copy?.resets ?? ['daily_limit', 'monthly_limit', 'rate_limit'].includes(d.reason)) && !!d.resets_at,
    payNow: !!payUrl && (d.reason === 'account_blocked' || d.reason === 'no_credit'),
    support: ['account_blocked', 'spend_cap', 'member_spend_cap', 'billing_unavailable'].includes(d.reason),
  }
}

/** An inline banner (never a toast) explaining why a request was refused, with the actions that help. */
export function BillingNotice({ denial, onDismiss }: { denial: BillingDenied; onDismiss?: () => void }) {
  const me = useBillingMe().data
  const a = noticeActions(denial, me?.payment_action_url)
  const credits = useWallet().enabled // Pay as you Go is on: credits can be topped up and the cap raised
  const copy = limitCopy(denial.message_key)
  const plans = usePlans().data?.plans
  const payg = Array.isArray(plans) ? plans.find((p) => p.code === 'payg')?.payg : undefined
  // our words for a known message_key; the API's own message for anything else
  const message = copy?.message ?? (denial.message || FALLBACK[denial.reason] || 'This request was not allowed on your plan.')
  // the numbers in a hint come from the API when it sends them (the 10 Fast messages a day)
  const hint = copy?.hint && denial.message_key === 'credits.empty' && payg ? `Fast models stay available for ${payg.no_credit_fast_per_day} messages a day` : copy?.hint
  return (
    <div role="alert" data-testid="billing-notice" data-reason={denial.reason} className="mb-2 flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p>{message}</p>
        {hint && <p className="opacity-90">{hint}</p>}
        {a.resets && <p className="font-medium">Resets at {formatIstTime(denial.resets_at)}</p>}
        {(a.upgrade || a.payNow || (a.support && !!supportEmail()) || (credits && ['no_credit', 'spend_cap'].includes(denial.reason))) && (
          <div className="flex flex-wrap gap-2">
            {credits && denial.reason === 'no_credit' && <Action to="/settings/billing">{NOTICE_ACTIONS.topUp}</Action>}
            {credits && denial.reason === 'spend_cap' && <Action to="/settings/billing">{NOTICE_ACTIONS.raiseCap}</Action>}
            {a.upgrade && <Action to="/pricing">Upgrade</Action>}
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

/** Quiet, dismissible usage notice from the response stream ("You've used 80% of today's messages"). */
export function quietMessage(n: StreamNotice): string {
  if (n.metric === 'spend_cap') return n.notice_key.endsWith('threshold_100') ? SPEND_CAP_NOTICE[100] : SPEND_CAP_NOTICE[80]
  const what = n.metric === 'best' ? "today's Best-model messages" : n.metric === 'youtube' ? "this month's video transcripts" : n.metric && n.metric !== 'messages' ? `your ${n.metric.replace(/_/g, ' ')} allowance` : "today's messages"
  if (n.notice_key.endsWith('threshold_100')) return `You've used all of ${what}.`
  const m = /threshold_(\d+)$/.exec(n.notice_key)
  if (m) return `You've used ${m[1]}% of ${what}.`
  return n.used != null && n.limit != null ? `You've used ${n.used} of ${n.limit} ${what}.` : `Usage notice: ${n.notice_key}`
}

export function QuietNotice({ notice, onDismiss }: { notice: StreamNotice; onDismiss: () => void }) {
  return (
    <div role="status" data-testid="quiet-notice" className={cn('mb-2 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-ink-2')}>
      <Info className="size-3.5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        {quietMessage(notice)}
        {notice.resets_at && <span className="text-ink-3"> Resets at {formatIstTime(notice.resets_at)}.</span>}
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
