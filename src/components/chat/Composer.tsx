import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowUp, CheckCircle2, FileText, Paperclip, Quote, RefreshCw, Wrench, X } from 'lucide-react'
import { Button, Spinner } from '@/components/ui/primitives'
import { FILE_POLICY } from '@/lib/config'
import { cn, formatBytes } from '@/lib/utils'
import { useAttachments, type Attachment } from '@/features/uploads/useAttachments'
import { useDocumentContext } from '@/features/uploads/useDocumentContext'
import { useToolSelection } from '@/features/tools/useTools'
import { usePreferences } from '@/features/preferences/usePreferences'
import { ToolPicker } from './ToolPicker'
import { useDraftStore } from '@/stores/draft.store'
import { useQuoteStore } from '@/stores/quote.store'
import { formatQuoted } from '@/lib/quote'

export const MAX_MESSAGE_CHARS = 8000

interface Props {
  conversationId: string | null
  draftKey: string
  /** A turn is being submitted or streamed: sending is disabled, typing is not. */
  busy: boolean
  placeholder?: string
  autoFocus?: boolean
  /** Textarea id; floating windows pass their own so ids stay unique. */
  inputId?: string
  /** Return true if the message was accepted (the composer then clears itself). */
  /** Documents attached earlier in this conversation (ids), offered as context for follow-ups. */
  contextDocumentIds?: string[]
  /** document id -> title of the ancestor conversation it was inherited from */
  inheritedFrom?: Record<string, string>
  /** toolIds / mode undefined = not chosen for this message (the user's saved defaults apply). */
  onSend: (text: string, fileIds: string[], toolIds: string[] | undefined, mode: string | undefined) => boolean | Promise<boolean>
}

const NO_IDS: string[] = []

