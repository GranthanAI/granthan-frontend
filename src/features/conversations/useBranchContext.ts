import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { qk } from '@/lib/query-keys'
import type { BranchContext } from '@/types/api'

/**
 * The documents (and ancestor chain) a branch inherits, resolved by the backend up to each branch
 * point. Conversations without a parent get an empty result. Failure is non-fatal: the conversation
 * still works with its own documents.
 */
export function useBranchContext(conversationId: string | null | undefined) {
  const query = useQuery({
    queryKey: qk.branchContext(conversationId ?? ''),
    queryFn: ({ signal }) => api.get<BranchContext>(`/conversations/${encodeURIComponent(conversationId!)}/context`, { signal }),
    enabled: !!conversationId,
    staleTime: 30_000,
    retry: 1,
  })
  const documents = useMemo(() => query.data?.documents ?? [], [query.data])
  /** document id -> title of the conversation it was inherited from */
  const sources = useMemo(() => Object.fromEntries(documents.map((d) => [d.document_id, d.source_title])), [documents])
  return { query, documents, sources }
}
