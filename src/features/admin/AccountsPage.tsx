import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Skeleton, TextField } from '@/components/ui/primitives'
import { errorMessage } from '@/lib/errors'
import { formatIstDate, formatPaise } from '@/lib/format'
import { adminService } from '@/services/admin.service'
import { ReasonDialog } from './ReasonDialog'
import { useCanWrite } from './useCanWrite'

export interface AdminAccountRow {
  id: string
  owner_type: string
  owner_id: string
  billing_email: string | null
  legal_name: string | null
  gstin: string | null
  state_code: string | null
  blocked_at: string | null
}
export interface AdminAccountDetail {
  account: AdminAccountRow & { blocked_reason?: string | null; created_at?: string }
  overrides: Array<{ id: string; plan_code: string; reason: string; starts_at: string; expires_at: string; ended_at: string | null }>
  subscriptions: Array<{ id: string; status: string; interval: string; plan_code: string; version: number; current_period_end: string | null; grace_until: string | null }>
  history: Array<{ from_status: string | null; to_status: string; trigger: string; at: string }>
  payments: Array<{ id: string; gateway_payment_id: string; purpose: string; method: string | null; amount_paise: number; status: string; captured_at: string | null }>
  invoices: Array<{ id: string; number: string; kind: string; total_paise: number; status: string; issued_at: string }>
  this_month: { usage_events: number; cost_micro_inr: number; revenue_paise: number; margin_micro_inr: number }
}

/** µINR -> rupees text (1 paisa = 10,000 µINR). */
export const microInr = (micro: number) => formatPaise(Math.round(micro / 10_000))
const OVERRIDE_DAYS = [7, 14, 30, 90]
const GRANTABLE = ['pro', 'max']

