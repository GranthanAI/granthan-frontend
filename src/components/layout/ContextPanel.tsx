import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, GitBranch, Info, NotebookPen, Rows2, RefreshCw, Shapes, Trash2, X } from 'lucide-react'
import { Alert, Button, EmptyState, Skeleton, Spinner } from '@/components/ui/primitives'
import { ConfirmDialog, toast } from '@/components/ui/overlays'
import { ArtifactsTab } from '@/features/artifacts/ArtifactsTab'
import { NotesTab } from '@/features/notes/NotesTab'
import { useDialogs } from '@/features/conversations/dialogs'
import { useLineage } from '@/features/conversations/hooks'
import { useBranchContext } from '@/features/conversations/useBranchContext'
import { useMessages } from '@/features/messages/hooks'
import { allDocumentIds } from '@/features/uploads/useDocumentContext'
import { errorMessage } from '@/lib/errors'
import { qk } from '@/lib/query-keys'
import { cn, parseServerDate } from '@/lib/utils'
import { fileService } from '@/services/file.service'
import { useUiStore, type PanelTab } from '@/stores/ui.store'
import type { Conversation, FileListItem } from '@/types/api'

const tabs: { id: PanelTab; label: string; icon: React.ReactNode }[] = [
  { id: 'details', label: 'Details', icon: <Info className="size-4" /> },
  { id: 'files', label: 'Files', icon: <FileText className="size-4" /> },
  { id: 'artifacts', label: 'Artifacts', icon: <Shapes className="size-4" /> },
  { id: 'notes', label: 'Notes', icon: <NotebookPen className="size-4" /> },
]

export function ContextPanel({ conversation }: { conversation: Conversation | undefined }) {
  const { panelTab, panelStack, stackTabs, selectPanelTab, setPanelStack, closePanel } = useUiStore()
  // In stack mode every open section is shown (in tab order); otherwise just the selected one.
  const open = panelStack ? tabs.filter((t) => stackTabs.includes(t.id)) : tabs.filter((t) => t.id === panelTab)
  const stacked = open.length > 1
  return (
    <aside aria-label="Conversation context" className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div role="tablist" aria-label="Context sections" aria-multiselectable={panelStack} className="flex min-w-0 gap-0.5 overflow-x-auto">
          {tabs.map((t) => {
            const active = open.some((o) => o.id === t.id)
            return (
              <button
                key={t.id}
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={active}
                aria-controls={`panel-${t.id}`}
                onClick={() => selectPanelTab(t.id)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm',
                  active ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2 hover:bg-surface-2',
                )}
              >
                {t.icon}
                {t.label}
              </button>
            )
          })}
        </div>
        <div className="ml-1 flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPanelStack(!panelStack)}
            aria-pressed={panelStack}
            aria-label={panelStack ? 'Show one section at a time' : 'Show several sections together'}
            title={panelStack ? 'Showing sections together. Click tabs to add or remove them' : 'Show several sections together, e.g. Artifacts and Notes'}
            className={cn(panelStack && 'bg-accent-soft text-ink')}
          >
            <Rows2 className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={closePanel} aria-label="Close context panel">
            <X className="size-4" />
          </Button>
        </div>
      </div>
      <div className={cn('flex min-h-0 flex-1 flex-col', stacked && 'divide-y divide-line')}>
        {open.map((t) => (
          <section
            key={t.id}
            role="tabpanel"
            id={`panel-${t.id}`}
            aria-labelledby={`tab-${t.id}`}
            className="flex min-h-0 flex-1 basis-0 flex-col"
          >
            {stacked && (
              <header className="flex shrink-0 items-center justify-between bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink-2">
                <span className="inline-flex items-center gap-1.5">{t.icon}{t.label}</span>
                <button
                  onClick={() => selectPanelTab(t.id)}
                  className="rounded p-0.5 hover:bg-surface hover:text-ink"
                  aria-label={`Hide ${t.label}`}
                >
                  <X className="size-3.5" />
                </button>
              </header>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <PanelBody tab={t.id} conversation={conversation} />
            </div>
          </section>
        ))}
      </div>
    </aside>
  )
}

function PanelBody({ tab, conversation }: { tab: PanelTab; conversation: Conversation | undefined }) {
  if (!conversation)
    return (
      <EmptyState icon={<Info className="size-5" />} title="No conversation selected">
        Open or start a conversation to see its details, files and memory context.
      </EmptyState>
    )
  if (tab === 'details') return <DetailsTab conversation={conversation} />
  if (tab === 'files') return <FilesTab conversationId={conversation.conversation_id} />
  if (tab === 'artifacts') return <ArtifactsTab key={conversation.conversation_id} conversation={conversation} />
  return <NotesTab key={conversation.conversation_id} conversationId={conversation.conversation_id} />
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  )
}

