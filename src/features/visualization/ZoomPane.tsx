import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react'

const MIN = 0.5
const MAX = 5
const STEP = 0.25
const clamp = (z: number) => Math.min(MAX, Math.max(MIN, Math.round(z * 100) / 100))

/** Shows a (sanitised) SVG scaled to `zoom`; the SVG is cloned in, never serialised to HTML. */
function Canvas({ svg, zoom, onZoom, onClickPlain }: { svg: SVGElement; zoom: number; onZoom: (z: number) => void; onClickPlain?: () => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null)

  useEffect(() => {
    const copy = svg.cloneNode(true) as SVGElement
    copy.removeAttribute('height')
    copy.setAttribute('width', '100%')
    copy.style.maxWidth = 'none'
    inner.current?.replaceChildren(copy)
  }, [svg])

  // Ctrl/Cmd + wheel (and trackpad pinch) zooms; a plain wheel scrolls as usual.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      onZoom(clamp(zoom + (e.deltaY < 0 ? STEP : -STEP)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom, onZoom])

  return (
    <div
      ref={scroller}
      className={`h-full w-full overflow-auto ${zoom > 1 ? 'cursor-grab active:cursor-grabbing' : onClickPlain ? 'cursor-zoom-in' : ''}`}
      onPointerDown={(e) => {
        const el = scroller.current
        if (!el) return
        drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        const el = scroller.current
        if (!d || !el || e.buttons !== 1) return
        const dx = e.clientX - d.x
        const dy = e.clientY - d.y
        if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
        el.scrollLeft = d.left - dx
        el.scrollTop = d.top - dy
      }}
      onPointerUp={() => {
        const moved = drag.current?.moved
        drag.current = null
        if (!moved) onClickPlain?.()
      }}
      onPointerLeave={() => {
        drag.current = null
      }}
    >
      <div ref={inner} style={{ width: `${zoom * 100}%`, minWidth: '100%' }} />
    </div>
  )
}

function Controls({ zoom, onZoom, onExpand, onClose }: { zoom: number; onZoom: (z: number) => void; onExpand?: () => void; onClose?: () => void }) {
  const btn = 'inline-flex size-7 items-center justify-center rounded-md hover:bg-surface-2 hover:text-ink disabled:opacity-40'
  return (
    <div className="flex items-center gap-0.5" onPointerDown={(e) => e.stopPropagation()}>
      <button className={btn} aria-label="Zoom out" disabled={zoom <= MIN} onClick={() => onZoom(clamp(zoom - STEP))}>
        <ZoomOut className="size-4" />
      </button>
      <button className="min-w-[3rem] rounded-md px-1 text-xs hover:bg-surface-2" aria-label="Reset zoom" onClick={() => onZoom(1)}>
        {Math.round(zoom * 100)}%
      </button>
      <button className={btn} aria-label="Zoom in" disabled={zoom >= MAX} onClick={() => onZoom(clamp(zoom + STEP))}>
        <ZoomIn className="size-4" />
      </button>
      {onExpand && (
        <button className={btn} aria-label="Expand to full screen" onClick={onExpand}>
          <Maximize2 className="size-4" />
        </button>
      )}
      {onClose && (
        <button className={btn} aria-label="Close full screen" onClick={onClose}>
          <X className="size-5" />
        </button>
      )}
    </div>
  )
}

/** Inline viewer: zoom buttons, Ctrl+wheel zoom, drag-to-pan, click (or the expand button) for full screen. */
export function useZoomViewer(svg: SVGElement | null) {
  const [zoom, setZoom] = useState(1)
  const [open, setOpen] = useState(false)
  const [fsZoom, setFsZoom] = useState(1)
  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, close])

  const controls = <Controls zoom={zoom} onZoom={setZoom} onExpand={svg ? () => (setFsZoom(1), setOpen(true)) : undefined} />
  const body = svg ? (
    <div className="h-[min(60vh,28rem)] p-1">
      <Canvas svg={svg} zoom={zoom} onZoom={setZoom} onClickPlain={() => (setFsZoom(1), setOpen(true))} />
    </div>
  ) : null
  const overlay =
    open && svg
      ? createPortal(
          <div role="dialog" aria-modal="true" aria-label="Diagram full screen" className="fixed inset-0 z-[100] flex flex-col bg-surface">
            <div className="flex items-center justify-between border-b border-line px-4 py-2 text-ink-3">
              <span className="text-sm">Ctrl + scroll to zoom · drag to move · Esc to close</span>
              <Controls zoom={fsZoom} onZoom={setFsZoom} onClose={close} />
            </div>
            <div className="min-h-0 flex-1 p-2">
              <Canvas svg={svg} zoom={fsZoom} onZoom={setFsZoom} />
            </div>
          </div>,
          document.body,
        )
      : null
  return { controls, body, overlay }
}
