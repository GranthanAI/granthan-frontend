import { Link, useInRouterContext } from 'react-router-dom'
import { useBillingMe, useWallet } from '@/features/billing/hooks'
import { NOTICE_ACTIONS } from '@/content/plans'
import { expiringSoon } from '@/components/settings/CreditsSettings'
import { supportEmail } from '@/lib/config'
import { formatIstDate, formatPaise } from '@/lib/format'
import type { BillingMe } from '@/types/billing'

const btn = 'inline-flex h-6 items-center rounded-md border border-current/30 px-2 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10'

function A({ to, href, children }: { to?: string; href?: string; children: React.ReactNode }) {
  const inRouter = useInRouterContext()
  if (to) return inRouter ? <Link to={to} className={btn}>{children}</Link> : <a href={to} className={btn}>{children}</a>
  return <a href={href} className={btn} {...(href?.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>
}

interface Banner {
  id: string
  tone: 'info' | 'warn' | 'danger'
  text: string
  action?: React.ReactNode
}

const planLabel = (me: BillingMe) => me.plan.code.charAt(0).toUpperCase() + me.plan.code.slice(1)

/** The app-wide banners that depend on the account: simulated payments, failed payment, suspension, scheduled cancellation. */
export function bannersFor(me: BillingMe): Banner[] {
  const out: Banner[] = []
  if (me.payment_mode === 'simulated') out.push({ id: 'simulated', tone: 'info', text: 'Payments are simulated — no real money' })
  if (me.status === 'past_due')
    out.push({
      id: 'past_due',
      tone: 'danger',
      text: `Payment failed. Pay now to keep ${planLabel(me)}.`,
      action: me.payment_action_url ? <A href={me.payment_action_url}>Pay now</A> : <A to="/settings/billing">Pay now</A>,
    })
  if (me.status === 'suspended')
    out.push({
      id: 'suspended',
      tone: 'danger',
      text: `Your ${planLabel(me)} plan is suspended because the payment could not be collected.`,
      action: supportEmail() ? <A href={`mailto:${supportEmail()}`}>Contact support</A> : undefined,
    })
  if (me.status === 'cancelling' || me.cancel_at_period_end)
    out.push({
      id: 'cancelling',
      tone: 'warn',
      text: `${planLabel(me)} ends on ${formatIstDate(me.current_period_end)}`,
      action: <A to="/settings/billing">Resume</A>,
    })
  return out
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Credits that expire within 7 days (`now` is passed in so tests do not depend on the clock). */
export function creditsBanner(wallet: Parameters<typeof expiringSoon>[0], now = Date.now()): Banner | null {
  const soon = expiringSoon(wallet)
  if (!soon) return null
  const ms = new Date(soon.at).getTime() - now
  if (ms > WEEK_MS || ms < 0) return null
  return { id: 'credits_expiring', tone: 'warn', text: `${formatPaise(soon.amount)} of your credits expire on ${formatIstDate(soon.at)}`, action: <A to="/settings/billing">{NOTICE_ACTIONS.topUp}</A> }
}

const TONE = {
  info: 'bg-accent-soft text-ink',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
} as const

export function BillingBanners() {
  const me = useBillingMe().data
  const wallet = useWallet()
  if (!me?.plan) return null
  const banners = [...bannersFor(me), ...(wallet.enabled ? [creditsBanner(wallet.wallet)].filter((x): x is Banner => !!x) : [])]
  if (!banners.length) return null
  return (
    <div data-testid="billing-banners">
      {banners.map((b) => (
        <div key={b.id} role={b.tone === 'danger' ? 'alert' : 'status'} data-banner={b.id} className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-3 py-1.5 text-xs ${TONE[b.tone]}`}>
          <span>{b.text}</span>
          {b.action}
        </div>
      ))}
    </div>
  )
}
