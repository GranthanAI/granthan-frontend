import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { edgePath, GRAPH, layoutFamily, type TreeNode } from '@/features/conversations/tree'
import { cn, truncate } from '@/lib/utils'

interface Props {
  root: TreeNode
  /** The conversation this graph was opened from. */
  currentId: string
  /** Conversations that already have a chat window open. */
  openIds: Set<string>
  onOpen: (conversationId: string) => void
}

const ZOOM_MIN = 0.4
const ZOOM_MAX = 2

/** Small node-link diagram of one master conversation and all its branches. Click a node to open it. */
export function HierarchyGraph({ root, currentId, openIds, onOpen }: Props) {
  const layout = useMemo(() => layoutFamily(root), [root])
  const box = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
  const h = layout.height + GRAPH.padY

  const fit = () => {
    const el = box.current
    if (!el) return
    setZoom(clamp(Math.min(el.clientWidth / layout.width, el.clientHeight / h)))
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={box} className="min-h-0 flex-1 overflow-auto p-1" data-testid="hierarchy-scroll">
        <svg
          role="group"
          aria-label="Conversation hierarchy"
          width={layout.width * zoom}
          height={h * zoom}
          viewBox={`0 0 ${layout.width} ${h}`}
          className="block"
        >
          <defs>
            <marker id="hg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" className="fill-ink-3" />
            </marker>
          </defs>
          {layout.edges.map(({ from, to }) => (
            <path
              key={to.id}
              d={edgePath(from, to)}
              className="fill-none stroke-ink-3"
              strokeWidth={1.4}
              markerEnd="url(#hg-arrow)"
            />
          ))}
          {layout.nodes.map((n) => {
            const current = n.id === currentId
            const opened = openIds.has(n.id)
            return (
              <g
                key={n.id}
                role="button"
                tabIndex={0}
                aria-label={`Open ${n.title}`}
                aria-current={current ? 'true' : undefined}
                data-node-id={n.id}
                onClick={() => onOpen(n.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpen(n.id)
                  }
                }}
                className="group cursor-pointer outline-none"
              >
                <title>{n.title}</title>
                {/* generous hit area */}
                <rect
                  x={n.x - 10}
                  y={n.y - GRAPH.rowH / 2 + 2}
                  width={GRAPH.labelW + 12}
                  height={GRAPH.rowH - 4}
                  rx={6}
                  className="fill-transparent group-hover:fill-surface-2 group-focus-visible:fill-surface-2"
                />
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={current ? 7 : 5.5}
                  className={cn(
                    current ? 'fill-accent stroke-accent' : opened ? 'fill-accent-soft stroke-accent' : 'fill-raised stroke-ink-3',
                  )}
                  strokeWidth={opened || current ? 2 : 1.5}
                />
                <text x={n.x + 12} y={n.y + 4} className={cn('select-none text-[11px]', current ? 'fill-ink font-semibold' : 'fill-ink-2')}>
                  {truncate(n.title, 24)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="absolute bottom-2 right-2 flex items-center gap-0.5 rounded-lg border border-line bg-raised/90 p-0.5 shadow-pop">
        <ZoomBtn label="Zoom out" onClick={() => setZoom((z) => clamp(z - 0.2))}>
          <ZoomOut className="size-3.5" />
        </ZoomBtn>
        <ZoomBtn label="Zoom in" onClick={() => setZoom((z) => clamp(z + 0.2))}>
          <ZoomIn className="size-3.5" />
        </ZoomBtn>
        <ZoomBtn label="Fit to window" onClick={fit}>
          <Maximize2 className="size-3.5" />
        </ZoomBtn>
      </div>
    </div>
  )
}

function ZoomBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-6 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </button>
  )
}
