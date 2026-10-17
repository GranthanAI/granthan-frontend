import { api } from '@/lib/api-client'
import type { ApiMessage, Page, SendMessageBody } from '@/types/api'

const base = (cid: string) => `/conversations/${encodeURIComponent(cid)}/messages`

export const messageService = {
  /** Newest first. */
  history: (cid: string, params: { limit?: number; cursor?: string | null }, signal?: AbortSignal) =>
    api.get<Page<ApiMessage>>(base(cid), {
      query: { limit: params.limit ?? 50, cursor: params.cursor },
      signal,
    }),

  /** 202 Accepted: the reply arrives asynchronously over SSE under `response_message_id`. */
  send: (cid: string, body: SendMessageBody, idempotencyKey: string, signal?: AbortSignal) =>
    api.post<ApiMessage>(base(cid), body, {
      headers: { 'X-Idempotency-Key': idempotencyKey },
      signal,
    }),

  regenerate: (cid: string, assistantMessageId: string) =>
    api.post<ApiMessage>(`${base(cid)}/${encodeURIComponent(assistantMessageId)}/regenerate`),

  remove: (cid: string, messageId: string) =>
    api.delete<void>(`${base(cid)}/${encodeURIComponent(messageId)}`),
}
