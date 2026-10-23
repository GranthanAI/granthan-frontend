import { api } from '@/lib/api-client'
import { ApiError } from '@/lib/errors'

/** The user's notes for ONE conversation. `version` 0 = nothing saved yet. */
export interface NotesDoc {
  conversation_id: string
  content: string
  version: number
  updated_at: string | null
  max_chars: number
}

/** Thrown when the server holds a newer version than the one we sent: it carries the current document. */
export class NotesConflictError extends Error {
  constructor(readonly current: NotesDoc) {
    super('Your notes were changed elsewhere.')
    this.name = 'NotesConflictError'
  }
}

export interface NotesApi {
  get(conversationId: string, signal?: AbortSignal): Promise<NotesDoc>
  put(conversationId: string, body: { content: string; version: number }): Promise<NotesDoc>
}

export const notesApi: NotesApi = {
  get: (conversationId, signal) => api.get<NotesDoc>(`/conversations/${conversationId}/notes`, { signal }),
  async put(conversationId, body) {
    try {
      return await api.put<NotesDoc>(`/conversations/${conversationId}/notes`, body)
    } catch (e) {
      const detail = (e instanceof ApiError ? e.detail : undefined) as { code?: string; current?: NotesDoc } | undefined
      if (e instanceof ApiError && e.status === 409 && detail?.code === 'version_conflict' && detail.current) {
        throw new NotesConflictError(detail.current)
      }
      throw e
    }
  },
}
