import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Alert, Button, Logo, Skeleton } from '@/components/ui/primitives'
import { CheckoutDialog, changeDirection, type CheckoutKind } from '@/features/billing/CheckoutDialog'
import { useBillingMe, usePlans } from '@/features/billing/hooks'
import { errorMessage } from '@/lib/errors'
import { formatLimit, formatPaise } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useRestoreSession } from '@/app/router'
import type { BillingInterval, PlanEntry, PlanLimits } from '@/types/billing'

const LIMIT_ROWS: Array<[keyof PlanLimits, string]> = [
  ['messages_per_day', 'Messages per day'],
  ['best_per_day', 'Best-model messages per day'],
  ['messages_per_conversation', 'Messages per conversation'],
  ['context_tokens', 'Context window (tokens)'],
  ['memory_facts', 'Saved memory facts'],
  ['documents_per_tree', 'Documents per conversation tree'],
  ['file_size_mb', 'Largest file (MB)'],
  ['storage_mb', 'Storage (MB)'],
  ['youtube_per_month', 'YouTube transcripts per month'],
  ['branches_per_tree', 'Branches per tree'],
  ['custom_modes', 'Custom modes'],
  ['mode_instruction_chars', 'Custom mode instruction length'],
]

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const limitText = (key: keyof PlanLimits, v: number) => (key === 'best_per_day' && v === 0 ? 'Not included' : formatLimit(v))

/** Public: reachable signed in and signed out. Prices are GST-inclusive INR from /billing/plans. */
export function PricingPage() {
  const status = useRestoreSession()
  const navigate = useNavigate()
  const plans = usePlans()
  const signedIn = status === 'authenticated'
  const me = useBillingMe().data
  const [interval, setInterval] = useState<BillingInterval>('month')
  const [checkout, setCheckout] = useState<{ kind: CheckoutKind; plan: PlanEntry } | null>(null)

  const list = [...(plans.data?.plans ?? [])].sort((a, b) => a.rank - b.rank)
  const current = signedIn ? me?.plan.code : undefined
  const currentInterval = me?.plan.interval ?? null

  const choose = (plan: PlanEntry) => {
    if (!signedIn) return navigate('/signup', { state: { from: '/pricing' } })
    const paid = !!me && me.plan.code !== 'free' && me.status !== 'free'
    setCheckout({ kind: paid ? 'change' : 'subscribe', plan })
  }

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link to="/" aria-label="GranthanAI home"><Logo /></Link>
        <nav className="flex items-center gap-3 text-sm">
          {signedIn ? (
            <>
              <Link to="/" className="hover:underline">Back to chat</Link>
              <Link to="/settings/billing" className="hover:underline">Billing</Link>
            </>
          ) : status === 'anonymous' ? (
            <Link to="/login" state={{ from: '/pricing' }} className="hover:underline">Sign in</Link>
          ) : null}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-16">
        <h1 className="text-3xl font-semibold tracking-tight">Plans and pricing</h1>
        <p className="mt-2 text-sm text-ink-2">All prices are in Indian rupees and include GST.</p>

        <div role="radiogroup" aria-label="Billing period" className="mt-6 inline-flex rounded-lg border border-line bg-surface p-0.5 text-sm">
          {(['month', 'year'] as const).map((i) => (
            <button
              key={i}
              role="radio"
              aria-checked={interval === i}
              onClick={() => setInterval(i)}
              className={cn('rounded-md px-3.5 py-1.5 font-medium', interval === i ? 'bg-raised shadow-sm' : 'text-ink-2 hover:text-ink')}
            >
              {i === 'month' ? 'Monthly' : 'Yearly'}
            </button>
          ))}
        </div>

        {plans.isPending ? (
          <div className="mt-8 grid gap-4 md:grid-cols-3" aria-busy aria-label="Loading plans">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-96 w-full" />)}
          </div>
        ) : plans.isError ? (
          <Alert tone="error" className="mt-8" action={<Button size="sm" onClick={() => void plans.refetch()}>Try again</Button>}>
            Could not load plans. {errorMessage(plans.error)}
          </Alert>
        ) : (
          <ul className="mt-8 grid gap-4 md:grid-cols-3">
            {list.map((plan) => {
              const price = plan.prices[interval]
              const isFree = price == null
              const isCurrent = current === plan.code && (isFree || currentInterval === interval)
              const onThisPlan = current === plan.code
              const label = !signedIn || current === 'free' || !current
                ? 'Upgrade'
                : changeDirection(plans.data, current, currentInterval, plan, interval) === 'upgrade' ? 'Upgrade' : 'Downgrade'
              return (
                <li key={plan.code} data-plan={plan.code} className={cn('flex flex-col rounded-2xl border bg-raised p-5', onThisPlan ? 'border-accent ring-1 ring-accent/30' : 'border-line')}>
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">{cap(plan.code)}</h2>
                    {onThisPlan && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-ink">Current plan</span>}
                  </div>
                  <p className="mt-3 text-3xl font-semibold">
                    {isFree ? '₹0' : formatPaise(price)}
                    {!isFree && <span className="text-sm font-normal text-ink-3"> / {interval === 'year' ? 'year' : 'month'}</span>}
                  </p>
                  <p className="text-xs text-ink-3">{isFree ? 'Free forever' : 'Includes GST'}</p>

                  <div className="mt-4">
                    {isFree ? null : (
                      <Button
                        variant={isCurrent ? 'secondary' : 'primary'}
                        className="w-full"
                        disabled={isCurrent}
                        onClick={() => choose(plan)}
                        aria-label={isCurrent ? `${cap(plan.code)}: current plan` : `${label} to ${cap(plan.code)}`}
                      >
                        {isCurrent ? 'Current plan' : label}
                      </Button>
                    )}
                  </div>

                  <ul className="mt-5 space-y-1.5 text-sm" aria-label={`${cap(plan.code)} limits`}>
                    <li className="flex gap-2 text-ink-2"><Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />{plan.groups.map(cap).join(', ')} models</li>
                    {LIMIT_ROWS.map(([key, text]) => (
                      <li key={key} className="flex justify-between gap-3 border-t border-line/60 pt-1.5 text-ink-2">
                        <span>{text}</span>
                        <span className="font-medium text-ink">{limitText(key, plan.limits[key])}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>
        )}
      </main>

      {checkout && <CheckoutDialog kind={checkout.kind} plan={checkout.plan} interval={interval} onClose={() => setCheckout(null)} />}
    </div>
  )
}
