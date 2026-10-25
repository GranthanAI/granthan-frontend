import { api } from '@/lib/api-client'
import { ApiError } from '@/lib/errors'
import type { SourceFormat } from './files'

/** A user's saved edit of one block. The assistant message itself is never changed. */
export interface SourceEditDoc {
  conversation_id: string
  message_id: string
  block_id: string
  language: string
  source_format: SourceFormat
  original_sha256: string
  content: string
  version: number
  created_at: string
  updated_at: string
}

export interface SourceEditList {
  conversation_id: string
  edits: SourceEditDoc[]
  max_chars: number
}

export interface SourceEditBody {
  content: string
  /** The version this client last saw (0 = no edit yet). */
  version: number
  language: string
  source_format: SourceFormat
  original_sha256: string
}

/** The server holds a different version. `current` is its edit, or null when the edit was discarded elsewhere. */
export class SourceEditConflictError extends Error {
  constructor(readonly current: SourceEditDoc | null) {
    super('This block was changed elsewhere.')
    this.name = 'SourceEditConflictError'
  }
}

export interface SourceEditsApi {
  list(conversationId: string, signal?: AbortSignal): Promise<SourceEditList>
  put(conversationId: string, messageId: string, blockId: string, body: SourceEditBody): Promise<SourceEditDoc>
  remove(conversationId: string, messageId: string, blockId: string, version: number): Promise<void>
}

const path = (c: string, m: string, b: string) => `/conversations/${c}/source-edits/${m}/${encodeURIComponent(b)}`

function asConflict(e: unknown): never {
  const detail = (e instanceof ApiError ? e.detail : undefined) as { code?: string; current?: SourceEditDoc | null } | undefined
  if (e instanceof ApiError && e.status === 409 && detail?.code === 'version_conflict') {
    throw new SourceEditConflictError(detail.current ?? null)
  }
  throw e
}

export const sourceEditsApi: SourceEditsApi = {
  list: (conversationId, signal) => api.get<SourceEditList>(`/conversations/${conversationId}/source-edits`, { signal }),
  async put(c, m, b, body) {
    try {
      return await api.put<SourceEditDoc>(path(c, m, b), body)
    } catch (e) {
      return asConflict(e)
    }
  },
  async remove(c, m, b, version) {
    try {
      await api.delete<void>(path(c, m, b), { query: { version } })
    } catch (e) {
      asConflict(e)
    }
  },
}
