import { lazy, Suspense, useState } from 'react'
import { Check, Copy, Download, Pencil, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { copyText } from '@/lib/clipboard'
import { EditableResponseProvider, useEditableResponse, type EditableResponse } from './context'
import { EditPanel } from './EditPanel'
import { downloadText } from './files'
import { useBlockEdit } from './registry'

const Markdown = lazy(() => import('@/components/chat/Markdown'))

/** One stable id for "the whole answer as a document". */
const RESPONSE_BLOCK = 'response'

function useResponseEdit(content: string, source: EditableResponse) {
  return useBlockEdit({
    conversationId: source.conversationId, messageId: source.messageId, blockId: RESPONSE_BLOCK,
    language: 'markdown', format: 'markdown', original: content,
  })
}

/** Toolbar buttons for an answer: edit it as a Markdown document, or download it as `.md` (exactly what is shown/saved). */
export function ResponseEditActions({ content }: { content: string }) {
  const source = useEditableResponse()
  if (!source) return <DownloadButton text={content} /> // streaming / unsaved: download only, no editing state
  return <EditableActions content={content} source={source} />
}

function DownloadButton({ text }: { text: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={() => downloadText('response.md', text)} aria-label="Download response as Markdown">
      <Download className="size-3.5" aria-hidden /> .md
    </Button>
  )
}

function EditableActions({ content, source }: { content: string; source: EditableResponse }) {
  const { state, controller } = useResponseEdit(content, source)
  const [copied, setCopied] = useState(false)
  const current = state.editing ? state.draft : (state.saved ?? content)
  return (
    <>
      {!state.editing && (
        <Button variant="ghost" size="sm" onClick={() => controller.startEdit()} aria-label="Edit response as a document">
          <Pencil className="size-3.5" aria-hidden /> Edit
        </Button>
      )}
      <DownloadButton text={current} />
      {state.saved !== null && (
        <Button
          variant="ghost" size="sm" aria-label={copied ? 'Copied edited copy' : 'Copy edited copy'}
          onClick={async () => {
            if (await copyText(state.saved as string)) {
              setCopied(true)
              setTimeout(() => setCopied(false), 1800)
            }
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} Edited
        </Button>
      )}
    </>
  )
}

/**
 * Shown under an answer once the user edits it as a document, or has a saved edited copy. The assistant's answer above is
 * never changed; this card is the user's separate, versioned copy, and says so.
 */
export function ResponseEditCard({ content }: { content: string }) {
  const source = useEditableResponse()
  return source ? <Card content={content} source={source} /> : null
}

function Card({ content, source }: { content: string; source: EditableResponse }) {
  const { state, controller } = useResponseEdit(content, source)
  if (!state.editing && state.saved === null) return null
  return (
    <section
      aria-label="Your edited copy of this response"
      className="mt-3 overflow-hidden rounded-xl border border-accent/40 bg-surface"
      data-testid="response-edit-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-xs text-ink-3">
        <span>
          <strong className="font-medium text-ink-2">Your edited copy</strong>
          {state.saved !== null && ` · v${state.version}`} · the answer above is unchanged
        </span>
        {!state.editing && (
          <span className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => controller.startEdit()} aria-label="Edit my copy">
              <Pencil className="size-3.5" aria-hidden /> Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => downloadText('response.md', state.saved ?? content)} aria-label="Download my copy">
              <Download className="size-3.5" aria-hidden /> Download .md
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void controller.revertToOriginal()} disabled={state.save === 'saving'}>
              <Undo2 className="size-3.5" aria-hidden /> Revert to original
            </Button>
          </span>
        )}
      </header>
      {state.editing ? (
        <EditPanel controller={controller} state={state} language="markdown" ariaLabel="Edit response as Markdown" />
      ) : (
        <div className="p-3 font-response">
          {/* code blocks inside this preview are read-only: the whole document is the unit being edited here */}
          <EditableResponseProvider enabled={false}>
            <Suspense fallback={<p className="whitespace-pre-wrap text-sm">{state.saved}</p>}>
              <Markdown content={state.saved ?? ''} scope="edited" />
            </Suspense>
          </EditableResponseProvider>
        </div>
      )}
    </section>
  )
}
