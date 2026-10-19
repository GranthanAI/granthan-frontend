import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Alert, Button, EmptyState, Skeleton, TextField } from '@/components/ui/primitives'
import { ConfirmDialog, toast } from '@/components/ui/overlays'
import { SegmentedControl, SettingsSection, TextAreaField } from '@/components/settings/controls'
import { useArchiveCustomMode, useCreateCustomMode, useCustomModes, useUpdateCustomMode } from '@/features/custom-modes/useCustomModes'
import { ApiError, toApiError } from '@/lib/errors'
import type { CustomMode, CustomModeInput, ExecutionStyle } from '@/types/api'

const EMPTY: CustomModeInput = { name: '', description: '', instructions: '', execution_style: 'direct' }
const DEFAULT_LIMITS = { name: 60, description: 200, instructions: 4000 }

const STYLE_OPTIONS: { value: ExecutionStyle; label: string; description: string }[] = [
  { value: 'direct', label: 'Standard', description: 'Answers directly, following your instructions.' },
  { value: 'smart', label: 'Smart', description: 'Reasons in several passes and may use tools when they help (slower).' },
]

function errorText(e: unknown): string {
  const err = toApiError(e)
  return err.message
}

/** Settings → Custom modes: create, edit and archive reusable modes. The server is the only store. */
export function CustomModesSettings() {
  const list = useCustomModes()
  const create = useCreateCustomMode()
  const update = useUpdateCustomMode()
  const archive = useArchiveCustomMode()
  // null = form closed, 'new' = creating, otherwise the mode being edited
  const [editing, setEditing] = useState<CustomMode | 'new' | null>(null)
  const [draft, setDraft] = useState<CustomModeInput>(EMPTY)
  const [formError, setFormError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [toArchive, setToArchive] = useState<CustomMode | null>(null)

  const limits = list.data?.limits ?? DEFAULT_LIMITS
  const items = (list.data?.items ?? []).filter((m) => m.status === 'active')
  const max = list.data?.max_per_user
  const atLimit = max !== undefined && items.length >= max
  const saving = create.isPending || update.isPending

  const open = (mode: CustomMode | 'new') => {
    setFormError('')
    setConflict(false)
    setDraft(mode === 'new' ? EMPTY : { name: mode.name, description: mode.description, instructions: mode.instructions, execution_style: mode.execution_style })
    setEditing(mode)
  }
  const close = () => {
    setEditing(null)
    setFormError('')
    setConflict(false)
  }

  const valid =
    draft.name.trim().length > 0 &&
    draft.name.length <= limits.name &&
    draft.description.length <= limits.description &&
    draft.instructions.trim().length > 0 &&
    draft.instructions.length <= limits.instructions

  const save = async () => {
    if (saving || !valid || !editing) return
    setFormError('')
    try {
      if (editing === 'new') await create.mutateAsync({ ...draft, name: draft.name.trim() })
      else await update.mutateAsync({ id: editing.mode_id, version: editing.version, ...draft, name: draft.name.trim() })
      toast(editing === 'new' ? 'Custom mode created' : 'Custom mode saved', 'success')
      close()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && editing !== 'new' && /changed elsewhere/i.test(e.message)) {
        setConflict(true)
        setFormError('This mode was changed elsewhere. Your edits are kept below; load the latest version to continue.')
      } else {
        setFormError(errorText(e))
      }
    }
  }

  const loadLatest = () => {
    if (editing && editing !== 'new') {
      const latest = (list.data?.items ?? []).find((m) => m.mode_id === editing.mode_id)
      if (latest && latest.status === 'active') {
        open(latest)
        return
      }
    }
    close()
  }

  return (
    <>
      <SettingsSection
        title="Custom modes"
        description="Save your own way of answering (for example “strict code reviewer” or “explain like a mentor”) and pick it from the mode menu in any chat or set it as your default. A custom mode only changes style, focus and format: it cannot change safety rules or turn tools on."
        actions={
          <Button size="sm" variant="primary" onClick={() => open('new')} disabled={atLimit || list.isPending || list.isError}>
            <Plus className="size-4" aria-hidden /> New mode
          </Button>
        }
      >
        {list.isPending && <Skeleton className="h-16 w-full" />}
        {list.isError && (
          <Alert tone="error" action={<Button size="sm" onClick={() => void list.refetch()}>Retry</Button>}>
            {errorText(list.error)}
          </Alert>
        )}
        {list.data && atLimit && (
          <Alert tone="info">You have reached the limit of {max} custom modes. Archive one to create another.</Alert>
        )}
        {list.data && items.length === 0 && !editing && (
          <EmptyState title="No custom modes yet">Create one to reuse your favourite instructions across chats.</EmptyState>
        )}
        {items.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {items.map((m) => (
              <li key={m.mode_id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {m.name}
                    <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-xs font-normal text-ink-2">
                      {m.execution_style === 'smart' ? 'Smart' : 'Standard'}
                    </span>
                  </p>
                  {m.description && <p className="mt-0.5 text-xs text-ink-2">{m.description}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Edit custom mode ${m.name}`} onClick={() => open(m)}>
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Archive custom mode ${m.name}`} onClick={() => setToArchive(m)}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      {editing && (
        <section aria-label={editing === 'new' ? 'New custom mode' : `Edit ${editing.name}`} className="rounded-2xl border border-line bg-raised p-5">
          <h2 className="text-base font-semibold">{editing === 'new' ? 'New custom mode' : `Edit “${editing.name}”`}</h2>
          <form
            noValidate
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            {formError && (
              <Alert tone="error" action={conflict ? <Button size="sm" onClick={loadLatest}>Load latest</Button> : undefined}>
                {formError}
              </Alert>
            )}
            <TextField
              label="Name"
              value={draft.name}
              maxLength={limits.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              hint={`${draft.name.length}/${limits.name}`}
            />
            <TextField
              label="Short description (optional)"
              value={draft.description}
              maxLength={limits.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              hint="Shown in the mode menu."
            />
            <TextAreaField
              label="Instructions"
              rows={7}
              value={draft.instructions}
              onChange={(v) => setDraft({ ...draft, instructions: v })}
              maxLength={limits.instructions}
              placeholder="e.g. Review the code I paste. List problems by severity, then show a corrected version."
              hint="These are added to every message sent in this mode. They shape style and focus and cannot override safety rules or enable tools."
            />
            <SegmentedControl
              label="How it runs"
              value={draft.execution_style}
              onChange={(v) => setDraft({ ...draft, execution_style: v })}
              options={STYLE_OPTIONS}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" loading={saving} disabled={!valid || saving}>
                {editing === 'new' ? 'Create mode' : 'Save changes'}
              </Button>
              <Button type="button" onClick={close} disabled={saving}>
                Cancel
              </Button>
            </div>
          </form>
        </section>
      )}

      <ConfirmDialog
        open={!!toArchive}
        onClose={() => {
          archive.reset()
          setToArchive(null)
        }}
        title="Archive this custom mode?"
        description={
          toArchive
            ? `“${toArchive.name}” will no longer appear in the mode menu. If it is your default mode, Auto is used until you pick another. Messages already sent are not affected.`
            : ''
        }
        confirmLabel="Archive"
        loading={archive.isPending}
        error={archive.isError ? errorText(archive.error) : null}
        onConfirm={() =>
          toArchive &&
          archive.mutate(toArchive.mode_id, {
            onSuccess: () => {
              setToArchive(null)
              toast('Custom mode archived', 'success')
            },
          })
        }
      />
    </>
  )
}
