import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import { Dialog } from '@/components/ui/overlays'
import { Alert, Button, Spinner, TextField } from '@/components/ui/primitives'
import { errorMessage } from '@/lib/errors'
import { formatIstDate, formatPaise } from '@/lib/format'
import { gstinError } from '@/lib/gstin'
import { cn, uuid } from '@/lib/utils'
import { authService } from '@/services/auth.service'
import { billingService } from '@/services/billing.service'
import { qk } from '@/lib/query-keys'
import type { BillingInterval, ChangeQuote, PlanEntry, PlansResponse } from '@/types/billing'
import { useBillingMe, useBillingProfile, useGstStates, usePlans } from './hooks'
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

/**
 * The wording for a plan change or resume, from billing's own quote (POST .../preview). Nothing is computed here:
 * every amount and date shown is a field of the quote.
 */
export function quoteCopy(q: ChangeQuote): string {
  if (q.kind === 'resume')
    return `Authorise payment again to keep your plan. It starts on ${formatIstDate(q.effective_at)}, when your paid period ends.`
  if (q.amount_due_now_paise > 0) {
    const back = q.refund_paise > 0 ? `; ${formatPaise(q.refund_paise)} for unused days goes back to your original payment method` : ''
    return `You'll pay ${formatPaise(q.amount_due_now_paise)} now for a new period${back}.`
  }
  return `Starts on ${formatIstDate(q.effective_at)}; authorise the new mandate now.`
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
  const qc = useQueryClient()
  const states = useGstStates()
  const profile = useBillingProfile()
  // billing's quote for a change / resume: shown as is, and the Pay button carries its amount
  const quoteKey = ['billing', 'quote', kind, plan?.code ?? '', interval] as const
  const quote = useQuery({
    queryKey: quoteKey,
    queryFn: () => (kind === 'resume' ? billingService.previewResume() : billingService.previewChange({ plan_code: plan!.code, interval })),
    enabled: kind !== 'subscribe' && !!plan,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })

  const [stateCode, setStateCode] = useState('')
  const [legalName, setLegalName] = useState('')
  const [gstin, setGstin] = useState('')
  const [touched, setTouched] = useState(false)
  const email = profile.data?.billing_email || user.data?.email || ''
  // prefill from the saved billing details (once, and never over what the user already typed)
  const prefilled = useRef(false)
  useEffect(() => {
    if (prefilled.current || !profile.data) return
    prefilled.current = true
    const p = profile.data
    setStateCode((v) => v || p.state_code || '')
    setLegalName((v) => v || p.legal_name || '')
    setGstin((v) => v || p.gstin || '')
  }, [profile.data])

  const flow = useCheckoutFlow({ email })
  // One key per payment attempt: a retry of the same attempt replays the same checkout instead of creating another.
  const attemptKey = useRef<string | null>(null)
  const resend = useMutation({ mutationFn: () => authService.resendVerification(email) })

  const gErr = gstinError(gstin, stateCode)
  const needsDetails = kind === 'subscribe'
  const detailsOk = !needsDetails || (!!stateCode && !gErr)

  const start = () => {
    setTouched(true)
    if (!detailsOk || !plan) return
    attemptKey.current ??= uuid()
    const key = attemptKey.current
    if (kind === 'subscribe') {
      // keep what was entered for next time (future invoices only); a failure here never blocks the payment
      void billingService
        .saveProfile({ billing_email: email, state_code: stateCode, gstin: gstin.trim().toUpperCase() || null, legal_name: legalName.trim() || null })
        .then((p) => qc.setQueryData(qk.billingProfile, p))
        .catch(() => undefined)
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

  const title = kind === 'resume' ? `Resume ${planName}` : kind === 'change' ? (quote.data && quote.data.amount_due_now_paise === 0 ? `Switch to ${planName}` : `Upgrade to ${planName}`) : `Subscribe to ${planName}`
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
            {kind !== 'subscribe' && quote.isPending && <p role="status" className="mt-2 flex items-center gap-2 text-xs text-ink-3"><Spinner className="size-3" /> Working out the amounts…</p>}
            {kind !== 'subscribe' && quote.data && <p className="mt-2 text-xs text-ink-2" data-testid="change-copy">{quoteCopy(quote.data)}</p>}
            {kind !== 'subscribe' && quote.isError && <p role="alert" className="mt-2 text-xs text-danger">{errorMessage(quote.error)}</p>}
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
                  {(states.data?.states ?? []).map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
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
            <Button variant="primary" onClick={start} loading={flow.phase === 'starting'} disabled={busy || !plan || (kind !== 'subscribe' && !quote.data)}>
              {actionLabel(kind, quote.data, price)}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

function actionLabel(kind: CheckoutKind, q: ChangeQuote | undefined, price: number | undefined): string {
  if (kind === 'resume') return 'Resume'
  if (kind === 'change') return q && q.amount_due_now_paise > 0 ? `Pay ${formatPaise(q.amount_due_now_paise)}` : 'Schedule and authorise'
  return price != null ? `Pay ${formatPaise(price)}` : 'Continue'
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
