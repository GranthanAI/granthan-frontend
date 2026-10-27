import { useRef, useState } from 'react'
import { clampPanelWidth, PANEL_MIN_WIDTH, useUiStore } from '@/stores/ui.store'
import { cn } from '@/lib/utils'

const STEP = 24

/**
 * Drag handle on the right panel's left border: hover it, then drag left to widen or right to narrow.
 * Keyboard: focus it and use the arrow keys (Left widens). Double-click restores the default width.
 */
export function PanelResizer() {
  const setPanelWidth = useUiStore((s) => s.setPanelWidth)
  const panelWidth = useUiStore((s) => s.panelWidth)
  const [dragging, setDragging] = useState(false)
  const start = useRef({ x: 0, width: 0 })

  const panelEl = (el: HTMLElement) => el.parentElement as HTMLElement

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, width: panelEl(e.currentTarget).getBoundingClientRect().width }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setPanelWidth(clampPanelWidth(start.current.width + (start.current.x - e.clientX), window.innerWidth))
  }
  const stop = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const current = panelWidth ?? panelEl(e.currentTarget).getBoundingClientRect().width
    setPanelWidth(clampPanelWidth(current + (e.key === 'ArrowLeft' ? STEP : -STEP), window.innerWidth))
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize context panel"
      aria-valuemin={PANEL_MIN_WIDTH}
      aria-valuenow={panelWidth ?? undefined}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
      onDoubleClick={() => setPanelWidth(null)}
      title="Drag to resize. Double-click to reset"
      className={cn(
        'group absolute inset-y-0 -left-1.5 z-10 flex w-3 cursor-col-resize touch-none select-none justify-center outline-none',
      )}
    >
      <span
        className={cn(
          'h-full w-0.5 rounded-full bg-transparent transition-colors group-hover:bg-accent/60 group-focus-visible:bg-accent',
          dragging && 'bg-accent',
        )}
      />
    </div>
  )
}
