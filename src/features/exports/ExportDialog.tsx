import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText } from 'lucide-react'
import { Alert, Button, Spinner } from '@/components/ui/primitives'
import { Dialog, toast } from '@/components/ui/overlays'
import { saveBlob } from '@/lib/download'
import { errorMessage } from '@/lib/errors'
import { parseServerDate } from '@/lib/utils'
import type { Conversation } from '@/types/api'
import { exportService, isExportActive, type ExportFormat, type ExportJob, type ExportScope } from './service'

const fmtTime = (iso: string) => new Date(parseServerDate(iso)).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const fmtSize = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

function Choice<T extends string>({
  name,
  value,
  current,
  onChange,
  label,
  description,
  disabled,
}: {
  name: string
  value: T
  current: T
  onChange: (v: T) => void
  label: string
  description: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line p-2.5 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
      <input id={id} type="radio" name={name} value={value} checked={current === value} disabled={disabled} onChange={() => onChange(value)} className="mt-1" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-ink-2">{description}</span>
      </span>
    </label>
  )
}

/**
 * Export the open conversation, or its whole hierarchy, as Markdown or PDF. The file is built from the persisted messages
 * on the server (nothing is regenerated); large exports are jobs, so the dialog shows real progress and offers the
 * download only once the file is stored. Asking again for an unchanged conversation reuses the existing file.
 */
export function ExportDialog({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const qc = useQueryClient()
  const isBranch = !!conversation.parent_conversation_id
  const [scope, setScope] = useState<ExportScope>('conversation')
  const [format, setFormat] = useState<ExportFormat>('markdown')
  const [includeMedia, setIncludeMedia] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const mediaApplies = scope === 'hierarchy' && format === 'markdown'

  const create = useMutation({
    mutationFn: () =>
      exportService.create({ conversation_id: conversation.conversation_id, scope, format, include_media: mediaApplies && includeMedia }),
    onSuccess: (job) => {
      qc.setQueryData(['export', job.job_id], job)
      setJobId(job.job_id)
    },
  })
  const job = useQuery({
    queryKey: ['export', jobId],
    enabled: !!jobId,
    queryFn: ({ signal }) => exportService.get(jobId!, signal),
    initialData: () => (jobId ? qc.getQueryData<ExportJob>(['export', jobId]) : undefined),
    refetchOnWindowFocus: false,
    retry: false,
    refetchInterval: (q) => (isExportActive(q.state.data) ? 1500 : false), // stops at ready / failed / expired and on close
  })
  const j = job.data
  const busy = create.isPending || isExportActive(j)
  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setJobId(null)
    create.reset()
  }

  const download = async () => {
    if (!j?.filename) return
    setDownloading(true)
    try {
      saveBlob(await exportService.download(j.job_id), j.filename)
    } catch (e) {
      toast(`Download failed: ${errorMessage(e)}`, 'error')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="Export conversation" description="Exports the saved messages exactly as they are; nothing is summarised or regenerated.">
      <div className="space-y-4">
        <fieldset className="space-y-2" disabled={busy}>
          <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-3">What to export</legend>
          <Choice name="scope" value="conversation" current={scope} onChange={change(setScope)} label="This conversation" description="Only the messages of the selected conversation." />
          <Choice
            name="scope"
            value="hierarchy"
            current={scope}
            onChange={change(setScope)}
            label="Whole hierarchy"
            description={
              isBranch
                ? 'The root conversation, this branch, its siblings and every descendant, in one export.'
                : 'This conversation and every branch below it, in one export.'
            }
          />
        </fieldset>

        <fieldset className="space-y-2" disabled={busy}>
          <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-3">Format</legend>
          <Choice
            name="format"
            value="markdown"
            current={format}
            onChange={change(setFormat)}
            label="Markdown"
            description={scope === 'hierarchy' ? 'A ZIP with one .md file per conversation arranged like the branches, plus a manifest and README.' : 'A single .md file.'}
          />
          <Choice
            name="format"
            value="pdf"
            current={format}
            onChange={change(setFormat)}
            label="PDF"
            description={scope === 'hierarchy' ? 'One combined PDF with a contents list, conversations in tree order. Animations appear as a titled card, not as video.' : 'A single PDF. Animations appear as a titled card, not as video.'}
          />
        </fieldset>

        {mediaApplies && (
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={includeMedia} disabled={busy} onChange={(e) => change(setIncludeMedia)(e.target.checked)} className="mt-1" />
            <span>
              Include animation videos in the ZIP
              <span className="block text-xs text-ink-2">Each video is stored once, even if several messages show it. Larger download.</span>
            </span>
          </label>
        )}

        {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}

        {j && (
          <div aria-live="polite" data-testid="export-status">
            {isExportActive(j) && (
              <div role="status" className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-sm">
                <Spinner />
                <span>
                  {j.status === 'pending' ? 'Waiting to start…' : 'Building your export…'}
                  {j.progress.total > 1 && j.progress.done > 0 ? ` ${j.progress.done} of ${j.progress.total} conversations` : ''}
                </span>
              </div>
            )}
            {j.status === 'ready' && (
              <Alert tone="success">
                <p className="flex items-center gap-1.5 font-medium">
                  <FileText className="size-4" aria-hidden /> {j.filename} <span className="font-normal text-ink-2">{fmtSize(j.size_bytes)}</span>
                </p>
                {j.expires_at && <p className="mt-0.5 text-xs">Available to download until {fmtTime(j.expires_at)}.</p>}
              </Alert>
            )}
            {(j.status === 'failed' || j.status === 'expired') && (
              <Alert tone="error">
                {j.message ?? 'The export failed.'}
                {j.failure_code === 'pdf_unavailable' && ' Markdown export still works; choose it above.'}
              </Alert>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Close</Button>
          {j?.status === 'ready' ? (
            <Button variant="primary" loading={downloading} onClick={download}>
              <Download className="size-4" /> Download
            </Button>
          ) : (
            // a permanent failure (no PDF engine on the server) cannot succeed on retry: ask for a different choice instead
            <Button variant="primary" loading={busy} disabled={j?.failure_code === 'pdf_unavailable'} onClick={() => create.mutate()}>
              {j && (j.status === 'failed' || j.status === 'expired') ? 'Try again' : 'Export'}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
