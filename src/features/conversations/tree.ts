import type { Conversation, GraphConversation } from '@/types/api'
import { parseServerDate } from '@/lib/utils'

export interface TreeNode {
  conversation: Conversation
  children: TreeNode[]
  depth: number
  /** True when `parent_conversation_id` is set but that parent is not loaded (yet). */
  detached: boolean
}

export function fromGraph(g: GraphConversation): Conversation {
  return {
    conversation_id: g.conversation_id,
    user_id: g.user_id,
    title: g.title,
    status: g.status.toLowerCase(),
    created_at: g.created_at,
    updated_at: g.updated_at,
    parent_conversation_id: g.parent_conversation_id,
  }
}

/** Merges node sources; earlier arguments win (the list endpoint is authoritative). */
export function mergeConversations(...sources: Conversation[][]): Conversation[] {
  const map = new Map<string, Conversation>()
  for (const src of sources) for (const c of src) if (!map.has(c.conversation_id)) map.set(c.conversation_id, c)
  return [...map.values()]
}

/**
 * Builds the parent/child forest strictly from the server's `parent_conversation_id`.
 * Nothing is inferred from titles or timestamps; timestamps are only used for ordering.
 * Guards against cycles and self-parenting by treating such nodes as roots.
 */
export function buildTree(conversations: Conversation[]): TreeNode[] {
  const byId = new Map(conversations.map((c) => [c.conversation_id, c]))
  const kids = new Map<string, Conversation[]>()
  const roots: Conversation[] = []

  const hasCycle = (c: Conversation): boolean => {
    const seen = new Set([c.conversation_id])
    let p = c.parent_conversation_id
    while (p) {
      if (seen.has(p)) return true
      seen.add(p)
      p = byId.get(p)?.parent_conversation_id ?? null
    }
    return false
  }

  for (const c of conversations) {
    const pid = c.parent_conversation_id
    if (pid && byId.has(pid) && !hasCycle(c)) {
      const arr = kids.get(pid) ?? []
      arr.push(c)
      kids.set(pid, arr)
    } else roots.push(c)
  }

  const byUpdated = (a: Conversation, b: Conversation) =>
    parseServerDate(b.updated_at) - parseServerDate(a.updated_at)
  const byCreated = (a: Conversation, b: Conversation) =>
    parseServerDate(a.created_at) - parseServerDate(b.created_at)

  const make = (c: Conversation, depth: number): TreeNode => ({
    conversation: c,
    depth,
    detached: !!c.parent_conversation_id && !byId.has(c.parent_conversation_id),
    children: (kids.get(c.conversation_id) ?? []).sort(byCreated).map((k) => make(k, depth + 1)),
  })
  return roots.sort(byUpdated).map((r) => make(r, 0))
}

/** Ids of every node on the path from a root to `id` (inclusive), using loaded data only. */
export function pathTo(conversations: Conversation[], id: string | undefined): string[] {
  if (!id) return []
  const byId = new Map(conversations.map((c) => [c.conversation_id, c]))
  const path: string[] = []
  const seen = new Set<string>()
  let cur: string | null | undefined = id
  while (cur && byId.has(cur) && !seen.has(cur)) {
    seen.add(cur)
    path.unshift(cur)
    cur = byId.get(cur)!.parent_conversation_id
  }
  return path
}

export interface FlatRow {
  node: TreeNode
  expanded: boolean
  hasChildren: boolean
}

/** Flattens the visible rows for rendering/keyboard navigation. */
export function flatten(roots: TreeNode[], expanded: Set<string>): FlatRow[] {
  const rows: FlatRow[] = []
  const walk = (n: TreeNode) => {
    const isOpen = expanded.has(n.conversation.conversation_id)
    rows.push({ node: n, expanded: isOpen, hasChildren: n.children.length > 0 })
    if (isOpen) n.children.forEach(walk)
  }
  roots.forEach(walk)
  return rows
}

export function descendantsOf(node: TreeNode): number {
  return node.children.reduce((n, c) => n + 1 + descendantsOf(c), 0)
}
