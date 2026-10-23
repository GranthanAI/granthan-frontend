import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Download, Film, GitBranch, Search, Sparkles, Workflow } from 'lucide-react'
import { Alert, Button, EmptyState, Skeleton } from '@/components/ui/primitives'
import { toast } from '@/components/ui/overlays'
import { errorMessage } from '@/lib/errors'
import { saveBlob, safeFileName } from '@/lib/download'
import { cn, parseServerDate } from '@/lib/utils'
import type { Conversation } from '@/types/api'
import { ArtifactVideo } from './ArtifactVideo'
import { MermaidPreview } from './MermaidPreview'
import { useArtifactList, useRetryArtifact } from './hooks'
import { scrollToMessage } from './navigate'
import { artifactKeys, artifactService, type Artifact, type ArtifactGroup, type ArtifactScope, type ArtifactType } from './service'

const FILTERS: { id: ArtifactType | null; label: string }[] = [
  { id: null, label: 'All' },
  { id: 'mermaid', label: 'Mermaid' },
  { id: 'manim', label: 'Manim' },
]

const STATUS: Record<Artifact['status'], { label: string; tone: string }> = {
  pending: { label: 'Waiting', tone: 'bg-warn-soft text-warn' },
  queued: { label: 'Queued', tone: 'bg-warn-soft text-warn' },
  rendering: { label: 'Rendering', tone: 'bg-warn-soft text-warn' },
  uploading: { label: 'Saving', tone: 'bg-warn-soft text-warn' },
  ready: { label: 'Ready', tone: 'bg-ok-soft text-ok' },
  failed: { label: 'Failed', tone: 'bg-danger-soft text-danger' },
}

const fmt = (iso: string) =>
  new Date(parseServerDate(iso)).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * The right-hand "Artifacts" tab: the Mermaid diagrams and Manim animations that are actually persisted for this
 * conversation, or for its whole authorised hierarchy, grouped by the conversation that produced them. Everything shown
 * comes from the artifact registry; opening this tab never starts a render.
 */
