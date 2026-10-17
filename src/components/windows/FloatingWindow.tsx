import { useRef, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Minus, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { clampPosition, MIN_H, MIN_W, useWindowsStore, type FloatingWin } from '@/stores/windows.store'

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const HANDLES: { edge: Edge; className: string; cursor: string }[] = [
  { edge: 'n', className: 'inset-x-2 -top-1 h-2', cursor: 'cursor-ns-resize' },
  { edge: 's', className: 'inset-x-2 -bottom-1 h-2', cursor: 'cursor-ns-resize' },
  { edge: 'e', className: 'inset-y-2 -right-1 w-2', cursor: 'cursor-ew-resize' },
  { edge: 'w', className: 'inset-y-2 -left-1 w-2', cursor: 'cursor-ew-resize' },
  { edge: 'ne', className: '-right-1 -top-1 size-3', cursor: 'cursor-nesw-resize' },
  { edge: 'nw', className: '-left-1 -top-1 size-3', cursor: 'cursor-nwse-resize' },
  { edge: 'se', className: '-bottom-1 -right-1 size-3', cursor: 'cursor-nwse-resize' },
  { edge: 'sw', className: '-bottom-1 -left-1 size-3', cursor: 'cursor-nesw-resize' },
]

interface Props {
  win: FloatingWin
  title: string
  icon?: ReactNode
  /** Extra header buttons, placed before collapse/close. */
  actions?: ReactNode
  children: ReactNode
}

const HEADER_H = 36

/** A draggable, resizable, collapsible window. Drag by the title bar; resize from any edge or corner. */
export function FloatingWindow({ win, title, icon, actions, children }: Props) {
  const { focus, close, toggleCollapsed, setRect, scale } = useWindowsStore.getState()
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null)
  const resize = useRef<{ edge: Edge; px: number; py: number; x: number; y: number; w: number; h: number } | null>(null)

  const onHeaderDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a')) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, x: win.x, y: win.y }
  }
  const onHeaderMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    setRect(win.key, clampPosition(d.x + e.clientX - d.px, d.y + e.clientY - d.py, win.w))
  }
  const endDrag = () => {
    drag.current = null
  }

  const onHandleDown = (edge: Edge) => (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    resize.current = { edge, px: e.clientX, py: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h }
  }
  const onHandleMove = (e: RPointerEvent<HTMLDivElement>) => {
    const r = resize.current
    if (!r) return
    const dx = e.clientX - r.px
    const dy = e.clientY - r.py
    let { x, y, w, h } = r
    if (r.edge.includes('e')) w = Math.max(MIN_W, r.w + dx)
    if (r.edge.includes('s')) h = Math.max(MIN_H, r.h + dy)
    // West/north edges move the origin; the opposite edge stays put once the minimum size is reached.
    if (r.edge.includes('w')) {
      w = Math.max(MIN_W, r.w - dx)
      x = r.x + (r.w - w)
    }
    if (r.edge.includes('n')) {
      h = Math.max(MIN_H, r.h - dy)
      y = r.y + (r.h - h)
    }
    setRect(win.key, { x, y: Math.max(0, y), w, h })
  }
  const endResize = () => {
    resize.current = null
  }

  return (
    <section
      role="dialog"
      aria-label={title}
      data-floating-window={win.key}
      onPointerDownCapture={() => focus(win.key)}
      style={{ left: win.x, top: win.y, width: win.w, height: win.collapsed ? HEADER_H : win.h, zIndex: win.z }}
      className="pointer-events-auto fixed flex flex-col overflow-hidden rounded-xl border border-line bg-raised shadow-pop"
    >
      <div
        data-window-header
        onPointerDown={onHeaderDown}
        onPointerMove={onHeaderMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => toggleCollapsed(win.key)}
        className="flex shrink-0 cursor-grab touch-none select-none items-center gap-1.5 border-b border-line bg-surface px-2 active:cursor-grabbing"
        style={{ height: HEADER_H }}
      >
        {icon && <span className="shrink-0 text-ink-3">{icon}</span>}
        <h2 className="min-w-0 flex-1 truncate text-xs font-medium">{title}</h2>
        {actions}
        {!win.collapsed && (
          <>
            <WinButton label="Make window smaller (50%)" onClick={() => scale(win.key, 0.5)}>
              <Minus className="size-3.5" />
            </WinButton>
            <WinButton label="Make window larger (+50%)" onClick={() => scale(win.key, 1.5)}>
              <Plus className="size-3.5" />
            </WinButton>
          </>
        )}
        <WinButton label={win.collapsed ? 'Expand window' : 'Collapse window'} onClick={() => toggleCollapsed(win.key)}>
          {win.collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        </WinButton>
        <WinButton label="Close window" onClick={() => close(win.key)}>
          <X className="size-3.5" />
        </WinButton>
      </div>

      {!win.collapsed && (
        <>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          {HANDLES.map((h) => (
            <div
              key={h.edge}
              data-resize={h.edge}
              onPointerDown={onHandleDown(h.edge)}
              onPointerMove={onHandleMove}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              className={cn('absolute z-10 touch-none', h.className, h.cursor)}
            />
          ))}
        </>
      )}
    </section>
  )
}

export function WinButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-line hover:text-ink"
    >
      {children}
    </button>
  )
}
