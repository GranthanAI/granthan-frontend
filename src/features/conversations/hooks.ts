import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { qk } from '@/lib/query-keys'
import { conversationService, graphService } from '@/services/conversation.service'
import { fromGraph, mergeConversations } from './tree'
import type { Conversation } from '@/types/api'

export function useConversationList() {
  const q = useInfiniteQuery({
    queryKey: qk.conversations,
    queryFn: ({ pageParam, signal }) => conversationService.list({ cursor: pageParam, limit: 30 }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
    staleTime: 15_000,
  })
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data])
  return { ...q, items }
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: qk.conversation(id ?? ''),
    queryFn: ({ signal }) => conversationService.get(id!, signal),
    enabled: !!id,
    retry: (n, e) => (e && 'kind' in e && ['not_found', 'forbidden', 'auth'].includes(String(e.kind)) ? false : n < 2),
  })
}

/**
 * Lineage context for the active conversation from Graph Service: its ancestors (so the
 * path is complete even if older pages are not loaded) and its direct children.
 * The graph is eventually consistent, so failures are non-fatal for the UI.
 */
export function useLineage(id: string | undefined) {
  const ancestors = useQuery({
    queryKey: qk.ancestors(id ?? ''),
    queryFn: ({ signal }) => graphService.ancestors(id!, signal),
    enabled: !!id,
    staleTime: 30_000,
    retry: 1,
  })
  const children = useQuery({
    queryKey: qk.children(id ?? ''),
    queryFn: ({ signal }) => graphService.children(id!, {}, signal),
    enabled: !!id,
    staleTime: 30_000,
    retry: 1,
  })
  // Graph Service nodes always report parent_conversation_id = null (verified against the
  // running stack), so relationships are derived from what each endpoint guarantees:
  //  - children(id): every item is a direct child of `id`
  //  - ancestors(id): documented root-to-parent chain, so item[i]'s parent is item[i-1]
  // The conversation list/get endpoints carry the authoritative parent for loaded items.
  const extra = useMemo<Conversation[]>(() => {
    const anc = (ancestors.data ?? []).map((g, i, arr) => ({
      ...fromGraph(g),
      parent_conversation_id: i > 0 ? arr[i - 1]!.conversation_id : null,
    }))
    const kids = (children.data ?? []).map((g) => ({ ...fromGraph(g), parent_conversation_id: id ?? null }))
    return [...anc, ...kids]
  }, [ancestors.data, children.data, id])
  return { ancestors, children, extra }
}

/** All nodes the tree can show: list pages first, then lineage extras. */
export function useTreeSource(activeId: string | undefined) {
  const list = useConversationList()
  const lineage = useLineage(activeId)
  const all = useMemo(() => mergeConversations(list.items, lineage.extra), [list.items, lineage.extra])
  return { list, lineage, all }
}

export function useCreateConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: conversationService.create,
    onSuccess: (c) => {
      qc.setQueryData(qk.conversation(c.conversation_id), c)
      void qc.invalidateQueries({ queryKey: qk.conversations })
      if (c.parent_conversation_id) {
        void qc.invalidateQueries({ queryKey: qk.children(c.parent_conversation_id) })
      }
    },
  })
}

export function useRenameConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; title: string }) => conversationService.rename(v.id, v.title),
    onSuccess: (c) => {
      qc.setQueryData(qk.conversation(c.conversation_id), c)
      void qc.invalidateQueries({ queryKey: qk.conversations })
    },
  })
}

export function useDeleteConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => conversationService.remove(id),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: qk.conversation(id) })
      qc.removeQueries({ queryKey: qk.messages(id) })
      void qc.invalidateQueries({ queryKey: qk.conversations })
    },
  })
}