export function Composer({ conversationId, draftKey, busy, placeholder, autoFocus, inputId = 'composer-input', contextDocumentIds = NO_IDS, inheritedFrom, onSend }: Props) {
  const draft = useDraftStore((s) => s.drafts[draftKey] ?? '')
  const setDraft = useDraftStore((s) => s.set)
  const clearDraft = useDraftStore((s) => s.clear)
  const att = useAttachments(conversationId)
  const quote = useQuoteStore((s) => s.byKey[draftKey] ?? null)
  const clearQuote = useQuoteStore((s) => s.clear)
  const tools = useToolSelection(draftKey)
  // Settings → AI preferences → Document context: 'attached_only' keeps earlier documents out of follow-ups.
  const documentContext = usePreferences().data?.document_context ?? 'conversation'
  const docs = useDocumentContext(documentContext === 'attached_only' ? NO_IDS : contextDocumentIds, inheritedFrom)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Auto-grow up to ~40% of the viewport.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`
  }, [draft])

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus, draftKey])

  const text = draft.trim()
  const tooLong = formatQuoted(quote, draft).length > MAX_MESSAGE_CHARS
  const canSend = !!text && !tooLong && !busy && !submitting && !att.blocking
  const reason = busy
    ? 'Wait for the current response to finish'
    : att.blocking
      ? 'Files are still uploading or being processed'
      : undefined

  const submit = async () => {
    if (!canSend) return
    setSubmitting(true)
    try {
      // New attachments plus still-usable documents from earlier in the conversation (no duplicates).
      const fileIds = [...new Set([...docs.includedIds, ...att.readyIds])]
      // The selected excerpt (if any) is sent with the prompt as a quote block.
      const ok = await onSend(formatQuoted(quote, text), fileIds, tools.explicitTools, tools.explicitMode)
      if (ok) {
        clearDraft(draftKey)
        clearQuote(draftKey)
        att.clear()
        tools.clear()
      }
    } finally {
      setSubmitting(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div
      className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-4 sm:pb-4"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        att.add([...e.dataTransfer.files])
      }}
    >
      {att.rejections.length > 0 && (
        <div role="alert" className="mb-2 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <ul className="min-w-0 flex-1">
            {att.rejections.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <button onClick={att.dismissRejections} aria-label="Dismiss file errors">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div
        className={cn(
          'rounded-2xl border bg-raised shadow-sm transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20',
          dragging ? 'border-accent bg-accent-soft' : 'border-line',
        )}
      >
        {att.items.length > 0 && (
          <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Attachments">
            {att.items.map((a) => (
              <AttachmentChip key={a.localId} a={a} onRemove={() => att.remove(a.localId)} onRetry={() => void att.retry(a.localId)} />
            ))}
          </ul>
        )}
        {quote && (
          <div className="mx-3 mt-3 flex items-start gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs">
            <Quote className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
            <p className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap text-ink-2" title={quote}>{quote}</p>
            <button onClick={() => clearQuote(draftKey)} aria-label="Remove quoted text" className="rounded p-0.5 text-ink-3 hover:text-ink">
              <X className="size-3.5" />
            </button>
          </div>
        )}
        {(tools.selected.length > 0 || !!tools.mode || docs.documents.length > 0) && (
          <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Message context">
            {tools.mode && (
              <li className="flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent-soft px-2.5 py-1 text-xs">
                <span className="text-ink-3">{tools.modeIsDefault ? 'Default mode' : 'Mode'}</span>
                <span className="font-medium">{tools.modeNameOf(tools.mode)}</span>
                <button onClick={() => tools.setMode(null)} aria-label={`Clear mode ${tools.modeNameOf(tools.mode)}`} className="rounded p-0.5 text-ink-3 hover:text-ink">
                  <X className="size-3.5" />
                </button>
              </li>
            )}
            {tools.selected.map((id) => (
              <li key={`tool-${id}`} className="flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent-soft px-2.5 py-1 text-xs">
                <Wrench className="size-3.5 text-accent" aria-hidden />
                <span className="font-medium">{tools.nameOf(id)}</span>
                {tools.toolsAreDefault && <span className="text-ink-3">default</span>}
                <button onClick={() => tools.remove(id)} aria-label={`Remove tool ${tools.nameOf(id)}`} className="rounded p-0.5 text-ink-3 hover:text-ink">
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
            {docs.documents.map((d) => (
              <li
                key={`doc-${d.id}`}
                className={cn(
                  'flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs',
                  d.included ? 'border-line bg-surface' : 'border-dashed border-line text-ink-3',
                )}
              >
                <FileText className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                <span className="max-w-40 truncate font-medium" title={d.inheritedFrom ? `${d.name} (inherited from ${d.inheritedFrom})` : d.name}>{d.name}</span>
                {d.inheritedFrom && <span className="max-w-28 truncate text-ink-3">from {d.inheritedFrom}</span>}
                {d.usable ? (
                  <button
                    onClick={() => docs.toggle(d.id)}
                    aria-pressed={d.included}
                    aria-label={d.included ? `Stop using ${d.name} as context` : `Use ${d.name} as context`}
                    className="rounded px-1 text-ink-3 hover:text-ink"
                  >
                    {d.included ? 'In context' : 'Off'}
                  </button>
                ) : (
                  <span className="text-warn">{d.reason}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <label htmlFor={inputId} className="sr-only">
          Message GranthanAI
        </label>
        <textarea
          id={inputId}
          ref={ref}
          data-own-focus-ring
          rows={1}
          value={draft}
          onChange={(e) => setDraft(draftKey, e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? 'Message GranthanAI…'}
          enterKeyHint="send"
          aria-invalid={tooLong || undefined}
          className="font-input block max-h-[40dvh] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[0.9375rem] leading-6 placeholder:text-ink-3 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex items-center gap-1">
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept={FILE_POLICY.accept}
              onChange={(e) => {
                att.add([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
            <Button variant="ghost" size="icon" onClick={() => fileInput.current?.click()} aria-label="Attach files" title={`Attach ${FILE_POLICY.label} files`}>
              <Paperclip className="size-4" />
            </Button>
            <ToolPicker selection={tools} disabled={busy} />
            {formatQuoted(quote, draft).length > MAX_MESSAGE_CHARS * 0.8 && (
              <span className={cn('text-xs', tooLong ? 'text-danger' : 'text-ink-3')} role={tooLong ? 'alert' : undefined}>
                {formatQuoted(quote, draft).length}/{MAX_MESSAGE_CHARS}
              </span>
            )}
          </div>
          <Button
            variant="primary"
            size="icon"
            onClick={() => void submit()}
            disabled={!canSend}
            aria-label="Send message"
            title={reason ?? 'Send (Enter)'}
            className="rounded-full"
          >
            {submitting || busy ? <Spinner /> : <ArrowUp className="size-4" />}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-ink-3" aria-live="polite">
        {reason ?? 'Enter to send · Shift+Enter for a new line'}
      </p>
    </div>
  )
}

function AttachmentChip({ a, onRemove, onRetry }: { a: Attachment; onRemove: () => void; onRetry: () => void }) {
  const failed = a.phase === 'failed' || a.phase === 'upload_failed'
  const label =
    a.phase === 'uploading'
      ? `Uploading ${Math.round(a.progress * 100)}%`
      : a.phase === 'processing'
        ? a.backendStatus === 'SCANNING'
          ? 'Scanning…'
          : 'Processing…'
        : a.phase === 'ready'
          ? 'Ready'
          : (a.error ?? 'Failed')
  return (
    <li
      className={cn(
        'flex max-w-full items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs',
        failed ? 'border-danger/40 bg-danger-soft' : 'border-line bg-surface',
      )}
    >
      <FileText className="size-4 shrink-0 text-ink-3" aria-hidden />
      <div className="min-w-0">
        <div className="max-w-44 truncate font-medium text-ink">{a.file.name}</div>
        <div className={cn('flex items-center gap-1', failed ? 'text-danger' : a.phase === 'ready' ? 'text-ok' : 'text-ink-3')}>
          {a.phase === 'ready' ? <CheckCircle2 className="size-3" aria-hidden /> : !failed && <Spinner className="size-3" />}
          <span className="truncate" title={failed ? a.error : undefined}>
            {label} · {formatBytes(a.file.size)}
          </span>
        </div>
        {a.phase === 'uploading' && (
          <div
            role="progressbar"
            aria-label={`Uploading ${a.file.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(a.progress * 100)}
            className="mt-1 h-1 overflow-hidden rounded-full bg-line"
          >
            <div className="h-full bg-accent transition-[width]" style={{ width: `${a.progress * 100}%` }} />
          </div>
        )}
      </div>
      {failed && (
        <button onClick={onRetry} aria-label={`Retry ${a.file.name}`} className="rounded-md p-1 text-danger hover:bg-danger/10">
          <RefreshCw className="size-3.5" />
        </button>
      )}
      <button onClick={onRemove} aria-label={`Remove ${a.file.name}`} className="rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink">
        <X className="size-3.5" />
      </button>
    </li>
  )
}