export function AccountsPage() {
  const [q, setQ] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const search = useQuery({
    queryKey: ['admin', 'accounts', submitted],
    queryFn: ({ signal }) => adminService.get<{ accounts: AdminAccountRow[] }>('/accounts', { q: submitted }, signal),
    enabled: submitted.trim().length > 0,
    retry: false,
  })
  return (
    <>
      <h1 className="text-xl font-semibold">Accounts</h1>
      <form role="search" className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); setSubmitted(q.trim()); setOpen(null) }}>
        <TextField label="Email, user id or account id" value={q} onChange={(e) => setQ(e.target.value)} className="w-96" />
        <Button type="submit" variant="primary" disabled={!q.trim()}>Search</Button>
      </form>
      {search.isError && <Alert tone="error">{errorMessage(search.error)}</Alert>}
      {search.isSuccess && search.data.accounts.length === 0 && <p className="text-sm text-ink-3">No account matches “{submitted}”.</p>}
      {search.isSuccess && search.data.accounts.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-raised" aria-label="Accounts found">
          {search.data.accounts.map((a) => (
            <li key={a.id}>
              <button onClick={() => setOpen(a.id)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface-2">
                <span><span className="font-medium">{a.billing_email ?? '(no email)'}</span> <span className="text-xs text-ink-3">{a.owner_type} · {a.id}</span></span>
                {a.blocked_at && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs text-danger">Blocked</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <AccountDetail id={open} />}
    </>
  )
}

type Action = { kind: 'block' | 'unblock' } | { kind: 'grant' } | { kind: 'end'; id: string } | { kind: 'refund'; paymentId: string; amount: number }

function AccountDetail({ id }: { id: string }) {
  const canWrite = useCanWrite()
  const qc = useQueryClient()
  const key = ['admin', 'account', id]
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => adminService.get<AdminAccountDetail>(`/accounts/${id}`, undefined, signal), retry: false })
  const [action, setAction] = useState<Action | null>(null)
  const [days, setDays] = useState(30)
  const [plan, setPlan] = useState('pro')
  const [refundRupees, setRefundRupees] = useState('')
  const [note, setNote] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: key })

  if (q.isPending) return <Skeleton className="h-40 w-full" />
  if (q.isError) return <Alert tone="error">{errorMessage(q.error)}</Alert>
  const d = q.data
  const blocked = !!d.account.blocked_at
  const invoices = d.invoices.filter((i) => !i.kind.startsWith('credit_note'))
  const notes = d.invoices.filter((i) => i.kind.startsWith('credit_note'))

  return (
    <section aria-label="Account detail" className="space-y-4 rounded-2xl border border-line bg-raised p-5" data-testid="account-detail">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{d.account.billing_email ?? '(no email)'}</h2>
          <p className="text-xs text-ink-3">{d.account.owner_type} · {d.account.id} · state {d.account.state_code ?? '—'}{d.account.gstin ? ` · GSTIN ${d.account.gstin}` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <span data-testid="block-state" className={blocked ? 'rounded-full bg-danger-soft px-2 py-0.5 text-xs text-danger' : 'rounded-full bg-ok-soft px-2 py-0.5 text-xs text-ok'}>{blocked ? 'Blocked' : 'Not blocked'}</span>
          {canWrite && <Button variant={blocked ? 'secondary' : 'danger'} size="sm" onClick={() => setAction({ kind: blocked ? 'unblock' : 'block' })}>{blocked ? 'Unblock' : 'Block'}</Button>}
        </div>
      </header>
      {note && <Alert tone="success">{note}</Alert>}
      {blocked && d.account.blocked_reason && <p className="text-sm text-ink-2">Blocked because: {d.account.blocked_reason}</p>}

      <Block title="Subscription">
        {d.subscriptions.length === 0 ? <p className="text-sm text-ink-3">No subscription.</p> : (
          <ul className="text-sm">{d.subscriptions.map((s) => <li key={s.id}>{s.plan_code} v{s.version} · {s.interval} · <strong>{s.status}</strong>{s.current_period_end ? ` · to ${formatIstDate(s.current_period_end)}` : ''}</li>)}</ul>
        )}
        <details className="mt-2 text-xs text-ink-2"><summary>History ({d.history.length})</summary>
          <ul className="mt-1 space-y-0.5">{d.history.map((h, i) => <li key={i}>{formatIstDate(h.at)}: {h.from_status ?? '—'} → {h.to_status} ({h.trigger})</li>)}</ul>
        </details>
      </Block>

      <Block title="This month">
        <p className="text-sm" data-testid="this-month">{d.this_month.usage_events} model calls · cost {microInr(d.this_month.cost_micro_inr)} · revenue {formatPaise(d.this_month.revenue_paise)} · margin {microInr(d.this_month.margin_micro_inr)}</p>
      </Block>

      <Block title="Overrides" action={canWrite && <Button size="sm" onClick={() => setAction({ kind: 'grant' })}>Grant override</Button>}>
        {d.overrides.length === 0 ? <p className="text-sm text-ink-3">No overrides.</p> : (
          <ul className="space-y-1 text-sm">
            {d.overrides.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2">
                <span>{o.plan_code} · {formatIstDate(o.starts_at)} → {formatIstDate(o.expires_at)} · {o.ended_at ? `ended ${formatIstDate(o.ended_at)}` : 'active'} <span className="text-xs text-ink-3">({o.reason})</span></span>
                {canWrite && !o.ended_at && <Button size="sm" onClick={() => setAction({ kind: 'end', id: o.id })}>End</Button>}
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Payments">
        {d.payments.length === 0 ? <p className="text-sm text-ink-3">No payments.</p> : (
          <ul className="divide-y divide-line text-sm" aria-label="Payments">
            {d.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                <span>{formatPaise(p.amount_paise)} · {p.purpose} · {p.method ?? '—'} · {p.status} · {p.captured_at ? formatIstDate(p.captured_at) : ''}</span>
                {canWrite && p.status !== 'refunded' && <Button size="sm" onClick={() => { setRefundRupees(String(p.amount_paise / 100)); setAction({ kind: 'refund', paymentId: p.id, amount: p.amount_paise }) }}>Refund</Button>}
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Invoices"><DocList rows={invoices} empty="No invoices." label="Invoices" /></Block>
      <Block title="Credit notes"><DocList rows={notes} empty="No credit notes." label="Credit notes" /></Block>

      {action?.kind === 'block' && <ReasonDialog title="Block this account?" description="Messages and uploads are refused until it is unblocked." confirmLabel="Block account" onClose={() => setAction(null)} onConfirm={async (reason) => { await adminService.post(`/accounts/${id}/block`, { reason }); await refresh() }} />}
      {action?.kind === 'unblock' && <ReasonDialog title="Unblock this account?" confirmLabel="Unblock" onClose={() => setAction(null)} onConfirm={async (reason) => { await adminService.post(`/accounts/${id}/unblock`, { reason }); await refresh() }} />}
      {action?.kind === 'end' && <ReasonDialog title="End this override now?" confirmLabel="End override" onClose={() => setAction(null)} onConfirm={async (reason) => { await adminService.post(`/overrides/${action.id}/end`, { reason }); await refresh() }} />}
      {action?.kind === 'grant' && (
        <ReasonDialog title="Grant a plan override" description="The account gets this plan for the chosen time, at no charge." confirmLabel="Grant override" onClose={() => setAction(null)}
          onConfirm={async (reason) => {
            const expires = new Date(Date.now() + days * 86_400_000).toISOString()
            await adminService.post('/overrides', { owner_type: d.account.owner_type, owner_id: d.account.owner_id, plan_code: plan, expires_at: expires, reason })
            await refresh()
          }}>
          <div className="flex gap-3 text-sm" role="group" aria-label="Override terms">
            <label>Plan <select value={plan} onChange={(e) => setPlan(e.target.value)} className="ml-1 h-9 rounded border border-line bg-raised px-2">{GRANTABLE.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label>For <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="ml-1 h-9 rounded border border-line bg-raised px-2">{OVERRIDE_DAYS.map((n) => <option key={n} value={n}>{n} days</option>)}</select></label>
          </div>
        </ReasonDialog>
      )}
      {action?.kind === 'refund' && (
        <RefundDialog max={action.amount} rupees={refundRupees} setRupees={setRefundRupees} onClose={() => setAction(null)}
          onConfirm={async (reason, paise) => {
            await adminService.post('/refunds', { payment_id: action.paymentId, amount_paise: paise, reason })
            setNote('Refund queued. Its credit note appears under Credit notes in a moment.')
            await refresh()
            setTimeout(() => void refresh(), 3000)
          }} />
      )}
    </section>
  )
}

function Block({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{title}</h3>{action}</div>
      {children}
    </div>
  )
}

function DocList({ rows, empty, label }: { rows: AdminAccountDetail['invoices']; empty: string; label: string }) {
  if (!rows.length) return <p className="text-sm text-ink-3">{empty}</p>
  return (
    <ul className="divide-y divide-line text-sm" aria-label={label}>
      {rows.map((i) => <li key={i.id} className="flex justify-between py-1.5"><span>{i.number} · {formatIstDate(i.issued_at)}</span><span className="font-medium">{formatPaise(i.total_paise)}</span></li>)}
    </ul>
  )
}

/** The refund amount is typed in rupees and sent as paise; it cannot exceed what the payment was (the server also checks what is left). */
function RefundDialog({ max, rupees, setRupees, onConfirm, onClose }: { max: number; rupees: string; setRupees: (v: string) => void; onConfirm: (reason: string, paise: number) => Promise<unknown>; onClose: () => void }) {
  const paise = Math.round(Number(rupees) * 100)
  const valid = /^\d+(\.\d{1,2})?$/.test(rupees.trim()) && paise > 0 && paise <= max
  return (
    <ReasonDialog title="Refund this payment" description={`Up to ${formatPaise(max)} (the payment; the server also subtracts earlier refunds). A credit note is issued.`} confirmLabel="Refund" onClose={onClose}
      onConfirm={(reason) => (valid ? onConfirm(reason, paise) : Promise.reject(new Error(`Enter an amount between ₹0.01 and ${formatPaise(max)}.`)))}>
      <TextField label="Amount in rupees" inputMode="decimal" value={rupees} onChange={(e) => setRupees(e.target.value)} error={rupees && !valid ? `Between ₹0.01 and ${formatPaise(max)}` : undefined} />
    </ReasonDialog>
  )
}

