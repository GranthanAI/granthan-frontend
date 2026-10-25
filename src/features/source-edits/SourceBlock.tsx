import { useMemo, useState, type ReactNode } from 'react'
import { Check, Copy, Download, Eye, Pencil } from 'lucide-react'
import { copyText } from '@/lib/clipboard'
import { useEditableResponse } from './context'
import { EditPanel } from './EditPanel'
import { classifyFence, downloadName, downloadText, makeBlockId } from './files'
import { useBlockEdit } from './registry'

interface Props {
  /** The AI's code exactly as written (no trailing fence newline). */
  code: string
  /** The fence's info string (untrusted; only used as a lookup key). */
  info: string | undefined
  /** Markdown segment index and fence start line: together with a hash of `code` they make the stable block id. */
  scope: string
  line: number
  /** The highlighted original, as react-markdown rendered it. */
  original: ReactNode
  /** Renders text with the same syntax highlighting pipeline as the original. */
  renderHighlighted: (code: string, info: string | undefined) => ReactNode
}

function Frame({
  label, filename, badge, actions, children,
}: { label: string; filename: string; badge?: ReactNode; actions: ReactNode; children: ReactNode }) {
  return (
    <div className="not-prose overflow-hidden rounded-xl border border-line bg-code" data-testid="source-block">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-3 py-1.5 text-xs text-ink-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="font-mono">{label}</span>
          <span className="truncate text-ink-3/80" data-testid="source-filename">{filename}</span>
          {badge}
        </span>
        <span className="flex items-center gap-0.5">{actions}</span>
      </div>
      {children}
    </div>
  )
}

const btn = 'inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-surface-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'

function useCopy(getText: () => string) {
  const [copied, setCopied] = useState(false)
  const run = async () => {
    if (await copyText(getText())) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }
  return { copied, run }
}

/** Code block in an answer that is still streaming, or has no server id: Copy and Download only, exactly as before. */
function PlainBlock({ code, info, original }: Props) {
  const kind = classifyFence(info)
  const { copied, run } = useCopy(() => code)
  return (
    <Frame
      label={info?.trim() ? info.trim().split(/\s+/)[0]! : 'text'}
      filename={downloadName(kind)}
      actions={
        <>
          <button onClick={() => downloadText(downloadName(kind), code)} aria-label="Download code" className={btn}>
            <Download className="size-3.5" aria-hidden /> Download
          </button>
          <button onClick={run} aria-label={copied ? 'Copied' : 'Copy code'} className={btn}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </>
      }
    >
      {original}
    </Frame>
  )
}

function EditableBlock({ code, info, scope, line, original, renderHighlighted }: Props) {
  const source = useEditableResponse()!
  const kind = useMemo(() => classifyFence(info), [info])
  const blockId = useMemo(() => makeBlockId(scope, line, code), [scope, line, code])
  const { state, controller } = useBlockEdit({
    conversationId: source.conversationId, messageId: source.messageId, blockId, language: kind.language, format: kind.format, original: code,
  })
  const effective = state.saved ?? code
  const current = state.editing ? state.draft : effective
  const filename = downloadName(kind)
  const { copied, run } = useCopy(() => current)
  const edited = state.saved !== null
  const label = info?.trim() ? info.trim().split(/\s+/)[0]! : 'text'

  return (
    <Frame
      label={label}
      filename={filename}
      badge={
        <>
          {edited && (
            <span
              className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-ink-2"
              data-testid="edited-badge"
              title={state.showOriginal ? 'Showing the original answer. Your edit is kept.' : 'Your edited copy. The original answer is unchanged.'}
            >
              {state.showOriginal ? 'Original' : `Edited · v${state.version}`}
            </span>
          )}
          {state.editing && controller.dirty && <span className="text-[10px] text-ink-2">Unsaved</span>}
        </>
      }
      actions={
        <>
          {edited && !state.editing && (
            <button onClick={() => controller.toggleOriginal()} className={btn} aria-pressed={state.showOriginal}>
              <Eye className="size-3.5" aria-hidden /> {state.showOriginal ? 'Show my edit' : 'Show original'}
            </button>
          )}
          {!state.editing && (
            <button onClick={() => controller.startEdit()} aria-label="Edit code" className={btn}>
              <Pencil className="size-3.5" aria-hidden /> Edit
            </button>
          )}
          <button onClick={() => downloadText(filename, current)} aria-label="Download code" className={btn}>
            <Download className="size-3.5" aria-hidden /> Download
          </button>
          <button onClick={run} aria-label={copied ? 'Copied' : 'Copy code'} className={btn}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </>
      }
    >
      {state.editing ? (
        <EditPanel controller={controller} state={state} language={kind.language} ariaLabel={`Edit ${label} code`} />
      ) : edited && !state.showOriginal ? (
        renderHighlighted(state.saved as string, info)
      ) : (
        original
      )}
    </Frame>
  )
}

/** The code block of an answer: editable once the answer is final and saved on the server, otherwise Copy/Download only. */
export function SourceBlock(props: Props) {
  const editable = useEditableResponse()
  return editable ? <EditableBlock {...props} /> : <PlainBlock {...props} />
}
