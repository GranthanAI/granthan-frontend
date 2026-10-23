import { api, requestBlob } from '@/lib/api-client'

export type ArtifactType = 'mermaid' | 'manim'
export type ArtifactStatus = 'pending' | 'queued' | 'rendering' | 'uploading' | 'ready' | 'failed'
export type ArtifactScope = 'self' | 'hierarchy' | 'auto'

/** A persisted artifact as the server describes it. The server is the source of truth for status; nothing here is invented. */
export interface Artifact {
  artifact_id: string
  type: ArtifactType
  title: string
  status: ArtifactStatus
  ready: boolean
  active: boolean
  failure_code: string | null
  message: string | null
  retryable: boolean
  created_at: string
  updated_at: string
  conversation_id: string | null
  source_message_id: string | null
  block_id: string | null
  mime_type: string | null
  size_bytes: number | null
  has_media: boolean
  has_thumbnail: boolean
  /** Mermaid source only; Manim specifications stay on the server. */
  source: string | null
}

export interface ArtifactGroup {
  conversation_id: string
  title: string
  parent_conversation_id: string | null
  is_current: boolean
  artifacts: Artifact[]
}

export interface ArtifactList {
  scope: 'self' | 'hierarchy'
  root_conversation_id: string
  conversation_id: string
  is_root: boolean
  groups: ArtifactGroup[]
  total: number
}

export interface RegisterBody {
  conversation_id: string
  source_message_id: string
  type: ArtifactType
  content: unknown
  block_id?: string
  title?: string
}

export const isActive = (a: Pick<Artifact, 'status'> | undefined | null) =>
  !!a && a.status !== 'ready' && a.status !== 'failed'

export const artifactService = {
  /** Idempotent: an existing artifact is returned as-is. This is the ONLY call a mounted chat block makes. */
  register: (body: RegisterBody, signal?: AbortSignal) => api.post<Artifact>('/artifacts', body, { signal }),
  get: (id: string, signal?: AbortSignal) => api.get<Artifact>(`/artifacts/${id}`, { signal }),
  list: (
    conversationId: string,
    o: { scope?: ArtifactScope; type?: ArtifactType | null; q?: string },
    signal?: AbortSignal,
  ) =>
    api.get<ArtifactList>('/artifacts', {
      query: { conversation_id: conversationId, scope: o.scope ?? 'auto', type: o.type ?? undefined, q: o.q || undefined },
      signal,
    }),
  /** Explicit, user-initiated retry of a failed render. */
  retry: (id: string) => api.post<Artifact>(`/artifacts/${id}/retry`),
  /** The video/thumbnail need the Authorization header, which <video src> cannot send: fetch to a blob. */
  media: (id: string, signal?: AbortSignal) => requestBlob(`/artifacts/${id}/media`, { signal }),
  thumbnail: (id: string, signal?: AbortSignal) => requestBlob(`/artifacts/${id}/thumbnail`, { signal }),
}

export const artifactKeys = {
  all: ['artifacts'] as const,
  list: (conversationId: string, scope: ArtifactScope, type: ArtifactType | null, q: string) =>
    ['artifacts', 'list', conversationId, scope, type, q] as const,
  one: (id: string) => ['artifacts', 'one', id] as const,
  registered: (conversationId: string, messageId: string, key: string) =>
    ['artifacts', 'registered', conversationId, messageId, key] as const,
  media: (id: string) => ['artifacts', 'media', id] as const,
  thumb: (id: string) => ['artifacts', 'thumb', id] as const,
}
