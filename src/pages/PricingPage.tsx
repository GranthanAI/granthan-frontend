import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Minus, Sparkles } from 'lucide-react'
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
import { PAYG_COPY, POPULAR_PLAN, PRICING_COPY, ROW_LABELS, WORDS, planCopy } from '@/content/plans'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The rows each card shows as its highlights (the full list is in the comparison table). */
const HIGHLIGHTS: Array<[string, string]> = [
  ['messagesPerDay', ROW_LABELS.messagesPerDay],
  ['models', ROW_LABELS.models],
  ['memoryFacts', ROW_LABELS.memoryFacts],
  ['storage', ROW_LABELS.storage],
  ['support', ROW_LABELS.support],
]

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
  const cells = Object.fromEntries(buildRows(list).map((r) => [r.key, r.cells]))
  // "Save up to N%" for paying yearly, shown beside the toggle (display only; the prices themselves are the API's)
  const yearlySaving = Math.max(0, ...list.map((p) => (p.prices.month && p.prices.year ? Math.round((1 - p.prices.year / (12 * p.prices.month)) * 100) : 0)))

  const choose = (plan: PlanEntry) => {
    if (!signedIn) return navigate('/signup', { state: { from: '/pricing' } })
    const paid = !!me && me.plan.code !== 'free' && me.status !== 'free'
    setCheckout({ kind: paid ? 'change' : 'subscribe', plan })
  }

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="border-b border-line/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/" aria-label="GranthanAI home"><Logo /></Link>
          <nav className="flex items-center gap-5 text-sm">
            {signedIn ? (
              <>
                <Link to="/" className="text-ink-2 hover:text-ink">Back to chat</Link>
                <Link to="/settings/billing" className="text-ink-2 hover:text-ink">Billing</Link>
              </>
            ) : status === 'anonymous' ? (
              <>
                <Link to="/login" state={{ from: '/pricing' }} className="text-ink-2 hover:text-ink">Sign in</Link>
                <Link to="/signup" state={{ from: '/pricing' }} className="inline-flex h-9 items-center rounded-lg bg-accent px-4 font-medium text-accent-ink">Get started</Link>
              </>
            ) : null}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20">
        <section className="mx-auto max-w-2xl pb-10 pt-14 text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Plans and pricing</h1>
          <p className="mt-4 text-base text-ink-2">{PRICING_COPY.subtitle}</p>
          <p className="mt-1 text-sm text-ink-3">All prices are in Indian rupees and include GST.</p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-xl border border-line bg-surface p-1 text-sm">
              {(['month', 'year'] as const).map((i) => (
                <button
                  key={i}
                  role="radio"
                  aria-checked={interval === i}
                  onClick={() => setInterval(i)}
                  className={cn('rounded-lg px-5 py-2 font-medium transition-colors', interval === i ? 'bg-raised text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}
                >
                  {i === 'month' ? 'Monthly' : 'Yearly'}
                </button>
              ))}
            </div>
            {yearlySaving > 0 && <span className="rounded-full bg-ok-soft px-3 py-1 text-xs font-semibold text-ok">Save up to {yearlySaving}% yearly</span>}
          </div>
        </section>

        {plans.isPending ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4" aria-busy aria-label="Loading plans">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[28rem] w-full" />)}
          </div>
        ) : plans.isError ? (
          <Alert tone="error" action={<Button size="sm" onClick={() => void plans.refetch()}>Try again</Button>}>
            Could not load plans. {errorMessage(plans.error)}
          </Alert>
        ) : (
          <ul className={cn('grid items-stretch gap-5 sm:grid-cols-2', list.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
            {list.map((plan) => {
              const price = plan.prices[interval]
              const isPayg = plan.code === 'payg'
              const isFree = price == null && !isPayg
              const isCurrent = current === plan.code && (isFree || isPayg || currentInterval === interval)
              const onThisPlan = current === plan.code
              const popular = plan.code === POPULAR_PLAN
              const label = !signedIn || current === 'free' || !current
                ? 'Upgrade'
                : changeDirection(plans.data, current, currentInterval, plan, interval) === 'upgrade' ? 'Upgrade' : 'Downgrade'
              return (
                <li
                  key={plan.code}
                  data-plan={plan.code}
                  className={cn(
                    'relative flex flex-col rounded-2xl border bg-raised p-6 transition-shadow hover:shadow-md',
                    popular ? 'border-accent shadow-md ring-1 ring-accent/30' : onThisPlan ? 'border-accent/60' : 'border-line',
                  )}
                >
                  {popular && (
                    <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink">
                      <Sparkles className="size-3" aria-hidden /> {PRICING_COPY.popular}
                    </span>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-xl font-semibold">{planCopy(plan.code).name}</h2>
                    {onThisPlan && <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent">Current plan</span>}
                  </div>
                  <p className="mt-1 min-h-10 text-sm text-ink-2">{planCopy(plan.code).bestFor}</p>

                  <div className="mt-5 min-h-[5.5rem]">
                    {isPayg ? (
                      <>
                        <p className="text-2xl font-semibold leading-tight">{WORDS.paygPrice}</p>
                        <p className="mt-1 text-xs text-ink-3">{PRICING_COPY.paygTagline}</p>
                      </>
                    ) : (
                      <>
                        <p className="flex items-baseline gap-1">
                          <span className="text-4xl font-semibold tracking-tight">{isFree ? '₹0' : formatPaise(price!)}</span>
                          {!isFree && <span className="text-sm text-ink-3">/ {interval === 'year' ? 'year' : 'month'}</span>}
                        </p>
                        <p className="mt-1 text-xs text-ink-3">{isFree ? 'Free forever' : 'Includes GST'}</p>
                      </>
                    )}
                  </div>

                  <div className="mt-5">
                    {isPayg ? (
                      <Button variant="primary" className="w-full" onClick={() => (signedIn ? setTopup(true) : navigate('/signup', { state: { from: '/pricing' } }))}>{PAYG_COPY.topUp}</Button>
                    ) : isFree ? (
                      <Button className="w-full" disabled>{onThisPlan ? 'Current plan' : 'Free'}</Button>
                    ) : (
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

                  <hr className="my-5 border-line" />
                  <ul className="space-y-2.5 text-sm" aria-label={`${planCopy(plan.code).name} highlights`}>
                    {HIGHLIGHTS.map(([key, text]) => (
                      <li key={key} className="flex items-start gap-2.5">
                        <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                        <span><span className="text-ink-2">{text}:</span> <span className="font-medium">{cells[key]?.[plan.code]}</span></span>
                      </li>
                    ))}
                  </ul>

                  {isPayg && plan.payg && (
                    <div className="mt-5 space-y-3 text-sm" data-testid="payg-card">
                      <p className="text-ink-2">{PAYG_COPY.how}</p>
                      <ul className="flex flex-wrap gap-2" aria-label="Credit packs">
                        {plan.payg.topup_packs.map((k) => (
                          <li key={k.code} className="rounded-lg border border-line bg-surface px-3 py-1.5 font-medium">{formatPaise(k.price_paise)}</li>
                        ))}
                      </ul>
                      <p className="text-xs text-ink-3">Prices include GST. {PAYG_COPY.ultra} {PAYG_COPY.validity(plan.payg.credit_validity_months)}</p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {plans.data && <ComparisonTable plans={list} />}

        <p className="mt-10 text-center text-xs text-ink-3">{PRICING_COPY.footnote}</p>
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
    <section className="mt-16" aria-labelledby="compare-title">
      <h2 id="compare-title" className="text-2xl font-semibold tracking-tight">Compare plans</h2>
      <p className="mt-1 text-sm text-ink-2">Everything each plan includes, side by side.</p>
      <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-raised shadow-sm">
        <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-surface">
              <th scope="col" className="sticky left-0 z-10 w-64 bg-surface px-5 py-4 font-medium text-ink-3"><span className="sr-only">Feature</span></th>
              {plans.map((p) => (
                <th key={p.code} scope="col" className={cn('px-5 py-4 text-base font-semibold', p.code === POPULAR_PLAN && 'text-accent')}>{planCopy(p.code).name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} data-row={r.key} className={cn('border-b border-line/60 last:border-0', i % 2 === 1 && 'bg-surface/50')}>
                <th scope="row" className={cn('sticky left-0 z-10 px-5 py-3 font-normal text-ink-2', i % 2 === 1 ? 'bg-surface' : 'bg-raised')}>{r.label}</th>
                {plans.map((p) => {
                  const v = r.cells[p.code]
                  return (
                    <td key={p.code} data-plan={p.code} className="px-5 py-3 font-medium text-ink">
                      {v === WORDS.yes ? (
                        <span className="inline-flex items-center gap-1.5 text-ok"><Check className="size-4" aria-hidden />{v}</span>
                      ) : v === WORDS.no ? (
                        <span className="inline-flex items-center text-ink-3"><Minus className="size-4" aria-hidden /><span className="sr-only">{v}</span></span>
                      ) : (
                        v
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
