import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { Alert, Button, EmptyState, Skeleton } from '@/components/ui/primitives'
import { ConfirmDialog, toast } from '@/components/ui/overlays'
import { SettingsSection } from '@/components/settings/controls'
import { toApiError } from '@/lib/errors'
import { qk } from '@/lib/query-keys'
import { fileService } from '@/services/file.service'
import type { FileListItem } from '@/types/api'

const LABEL: Record<string, string> = {
  UPLOADING: 'Uploading',
  UPLOADED: 'Queued',
  SCANNING: 'Scanning',
  PROCESSING: 'Processing',
  READY: 'Ready',
  FAILED: 'Failed',
  DELETING: 'Deleting',
  DELETED: 'Deleted',
}

/** Why a FAILED document failed, as reported (and sanitised) by the server. */
function FailureReason({ id }: { id: string }) {
  const s = useQuery({ queryKey: qk.fileStatus(id), queryFn: ({ signal }) => fileService.status(id, signal), staleTime: 30_000 })
  if (!s.data) return null
  return (
    <p className="mt-0.5 text-xs text-danger">
      {s.data.error_message || 'Processing failed.'}
    </p>
  )
}

/** Settings → Documents & knowledge. */
export function DocumentsSettings() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: qk.files(), queryFn: () => fileService.list({ limit: 100 }), retry: 1 })
  const [deleting, setDeleting] = useState<FileListItem | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['files'] })

  const retry = useMutation({
    mutationFn: (id: string) => fileService.retry(id),
    onSuccess: (_r, id) => {
      void qc.invalidateQueries({ queryKey: qk.fileStatus(id) })
      void refresh()
      toast('Processing restarted', 'success')
    },
    onError: (e) => toast(toApiError(e).message, 'error'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => fileService.remove(id),
    onSuccess: () => {
      setDeleting(null)
      void refresh()
      toast('Document deleted', 'success')
    },
  })

  const items = (list.data?.items ?? []).filter((f) => f.status !== 'DELETED')
  return (
    <>
      <SettingsSection
        title="Documents & knowledge"
        description="Files you have uploaded. Ready documents can be used as context in your chats. Deleting a document removes it and its searchable content."
      >
        {list.isPending && <Skeleton className="h-16 w-full" />}
        {list.isError && (
          <Alert tone="error" action={<Button size="sm" onClick={() => void list.refetch()}>Retry</Button>}>
            {toApiError(list.error).message}
          </Alert>
        )}
        {list.data && items.length === 0 && (
          <EmptyState icon={<FileText className="size-6" aria-hidden />} title="No documents">
            Attach a file in the chat composer to add one.
          </EmptyState>
        )}
        {items.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {items.map((f) => (
              <li key={f.document_id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{f.filename}</p>
                  <p className="text-xs text-ink-3">{LABEL[f.status] ?? f.status}</p>
                  {f.status === 'FAILED' && <FailureReason id={f.document_id} />}
                </div>
                <div className="flex shrink-0 gap-2">
                  {f.status === 'FAILED' && (
                    <Button size="sm" loading={retry.isPending && retry.variables === f.document_id} onClick={() => retry.mutate(f.document_id)}>
                      Retry
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={f.status === 'DELETING'} onClick={() => setDeleting(f)} aria-label={`Delete ${f.filename}`}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this document?"
        description={deleting ? `“${deleting.filename}” and its searchable content will be removed.` : ''}
        loading={remove.isPending}
        error={remove.isError ? toApiError(remove.error).message : null}
        onConfirm={() => deleting && remove.mutate(deleting.document_id)}
      />
    </>
  )
}
