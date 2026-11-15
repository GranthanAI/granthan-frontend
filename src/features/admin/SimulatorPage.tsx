import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Skeleton, TextField } from '@/components/ui/primitives'
import { ConfirmDialog } from '@/components/ui/overlays'
import { useBillingMe } from '@/features/billing/hooks'
import { errorMessage } from '@/lib/errors'
import { adminService } from '@/services/admin.service'
import { useCanWrite } from './useCanWrite'

interface Row { id: string; status?: string; next_outcome?: string | null; [k: string]: unknown }
interface SimState { subscriptions: Row[]; payments: Row[]; refunds: Row[]; pending_webhooks: Row[] }
type Pending = { title: string; description: string; run: () => Promise<unknown> }
const OUTCOMES = ['success', 'fail', 'halt'] as const

/** Payment simulator controls. Only when billing says payments are simulated (and only for roles that may change things). */
export function SimulatorPage() {
  const me = useBillingMe().data
  const canWrite = useCanWrite()
  const qc = useQueryClient()
  const [userId, setUserId] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]>('success')
  const [pending, setPending] = useState<Pending | null>(null)
  const [said, setSaid] = useState('')
  const state = useQuery({
    queryKey: ['admin', 'sim', submitted],
    queryFn: () => adminService.sim.get<SimState>('/state', { user_id: submitted }),
    enabled: submitted !== '',
    retry: false,
  })
  const confirm = useMutation({
    mutationFn: async () => { await pending!.run() },
    onSuccess: async () => { setSaid(pending!.title); setPending(null); await qc.invalidateQueries({ queryKey: ['admin', 'sim'] }) },
  })
  if (me && me.payment_mode !== 'simulated') return <Alert tone="info">Payments are live: the simulator tools are not available.</Alert>
  const ask = (title: string, description: string, run: () => Promise<unknown>) => { confirm.reset(); setPending({ title, description, run }) }

  return (
    <>
      <h1 className="text-xl font-semibold">Simulator tools</h1>
      <p className="text-sm text-ink-2">Payments are simulated: nothing here moves real money.</p>
      <form className="flex items-end gap-2" role="search" onSubmit={(e) => { e.preventDefault(); setSubmitted(userId.trim()); setSaid('') }}>
        <TextField label="User id" value={userId} onChange={(e) => setUserId(e.target.value)} className="w-96" />
        <Button type="submit" variant="primary" disabled={!userId.trim()}>Show simulated state</Button>
        {canWrite && <Button onClick={() => ask('Settle now', 'Settles every captured payment in the simulator.', () => adminService.sim.post('/settle-now'))}>Settle now</Button>}
      </form>
      {said && <Alert tone="success">Done: {said}</Alert>}
      {state.isPending && submitted && <Skeleton className="h-24 w-full" />}
      {state.isError && <Alert tone="error">{errorMessage(state.error)}</Alert>}
      {state.isSuccess && (
        <div className="space-y-4" data-testid="sim-state">
          <section aria-label="Simulated subscriptions" className="space-y-2">
            <h2 className="font-semibold">Subscriptions</h2>
            {state.data.subscriptions.length === 0 && <p className="text-sm text-ink-3">None for this user.</p>}
            {state.data.subscriptions.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-raised px-3 py-2 text-sm">
                <span><span className="font-medium">{s.id}</span> · {s.status} · next charge: {s.next_outcome ?? 'success'}</span>
                {canWrite && (
                  <span className="flex flex-wrap items-center gap-2">
                    <select aria-label={`Next charge outcome for ${s.id}`} value={outcome} onChange={(e) => setOutcome(e.target.value as (typeof OUTCOMES)[number])} className="h-8 rounded border border-line bg-raised px-2">
                      {OUTCOMES.map((o) => <option key={o}>{o}</option>)}
                    </select>
                    <Button size="sm" onClick={() => ask(`Next charge ${outcome} for ${s.id}`, 'The next renewal charge of this simulated subscription will have this outcome.', () => adminService.sim.post(`/subscriptions/${s.id}/next-charge`, { outcome }))}>Set next charge</Button>
                    <Button size="sm" onClick={() => ask(`Renew ${s.id} now`, 'Runs the renewal charge immediately.', () => adminService.sim.post(`/subscriptions/${s.id}/renew-now`))}>Renew now</Button>
                    <Button size="sm" onClick={() => ask(`Customer cancels ${s.id}`, 'The customer cancels this subscription in their bank app.', () => adminService.sim.post(`/subscriptions/${s.id}/customer-cancel`))}>Customer cancel</Button>
                  </span>
                )}
              </div>
            ))}
          </section>
          <section aria-label="Simulated refunds" className="space-y-2">
            <h2 className="font-semibold">Refunds</h2>
            {state.data.refunds.length === 0 && <p className="text-sm text-ink-3">None.</p>}
            {state.data.refunds.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-xl border border-line bg-raised px-3 py-2 text-sm">
                <span>{r.id} · {r.status}</span>
                {canWrite && <Button size="sm" onClick={() => ask(`Fail refund ${r.id}`, 'The simulated refund fails.', () => adminService.sim.post(`/refunds/${r.id}/fail`))}>Fail refund</Button>}
              </div>
            ))}
          </section>
          <p className="text-xs text-ink-3">{state.data.payments.length} simulated payment(s), {state.data.pending_webhooks.length} webhook(s) waiting.</p>
        </div>
      )}
      <ConfirmDialog open={!!pending} onClose={() => setPending(null)} onConfirm={() => confirm.mutate()} title={pending?.title ?? ''} description={pending?.description ?? ''} confirmLabel="Do it" loading={confirm.isPending} error={confirm.isError ? errorMessage(confirm.error) : null} />
    </>
  )
}
