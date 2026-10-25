import { api } from '@/lib/api-client'

/** Authoritative state of a YouTube source (File Service). `ready` is true only once the transcript is stored AND indexed. */
export interface YoutubeSource {
  document_id: string
  video_id: string
  canonical_url: string
  title: string | null
  language: string | null
  is_generated: boolean | null
  transcript_version: number
  segment_count: number | null
  duration_seconds: number | null
  extraction_status: 'PENDING' | 'FETCHING' | 'FETCHED' | 'FAILED_RETRYABLE' | 'FAILED_PERMANENT'
  indexing_status: string
  ready: boolean
  error_code: string | null
  message: string | null
  retryable: boolean
  retry_after_seconds: number | null
  created: boolean
}

const path = (id: string) => `/files/youtube/${encodeURIComponent(id)}`

export const youtubeService = {
  /** Idempotent per user + video: the same video returns the same document. 202 = accepted, poll `get`. */
  attach: (url: string, conversationId?: string | null) =>
    api.post<YoutubeSource>('/files/youtube', { url, conversation_id: conversationId ?? undefined }),
  get: (id: string, signal?: AbortSignal) => api.get<YoutubeSource>(path(id), { signal }),
  retry: (id: string) => api.post<YoutubeSource>(`${path(id)}/retry`),
  remove: (id: string) => api.delete<void>(path(id)),
}
