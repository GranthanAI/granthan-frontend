import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { Menu } from '@/components/ui/overlays'
import { EDIT_COPY } from '@/content/quickwins'
import { MAX_MESSAGE_CHARS } from '@/components/chat/Composer'
import { editMessage } from '@/features/messages/chat-controller'
import { useModeSelectionStore } from '@/features/tools/useTools'
import { ApiError, errorMessage } from '@/lib/errors'
import { qk } from '@/lib/query-keys'
import { uuid } from '@/lib/utils'
import { editService } from '@/services/quickwins.service'

/** The pencil on a user's own sent message, and the inline editor it opens. */
export function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} aria-label={EDIT_COPY.edit} title={EDIT_COPY.edit}>
      <Pencil className="size-3.5" />
    </Button>
  )
}

export function MessageEditor({ conversationId, messageId, initial, onClose }: { conversationId: string; messageId: string; initial: string; onClose: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [text, setText] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // New key per click; reused only when the previous attempt's outcome is unknown (network / timeout), so the server replays.
  const key = useRef<string | null>(null)

  const send = async () => {
    const content = text.trim()
    if (!content || sending || content.length > MAX_MESSAGE_CHARS) return
    setSending(true)
    setError(null)
    key.current = key.current ?? uuid()
    try {
      const mode = useModeSelectionStore.getState().modeByKey[conversationId]
      await editMessage(qc, conversationId, messageId, content, { idempotencyKey: key.current, mode }, (newCid) => navigate(`/c/${newCid}`))
      key.current = null
      onClose()
    } catch (e) {
      const unknownOutcome = e instanceof ApiError && (e.kind === 'network' || e.kind === 'timeout')
      if (!unknownOutcome) key.current = null
      setError(errorMessage(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="w-full max-w-[85%] space-y-2 self-end">
      <label className="sr-only" htmlFor={`edit-${messageId}`}>
        {EDIT_COPY.edit}
      </label>
      <textarea
        id={`edit-${messageId}`}
        data-autofocus
        value={text}
        maxLength={MAX_MESSAGE_CHARS}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void send()
          }
        }}
        rows={Math.min(10, Math.max(3, text.split('\n').length))}
        className="font-input block w-full resize-y rounded-2xl border border-line bg-surface p-3 text-[0.9375rem] focus:border-accent focus:outline-none"
      />
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onClose} disabled={sending}>
          {EDIT_COPY.cancel}
        </Button>
        <Button size="sm" variant="primary" onClick={() => void send()} loading={sending} disabled={!text.trim()}>
          {EDIT_COPY.send}
        </Button>
      </div>
    </div>
  )
}

/** "Edited · 2 versions": appears once the message is known to have edits (fetched lazily on hover or focus). */
export function VersionsChip({ conversationId, messageId, wanted }: { conversationId: string; messageId: string; wanted: boolean }) {
  const navigate = useNavigate()
  const q = useQuery({
    queryKey: qk.edits(conversationId, messageId),
    queryFn: ({ signal }) => editService.versions(conversationId, messageId, signal),
    enabled: wanted,
    staleTime: 60_000,
    retry: false,
  })
  const versions = q.data ?? []
  if (!versions.length) return null
  return (
    <Menu
      label={EDIT_COPY.versionsLabel}
      items={versions.map((v, i) => ({
        label: `Version ${i + 2}: ${v.title}`,
        hint: new Date(v.created_at).toLocaleString(),
        onSelect: () => navigate(`/c/${v.conversation_id}`),
      }))}
      trigger={({ props }) => (
        <button type="button" {...props} aria-label={EDIT_COPY.versions(versions.length + 1)} className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-2 hover:bg-surface-2">
          {EDIT_COPY.versions(versions.length + 1)}
        </button>
      )}
    />
  )
}
