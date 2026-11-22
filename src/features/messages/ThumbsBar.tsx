import { useState } from 'react'
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { Dialog, toast } from '@/components/ui/overlays'
import { FEEDBACK_COPY } from '@/content/quickwins'
import { errorMessage } from '@/lib/errors'
import { qk } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { feedbackService } from '@/services/quickwins.service'
import { FEEDBACK_REASONS, type ApiMessage, type FeedbackBody, type FeedbackReason, type Page } from '@/types/api'

type Cache = InfiniteData<Page<ApiMessage>>
type Mine = ApiMessage['feedback']

/** Sets (or clears) the caller's rating on one message inside the cached history pages. */
export function withFeedback(data: Cache | undefined, messageId: string, feedback: Mine): Cache | undefined {
  if (!data) return data
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((m) => (m.message_id === messageId ? { ...m, feedback } : m)) })) }
}

/** Thumbs up / down under a sent answer. Optimistic, with rollback when the server refuses. */
export function ThumbsBar({ conversationId, messageId, current }: { conversationId: string; messageId: string; current: Mine | undefined }) {
  const qc = useQueryClient()
  const [asking, setAsking] = useState(false)
  const key = qk.messages(conversationId)

  const save = useMutation<void, unknown, FeedbackBody | null, { before: Cache | undefined }>({
    mutationFn: async (body) => {
      if (body) await feedbackService.put(conversationId, messageId, body)
      else await feedbackService.remove(conversationId, messageId)
    },
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: key })
      const before = qc.getQueryData<Cache>(key)
      qc.setQueryData<Cache>(key, (d) => withFeedback(d, messageId, body ? { rating: body.rating, reason: body.reason ?? null } : null))
      return { before }
    },
    onError: (e, _body, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before)
      toast(errorMessage(e), 'error')
    },
  })

  const rating = current?.rating
  const up = () => save.mutate(rating === 'up' ? null : { rating: 'up' })
  const down = () => {
    if (rating === 'down') save.mutate(null)
    else setAsking(true)
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={up} aria-label={FEEDBACK_COPY.up} aria-pressed={rating === 'up'}>
        <ThumbsUp className={cn('size-3.5', rating === 'up' && 'fill-current')} />
      </Button>
      <Button variant="ghost" size="sm" onClick={down} aria-label={FEEDBACK_COPY.down} aria-pressed={rating === 'down'}>
        <ThumbsDown className={cn('size-3.5', rating === 'down' && 'fill-current')} />
      </Button>
      <ReasonDialog
        open={asking}
        onClose={() => setAsking(false)}
        onSubmit={(reason, comment) => {
          setAsking(false)
          save.mutate({ rating: 'down', ...(reason ? { reason } : {}), ...(comment ? { comment } : {}) })
        }}
      />
    </>
  )
}

export function ReasonDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (reason: FeedbackReason | null, comment: string) => void }) {
  const [reason, setReason] = useState<FeedbackReason | null>(null)
  const [comment, setComment] = useState('')
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={FEEDBACK_COPY.title}
      description={FEEDBACK_COPY.consent}
      footer={
        <>
          <Button onClick={() => onSubmit(null, '')}>{FEEDBACK_COPY.skip}</Button>
          <Button variant="primary" onClick={() => onSubmit(reason, comment.trim())}>
            {FEEDBACK_COPY.submit}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label={FEEDBACK_COPY.title}>
        {FEEDBACK_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={reason === r}
            onClick={() => setReason(reason === r ? null : r)}
            className={cn('rounded-full border px-3 py-1 text-sm', reason === r ? 'border-accent bg-accent-soft font-medium' : 'border-line text-ink-2 hover:bg-surface-2')}
          >
            {FEEDBACK_COPY.reasons[r]}
          </button>
        ))}
      </div>
      <label className="mt-3 block text-sm text-ink-2">
        {FEEDBACK_COPY.comment}
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={1000}
          rows={3}
          className="mt-1 block w-full rounded-lg border border-line bg-surface p-2 text-sm"
        />
      </label>
    </Dialog>
  )
}
