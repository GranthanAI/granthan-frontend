import { api } from '@/lib/api-client'
import type {
  ApiMessage,
  EditedVersion,
  EditResponse,
  FeedbackAdminItem,
  FeedbackBody,
  FeedbackRating,
  FeedbackReason,
  Page,
  SendMessageBody,
  ShareCreated,
  ShareItem,
  ShareScope,
  SharedSnapshot,
} from '@/types/api'

const msg = (cid: string, mid: string) => `/conversations/${encodeURIComponent(cid)}/messages/${encodeURIComponent(mid)}`

/** Edit a sent message into a new sibling branch (Q1). `X-Idempotency-Key` is new per click and reused on retry. */
export const editService = {
  edit: (cid: string, mid: string, body: SendMessageBody, idempotencyKey: string) =>
    api.post<EditResponse>(`${msg(cid, mid)}/edit`, body, { headers: { 'X-Idempotency-Key': idempotencyKey } }),
  versions: (cid: string, mid: string, signal?: AbortSignal) => api.get<EditedVersion[]>(`${msg(cid, mid)}/edits`, { signal }),
}

/** Thumbs up / down (Q2) and the staff review list. */
export const feedbackService = {
  put: (cid: string, mid: string, body: FeedbackBody) =>
    api.put<{ rating: FeedbackRating; reason: FeedbackReason | null }>(`${msg(cid, mid)}/feedback`, body),
  remove: (cid: string, mid: string) => api.delete<void>(`${msg(cid, mid)}/feedback`),
  admin: (
    params: { rating?: FeedbackRating; from?: string; to?: string; model_group?: string; reason?: string; cursor?: string | null; limit?: number },
    signal?: AbortSignal,
  ) =>
    api.get<Page<FeedbackAdminItem>>('/feedback/admin', {
      query: { rating: params.rating ?? 'down', from: params.from, to: params.to, model_group: params.model_group, reason: params.reason, cursor: params.cursor, limit: params.limit ?? 50 },
      signal,
    }),
}

/** Share links (Q3). The public read sends no Authorization header. */
export const shareService = {
  create: (conversation_id: string, scope: ShareScope) => api.post<ShareCreated>('/shares', { conversation_id, scope }),
  list: (signal?: AbortSignal) => api.get<{ items: ShareItem[] }>('/shares', { signal }),
  refresh: (shareId: string) => api.post<ShareItem>(`/shares/${encodeURIComponent(shareId)}/refresh`),
  revoke: (shareId: string) => api.delete<void>(`/shares/${encodeURIComponent(shareId)}`),
  readPublic: (token: string, signal?: AbortSignal) =>
    api.get<SharedSnapshot>(`/shares/public/${encodeURIComponent(token)}`, { auth: false, signal }),
}

export type { ApiMessage }
