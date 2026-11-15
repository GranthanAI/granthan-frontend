import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Logo, Skeleton } from '@/components/ui/primitives'
import { CheckoutDialog, changeDirection, type CheckoutKind } from '@/features/billing/CheckoutDialog'
import { useBillingMe, usePlans, useWallet } from '@/features/billing/hooks'
import { TopupDialog } from '@/features/billing/TopupDialog'
import { errorMessage } from '@/lib/errors'
import { formatPaise } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useRestoreSession } from '@/app/router'
import type { BillingInterval, PlanEntry } from '@/types/billing'
import { buildRows } from '@/features/billing/planTable'
import { PAYG_COPY, WORDS, planCopy } from '@/content/plans'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Public: reachable signed in and signed out. Prices are GST-inclusive INR from /billing/plans. */
export function PricingPage() {
  const status = useRestoreSession()
  const navigate = useNavigate()
  const plans = usePlans()
  const signedIn = status === 'authenticated'
  const me = useBillingMe().data
  const [interval, setInterval] = useState<BillingInterval>('month')
  const [checkout, setCheckout] = useState<{ kind: CheckoutKind; plan: PlanEntry } | null>(null)

  // Free, Pro, Max by rank; Pay as you Go (rank 0: credits never outrank a plan) always last
  const order = (p: PlanEntry) => (p.code === 'payg' ? 1000 : p.rank)
  const wallet = useWallet()
  // Pay as you Go shows only when the plans list it AND (signed in) the wallet routes answer; a 404 means it is off
  const list = [...(plans.data?.plans ?? [])].filter((p) => p.code !== 'payg' || !signedIn || wallet.enabled).sort((a, b) => order(a) - order(b))
  const [topup, setTopup] = useState(false)
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
                    {plan.code === 'payg' ? WORDS.paygPrice : isFree ? '₹0' : formatPaise(price!)}
                    {!isFree && <span className="text-sm font-normal text-ink-3"> / {interval === 'year' ? 'year' : 'month'}</span>}
                  </p>
                  <p className="text-xs text-ink-3">{plan.code === 'payg' ? 'Top up credits, spend them as you go' : isFree ? 'Free forever' : 'Includes GST'}</p>

                  {plan.code === 'payg' && plan.payg && (
                    <div className="mt-3 space-y-2 text-sm text-ink-2" data-testid="payg-card">
                      <p>{PAYG_COPY.how}</p>
                      <ul className="space-y-1" aria-label="Credit packs">
                        {plan.payg.topup_packs.map((k) => <li key={k.code} className="flex justify-between"><span>Pack</span><span className="font-medium text-ink">{formatPaise(k.price_paise)} <span className="text-xs font-normal text-ink-3">incl. GST</span></span></li>)}
                      </ul>
                      <p>{PAYG_COPY.ultra} {PAYG_COPY.validity(plan.payg.credit_validity_months)}</p>
                      <Button variant="primary" className="w-full" onClick={() => (signedIn ? setTopup(true) : navigate('/signup', { state: { from: '/pricing' } }))}>{PAYG_COPY.topUp}</Button>
                    </div>
                  )}

                  <div className="mt-4">
                    {isFree || plan.code === 'payg' ? null : (
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

                  <p className="mt-4 text-sm text-ink-2">{planCopy(plan.code).bestFor}</p>
                </li>
              )
            })}
          </ul>
        )}

        {plans.data && <ComparisonTable plans={list} />}
      </main>

      {topup && <TopupDialog onClose={() => setTopup(false)} />}
      {checkout && <CheckoutDialog kind={checkout.kind} plan={checkout.plan} interval={interval} onClose={() => setCheckout(null)} />}
    </div>
  )
}

/** Every row of the plan sheet. The Pay as you Go column is there only when the API lists that plan. */
function ComparisonTable({ plans }: { plans: PlanEntry[] }) {
  const rows = buildRows(plans)
  return (
    <section className="mt-10" aria-labelledby="compare-title">
      <h2 id="compare-title" className="text-xl font-semibold">Compare plans</h2>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-raised">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-4 py-3 font-medium text-ink-3"><span className="sr-only">Feature</span></th>
              {plans.map((p) => <th key={p.code} scope="col" className="px-4 py-3 font-semibold">{planCopy(p.code).name}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-row={r.key} className="border-b border-line/60 last:border-0">
                <th scope="row" className="px-4 py-2.5 font-normal text-ink-2">{r.label}</th>
                {plans.map((p) => <td key={p.code} data-plan={p.code} className="px-4 py-2.5 font-medium text-ink">{r.cells[p.code]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
