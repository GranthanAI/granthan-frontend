import { groupLabel } from '@/content/plans'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Skeleton, TextField } from '@/components/ui/primitives'
import { errorMessage } from '@/lib/errors'
import { formatIstDate, formatPaise } from '@/lib/format'
import { adminService } from '@/services/admin.service'
import { microInr } from './AccountsPage'
import { ReasonDialog } from './ReasonDialog'
import { useCanWrite } from './useCanWrite'

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const today = () => isoDay(new Date())
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000))

// --- costs -------------------------------------------------------------------------------------------------------

interface CostRow { key: string; cost_micro_inr: number; events: number; price_paise?: number | null }
const BY = [{ v: 'provider', label: 'By provider' }, { v: 'plan', label: 'By plan' }, { v: 'user', label: 'Heavy users' }] as const

export function CostsPage() {
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [by, setBy] = useState<(typeof BY)[number]['v']>('provider')
  const q = useQuery({
    queryKey: ['admin', 'costs', by, from, to],
    queryFn: ({ signal }) => adminService.get<{ rows: CostRow[] }>('/costs', { from, to, by }, signal),
    retry: false,
  })
  const rows = q.data?.rows ?? []
  const total = rows.reduce((s, r) => s + r.cost_micro_inr, 0)
  return (
    <>
      <h1 className="text-xl font-semibold">Costs</h1>
      <div className="flex flex-wrap items-end gap-3">
        <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <div role="radiogroup" aria-label="Group by" className="flex gap-1">
          {BY.map((b) => (
            <button key={b.v} role="radio" aria-checked={by === b.v} onClick={() => setBy(b.v)} className={`rounded-lg border px-3 py-2 text-sm ${by === b.v ? 'border-accent bg-accent-soft' : 'border-line'}`}>{b.label}</button>
          ))}
        </div>
      </div>
      {q.isPending && <Skeleton className="h-24 w-full" />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.isSuccess && (
        <table className="w-full text-left text-sm" aria-label="Costs">
          <thead><tr className="border-b border-line text-ink-3"><th className="py-2">{by === 'user' ? 'User' : by === 'plan' ? 'Plan' : 'Provider'}</th><th>Events</th><th>Cost</th>{by !== 'provider' && <th>Charged to users</th>}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-line/60"><td className="py-2">{r.key}</td><td>{r.events}</td><td>{microInr(r.cost_micro_inr)}</td>{by !== 'provider' && <td>{formatPaise(r.price_paise ?? 0)}</td>}</tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="py-3 text-ink-3">No usage in this period.</td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr><td className="py-2 font-medium">Total</td><td></td><td className="font-medium" data-testid="cost-total">{microInr(total)}</td></tr></tfoot>}
        </table>
      )}
    </>
  )
}

// --- reconciliation ------------------------------------------------------------------------------------------------

interface Check { check: string; status: string; difference_paise: number | null; details: unknown; created_at: string }

/** A check that differs from the books, or is not ok, stands out. */
export const isProblem = (c: Check) => c.status !== 'ok' || (c.difference_paise ?? 0) !== 0

