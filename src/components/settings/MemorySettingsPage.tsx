import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'
import { Alert, Button, EmptyState, Skeleton } from '@/components/ui/primitives'
import { ConfirmDialog, toast } from '@/components/ui/overlays'
import { SettingsSection, TextAreaField, Toggle } from '@/components/settings/controls'
import { toApiError } from '@/lib/errors'
import { qk } from '@/lib/query-keys'
import { memoryService } from '@/services/memory.service'
import type { MemoryFact, MemoryFactList } from '@/types/api'

/** Settings → Memory. Saved facts the assistant may use; pausing is enforced server-side. */
export function MemorySettingsPage() {
  const qc = useQueryClient()
  const facts = useQuery({ queryKey: qk.memoryFacts, queryFn: ({ signal }) => memoryService.list(signal), retry: 1 })
  const [editing, setEditing] = useState<MemoryFact | null>(null)
  const [text, setText] = useState('')
  const [deleting, setDeleting] = useState<MemoryFact | null>(null)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState('')

  const setList = (fn: (l: MemoryFactList) => MemoryFactList) =>
    qc.setQueryData<MemoryFactList>(qk.memoryFacts, (l) => (l ? fn(l) : l))

  const pause = useMutation({
    mutationFn: (enabled: boolean) => memoryService.setEnabled(enabled),
    onSuccess: (s) => {
      setList((l) => ({ ...l, memory_enabled: s.memory_enabled }))
      toast(s.memory_enabled ? 'Memory is on' : 'Memory is paused', 'success')
    },
    onError: (e) => toast(toApiError(e).message, 'error'),
  })
  const save = useMutation({
    mutationFn: ({ fact, statement }: { fact: MemoryFact; statement: string }) => memoryService.update(fact, statement),
    onSuccess: (f, v) => {
      setList((l) => ({ ...l, items: l.items.map((i) => (i.id === v.fact.id ? f : i)) }))
      setEditing(null)
      toast('Memory updated', 'success')
    },
    onError: (e) => setError(toApiError(e).message),
  })
  const remove = useMutation({
    mutationFn: (fact: MemoryFact) => memoryService.remove(fact),
    onSuccess: (_r, fact) => {
      setList((l) => ({ ...l, items: l.items.filter((i) => i.id !== fact.id) }))
      setDeleting(null)
      toast('Memory deleted', 'success')
    },
    onError: (e) => setError(toApiError(e).message),
  })
  const clear = useMutation({
    mutationFn: () => memoryService.clear(),
    onSuccess: () => {
      setList((l) => ({ ...l, items: [] }))
      setClearing(false)
      toast('All saved memory deleted', 'success')
    },
    onError: (e) => setError(toApiError(e).message),
  })

  const data = facts.data
  return (
    <>
      <SettingsSection
        title="Memory"
        description="Facts GranthanAI has learned about you from your conversations (for example your role or preferences) so it can personalise future answers. This is separate from your chat history and conversation summaries, which are not affected here."
      >
        {facts.isPending && <Skeleton className="h-16 w-full" />}
        {facts.isError && (
          <Alert tone="error" action={<Button size="sm" onClick={() => void facts.refetch()}>Retry</Button>}>
            {toApiError(facts.error).message}
          </Alert>
        )}
        {data && (
          <>
            <Toggle
              label="Use and learn memory"
              description={
                data.memory_enabled
                  ? 'On: new facts may be saved and used in answers.'
                  : 'Paused: nothing new is learned and saved facts are not used. They are kept until you delete them.'
              }
              checked={data.memory_enabled}
              disabled={pause.isPending}
              onChange={(v) => pause.mutate(v)}
            />
            {error && <Alert tone="error">{error}</Alert>}
            {data.items.length === 0 ? (
              <EmptyState title="Nothing saved yet">Facts will appear here once GranthanAI learns them from your chats.</EmptyState>
            ) : (
              <>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {data.items.map((f) => (
                    <li key={f.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="break-words text-sm">{f.statement}</p>
                        <p className="mt-0.5 text-xs capitalize text-ink-3">{f.category.replace(/_/g, ' ')}</p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit memory: ${f.statement}`}
                          onClick={() => {
                            setError('')
                            setText(f.statement)
                            setEditing(f)
                          }}
                        >
                          <Pencil className="size-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete memory: ${f.statement}`}
                          onClick={() => {
                            setError('')
                            setDeleting(f)
                          }}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
                <Button variant="danger" onClick={() => { setError(''); setClearing(true) }}>
                  Delete all memory
                </Button>
              </>
            )}
          </>
        )}
      </SettingsSection>

      {editing && (
        <div role="dialog" aria-modal="true" aria-label="Edit memory" className="rounded-2xl border border-line bg-raised p-5">
          <TextAreaField label="Memory" value={text} onChange={setText} maxLength={500} rows={3} />
          {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={!text.trim() || text.length > 500 || text.trim() === editing.statement}
              onClick={() => save.mutate({ fact: editing, statement: text.trim() })}
            >
              Save
            </Button>
            <Button onClick={() => setEditing(null)} disabled={save.isPending}>Cancel</Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this memory?"
        description={deleting ? `“${deleting.statement}” will be removed and will not be learned again.` : ''}
        loading={remove.isPending}
        error={remove.isError ? error : null}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
      <ConfirmDialog
        open={clearing}
        onClose={() => setClearing(false)}
        title="Delete all memory?"
        description="Every saved fact is removed and will not be learned again. Your conversations and summaries are not deleted."
        confirmLabel="Delete all"
        loading={clear.isPending}
        error={clear.isError ? error : null}
        onConfirm={() => clear.mutate()}
      />
    </>
  )
}
