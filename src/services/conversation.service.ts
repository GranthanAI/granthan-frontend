import { api } from '@/lib/api-client'
import type { Conversation, GraphConversation, Page } from '@/types/api'

export const conversationService = {
  list: (params: { limit?: number; cursor?: string | null }, signal?: AbortSignal) =>
    api.get<Page<Conversation>>('/conversations', {
      query: { limit: params.limit ?? 30, cursor: params.cursor },
      signal,
    }),

  get: (id: string, signal?: AbortSignal) =>
    api.get<Conversation>(`/conversations/${encodeURIComponent(id)}`, { signal }),

  /** `parent_conversation_id` creates a lineage link (branch); history is NOT copied. */
  create: (body: { title: string; parent_conversation_id?: string | null }) =>
    api.post<Conversation>('/conversations', {
      title: body.title,
      ...(body.parent_conversation_id ? { parent_conversation_id: body.parent_conversation_id } : {}),
    }),

  rename: (id: string, title: string) =>
    api.patch<Conversation>(`/conversations/${encodeURIComponent(id)}/rename`, { title }),

  remove: (id: string) => api.delete<void>(`/conversations/${encodeURIComponent(id)}`),
}

/** Graph Service (lineage). Eventually consistent with Conversation Service (Kafka). */
export const graphService = {
  children: (id: string, params: { skip?: number; limit?: number } = {}, signal?: AbortSignal) =>
    api.get<GraphConversation[]>(`/graph/conversations/${encodeURIComponent(id)}/children`, {
      query: { skip: params.skip ?? 0, limit: params.limit ?? 100 },
      signal,
    }),

  ancestors: (id: string, signal?: AbortSignal) =>
    api.get<GraphConversation[]>(`/graph/conversations/${encodeURIComponent(id)}/ancestors`, {
      query: { skip: 0, limit: 100 },
      signal,
    }),
}
