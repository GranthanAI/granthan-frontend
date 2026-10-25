import { lazy, memo, Suspense, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Copy, FileText, Paperclip, RefreshCw, StepForward } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/primitives'
import { youtubeService } from '@/services/youtube.service'
import { timecode, videoLink, youtubeDocTitle } from '@/features/uploads/youtube'
import { copyText } from '@/lib/clipboard'
import { parseQuoted } from '@/lib/quote'
import { cn } from '@/lib/utils'
import { isTruncated } from '@/lib/truncation'
import type { DisplayMessage } from '@/features/messages/display'
import { hasVisualFence } from '@/features/visualization/blocks'
import { ArtifactSourceProvider } from '@/features/artifacts/source'
import { EditableResponseProvider } from '@/features/source-edits/context'
import { ResponseEditActions, ResponseEditCard } from '@/features/source-edits/ResponseEdit'

const Markdown = lazy(() => import('./Markdown'))
const ResponseBlocks = lazy(() => import('@/features/visualization/ResponseBlocks').then((m) => ({ default: m.ResponseBlocks })))

interface Props {
  message: DisplayMessage
  /** The open conversation: lets diagrams/animations in this message be linked to it in the artifact registry. */
  conversationId?: string
  isLastAssistant: boolean
  canRegenerate: boolean
  onRegenerate: (id: string) => void
  /** Sends "continue" so the model finishes an answer that stopped at its length limit. */
  onContinue?: () => void
  onRetrySend: () => void
  onDismissSend: () => void
}

export const MessageItem = memo(function MessageItem({
  message: m,
  conversationId,
  isLastAssistant,
  canRegenerate,
  onRegenerate,
  onContinue,
  onRetrySend,
  onDismissSend,
}: Props) {
  if (m.sender === 'user') return <UserMessage m={m} onRetrySend={onRetrySend} onDismissSend={onDismissSend} />
  const showContinue = isLastAssistant && canRegenerate && !!onContinue && m.status !== 'failed' && isTruncated(m.content)
  return (
    <AssistantMessage
      m={m}
      conversationId={conversationId}
      showRegenerate={isLastAssistant && canRegenerate}
      onRegenerate={onRegenerate}
      onContinue={showContinue ? onContinue : undefined}
    />
  )
})

