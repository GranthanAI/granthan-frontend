import { lazy, Suspense, useState } from 'react'
import { AlertCircle, Check, RotateCcw, Save, Undo2, X } from 'lucide-react'
import { Button, Spinner } from '@/components/ui/primitives'
import { copyText } from '@/lib/clipboard'
import type { BlockEditController, BlockEditState } from './controller'

const SourceEditor = lazy(() => import('./SourceEditor'))

function Status({ state, dirty }: { state: BlockEditState; dirty: boolean }) {
  if (state.save === 'saving')
    return (
      <span className="inline-flex items-center gap-1.5">
        <Spinner className="size-3" /> Saving…
      </span>
    )
  if (state.save === 'error')
    return (
      <span className="inline-flex items-center gap-1.5 text-danger">
        <AlertCircle className="size-3.5" aria-hidden /> Couldn&apos;t save{state.error ? `: ${state.error.replace(/[.\s]+$/, '')}` : ''}. Your text is kept.
      </span>
    )
  if (state.save === 'conflict') return <span className="text-danger">Changed elsewhere</span>
  if (dirty) return <span>Unsaved changes</span>
  if (state.save === 'saved')
    return (
      <span className="inline-flex items-center gap-1.5">
        <Check className="size-3.5" aria-hidden /> Saved
      </span>
    )
  return <span>No changes</span>
}

/**
 * The editing surface shared by code blocks and whole-response documents: editor, live status, and the actions Save, Reset
 * (drop unsaved changes), Revert to original (discard the saved edit) and Close. Conflicts keep the user's text on screen
 * and ask which version to keep.
 */
export function EditPanel({
  controller, state, language, ariaLabel, editorKey, onChangeKey,
}: {
  controller: BlockEditController
  state: BlockEditState
  language: string
  ariaLabel: string
  /** Bumped by callers when the editor text must be replaced from outside. */
  editorKey?: number
  onChangeKey?: () => void
}) {
  const [resetKey, setResetKey] = useState(0)
  const dirty = controller.dirty
  const busy = state.save === 'saving'
  const key = `${resetKey}:${editorKey ?? 0}`
  const bump = () => {
    setResetKey((k) => k + 1)
    onChangeKey?.()
  }

  return (
    <div>
      <Suspense fallback={<p className="p-3 text-xs text-ink-3">Loading editor…</p>}>
        <SourceEditor
          value={state.draft}
          resetKey={key}
          language={language}
          ariaLabel={ariaLabel}
          onChange={(t) => controller.setDraft(t)}
          onSave={() => void controller.save()}
        />
      </Suspense>

      {state.save === 'conflict' && state.conflict && (
        <div role="alert" className="m-2 rounded-lg border border-danger/40 bg-danger-soft p-2.5 text-xs text-danger">
          <p className="font-medium">
            {state.conflict.current ? 'This block was saved elsewhere (another tab or device).' : 'This edit was discarded elsewhere.'}
          </p>
          <p className="mt-0.5 opacity-90">Your text is still here. Choose which version to keep.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => void controller.keepMine()}>
              Keep mine
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                controller.useTheirs()
                bump()
              }}
            >
              Use the other version
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void copyText(state.draft)}>
              Copy mine
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-xs text-ink-3">
        <span role="status" aria-live="polite" data-testid="edit-status">
          <Status state={state} dirty={dirty} />
        </span>
        <span className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="secondary" disabled={busy || (!dirty && state.save !== 'error')} onClick={() => void controller.save()}>
            <Save className="size-3.5" aria-hidden /> {state.save === 'error' ? 'Retry' : 'Save'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !dirty}
            onClick={() => {
              controller.resetDraft()
              bump()
            }}
          >
            <RotateCcw className="size-3.5" aria-hidden /> Reset
          </Button>
          {state.version > 0 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void controller.revertToOriginal().then(bump)
              }}
              title="Discard my saved edit and go back to the AI's original text"
            >
              <Undo2 className="size-3.5" aria-hidden /> Revert to original
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => controller.close()}>
            <X className="size-3.5" aria-hidden /> {dirty ? 'Discard & close' : 'Close'}
          </Button>
        </span>
      </div>
    </div>
  )
}
