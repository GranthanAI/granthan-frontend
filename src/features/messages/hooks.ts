import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { qk } from '@/lib/query-keys'
import { parseServerDate } from '@/lib/utils'
import { messageService } from '@/services/message.service'
import { flattenHistory, TIMEOUT_TEXT } from './chat-controller'
import type { ApiMessage } from '@/types/api'

const LATE_RECOVERY_WINDOW_MS = 10 * 60_000

/**
 * True while the newest assistant row can still change on the server:
 *  - `pending`: generation is in flight
 *  - `failed` by the backend's timeout watchdog, recently: the real reply may still land and
 *    overwrites the failed row ("a late real reply beats a timeout failure")
 */
export function needsPolling(messages: ApiMessage[], now = Date.now()): boolean {
  const last = [...messages].reverse().find((m) => m.sender === 'assistant')
  if (!last) return false
  if (last.status === 'pending') return true
  return (
    last.status === 'failed' &&
    last.content.startsWith(TIMEOUT_TEXT) &&
    now - parseServerDate(last.created_at) < LATE_RECOVERY_WINDOW_MS
  )
}

export function useMessages(conversationId: string | undefined) {
  const q = useInfiniteQuery({
    queryKey: qk.messages(conversationId ?? ''),
    queryFn: ({ pageParam, signal }) =>
      messageService.history(conversationId!, { cursor: pageParam, limit: 50 }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
    enabled: !!conversationId,
    staleTime: 5_000,
    refetchInterval: (query) => {
      const first = query.state.data?.pages[0]?.items ?? []
      return needsPolling([...first].reverse()) ? 4_000 : false
    },
  })
  const messages = useMemo(() => flattenHistory(q.data), [q.data])
  return { ...q, messages }
}
