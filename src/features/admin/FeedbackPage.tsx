import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Alert, Button, Skeleton } from '@/components/ui/primitives'
import { FEEDBACK_COPY } from '@/content/quickwins'
import { errorMessage } from '@/lib/errors'
import { qk } from '@/lib/query-keys'
import { feedbackService } from '@/services/quickwins.service'
import { FEEDBACK_REASONS, type FeedbackAdminItem, type FeedbackRating } from '@/types/api'

/** /admin/feedback: staff review of rated answers (read-only). The server returns the excerpts only for answers the user rated. */
export function FeedbackPage() {
  const [rating, setRating] = useState<FeedbackRating>('down')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [group, setGroup] = useState('')
  const [reason, setReason] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const filters = { rating, from: from || undefined, to: to || undefined, model_group: group || undefined, reason: reason || undefined }
  const q = useInfiniteQuery({
    queryKey: qk.feedbackAdmin(JSON.stringify(filters)),
    queryFn: ({ pageParam, signal }) => feedbackService.admin({ ...filters, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <section aria-label="Feedback">
      <h2 className="text-lg font-semibold">Answer feedback</h2>
      <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
        <label>
          Rating
          <select value={rating} onChange={(e) => setRating(e.target.value as FeedbackRating)} className="ml-1 rounded border border-line bg-surface px-2 py-1">
            <option value="down">Thumbs down</option>
            <option value="up">Thumbs up</option>
          </select>
        </label>
        <label>
          From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-line bg-surface px-2 py-1" />
        </label>
        <label>
          To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-line bg-surface px-2 py-1" />
        </label>
        <label>
          Model group
          <select value={group} onChange={(e) => setGroup(e.target.value)} className="ml-1 rounded border border-line bg-surface px-2 py-1">
            <option value="">All</option>
            {['fast', 'smart', 'best', 'ultra'].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
        <label>
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="ml-1 rounded border border-line bg-surface px-2 py-1">
            <option value="">All</option>
            {FEEDBACK_REASONS.map((r) => (
              <option key={r} value={r}>{FEEDBACK_COPY.reasons[r]}</option>
            ))}
          </select>
        </label>
      </div>

      {q.isPending ? (
        <Skeleton className="mt-4 h-32 w-full" />
      ) : q.isError ? (
        <Alert tone="error" action={<Button size="sm" onClick={() => void q.refetch()}>Retry</Button>}>{errorMessage(q.error)}</Alert>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm text-ink-2">Nothing here yet.</p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-xs uppercase text-ink-3">
            <tr><th className="py-2">When</th><th>Reason</th><th>Model</th><th>Question</th><th>Answer</th></tr>
          </thead>
          <tbody>
            {items.map((i) => <Row key={`${i.conversation_id}:${i.message_id}`} i={i} open={open === i.message_id} onToggle={() => setOpen(open === i.message_id ? null : i.message_id)} />)}
          </tbody>
        </table>
      )}
      {q.hasNextPage && (
        <Button className="mt-3" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>Load more</Button>
      )}
    </section>
  )
}

function Row({ i, open, onToggle }: { i: FeedbackAdminItem; open: boolean; onToggle: () => void }) {
  const clip = (s: string | null, n: number) => (s ? (open || s.length <= n ? s : `${s.slice(0, n)}…`) : '—')
  return (
    <tr className="cursor-pointer border-t border-line align-top hover:bg-surface" onClick={onToggle} aria-expanded={open}>
      <td className="py-2 pr-3 whitespace-nowrap">{new Date(i.created_at).toLocaleString()}</td>
      <td className="pr-3">{i.reason ? FEEDBACK_COPY.reasons[i.reason] : '—'}{i.comment && open ? <p className="mt-1 text-ink-2">{i.comment}</p> : null}</td>
      <td className="pr-3">{i.model ?? '—'} {i.model_group ? `(${i.model_group})` : ''}</td>
      <td className="pr-3 whitespace-pre-wrap">{clip(i.question, 80)}</td>
      <td className="whitespace-pre-wrap">{clip(i.answer, 120)}</td>
    </tr>
  )
}
