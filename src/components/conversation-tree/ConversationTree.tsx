import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, CornerDownRight, GitBranch, MoreHorizontal, Network, Pencil, Trash2 } from 'lucide-react'
import { cn, relativeTime } from '@/lib/utils'
import { buildTree, descendantsOf, flatten, pathTo, type TreeNode } from '@/features/conversations/tree'
import { Menu } from '@/components/ui/overlays'
import { Skeleton } from '@/components/ui/primitives'
import { useWindowsStore } from '@/stores/windows.store'
import type { Conversation } from '@/types/api'

interface Props {
  conversations: Conversation[]
  activeId?: string
  /** Called after a row link is followed (closes the mobile drawer). */
  onNavigate?: () => void
  onRename: (c: Conversation) => void
  onDelete: (c: Conversation, descendantCount: number) => void
  onBranch: (c: Conversation) => void
}

/** Hierarchical history: indentation + connector lines, expand/collapse, keyboard navigation. */
export function ConversationTree({ conversations, activeId, onNavigate, onRename, onDelete, onBranch }: Props) {
  const roots = useMemo(() => buildTree(conversations), [conversations])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const autoExpanded = useRef<string | undefined>(undefined)

  // Reveal the path to the active conversation once per navigation.
  useEffect(() => {
    if (!activeId || autoExpanded.current === activeId) return
    const path = pathTo(conversations, activeId)
    if (path.length === 0) return
    autoExpanded.current = activeId
    // Syncing UI state to the route (an external system); runs once per navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded((prev) => {
      const next = new Set(prev)
      path.slice(0, -1).forEach((id) => next.add(id))
      return next
    })
  }, [activeId, conversations])

  const rows = useMemo(() => flatten(roots, expanded), [roots, expanded])
  const toggle = (id: string) =>
    setExpanded((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const listRef = useRef<HTMLUListElement>(null)
  const onKeyDown = (e: React.KeyboardEvent) => {
    const links = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-row-link]') ?? [])]
    const i = links.indexOf(document.activeElement as HTMLElement)
    if (i === -1) return
    const id = (document.activeElement as HTMLElement).dataset.id!
    const row = rows.find((r) => r.node.conversation.conversation_id === id)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      links[Math.min(i + 1, links.length - 1)]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      links[Math.max(i - 1, 0)]?.focus()
    } else if (e.key === 'ArrowRight' && row?.hasChildren && !row.expanded) {
      e.preventDefault()
      toggle(id)
    } else if (e.key === 'ArrowLeft' && row?.hasChildren && row.expanded) {
      e.preventDefault()
      toggle(id)
    }
  }

  return (
    <ul ref={listRef} role="tree" aria-label="Conversation history" onKeyDown={onKeyDown} className="space-y-0.5">
      {rows.map(({ node, expanded: open, hasChildren }) => (
        <TreeRow
          key={node.conversation.conversation_id}
          node={node}
          open={open}
          hasChildren={hasChildren}
          active={node.conversation.conversation_id === activeId}
          onToggle={toggle}
          onNavigate={onNavigate}
          onRename={onRename}
          onDelete={onDelete}
          onBranch={onBranch}
        />
      ))}
    </ul>
  )
}

interface RowProps {
  node: TreeNode
  open: boolean
  hasChildren: boolean
  active: boolean
  onToggle: (id: string) => void
  onNavigate?: () => void
  onRename: (c: Conversation) => void
  onDelete: (c: Conversation, n: number) => void
  onBranch: (c: Conversation) => void
}

const TreeRow = memo(function TreeRow({
  node,
  open,
  hasChildren,
  active,
  onToggle,
  onNavigate,
  onRename,
  onDelete,
  onBranch,
}: RowProps) {
  const c = node.conversation
  const navigate = useNavigate()
  const openWindow = useWindowsStore((s) => s.open)
  return (
    <li
      role="treeitem"
      aria-level={node.depth + 1}
      aria-selected={active}
      aria-expanded={hasChildren ? open : undefined}
      className="relative"
    >
      <div
        className={cn(
          'group flex items-center rounded-lg pr-1 transition-colors',
          active ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        )}
        style={{ paddingLeft: node.depth * 14 + 2 }}
      >
        {node.depth > 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-1/2 top-0 w-px bg-line"
            style={{ left: node.depth * 14 - 5 }}
          />
        )}
        {hasChildren ? (
          <button
            aria-label={`${open ? 'Collapse' : 'Expand'} branches of ${c.title}`}
            onClick={() => onToggle(c.conversation_id)}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 hover:text-ink"
          >
            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          </button>
        ) : (
          <span className="flex size-6 shrink-0 items-center justify-center text-ink-3" aria-hidden>
            {node.depth > 0 ? (
              <CornerDownRight className="size-3.5" />
            ) : node.detached ? (
              <GitBranch className="size-3.5" />
            ) : null}
          </span>
        )}
        <Link
          to={`/c/${c.conversation_id}`}
          data-row-link
          data-id={c.conversation_id}
          aria-current={active ? 'page' : undefined}
          onClick={onNavigate}
          title={node.detached ? `${c.title} (branch of a conversation not loaded yet)` : c.title}
          className="min-w-0 flex-1 rounded-md py-1.5 pr-1 text-sm"
        >
          <span className={cn('block truncate', active && 'font-medium')}>{c.title}</span>
          <span className="block text-[11px] leading-4 text-ink-3">{relativeTime(c.updated_at)}</span>
        </Link>
        <Menu
          label={`Actions for ${c.title}`}
          className="shrink-0"
          trigger={({ props }) => (
            <button
              {...props}
              className={cn(
                'flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-line hover:text-ink',
                'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100',
              )}
            >
              <MoreHorizontal className="size-4" />
            </button>
          )}
          items={[
            { label: 'Open', icon: <CornerDownRight className="size-4" />, onSelect: () => { navigate(`/c/${c.conversation_id}`); onNavigate?.() } },
            { label: 'Chat hierarchy', icon: <Network className="size-4" />, onSelect: () => openWindow('hierarchy', c.conversation_id, { follow: true }), hint: 'Branch graph in a floating window' },
            { label: 'New branch', icon: <GitBranch className="size-4" />, onSelect: () => onBranch(c), hint: 'Start a linked conversation' },
            { label: 'Rename', icon: <Pencil className="size-4" />, onSelect: () => onRename(c) },
            'separator',
            { label: 'Delete', icon: <Trash2 className="size-4" />, danger: true, onSelect: () => onDelete(c, descendantsOf(node)) },
          ]}
        />
      </div>
    </li>
  )
})

export function TreeSkeleton() {
  return (
    <div className="space-y-2 px-2" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-8" />
      ))}
    </div>
  )
}
