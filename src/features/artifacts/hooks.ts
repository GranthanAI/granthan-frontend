import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  artifactKeys,
  artifactService,
  isActive,
  type Artifact,
  type ArtifactList,
  type ArtifactScope,
  type ArtifactType,
} from './service'

export const POLL_MS = 1500

/** A short stable key for a spec/source so the register query is cached per content (not per render). */
export function contentKey(content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return `${text.length}:${(h >>> 0).toString(36)}`
}

/**
 * Resolves the persisted artifact for a block that appears in a message.
 *
 * 1. `register` (idempotent): the server returns the existing artifact, or creates it. For an artifact that already exists
 *    this never renders anything, which is what makes revisiting a conversation free. The result is cached for the
 *    session, so switching away and back does not even repeat the request.
 * 2. Status is then read from the server and polled ONLY while the artifact is genuinely being produced; polling stops
 *    on `ready`/`failed` and when the component unmounts.
 */
export function useBlockArtifact(args: {
  conversationId: string | undefined
  messageId: string | undefined
  type: ArtifactType
  content: unknown
  blockId?: string
  title?: string
}) {
  const { conversationId, messageId, type, content, blockId, title } = args
  const qc = useQueryClient()
  const key = useMemo(() => contentKey(content), [content])
  const enabled = !!conversationId && !!messageId
  const registered = useQuery({
    queryKey: artifactKeys.registered(conversationId ?? '', messageId ?? '', `${type}:${blockId ?? ''}:${key}`),
    enabled,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      const a = await artifactService.register(
        { conversation_id: conversationId!, source_message_id: messageId!, type, content, block_id: blockId, title },
        signal,
      )
      void qc.invalidateQueries({ queryKey: artifactKeys.all, predicate: (q) => q.queryKey[1] === 'list' })
      return a
    },
  })
  const id = registered.data?.artifact_id
  const live = useQuery({
    queryKey: artifactKeys.one(id ?? ''),
    enabled: !!id,
    initialData: registered.data,
    // a finished artifact never changes, so it is never re-fetched; an active one is polled below
    staleTime: (q) => (isActive(q.state.data) ? 0 : Infinity),
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: ({ signal }) => artifactService.get(id!, signal),
    refetchInterval: (q) => (isActive(q.state.data) ? POLL_MS : false),
  })
  return { artifact: live.data ?? registered.data, loading: enabled && registered.isPending, error: registered.error }
}

export function useRetryArtifact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => artifactService.retry(id),
    onSuccess: (a: Artifact) => {
      qc.setQueryData(artifactKeys.one(a.artifact_id), a)
      void qc.invalidateQueries({ queryKey: artifactKeys.all, predicate: (q) => q.queryKey[1] === 'list' })
    },
  })
}

/** The sidebar list. Polls only while something in it is still being produced. */
export function useArtifactList(conversationId: string | undefined, scope: ArtifactScope, type: ArtifactType | null, q: string) {
  return useQuery({
    queryKey: artifactKeys.list(conversationId ?? '', scope, type, q),
    enabled: !!conversationId,
    queryFn: ({ signal }) => artifactService.list(conversationId!, { scope, type, q }, signal),
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const data = query.state.data as ArtifactList | undefined
      return data?.groups.some((g) => g.artifacts.some(isActive)) ? POLL_MS : false
    },
  })
}

/** An object URL for an authenticated blob, revoked on unmount. Fetched once per artifact and cached. */
export function useBlobUrl(key: readonly unknown[], fetcher: (signal: AbortSignal) => Promise<Blob>, enabled: boolean) {
  const query = useQuery({ queryKey: key, enabled, queryFn: ({ signal }) => fetcher(signal), staleTime: Infinity, gcTime: 10 * 60_000, retry: false })
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    // An object URL is created for the blob and revoked on cleanup; doing this in an effect keeps it StrictMode-safe.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!query.data) return setUrl(null)
    const u = URL.createObjectURL(query.data)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [query.data])
  return { url, blob: query.data, loading: enabled && query.isPending, error: query.error }
}