const fmt = (iso: string) =>
  new Date(parseServerDate(iso)).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function DetailsTab({ conversation: c }: { conversation: Conversation }) {
  const openDialog = useDialogs((s) => s.open)
  const { ancestors, children } = useLineage(c.conversation_id)
  return (
    <div className="space-y-5">
      <dl className="space-y-3">
        <Row label="Title">{c.title}</Row>
        <Row label="Created">{fmt(c.created_at)}</Row>
        <Row label="Last activity">{fmt(c.updated_at)}</Row>
        <Row label="Status">
          <span className="capitalize">{c.status}</span>
        </Row>
      </dl>

      <section aria-labelledby="lineage-h">
        <h3 id="lineage-h" className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <GitBranch className="size-4" aria-hidden /> Lineage
        </h3>
        {ancestors.isPending || children.isPending ? (
          <Skeleton className="h-16" />
        ) : ancestors.isError && children.isError ? (
          <Alert tone="warn">
            Lineage data from the Graph Service is unavailable right now ({errorMessage(ancestors.error)}).
          </Alert>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs text-ink-3">Branched from</div>
              {ancestors.data && ancestors.data.length > 0 ? (
                <ol className="mt-1 space-y-1">
                  {ancestors.data.map((a) => (
                    <li key={a.conversation_id}>
                      <Link className="text-accent hover:underline" to={`/c/${a.conversation_id}`}>
                        {a.title}
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-ink-2">Nothing: this is a root conversation.</p>
              )}
            </div>
            <div>
              <div className="text-xs text-ink-3">Branches</div>
              {children.data && children.data.length > 0 ? (
                <ul className="mt-1 space-y-1">
                  {children.data.map((k) => (
                    <li key={k.conversation_id}>
                      <Link className="text-accent hover:underline" to={`/c/${k.conversation_id}`}>
                        {k.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-2">No branches yet.</p>
              )}
            </div>
          </div>
        )}
        <Button className="mt-3" size="sm" onClick={() => openDialog({ kind: 'branch', conversation: c })}>
          <GitBranch className="size-4" /> Start a branch
        </Button>
        <p className="mt-2 text-xs text-ink-3">
          A branch is linked to this conversation but starts with an empty context; messages are not copied.
        </p>
      </section>
    </div>
  )
}

function FilesTab({ conversationId }: { conversationId: string }) {
  const qc = useQueryClient()
  const files = useQuery({
    queryKey: qk.files(conversationId),
    queryFn: () => fileService.list({ conversationId, limit: 50 }),
    refetchInterval: (q) =>
      q.state.data?.items.some((f) => ['UPLOADED', 'SCANNING', 'PROCESSING', 'UPLOADING'].includes(f.status)) ? 3000 : false,
  })
  // Files uploaded from the new-chat screen are created before the conversation exists, so File Service
  // has no conversation_id for them. The messages that carry them (file_ids) are the reliable link, so
  // those documents are merged in alongside the ones listed by conversation_id.
  const msgs = useMessages(conversationId)
  const inherited = useBranchContext(conversationId)
  const attachedIds = useMemo(
    () => [...new Set([...allDocumentIds(msgs.messages), ...inherited.documents.map((d) => d.document_id)])],
    [msgs.messages, inherited.documents],
  )
  const listedIds = new Set((files.data?.items ?? []).map((f) => f.document_id))
  const extraIds = attachedIds.filter((id) => !listedIds.has(id))
  const extras = useQueries({
    queries: extraIds.map((id) => ({
      queryKey: qk.file(id),
      queryFn: () => fileService.get(id),
      retry: false,
      staleTime: 10_000,
      refetchInterval: (q: { state: { data?: { status: string } } }) =>
        q.state.data && ['UPLOADED', 'SCANNING', 'PROCESSING', 'UPLOADING'].includes(q.state.data.status) ? 3000 : false,
    })),
  })
  const extraItems: FileListItem[] = extras.flatMap((q) =>
    q.data ? [{ document_id: q.data.document_id, filename: q.data.filename, status: q.data.status }] : [],
  )
  const [toDelete, setToDelete] = useState<FileListItem | null>(null)
  const del = useMutation({
    mutationFn: (id: string) => fileService.remove(id),
    onSuccess: (_d, id) => {
      void qc.invalidateQueries({ queryKey: qk.files(conversationId) })
      void qc.invalidateQueries({ queryKey: qk.file(id) })
      setToDelete(null)
      toast('File deleted', 'success')
    },
  })
  const retry = useMutation({
    mutationFn: (id: string) => fileService.retry(id),
    onSuccess: (_d, id) => {
      void qc.invalidateQueries({ queryKey: qk.files(conversationId) })
      void qc.invalidateQueries({ queryKey: qk.file(id) })
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  })
  const download = async (id: string) => {
    try {
      const { download_url } = await fileService.download(id)
      window.open(download_url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  if (files.isPending && extraItems.length === 0) return <Skeleton className="h-20" />
  if (files.isError && extraItems.length === 0)
    return (
      <Alert tone="error" action={<Button size="sm" variant="ghost" onClick={() => void files.refetch()}>Retry</Button>}>
        {errorMessage(files.error)}
      </Alert>
    )
  const items = [...(files.data?.items ?? []), ...extraItems].filter(
    (f) => f.status !== 'DELETED' && f.status !== 'DELETING',
  )
  if (items.length === 0)
    return (
      <EmptyState icon={<FileText className="size-5" />} title="No files in this conversation">
        Documents you attach to a message in this conversation are listed here, with their processing status.
      </EmptyState>
    )
  return (
    <>
      <ul className="space-y-2">
        {items.map((f) => (
          <li key={f.document_id} className="rounded-xl border border-line bg-raised p-3">
            <div className="flex items-start gap-2">
              <FileText className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" title={f.filename}>{f.filename}</div>
                <FileStatusBadge status={f.status} />
                {inherited.sources[f.document_id] && (
                  <div className="mt-0.5 text-xs text-ink-3">Inherited from {inherited.sources[f.document_id]}</div>
                )}
              </div>
            </div>
            <div className="mt-2 flex gap-1">
              <Button size="sm" variant="ghost" disabled={f.status !== 'READY'} onClick={() => void download(f.document_id)}>
                <Download className="size-3.5" /> Download
              </Button>
              {f.status === 'FAILED' && (
                <Button size="sm" variant="ghost" loading={retry.isPending && retry.variables === f.document_id} onClick={() => retry.mutate(f.document_id)}>
                  <RefreshCw className="size-3.5" /> Retry
                </Button>
              )}
              {!inherited.sources[f.document_id] && (
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => setToDelete(f)}>
                  <Trash2 className="size-3.5" /> Delete
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => { del.reset(); setToDelete(null) }}
        onConfirm={() => toDelete && del.mutate(toDelete.document_id)}
        title="Delete file?"
        description={`"${toDelete?.filename ?? ''}" will be removed and no longer used for answers.`}
        loading={del.isPending}
        error={del.error ? errorMessage(del.error) : null}
      />
    </>
  )
}

const statusStyle: Record<string, string> = {
  READY: 'text-ok',
  FAILED: 'text-danger',
}
const statusLabel: Record<string, string> = {
  UPLOADING: 'Uploading',
  UPLOADED: 'Uploaded, queued',
  SCANNING: 'Scanning',
  PROCESSING: 'Processing for search',
  READY: 'Ready',
  FAILED: 'Processing failed',
  DELETING: 'Deleting',
}

function FileStatusBadge({ status }: { status: string }) {
  const busy = ['UPLOADING', 'UPLOADED', 'SCANNING', 'PROCESSING', 'DELETING'].includes(status)
  return (
    <span className={cn('mt-0.5 inline-flex items-center gap-1 text-xs', statusStyle[status] ?? 'text-ink-3')}>
      {busy && <Spinner className="size-3" />}
      {statusLabel[status] ?? status}
    </span>
  )
}
