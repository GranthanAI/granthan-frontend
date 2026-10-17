import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GitBranchPlus, MessageSquareQuote } from 'lucide-react'
import { cleanSelection } from '@/lib/quote'
import { Spinner } from '@/components/ui/primitives'

interface Anchor {
  text: string
  top: number
  bottom: number
  left: number
}

const elementOf = (n: Node | null): Element | null => (n instanceof Element ? n : (n?.parentElement ?? null))

/**
 * Two actions over text selected inside a chat message, shown when the user finishes selecting:
 *  - Create new branch: a child conversation titled with the first 5 words of the selection
 *  - In this branch: stay in this conversation
 * Either way the selection travels with the next prompt (see the composer's quote chip).
 *
 * The selection must sit inside ONE message of the message list (`[data-chat-messages]`), so selecting
 * in the composer, sidebar or across messages never shows it.
 */
export function SelectionActions({
  onNewBranch,
  onThisBranch,
  pending,
}: {
  onNewBranch: (selection: string) => void
  onThisBranch: (selection: string) => void
  pending?: boolean
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const bar = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const read = () => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return setAnchor(null)
      const text = cleanSelection(sel.toString())
      if (!text) return setAnchor(null)
      const a = elementOf(sel.anchorNode)
      const f = elementOf(sel.focusNode)
      const msgA = a?.closest('[data-message-id]')
      const msgF = f?.closest('[data-message-id]')
      if (!msgA || msgA !== msgF || !a?.closest('[data-chat-messages]')) return setAnchor(null)
      const r = sel.getRangeAt(0).getBoundingClientRect()
      setAnchor({ text, top: r.top, bottom: r.bottom, left: r.left + r.width / 2 })
    }
    // After the pointer/keyboard selection gesture ends ("select and leave it").
    const settle = () => setTimeout(read, 0)
    const onChange = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) setAnchor(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAnchor(null)
      else settle() // Shift+arrows extend a selection from the keyboard
    }
    const onScroll = () => setAnchor((cur) => (cur ? null : cur))

    document.addEventListener('mouseup', settle)
    document.addEventListener('touchend', settle)
    document.addEventListener('keyup', onKey)
    document.addEventListener('selectionchange', onChange)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mouseup', settle)
      document.removeEventListener('touchend', settle)
      document.removeEventListener('keyup', onKey)
      document.removeEventListener('selectionchange', onChange)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  if (!anchor) return null

  const above = anchor.top > 56
  const left = Math.min(Math.max(anchor.left, 110), Math.max(window.innerWidth - 110, 110))
  const run = (fn: (s: string) => void) => {
    const text = anchor.text
    window.getSelection()?.removeAllRanges()
    setAnchor(null)
    fn(text)
  }

  return createPortal(
    <div
      ref={bar}
      role="toolbar"
      aria-label="Actions for selected text"
      style={{
        position: 'fixed',
        top: above ? anchor.top - 8 : anchor.bottom + 8,
        left,
        transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
      }}
      className="animate-in z-50 flex items-center gap-0.5 rounded-xl border border-line bg-raised p-1 shadow-pop"
    >
      {/* mousedown default-prevented so clicking a button does not clear the selection first */}
      <button
        type="button"
        disabled={pending}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => run(onNewBranch)}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
      >
        {pending ? <Spinner className="size-4" /> : <GitBranchPlus className="size-4" aria-hidden />}
        Create new branch
      </button>
      <span className="h-5 w-px bg-line" aria-hidden />
      <button
        type="button"
        disabled={pending}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => run(onThisBranch)}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
      >
        <MessageSquareQuote className="size-4" aria-hidden />
        In this branch
      </button>
    </div>,
    document.body,
  )
}