function UserMessage({
  m,
  onRetrySend,
  onDismissSend,
}: {
  m: DisplayMessage
  onRetrySend: () => void
  onDismissSend: () => void
}) {
  const { quote, body } = parseQuoted(m.content)
  return (
    <div className="animate-in flex flex-col items-end gap-1.5" data-message-id={m.id ?? undefined}>
      <div
        className={cn(
          'font-input max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface-2 px-4 py-2.5 text-[0.9375rem] leading-relaxed',
          '[overflow-wrap:anywhere]',
          m.status === 'send_failed' && 'ring-1 ring-danger/50',
          m.status === 'sending' && 'opacity-70',
        )}
      >
        {quote && (
          <blockquote className="mb-2 line-clamp-4 border-l-2 border-accent/60 pl-2.5 text-sm text-ink-2">{quote}</blockquote>
        )}
        {body}
      </div>
      {m.fileIds.length > 0 && (
        <span className="inline-flex items-center gap-1 text-xs text-ink-3">
          <Paperclip className="size-3" aria-hidden /> {m.fileIds.length} attached file
          {m.fileIds.length === 1 ? '' : 's'}
        </span>
      )}
      {m.status === 'send_failed' && (
        <div role="alert" className="flex flex-wrap items-center justify-end gap-2 text-xs text-danger">
          <AlertCircle className="size-3.5" aria-hidden />
          <span>{m.error ?? 'Message not sent.'}</span>
          <Button size="sm" variant="secondary" onClick={onRetrySend}>
            <RefreshCw className="size-3.5" /> Retry
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismissSend}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  )
}

function AssistantMessage({
  m,
  conversationId,
  showRegenerate,
  onRegenerate,
  onContinue,
}: {
  m: DisplayMessage
  conversationId?: string
  showRegenerate: boolean
  onRegenerate: (id: string) => void
  onContinue?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const streaming = m.status === 'streaming'
  const waiting = m.status === 'connecting' || m.status === 'pending'
  const failed = m.status === 'failed'

  const copy = async () => {
    if (await copyText(m.content)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }

  return (
    <article
      className="animate-in group"
      data-message-id={m.id ?? undefined}
      aria-label="Assistant message"
      aria-busy={streaming || waiting}
    >
      <EditableResponseProvider conversationId={conversationId} messageId={m.id} enabled={!streaming && !waiting && !failed}>
      {waiting && !m.content ? (
        <div role="status" className="flex items-center gap-2 py-2 text-sm text-ink-3">
          <span className="flex gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-1.5 animate-pulse rounded-full bg-ink-3"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </span>
          {m.status === 'pending' ? 'Generating a response…' : 'Thinking…'}
        </div>
      ) : failed ? (
        <div role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3.5 py-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">The response could not be generated.</p>
            <p className="mt-0.5 break-words opacity-90">{m.error || m.content}</p>
          </div>
        </div>
      ) : (
        <div className="font-response">
          <Suspense fallback={<p className="whitespace-pre-wrap text-[0.9375rem]">{m.content}</p>}>
            {hasVisualFence(m.content) ? (
              <div className={streaming ? 'caret' : undefined}>
                {conversationId && m.id ? (
                  <ArtifactSourceProvider conversationId={conversationId} messageId={m.id}>
                    <ResponseBlocks content={m.content} streaming={streaming} />
                  </ArtifactSourceProvider>
                ) : (
                  <ResponseBlocks content={m.content} streaming={streaming} />
                )}
              </div>
            ) : streaming ? (
              <div className="caret">
                <Markdown content={m.content} />
              </div>
            ) : (
              <Markdown content={m.content} />
            )}
          </Suspense>
        </div>
      )}

      {!streaming && !waiting && !failed && m.content && <ResponseEditCard content={m.content} />}

      {m.citations.length > 0 && !streaming && <Sources citations={m.citations} />}

      {onContinue && !streaming && !waiting && (
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={onContinue}>
            <StepForward className="size-3.5" aria-hidden /> Continue
          </Button>
        </div>
      )}

      {!streaming && !waiting && (m.content || failed) && (
        <div className="mt-1.5 flex items-center gap-1 text-ink-3 opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          {!failed && (
            <Button variant="ghost" size="sm" onClick={copy} aria-label={copied ? 'Copied' : 'Copy response'}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          )}
          {!failed && <ResponseEditActions content={m.content} />}
          {showRegenerate && m.id && (
            <Button variant="ghost" size="sm" onClick={() => onRegenerate(m.id!)}>
              <RefreshCw className="size-3.5" /> {failed ? 'Try again' : 'Regenerate'}
            </Button>
          )}
        </div>
      )}
      </EditableResponseProvider>
    </article>
  )
}

function Sources({ citations }: { citations: DisplayMessage['citations'] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3 rounded-xl border border-line bg-surface">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-ink-2 hover:text-ink"
      >
        <span className="inline-flex items-center gap-1.5">
          <FileText className="size-3.5" aria-hidden /> {citations.length} source{citations.length === 1 ? '' : 's'}
        </span>
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul className="space-y-1 border-t border-line px-3 py-2 text-xs">
          {citations.map((c, i) => (
            <li key={`${c.file_id}-${c.page_number}-${c.section}-${i}`} className="text-ink-2">
              {c.start_seconds != null ? (
                <VideoCitation c={c} />
              ) : (
                <>
                  <span className="font-medium text-ink">{c.source_name}</span>
                  {c.page_number != null && <span> · page {c.page_number}</span>}
                  {c.section && <span> · {c.section}</span>}
                </>
              )}
            </li>
          ))}
          <li className="pt-1 text-ink-3">Sources are shown for this session only; the backend does not store them with the message.</li>
        </ul>
      )}
    </div>
  )
}

/** A passage from a video transcript: the title and a link to the exact moment (built from the validated video id). */
export function VideoCitation({ c }: { c: DisplayMessage['citations'][number] }) {
  const { data } = useQuery({
    queryKey: ['youtube-source', c.file_id],
    queryFn: ({ signal }) => youtubeService.get(c.file_id, signal),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const start = c.start_seconds ?? 0
  const label = c.end_seconds && c.end_seconds > start ? `${timecode(start)}–${timecode(c.end_seconds)}` : timecode(start)
  const href = data ? videoLink(data.video_id, start) : null
  return (
    <>
      <span className="font-medium text-ink">{data?.title ?? youtubeDocTitle(c.source_name)}</span>
      <span> · video · </span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline" aria-label={`Open the video at ${timecode(start)}`}>
          {label}
        </a>
      ) : (
        <span>{label}</span>
      )}
    </>
  )
}