export function ReconciliationPage() {
  const [date, setDate] = useState(today())
  const q = useQuery({
    queryKey: ['admin', 'reconciliation', date],
    queryFn: ({ signal }) => adminService.get<{ checks: Check[] }>('/reconciliation', { date }, signal),
    retry: false,
  })
  return (
    <>
      <h1 className="text-xl font-semibold">Reconciliation</h1>
      <TextField label="Run date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-52" />
      {q.isPending && <Skeleton className="h-24 w-full" />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.isSuccess && q.data.checks.length === 0 && <p className="text-sm text-ink-3">No reconciliation run on this date.</p>}
      {q.isSuccess && q.data.checks.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-raised" aria-label="Checks">
          {q.data.checks.map((c) => (
            <li key={c.check} data-problem={isProblem(c)} className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm ${isProblem(c) ? 'bg-warn-soft text-warn' : ''}`}>
              <span className="font-medium">{c.check}</span>
              <span>{c.status}{c.difference_paise ? ` · difference ${formatPaise(c.difference_paise)}` : ''} <span className="text-xs text-ink-3">{formatIstDate(c.created_at)}</span></span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

// --- settlements -----------------------------------------------------------------------------------------------------

interface SettlementLine { payment_id: string; fee_paise: number; fee_gst_paise: number }
/** CSV lines "payment_id,fee_paise,fee_gst_paise"; returns the good lines and the bad ones (1-based line number). */
export function parseSettlements(text: string): { lines: SettlementLine[]; bad: number[] } {
  const lines: SettlementLine[] = []
  const bad: number[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const row = raw.trim()
    if (!row || row.toLowerCase().startsWith('payment_id')) return
    const [id, fee, gst] = row.split(',').map((x) => x.trim())
    const ok = !!id && /^\d+$/.test(fee ?? '') && /^\d+$/.test(gst ?? '')
    if (ok) lines.push({ payment_id: id!, fee_paise: Number(fee), fee_gst_paise: Number(gst) })
    else bad.push(i + 1)
  })
  return { lines, bad }
}

export function SettlementsPage() {
  const canWrite = useCanWrite()
  const [text, setText] = useState('')
  const [asking, setAsking] = useState(false)
  const [results, setResults] = useState<Array<{ id: string; ok: boolean; note: string }>>([])
  const parsed = parseSettlements(text)
  return (
    <>
      <h1 className="text-xl font-semibold">Settlements</h1>
      <p className="text-sm text-ink-2">Paste the gateway's settlement report as CSV: <code>payment_id,fee_paise,fee_gst_paise</code>, one payment per line. Amounts are paise.</p>
      <textarea aria-label="Settlement CSV" value={text} onChange={(e) => setText(e.target.value)} rows={6} className="w-full rounded-lg border border-line bg-raised p-3 font-mono text-xs" />
      {parsed.bad.length > 0 && <Alert tone="warn">Check line{parsed.bad.length > 1 ? 's' : ''} {parsed.bad.join(', ')}: each needs a payment id and two whole numbers.</Alert>}
      {canWrite ? <div><Button variant="primary" disabled={!parsed.lines.length || parsed.bad.length > 0} onClick={() => setAsking(true)}>Import {parsed.lines.length || ''} settlement{parsed.lines.length === 1 ? '' : 's'}</Button></div> : <p className="text-sm text-ink-3">Importing needs the billing_admin role.</p>}
      {results.length > 0 && (
        <ul className="text-sm" aria-label="Import results">{results.map((r) => <li key={r.id} className={r.ok ? 'text-ok' : 'text-danger'}>{r.id}: {r.note}</li>)}</ul>
      )}
      {asking && (
        <ReasonDialog title={`Import ${parsed.lines.length} settlements?`} description="Each payment's gateway fee and the GST on it are posted to the books." confirmLabel="Import" onClose={() => setAsking(false)}
          onConfirm={async (reason) => {
            const out: typeof results = []
            for (const l of parsed.lines) {
              try {
                const r = await adminService.post<{ posted: boolean }>('/settlements', { ...l, reason })
                out.push({ id: l.payment_id, ok: true, note: r.posted ? 'posted' : 'already posted' })
              } catch (e) {
                out.push({ id: l.payment_id, ok: false, note: errorMessage(e) })
              }
            }
            setResults(out)
          }} />
      )}
    </>
  )
}

// --- model prices and FX ------------------------------------------------------------------------------------------------

interface PriceRow { model: string; provider: string; model_group: string; input_usd_per_m: string | number; cached_input_usd_per_m: string | number | null; output_usd_per_m: string | number; effective_from: string }
interface FxRow { effective_from: string; usd_inr: string | number; source: string }

export function PricesPage() {
  const canWrite = useCanWrite()
  const qc = useQueryClient()
  const prices = useQuery({ queryKey: ['admin', 'prices'], queryFn: ({ signal }) => adminService.get<{ prices: PriceRow[] }>('/model-prices', undefined, signal), retry: false })
  const fx = useQuery({ queryKey: ['admin', 'fx'], queryFn: ({ signal }) => adminService.get<{ rates: FxRow[] }>('/fx-rates', undefined, signal), retry: false })
  const [dialog, setDialog] = useState<'price' | 'fx' | null>(null)
  const [p, setP] = useState({ model: '', provider: '', group: 'smart', input: '', cached: '', output: '', from: today() })
  const [f, setF] = useState({ from: today(), rate: '', source: 'admin' })
  const num = (v: string) => /^\d+(\.\d+)?$/.test(v.trim())
  const priceOk = !!p.model.trim() && !!p.provider.trim() && num(p.input) && num(p.output) && (p.cached === '' || num(p.cached))
  const fxOk = num(f.rate) && !!f.source.trim()
  return (
    <>
      <h1 className="text-xl font-semibold">Prices and FX</h1>
      <p className="text-sm text-ink-2">History is never edited: a change is a new row that takes effect from its date.</p>

      <div className="flex items-center justify-between"><h2 className="font-semibold">Model prices (USD per million tokens)</h2>{canWrite && <Button size="sm" onClick={() => setDialog('price')}>Add a price row</Button>}</div>
      {prices.isError && <Alert tone="error">{errorMessage(prices.error)}</Alert>}
      {prices.isSuccess && (
        <table className="w-full text-left text-sm" aria-label="Model prices">
          <thead><tr className="border-b border-line text-ink-3"><th className="py-2">Model</th><th>Group</th><th>Input</th><th>Cached</th><th>Output</th><th>Effective from</th></tr></thead>
          <tbody>{prices.data.prices.map((r) => <tr key={`${r.model}${r.effective_from}`} className="border-b border-line/60"><td className="py-1.5">{r.model}</td><td>{groupLabel(r.model_group)}</td><td>{r.input_usd_per_m}</td><td>{r.cached_input_usd_per_m ?? '—'}</td><td>{r.output_usd_per_m}</td><td>{formatIstDate(r.effective_from)}</td></tr>)}</tbody>
        </table>
      )}

      <div className="flex items-center justify-between"><h2 className="font-semibold">USD → INR</h2>{canWrite && <Button size="sm" onClick={() => setDialog('fx')}>Add a rate</Button>}</div>
      {fx.isError && <Alert tone="error">{errorMessage(fx.error)}</Alert>}
      {fx.isSuccess && (
        <table className="w-full text-left text-sm" aria-label="FX rates">
          <thead><tr className="border-b border-line text-ink-3"><th className="py-2">Effective from</th><th>₹ per US$</th><th>Source</th></tr></thead>
          <tbody>{fx.data.rates.map((r) => <tr key={r.effective_from} className="border-b border-line/60"><td className="py-1.5">{formatIstDate(r.effective_from)}</td><td>{r.usd_inr}</td><td>{r.source}</td></tr>)}</tbody>
        </table>
      )}

      {dialog === 'price' && (
        <ReasonDialog title="Add a model price" description="A new row; earlier rows stay as they are." confirmLabel="Add price" onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            if (!priceOk) throw new Error('Fill in the model, provider and the input and output prices (numbers).')
            await adminService.put('/model-prices', { model: p.model.trim(), provider: p.provider.trim(), group: p.group, input_usd_per_m: p.input.trim(), cached_input_usd_per_m: p.cached.trim() || null, output_usd_per_m: p.output.trim(), effective_from: `${p.from}T00:00:00+05:30`, reason })
            await qc.invalidateQueries({ queryKey: ['admin', 'prices'] })
          }}>
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Model id" value={p.model} onChange={(e) => setP({ ...p, model: e.target.value })} />
            <TextField label="Provider" value={p.provider} onChange={(e) => setP({ ...p, provider: e.target.value })} />
            <label className="text-sm"><span className="mb-1.5 block font-medium">Group</span><select value={p.group} onChange={(e) => setP({ ...p, group: e.target.value })} className="h-10 w-full rounded-lg border border-line bg-raised px-3 text-sm">{['fast', 'smart', 'best', 'ultra'].map((g) => <option key={g} value={g}>{groupLabel(g)}</option>)}</select></label>
            <TextField label="Effective from" type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} />
            <TextField label="Input $/M" value={p.input} onChange={(e) => setP({ ...p, input: e.target.value })} />
            <TextField label="Cached input $/M (optional)" value={p.cached} onChange={(e) => setP({ ...p, cached: e.target.value })} />
            <TextField label="Output $/M" value={p.output} onChange={(e) => setP({ ...p, output: e.target.value })} />
          </div>
        </ReasonDialog>
      )}
      {dialog === 'fx' && (
        <ReasonDialog title="Add an exchange rate" confirmLabel="Add rate" onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            if (!fxOk) throw new Error('Enter the rate as a number and a source.')
            await adminService.put('/fx-rates', { effective_from: f.from, usd_inr: f.rate.trim(), source: f.source.trim(), reason })
            await qc.invalidateQueries({ queryKey: ['admin', 'fx'] })
          }}>
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Effective from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
            <TextField label="₹ per US$" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
            <TextField label="Source" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} />
          </div>
        </ReasonDialog>
      )}
    </>
  )
}
