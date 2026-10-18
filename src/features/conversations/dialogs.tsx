import { useState } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'
import { create } from 'zustand'
import { errorMessage } from '@/lib/errors'
import { titleSchema } from '@/lib/validation'
import { ConfirmDialog, Dialog, toast } from '@/components/ui/overlays'
import { Button, TextField } from '@/components/ui/primitives'
import { truncate } from '@/lib/utils'
import { useCreateConversation, useDeleteConversation, useRenameConversation } from './hooks'
import type { Conversation } from '@/types/api'

type Dialogs =
  | { kind: 'rename'; conversation: Conversation }
  | { kind: 'delete'; conversation: Conversation; descendants: number }
  | { kind: 'branch'; conversation: Conversation }
  | null

export const useDialogs = create<{ dialog: Dialogs; open: (d: NonNullable<Dialogs>) => void; close: () => void }>(
  (set) => ({ dialog: null, open: (dialog) => set({ dialog }), close: () => set({ dialog: null }) }),
)

function TitleDialog({
  title,
  description,
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  title: string
  description?: string
  initial: string
  submitLabel: string
  pending: boolean
  error: string | null
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  const [local, setLocal] = useState<string | null>(null)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const r = titleSchema.safeParse(value)
    if (!r.success) return setLocal(r.error.issues[0]?.message ?? 'Invalid title')
    setLocal(null)
    onSubmit(r.data)
  }
  return (
    <Dialog open onClose={onClose} title={title} description={description}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField
          label="Title"
          value={value}
          maxLength={255}
          onChange={(e) => setValue(e.target.value)}
          error={local ?? error ?? undefined}
          data-autofocus
        />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Mounted once in the app shell; opened via useDialogs().open(...). */
export function ConversationDialogs() {
  const { dialog, close } = useDialogs()
  const navigate = useNavigate()
  const activeMatch = useMatch('/c/:id')
  const rename = useRenameConversation()
  const del = useDeleteConversation()
  const create = useCreateConversation()

  if (!dialog) return null
  const c = dialog.conversation

  if (dialog.kind === 'rename')
    return (
      <TitleDialog
        title="Rename conversation"
        initial={c.title}
        submitLabel="Save"
        pending={rename.isPending}
        error={rename.error ? errorMessage(rename.error) : null}
        onClose={() => {
          rename.reset()
          close()
        }}
        onSubmit={(title) =>
          rename.mutate(
            { id: c.conversation_id, title },
            {
              onSuccess: () => {
                toast('Conversation renamed', 'success')
                close()
              },
            },
          )
        }
      />
    )

  if (dialog.kind === 'branch')
    return (
      <TitleDialog
        title="Start a branch"
        description="Creates a new conversation linked to this one in your history tree. The branch continues from the parent as it is now: earlier messages and attached documents are inherited, while anything added to the parent later is not."
        initial={`Branch of ${truncate(c.title, 60)}`}
        submitLabel="Create branch"
        pending={create.isPending}
        error={create.error ? errorMessage(create.error) : null}
        onClose={() => {
          create.reset()
          close()
        }}
        onSubmit={(title) =>
          create.mutate(
            { title, parent_conversation_id: c.conversation_id },
            {
              onSuccess: (created) => {
                close()
                navigate(`/c/${created.conversation_id}`)
              },
            },
          )
        }
      />
    )

  return (
    <ConfirmDialog
      open
      title="Delete conversation?"
      description={
        dialog.descendants > 0
          ? `"${truncate(c.title, 60)}" will be deleted. Its ${dialog.descendants} branch${dialog.descendants === 1 ? '' : 'es'} will not be deleted and will remain in your history.`
          : `"${truncate(c.title, 60)}" and its messages will be deleted. This cannot be undone.`
      }
      loading={del.isPending}
      error={del.error ? errorMessage(del.error) : null}
      onClose={() => {
        del.reset()
        close()
      }}
      onConfirm={() =>
        del.mutate(c.conversation_id, {
          onSuccess: () => {
            toast('Conversation deleted', 'success')
            close()
            if (activeMatch?.params.id === c.conversation_id) navigate('/', { replace: true })
          },
        })
      }
    />
  )
}
