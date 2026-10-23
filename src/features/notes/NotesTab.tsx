import { lazy, Suspense, useId, useState } from 'react'
import { AlertTriangle, Check, Copy, Eye, Pencil } from 'lucide-react'
import { Alert, Button, Skeleton, Spinner } from '@/components/ui/primitives'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import type { NotesState } from './controller'
import { useNotes } from './useNotes'

// The same safe renderer as chat answers: raw HTML is not enabled and unsafe URL schemes are stripped.
const Markdown = lazy(() => import('@/components/chat/Markdown'))

function SaveStatus({ state, onRetry }: { state: NotesState; onRetry: () => void }) {
  switch (state.save) {
    case 'saving':
      return (
        <span role="status" className="inline-flex items-center gap-1.5 text-xs text-ink-3">
          <Spinner className="size-3" /> Saving…
        </span>
      )
    case 'dirty':
      return (
        <span role="status" className="text-xs text-ink-3">
          Unsaved changes
        </span>
      )
    case 'saved':
      return (
        <span role="status" className="inline-flex items-center gap-1 text-xs text-ink-3" title={state.savedAt ?? undefined}>
          <Check className="size-3" aria-hidden /> Saved
        </span>
      )
    case 'error':
      return (
        <span role="alert" className="inline-flex items-center gap-2 text-xs text-danger">
          Couldn't save
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </span>
      )
    default:
      return <span className="text-xs text-ink-3">&nbsp;</span>
  }
}

/**
 * The right-sidebar Notes tab: the user's own notes for the open conversation (a branch has its own, nothing is inherited).
 * Plain Markdown text in a textarea with a safe preview. It autosaves after a pause in typing and never throws text away:
 * a failed save keeps it and offers Retry; a change made in another tab asks which version to keep.
 */
export function NotesTab({ conversationId }: { conversationId: string }) {
  const { state, controller } = useNotes(conversationId)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [copied, setCopied] = useState(false)
  const fieldId = useId()

  if (state.load === 'loading')
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading notes">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-40" />
      </div>
    )
  if (state.load === 'error')
    return (
      <Alert tone="error" action={<Button size="sm" onClick={() => void controller.load(true)}>Retry</Button>}>
        Notes could not be loaded{state.loadError ? `: ${state.loadError}` : ''}.
      </Alert>
    )

  const nearLimit = state.text.length >= state.maxChars * 0.8

  return (
    <div className="flex h-full min-h-[18rem] flex-col gap-2" data-testid="notes-tab">
      <div className="flex items-center justify-between gap-2">
        <div role="group" aria-label="Notes view" className="flex rounded-lg border border-line p-0.5 text-xs">
          <button
            aria-pressed={mode === 'edit'}
            onClick={() => setMode('edit')}
            className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1', mode === 'edit' ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2 hover:bg-surface-2')}
          >
            <Pencil className="size-3" aria-hidden /> Write
          </button>
          <button
            aria-pressed={mode === 'preview'}
            onClick={() => setMode('preview')}
            className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1', mode === 'preview' ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2 hover:bg-surface-2')}
          >
            <Eye className="size-3" aria-hidden /> Preview
          </button>
        </div>
        <SaveStatus state={state} onRetry={() => void controller.retry()} />
      </div>

      {state.save === 'conflict' && state.conflict && (
        <Alert tone="warn" className="flex-col">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-4" aria-hidden /> These notes were changed in another tab or window.
          </p>
          <p className="mt-1 text-xs">Your text is still here and has not been saved. Choose which version to keep.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => void controller.keepMine()}>
              Keep mine
            </Button>
            <Button size="sm" variant="secondary" onClick={() => controller.useTheirs()}>
              Use the other version
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (await copyText(state.text)) {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1800)
                }
              }}
            >
              <Copy className="size-3.5" aria-hidden /> {copied ? 'Copied' : 'Copy mine'}
            </Button>
          </div>
        </Alert>
      )}

      {mode === 'edit' ? (
        <>
          <label htmlFor={fieldId} className="sr-only">
            Notes for this conversation
          </label>
          <textarea
            id={fieldId}
            value={state.text}
            onChange={(e) => controller.setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault()
                void controller.flush()
              }
            }}
            onBlur={() => void controller.flush()}
            maxLength={state.maxChars}
            spellCheck
            placeholder={'Write notes for this conversation.\n\nMarkdown works: # headings, - lists, - [ ] checkboxes, ```code```.'}
            className="min-h-[14rem] w-full flex-1 resize-y rounded-lg border border-line bg-surface p-2.5 font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-3"
          />
        </>
      ) : (
        <div className="min-h-[14rem] flex-1 overflow-y-auto rounded-lg border border-line bg-surface p-3" data-testid="notes-preview">
          {state.text.trim() ? (
            <Suspense fallback={<Skeleton className="h-20" />}>
              <Markdown content={state.text} />
            </Suspense>
          ) : (
            <p className="text-sm text-ink-3">Nothing to preview yet. Switch to Write and add some notes.</p>
          )}
        </div>
      )}

      <p className="flex items-center justify-between text-[11px] text-ink-3">
        <span>Only you can see these notes. They are not sent to the assistant.</span>
        {nearLimit && <span aria-live="polite">{state.text.length.toLocaleString()} / {state.maxChars.toLocaleString()}</span>}
      </p>
    </div>
  )
}
