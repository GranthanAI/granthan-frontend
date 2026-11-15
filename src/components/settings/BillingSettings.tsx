import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { Alert, Button, Skeleton, TextField } from '@/components/ui/primitives'
import { ConfirmDialog, toast } from '@/components/ui/overlays'
import { SettingsSection } from '@/components/settings/controls'
import { CheckoutDialog } from '@/features/billing/CheckoutDialog'
import { CreditsSettings } from '@/components/settings/CreditsSettings'
import { invalidateBilling, useBillingMe, useBillingProfile, useGstStates, useInvoices, usePlans } from '@/features/billing/hooks'
import { saveBlob, safeFileName } from '@/lib/download'
import { toApiError, errorMessage } from '@/lib/errors'
import { fieldErrors, gstinError } from '@/lib/gstin'
import { qk } from '@/lib/query-keys'
import { formatIstDate, formatLimit, formatPaise } from '@/lib/format'
import { billingService } from '@/services/billing.service'
import { isCreditNote, type BillingMe, type Invoice } from '@/types/billing'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const STATUS_LABEL: Record<string, string> = {
  free: 'Free',
  active: 'Active',
  past_due: 'Payment failed',
  suspended: 'Suspended',
  cancelling: 'Ending',
}

/** Settings → Billing: the plan, its status and dates, cancel / resume, and the invoices and credit notes. */
export function BillingSettings() {
  const meQuery = useBillingMe()
  const me = meQuery.data
  const plans = usePlans().data
  const [resuming, setResuming] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const qc = useQueryClient()

  const cancel = useMutation({
    mutationFn: () => billingService.cancel(),
    onSuccess: () => {
      invalidateBilling(qc, { all: true })
      setConfirmCancel(false)
      toast('Your subscription will end at the end of the paid period', 'success')
    },
  })

  if (meQuery.isPending) return <SettingsSection title="Billing"><Skeleton className="h-24 w-full" /></SettingsSection>
  if (meQuery.isError || !me)
    return (
      <SettingsSection title="Billing">
        <Alert tone="error" action={<Button size="sm" onClick={() => void meQuery.refetch()}>Retry</Button>}>
          Could not load your billing details. {errorMessage(meQuery.error)}
        </Alert>
      </SettingsSection>
    )

  const paid = me.plan.code !== 'free' && me.status !== 'free'
  const ending = me.status === 'cancelling' || me.cancel_at_period_end
  const planEntry = plans?.plans.find((p) => p.code === me.plan.code)
  const price = planEntry?.prices[me.plan.interval ?? 'month']
  const until = formatIstDate(me.current_period_end)

  return (
    <>
      <SettingsSection title="Billing" description="Your plan, how it renews, and your invoices. Prices include GST.">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm" data-testid="plan-summary">
          <dt className="text-ink-3">Plan</dt>
          <dd className="font-medium">
            {cap(me.plan.code)}
            {paid && me.plan.interval && <span className="font-normal text-ink-2"> · {me.plan.interval === 'year' ? 'yearly' : 'monthly'}{price != null && ` · ${formatPaise(price)}`}</span>}
          </dd>
          <dt className="text-ink-3">Status</dt>
          <dd data-testid="plan-status">{STATUS_LABEL[me.status] ?? cap(me.status)}</dd>
          {paid && until && (
            <>
              <dt className="text-ink-3">{ending ? 'Access until' : 'Renews on'}</dt>
              <dd>{until}</dd>
            </>
          )}
          {me.status === 'past_due' && me.grace_until && (
            <>
              <dt className="text-ink-3">Pay by</dt>
              <dd>{formatIstDate(me.grace_until)}</dd>
            </>
          )}
          {me.pending_change && (
            <>
              <dt className="text-ink-3">Scheduled</dt>
              <dd>Switches to {cap(me.pending_change.plan_code)}{me.pending_change.interval ? ` (${me.pending_change.interval === 'year' ? 'yearly' : 'monthly'})` : ''} on {until}</dd>
            </>
          )}
          <dt className="text-ink-3">Payments</dt>
          <dd>{me.payment_mode === 'simulated' ? 'Simulated (no real money)' : 'Live'}</dd>
        </dl>

        {me.status === 'past_due' && me.payment_action_url && (
          <Alert tone="error" action={<a href={me.payment_action_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-sm font-medium text-accent-ink">Pay now</a>}>
            Your last payment failed. Pay now to keep {cap(me.plan.code)}.
          </Alert>
        )}

        <div className="flex flex-wrap gap-2">
          <Link to="/pricing" className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink">
            {paid ? 'Change plan' : 'Upgrade'}
          </Link>
          {paid && ending && <Button onClick={() => setResuming(true)}>Resume</Button>}
          {paid && !ending && <Button variant="danger" onClick={() => { cancel.reset(); setConfirmCancel(true) }}>Cancel subscription</Button>}
        </div>
        {ending && paid && <p className="text-sm text-ink-2">Your plan ends on {until}. Resume to keep it.</p>}
      </SettingsSection>

      <BillingDetails />

      <CreditsSettings />

      <SettingsSection title="Limits" description="What your plan includes.">
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm" aria-label="Plan limits">
          <Limit label="Messages per day" value={me.limits.messages_per_day} />
          <Limit label="Best-model messages per day" value={me.limits.best_per_day} />
          <Limit label="Saved memory facts" value={me.limits.memory_facts} />
          <Limit label="Storage (MB)" value={me.limits.storage_mb} />
        </ul>
      </SettingsSection>

      <Invoices />

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => cancel.mutate()}
        title="Cancel your subscription?"
        description={cancelText(me, until)}
        confirmLabel="Cancel subscription"
        loading={cancel.isPending}
        error={cancel.isError ? errorMessage(cancel.error) : null}
      />
      {resuming && <CheckoutDialog kind="resume" interval={me.plan.interval ?? 'month'} onClose={() => setResuming(false)} />}
    </>
  )
}

export const cancelText = (me: BillingMe, until: string) =>
  `You keep ${cap(me.plan.code)} until ${until || 'the end of the paid period'}. After that you move to Free and won't be charged again. You can resume any time before then.`

function Limit({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex justify-between gap-3 border-b border-line/60 py-1">
      <span className="text-ink-2">{label}</span>
      <span className="font-medium">{value === 0 ? 'Not included' : formatLimit(value)}</span>
    </li>
  )
}

/** Tax invoices and credit notes are different documents: listed separately. */
function Invoices() {
  const q = useInvoices()
  const [downloading, setDownloading] = useState<string | null>(null)
  const [error, setError] = useState('')

  const download = async (i: Invoice) => {
    setError('')
    setDownloading(i.id)
    try {
      // Fetched with the Authorization header (the browser cannot add it to a plain link), then saved.
      saveBlob(await billingService.invoicePdf(i.id), safeFileName(i.number, 'invoice', '.pdf'))
    } catch (e) {
      setError(`Could not download ${i.number}. ${errorMessage(e)}`)
    } finally {
      setDownloading(null)
    }
  }

  const all = q.data?.invoices ?? []
  const invoices = all.filter((i) => !isCreditNote(i))
  const notes = all.filter(isCreditNote)

  return (
    <>
      <SettingsSection title="Invoices">
        {q.isPending && <Skeleton className="h-12 w-full" />}
        {q.isError && <Alert tone="error" action={<Button size="sm" onClick={() => void q.refetch()}>Retry</Button>}>Could not load invoices. {errorMessage(q.error)}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        {q.isSuccess && <Table rows={invoices} empty="No invoices yet." onDownload={download} busy={downloading} />}
      </SettingsSection>
      <SettingsSection title="Credit notes" description="Issued when part of a payment is refunded.">
        {q.isSuccess && <Table rows={notes} empty="No credit notes." onDownload={download} busy={downloading} credit />}
      </SettingsSection>
    </>
  )
}

function Table({ rows, empty, onDownload, busy, credit }: { rows: Invoice[]; empty: string; onDownload: (i: Invoice) => void; busy: string | null; credit?: boolean }) {
  if (!rows.length) return <p className="text-sm text-ink-3">{empty}</p>
  return (
    <ul className="divide-y divide-line rounded-lg border border-line">
      {rows.map((i) => (
        <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
          <div className="min-w-0">
            <p className="font-medium">{i.number}</p>
            <p className="text-xs text-ink-3">
              {formatIstDate(i.issued_at)}
              {credit && i.original_number && <> · against {i.original_number}</>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="font-medium">{credit ? `-${formatPaise(i.total_paise)}` : formatPaise(i.total_paise)}</span>
            <Button size="sm" onClick={() => onDownload(i)} disabled={!i.pdf_ready} loading={busy === i.id} aria-label={`Download PDF ${i.number}`} title={i.pdf_ready ? 'Download PDF' : 'The PDF is still being prepared'}>
              <Download className="size-3.5" aria-hidden /> PDF
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Billing email, GST state and optional GSTIN: saved to billing, applied to FUTURE invoices only. */
function BillingDetails() {
  const profile = useBillingProfile()
  const states = useGstStates()
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [stateCode, setStateCode] = useState('')
  const [gstin, setGstin] = useState('')
  const [legalName, setLegalName] = useState('')
  const [server, setServer] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState<unknown>(null)
  if (profile.data && loaded !== profile.data) {
    setLoaded(profile.data)
    setEmail(profile.data.billing_email ?? '')
    setStateCode(profile.data.state_code ?? '')
    setGstin(profile.data.gstin ?? '')
    setLegalName(profile.data.legal_name ?? '')
  }
  const save = useMutation({
    mutationFn: () => billingService.saveProfile({ billing_email: email.trim(), state_code: stateCode, gstin: gstin.trim().toUpperCase() || null, legal_name: legalName.trim() || null }),
    onSuccess: (p) => {
      qc.setQueryData(qk.billingProfile, p)
      setServer({})
      toast('Billing details saved. They apply to future invoices.', 'success')
    },
    onError: (e) => setServer(fieldErrors(toApiError(e).problemErrors)),
  })
  const gErr = gstin ? gstinError(gstin, stateCode) : null
  const nameErr = gstin && !legalName.trim() ? 'Required when a GSTIN is given.' : null
  const emailErr = email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) ? 'Enter a valid email address.' : null
  const valid = !!email.trim() && !emailErr && !!stateCode && !gErr && !nameErr

  return (
    <SettingsSection title="Billing details" description="Used on your invoices. A change applies to future invoices only; invoices already issued keep the details they were issued with.">
      {profile.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate() }}>
          {save.isError && !Object.keys(server).length && <Alert tone="error">{errorMessage(save.error)}</Alert>}
          <TextField label="Billing email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={emailErr ?? server.billing_email} autoComplete="email" />
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">State (place of supply)</span>
            <select value={stateCode} onChange={(e) => setStateCode(e.target.value)} className="h-10 w-full rounded-lg border border-line bg-raised px-3 text-sm">
              <option value="">Select your state…</option>
              {(states.data?.states ?? []).map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
            </select>
            {server.state_code && <span role="alert" className="mt-1 block text-xs text-danger">{server.state_code}</span>}
          </label>
          <TextField label="GSTIN (optional)" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={15} error={(gErr ?? server.gstin) || undefined} />
          <TextField label="Legal name" value={legalName} onChange={(e) => setLegalName(e.target.value)} maxLength={200} error={nameErr ?? server.legal_name} hint="The name on a GST invoice." />
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!valid}>Save billing details</Button>
        </form>
      )}
    </SettingsSection>
  )
}
