import { useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, Button } from '@/components/ui/primitives'
import { saveBlob } from '@/lib/download'
import { uuid } from '@/lib/utils'
import { orgService } from '@/services/org.service'
import type { CsvUpload, Me, OrgRole } from '@/types/org'
import { CSV_REASON_COPY, orgErrorMessage } from './errors'
import { Card, FormError, Upsell } from './shared'

export const CSV_MAX_BYTES = 1_048_576

/** Checked in the browser before anything is sent; the server checks again. Returns a message, or '' when the file is fine. */
export function csvFileProblem(file: File): string {
  if (!/\.csv$/i.test(file.name)) return 'Choose a .csv file.'
  if (file.size === 0) return 'This file is empty.'
  if (file.size > CSV_MAX_BYTES) return 'This file is larger than 1 MB. Split it into smaller files.'
  return ''
}

/** Invites tab, owner and admin: pick a file, check it (dry run), send it, then follow the batch. */
export function CsvInvites({ me }: { me: Me }) {
  const id = me.org.id
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [role, setRole] = useState<Exclude<OrgRole, 'owner'>>('member')
  const [problem, setProblem] = useState('')
  const [report, setReport] = useState<CsvUpload | null>(null)
  const [batchId, setBatchId] = useState<string | null>(null)
  const sendKey = useRef(uuid()) // one key per file+role choice, so a double click cannot send twice

  const reset = () => { setReport(null); setBatchId(null); sendKey.current = uuid() }
  const check = useMutation({
    mutationFn: () => orgService.uploadCsv(id, file!, role, true),
    onSuccess: (r) => { setReport(r); setProblem('') },
    onError: (e) => setProblem(orgErrorMessage(e)),
  })
  const send = useMutation({
    mutationFn: () => orgService.uploadCsv(id, file!, role, false, sendKey.current),
    onSuccess: (r) => { setBatchId(r.batch_id); setProblem('') },
    onError: (e) => setProblem(orgErrorMessage(e)),
  })

  if (!me.features.csv_invites) return <Card title="Invite from a CSV file"><Upsell what="Bulk invites from a file" /></Card>
  const pick = (f: File | null) => {
    reset()
    setFile(null)
    if (!f) return setProblem('')
    const p = csvFileProblem(f)
    setProblem(p)
    if (!p) setFile(f)
  }
  const warnSeats = report && report.seats.bought != null && report.seats.used + report.seats.open_invites + report.rows_ok > report.seats.bought
  return (
    <Card title="Invite from a CSV file">
      <p className="text-sm text-ink-2">One email per row, up to 1 MB. A header row named “email” is fine. We check the file first; nothing is sent until you confirm.</p>
      <FormError message={problem} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">CSV file
          <input ref={input} type="file" accept=".csv,text/csv" className="mt-1 block text-sm" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </label>
        <label className="text-sm">Role
          <select value={role} onChange={(e) => { setRole(e.target.value as 'admin' | 'member'); reset() }} className="ml-2 h-8 rounded-lg border border-line bg-raised px-2 text-sm">
            <option value="member">Member</option>
            {me.role === 'owner' && <option value="admin">Admin</option>}
          </select>
        </label>
        <Button variant="primary" disabled={!file} loading={check.isPending} onClick={() => check.mutate()}>Check file</Button>
      </div>

      {report && !batchId && (
        <div className="space-y-3" data-testid="csv-report">
          <p className="text-sm" data-testid="csv-counts">{report.rows_total} rows · <strong>{report.rows_ok} ready</strong> · {report.rows_failed} with a problem</p>
          {report.seats.payment_due && <Alert tone="warn">This organisation has a payment due. Invitations can go out, but people cannot join until it is paid.</Alert>}
          {warnSeats && <Alert tone="warn">There are fewer free seats than invitations ({report.seats.used} used + {report.seats.open_invites} invited of {report.seats.bought}). Rows beyond the free seats are skipped.</Alert>}
          {report.errors_preview.length > 0 && (
            <table className="w-full text-left text-sm" data-testid="csv-errors">
              <caption className="pb-1 text-left text-xs text-ink-3">First {Math.min(20, report.errors_preview.length)} problems{report.rows_failed > 20 ? ` of ${report.rows_failed}` : ''}</caption>
              <thead><tr className="text-ink-3"><th className="pr-3 font-medium">Row</th><th className="pr-3 font-medium">Email</th><th className="font-medium">Problem</th></tr></thead>
              <tbody>{report.errors_preview.slice(0, 20).map((e) => <tr key={`${e.row}-${e.email}`}><td className="pr-3">{e.row}</td><td className="pr-3 break-all">{e.email}</td><td>{CSV_REASON_COPY[e.reason] ?? e.reason}</td></tr>)}</tbody>
            </table>
          )}
          <div className="flex gap-2">
            <Button variant="primary" disabled={report.rows_ok === 0} loading={send.isPending} onClick={() => send.mutate()}>Send {report.rows_ok} invites</Button>
            {report.rows_failed > 0 && <DownloadErrors batchId={report.batch_id} />}
          </div>
        </div>
      )}
      {batchId && <BatchProgress batchId={batchId} />}
    </Card>
  )
}

export function DownloadErrors({ batchId }: { batchId: string }) {
  const [error, setError] = useState('')
  const download = useMutation({
    mutationFn: () => orgService.batchErrors(batchId),
    onSuccess: ({ blob, filename }) => { setError(''); saveBlob(blob, filename ?? `invite-errors-${batchId}.csv`) },
    onError: (e) => setError(orgErrorMessage(e)),
  })
  return <><Button loading={download.isPending} onClick={() => download.mutate()}>Download errors</Button>{error && <span role="alert" className="text-sm text-danger">{error}</span>}</>
}

const FINISHED = ['done', 'stopped']

/** The batch after "Send": polls every 5 seconds until it is done or stopped. */
export function BatchProgress({ batchId }: { batchId: string }) {
  const batch = useQuery({
    queryKey: ['org', 'batch', batchId],
    queryFn: ({ signal }) => orgService.batch(batchId, signal),
    refetchInterval: (q) => (q.state.data && FINISHED.includes(q.state.data.status) ? false : 5000),
  })
  const b = batch.data
  return (
    <div className="space-y-2 text-sm" data-testid="batch-progress">
      {batch.isError && <Alert tone="error">{orgErrorMessage(batch.error)}</Alert>}
      {!b && !batch.isError && <p className="text-ink-2">Starting…</p>}
      {b && (
        <>
          <p><strong>{b.status === 'done' ? 'Finished' : b.status === 'stopped' ? 'Stopped' : 'Sending…'}</strong> · {b.sent} sent · {b.pending_send} waiting · {b.not_sent} not sent</p>
          {b.status === 'stopped' && <Alert tone="warn">Sending stopped{b.errors_note ? `: ${b.errors_note}` : ''}. The invitations that did not go out were not sent.</Alert>}
          {b.rows_failed > 0 && <DownloadErrors batchId={batchId} />}
        </>
      )}
    </div>
  )
}
