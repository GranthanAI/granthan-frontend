import { useCallback, useMemo, useRef, useState } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import { Dialog } from '@/components/ui/overlays'
import { Alert, Button, Spinner, TextField } from '@/components/ui/primitives'
import { errorMessage } from '@/lib/errors'
import { formatIstDate, formatPaise } from '@/lib/format'
import { GST_STATES, gstinError } from '@/lib/gst-states'
import { cn, uuid } from '@/lib/utils'
import { authService } from '@/services/auth.service'
import { billingService } from '@/services/billing.service'
import type { BillingInterval, PlanEntry, PlansResponse } from '@/types/billing'
import { useBillingMe, usePlans } from './hooks'
import { useCheckoutFlow } from './useCheckoutFlow'

export type CheckoutKind = 'subscribe' | 'change' | 'resume'
export type ChangeDirection = 'upgrade' | 'downgrade'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Upgrade = pay now for a new period; downgrade = starts at the end of the paid period. */
export function changeDirection(plans: PlansResponse | undefined, fromCode: string, fromInterval: BillingInterval | null, to: PlanEntry, toInterval: BillingInterval): ChangeDirection {
  const from = plans?.plans.find((p) => p.code === fromCode)
  if (from && from.rank !== to.rank) return to.rank > from.rank ? 'upgrade' : 'downgrade'
  return fromInterval === 'month' && toInterval === 'year' ? 'upgrade' : 'downgrade'
}

/** The wording for each kind of change; the amounts are the ones billing's catalog gives (no estimates). */
export function changeCopy(direction: ChangeDirection, price: number | undefined, periodEnd: string | null) {
  if (direction === 'upgrade')
    return `You'll pay ${price != null ? formatPaise(price) : 'the new plan price'} now for a new period; the unused days on your current plan go back to your original payment method.`
  return `Starts on ${formatIstDate(periodEnd) || 'the end of your current period'}; authorise the new mandate now.`
}

interface Props {
  kind: CheckoutKind
  /** The plan being bought / switched to. Not needed for resume (the current plan is resumed). */
  plan?: PlanEntry | null
  interval: BillingInterval
  onClose: () => void
}

