import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { qk } from '@/lib/query-keys'
import { messageService } from '@/services/message.service'
import { flattenHistory } from './chat-controller'

export function useMessages(conversationId: string | undefined) {
  const q = useInfiniteQuery({
    queryKey: qk.messages(conversationId ?? ''),
    queryFn: ({ pageParam, signal }) =>
      messageService.history(conversationId!, { cursor: pageParam, limit: 50 }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
    enabled: !!conversationId,
    staleTime: 5_000,
  })
  const messages = useMemo(() => flattenHistory(q.data), [q.data])
  return { ...q, messages }
}
