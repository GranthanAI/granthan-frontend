import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { Dialog } from '@/components/ui/overlays'
import { SHARE_COPY } from '@/content/quickwins'
import { copyText } from '@/lib/clipboard'
import { errorMessage } from '@/lib/errors'
import { qk } from '@/lib/query-keys'
import { shareService } from '@/services/quickwins.service'
import type { Conversation, ShareCreated, ShareScope } from '@/types/api'

export const shareUrl = (token: string) => `${window.location.origin}/s/${token}`

/** Header menu > Share: creates a public read-only snapshot link. The token is shown only now. */
export function ShareDialog({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const qc = useQueryClient()
  const [scope, setScope] = useState<ShareScope>('conversation')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<ShareCreated | null>(null)
  const [copied, setCopied] = useState(false)

  const create = async () => {
    setPending(true)
    setError(null)
    try {
      setCreated(await shareService.create(conversation.conversation_id, scope))
      void qc.invalidateQueries({ queryKey: qk.shares })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }
  const copy = async () => {
    if (created && (await copyText(shareUrl(created.url_token)))) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={SHARE_COPY.title}
      footer={
        created ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void create()} loading={pending}>
              {SHARE_COPY.create}
            </Button>
          </>
        )
      }
    >
      {!created ? (
        <fieldset className="space-y-2">
          <legend className="sr-only">Scope</legend>
          {(
            [
              ['conversation', SHARE_COPY.scopeConversation],
              ['hierarchy', SHARE_COPY.scopeHierarchy],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input type="radio" name="share-scope" value={value} checked={scope === value} onChange={() => setScope(value)} />
              {label}
            </label>
          ))}
        </fieldset>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input readOnly value={shareUrl(created.url_token)} aria-label="Share link" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm" onFocus={(e) => e.currentTarget.select()} />
            <Button onClick={() => void copy()} aria-label={SHARE_COPY.copy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? SHARE_COPY.copied : SHARE_COPY.copy}
            </Button>
          </div>
          <p className="text-sm text-ink-2">{SHARE_COPY.onceOnly}</p>
        </div>
      )}
      <p className="mt-3 text-sm text-ink-2">{SHARE_COPY.warning}</p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </Dialog>
  )
}