/** Collects what GST needs, then runs the payment (Razorpay or the simulator) and shows the result. */
export function CheckoutDialog({ kind, plan: planProp, interval, onClose }: Props) {
  const me = useBillingMe().data
  const plans = usePlans().data
  const user = useQuery({ queryKey: ['auth', 'me'], queryFn: () => authService.me(), staleTime: 0 })
  const plan = useMemo(() => planProp ?? plans?.plans.find((p) => p.code === me?.plan.code) ?? null, [planProp, plans, me])
  const planName = plan ? cap(plan.code) : 'your plan'
  const price = plan?.prices[interval]

  const [stateCode, setStateCode] = useState('')
  const [legalName, setLegalName] = useState('')
  const [gstin, setGstin] = useState('')
  const [touched, setTouched] = useState(false)
  const email = user.data?.email ?? ''

  const flow = useCheckoutFlow({ email })
  // One key per payment attempt: a retry of the same attempt replays the same checkout instead of creating another.
  const attemptKey = useRef<string | null>(null)
  const resend = useMutation({ mutationFn: () => authService.resendVerification(email) })

  const gErr = gstinError(gstin, stateCode)
  const needsDetails = kind === 'subscribe'
  const detailsOk = !needsDetails || (!!stateCode && !gErr)
  const direction = kind === 'change' && plan ? changeDirection(plans, me?.plan.code ?? 'free', me?.plan.interval ?? null, plan, interval) : null

  const start = () => {
    setTouched(true)
    if (!detailsOk || !plan) return
    attemptKey.current ??= uuid()
    const key = attemptKey.current
    if (kind === 'subscribe') {
      flow.begin(() =>
        billingService.checkout(
          { plan_code: plan.code, interval, state_code: stateCode, email, ...(legalName.trim() ? { legal_name: legalName.trim() } : {}), ...(gstin.trim() ? { gstin: gstin.trim().toUpperCase() } : {}) },
          key,
        ),
      )
    } else if (kind === 'change') {
      flow.begin(() => billingService.changePlan({ plan_code: plan.code, interval }, key))
    } else {
      flow.begin(() => billingService.resume(key))
    }
  }

  const title = kind === 'resume' ? `Resume ${planName}` : kind === 'change' ? (direction === 'downgrade' ? `Switch to ${planName}` : `Upgrade to ${planName}`) : `Subscribe to ${planName}`
  const busy = flow.phase === 'starting' || flow.phase === 'awaiting' || flow.phase === 'verifying'
  const verified = user.data?.is_email_verified === true
  // Must be stable: the dialog re-focuses its first field whenever onClose changes.
  const verifying = flow.phase === 'verifying'
  const close = useCallback(() => { if (!verifying) onClose() }, [verifying, onClose])

  return (
    <Dialog open onClose={close} title={title} className="max-w-lg">
      {flow.phase === 'success' ? (
        <Success planName={planName} onClose={onClose} />
      ) : user.isPending ? (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-2"><Spinner /> Checking your account…</p>
      ) : user.isError ? (
        <Alert tone="error" action={<Button size="sm" onClick={() => void user.refetch()}>Try again</Button>}>Could not load your account. {errorMessage(user.error)}</Alert>
      ) : !verified ? (
        <div className="space-y-3" data-testid="verify-step">
          <Alert tone="warn">Verify your email before paying. We use it for your invoice and payment receipts.</Alert>
          <p className="text-sm text-ink-2">Your email is <strong>{email}</strong>. Open the verification email we sent, then check again here.</p>
          {resend.isSuccess && <p role="status" className="text-sm text-ok">Verification email sent.</p>}
          {resend.isError && <p role="alert" className="text-sm text-danger">{errorMessage(resend.error)}</p>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => resend.mutate()} loading={resend.isPending}>Resend email</Button>
            <Button variant="primary" onClick={() => void user.refetch()} loading={user.isFetching}>I've verified, check again</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-surface px-3.5 py-3 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="font-medium">{planName} · {interval === 'year' ? 'yearly' : 'monthly'}</span>
              {price != null && <span className="font-semibold">{formatPaise(price)} <span className="text-xs font-normal text-ink-3">incl. GST</span></span>}
            </div>
            {kind === 'change' && direction && <p className="mt-2 text-xs text-ink-2" data-testid="change-copy">{changeCopy(direction, price, me?.current_period_end ?? null)}</p>}
            {kind === 'resume' && <p className="mt-2 text-xs text-ink-2">Authorise payment again to keep {planName} after {formatIstDate(me?.current_period_end) || 'this period'}.</p>}
          </div>

          {needsDetails && (
            <form noValidate onSubmit={(e) => { e.preventDefault(); start() }} className="space-y-3" id="checkout-form">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">State (place of supply)</span>
                <select
                  value={stateCode}
                  onChange={(e) => { attemptKey.current = null; setStateCode(e.target.value) }}
                  aria-invalid={touched && !stateCode}
                  disabled={busy}
                  className={cn('h-10 w-full rounded-lg border bg-raised px-3 text-sm', touched && !stateCode ? 'border-danger' : 'border-line')}
                >
                  <option value="">Select your state…</option>
                  {GST_STATES.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
                </select>
                {touched && !stateCode && <span role="alert" className="mt-1 block text-xs text-danger">Choose your state: it decides which GST applies.</span>}
              </label>
              <TextField label="Business name (optional)" value={legalName} onChange={(e) => { attemptKey.current = null; setLegalName(e.target.value) }} maxLength={200} disabled={busy} autoComplete="organization" />
              <TextField
                label="GSTIN (optional)"
                value={gstin}
                onChange={(e) => { attemptKey.current = null; setGstin(e.target.value.toUpperCase()) }}
                maxLength={15}
                disabled={busy}
                hint="Add it to get a GST invoice in your business name."
                error={gstin && gErr ? gErr : undefined}
              />
            </form>
          )}

          {flow.phase === 'awaiting' && !flow.blockedUrl && (
            <p role="status" className="flex items-center gap-2 text-sm text-ink-2"><Spinner /> Complete the payment in the window we opened…</p>
          )}
          {flow.blockedUrl && (
            <Alert tone="warn" action={<Button size="sm" variant="primary" onClick={flow.openBlocked}><ExternalLink className="size-3.5" /> Open payment window</Button>}>
              Your browser blocked the payment pop-up.
            </Alert>
          )}
          {flow.phase === 'verifying' && <p role="status" className="flex items-center gap-2 text-sm text-ink-2"><Spinner /> Confirming your payment…</p>}
          {flow.phase === 'dismissed' && (
            <Alert tone="warn" action={<Button size="sm" onClick={flow.retry}>Try again</Button>}>Payment not completed. You haven't been charged for this attempt.</Alert>
          )}
          {flow.phase === 'error' && flow.error && (
            <Alert tone="error" action={<Button size="sm" onClick={flow.retry}>Try again</Button>}>{flow.error}</Alert>
          )}

          <div className="flex justify-end gap-2">
            <Button onClick={onClose} disabled={flow.phase === 'verifying'}>Cancel</Button>
            <Button variant="primary" onClick={start} loading={flow.phase === 'starting'} disabled={busy || !plan}>
              {kind === 'resume' ? 'Resume' : kind === 'change' && direction === 'downgrade' ? 'Schedule and authorise' : price != null ? `Pay ${formatPaise(price)}` : 'Continue'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

function Success({ planName, onClose }: { planName: string; onClose: () => void }) {
  const inRouter = useInRouterContext()
  const cls = 'inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink'
  return (
    <div className="space-y-4 text-center" data-testid="checkout-success">
      <CheckCircle2 className="mx-auto size-10 text-ok" aria-hidden />
      <div>
        <h3 className="text-lg font-semibold">You're on {planName}</h3>
        <p className="mt-1 text-sm text-ink-2">Your payment went through. New models are unlocked now, and your invoice is under Settings → Billing.</p>
      </div>
      <div className="flex justify-center gap-2">
        <Button onClick={onClose}>Close</Button>
        {inRouter ? <Link to="/" onClick={onClose} className={cls}>Start chatting</Link> : <a href="/" className={cls}>Start chatting</a>}
      </div>
    </div>
  )
}