export function ArtifactsTab({ conversation }: { conversation: Conversation }) {
  const isChild = !!conversation.parent_conversation_id
  // A root conversation shows its whole tree by default; a branch shows only its own artifacts until the user widens it.
  const [scope, setScope] = useState<ArtifactScope>(isChild ? 'self' : 'hierarchy')
  const [type, setType] = useState<ArtifactType | null>(null)
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim(), 250)

  const list = useArtifactList(conversation.conversation_id, scope, type, q)

  return (
    <div className="space-y-3" data-testid="artifacts-tab">
      <div role="group" aria-label="Artifact scope" className="flex rounded-lg border border-line p-0.5 text-xs">
        {(
          [
            ['self', 'This conversation'],
            ['hierarchy', 'Whole hierarchy'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-pressed={scope === id}
            onClick={() => setScope(id)}
            className={cn('flex-1 rounded-md px-2 py-1.5', scope === id ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2 hover:bg-surface-2')}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            aria-label="Search artifacts"
            className="h-8 w-full rounded-lg border border-line bg-surface pl-7 pr-2 text-sm"
          />
        </div>
        <div role="group" aria-label="Filter by type" className="flex shrink-0 gap-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              aria-pressed={type === f.id}
              onClick={() => setType(f.id)}
              className={cn('rounded-md px-2 py-1 text-xs', type === f.id ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2 hover:bg-surface-2')}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {list.isPending ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading artifacts">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : list.isError ? (
        <Alert
          tone="error"
          action={
            <Button size="sm" onClick={() => list.refetch()}>
              Retry
            </Button>
          }
        >
          Artifacts could not be loaded ({errorMessage(list.error)}).
        </Alert>
      ) : list.data.total === 0 ? (
        q || type ? (
          <EmptyState icon={<Search className="size-5" />} title="No matching artifacts">
            Nothing matches the current search or filter.
          </EmptyState>
        ) : (
          <EmptyState icon={<Sparkles className="size-5" />} title="No artifacts yet">
            Diagrams and animations generated in {scope === 'hierarchy' ? 'this conversation and its branches' : 'this conversation'} will appear here.
          </EmptyState>
        )
      ) : (
        <div className="space-y-4">
          {list.data.groups.map((g) => (
            <Group key={g.conversation_id} group={g} showHeader={list.data.scope === 'hierarchy'} currentConversationId={conversation.conversation_id} />
          ))}
        </div>
      )}
    </div>
  )
}

function Group({ group, showHeader, currentConversationId }: { group: ArtifactGroup; showHeader: boolean; currentConversationId: string }) {
  const navigate = useNavigate()
  return (
    <section aria-label={`Artifacts from ${group.title}`}>
      {showHeader && (
        <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
          <GitBranch className="size-3.5" aria-hidden />
          {group.is_current ? (
            <span className="truncate">{group.title}</span>
          ) : (
            <button className="truncate text-accent hover:underline" onClick={() => navigate(`/c/${group.conversation_id}`)}>
              {group.title}
            </button>
          )}
          {group.is_current && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-normal">Current</span>}
        </h3>
      )}
      <ul className="space-y-2">
        {group.artifacts.map((a) => (
          <li key={`${a.artifact_id}:${a.source_message_id}`}>
            <ArtifactItem artifact={a} sameConversation={group.conversation_id === currentConversationId} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ArtifactItem({ artifact: a, sameConversation }: { artifact: Artifact; sameConversation: boolean }) {
  const navigate = useNavigate()
  const retry = useRetryArtifact()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const status = STATUS[a.status]
  const Icon = a.type === 'mermaid' ? Workflow : Film
  const canPreview = a.type === 'mermaid' ? !!a.source : a.ready

  const goToMessage = async () => {
    if (!a.source_message_id || !a.conversation_id) return
    if (!sameConversation) navigate(`/c/${a.conversation_id}`)
    const found = await scrollToMessage(a.source_message_id, sameConversation ? 800 : 6000)
    if (!found) toast('That message is not loaded yet. Load earlier messages and try again.')
  }

  // Reuses the blob already cached for playback, so downloading never triggers a render or a second fetch.
  const download = async () => {
    setDownloading(true)
    try {
      const blob = await qc.fetchQuery({ queryKey: artifactKeys.media(a.artifact_id), queryFn: () => artifactService.media(a.artifact_id), staleTime: Infinity })
      saveBlob(blob, safeFileName(a.title, 'animation', '.mp4'))
    } catch (e) {
      toast(`Download failed: ${errorMessage(e)}`, 'error')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface" data-testid="artifact-item" data-artifact-id={a.artifact_id}>
      <div className="flex items-start gap-2 px-2.5 py-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium" title={a.title}>
              {a.title}
            </p>
            <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', status.tone)}>{status.label}</span>
          </div>
          <p className="text-xs text-ink-3">
            {a.type === 'mermaid' ? 'Mermaid diagram' : 'Manim animation'} · {fmt(a.created_at)}
          </p>
          {a.status === 'failed' && <p className="mt-1 text-xs text-danger">{a.message}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-t border-line px-1.5 py-1">
        {canPreview && (
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Preview'} ${a.title}`}>
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} {open ? 'Hide' : 'Preview'}
          </Button>
        )}
        {a.source_message_id && (
          <Button size="sm" variant="ghost" onClick={goToMessage} aria-label={`Go to the message containing ${a.title}`}>
            Go to message
          </Button>
        )}
        {a.type === 'manim' && a.has_media && (
          <Button size="sm" variant="ghost" loading={downloading} onClick={download} aria-label={`Download ${a.title}`}>
            <Download className="size-3.5" /> Download
          </Button>
        )}
        {a.status === 'failed' && a.retryable && (
          <Button size="sm" variant="ghost" loading={retry.isPending} onClick={() => retry.mutate(a.artifact_id)} aria-label={`Retry rendering ${a.title}`}>
            Retry
          </Button>
        )}
      </div>
      {retry.isError && <p className="px-2.5 pb-2 text-xs text-danger">{errorMessage(retry.error)}</p>}
      {open && canPreview && (
        <div className="border-t border-line p-2">{a.type === 'mermaid' && a.source ? <MermaidPreview key={a.source} source={a.source} /> : <ArtifactVideo artifact={a} />}</div>
      )}
    </div>
  )
}
