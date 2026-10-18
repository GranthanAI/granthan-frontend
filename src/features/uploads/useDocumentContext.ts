import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { qk } from '@/lib/query-keys'
import { fileService } from '@/services/file.service'
import type { ApiMessage, FileStatus } from '@/types/api'

export interface ContextDocument {
  id: string
  name: string
  status: FileStatus | 'UNKNOWN'
  /** READY means chunks are indexed and searchable; anything else (or a missing file) cannot ground an answer. */
  usable: boolean
  included: boolean
  reason?: string
  /** Title of the ancestor conversation this document was inherited from (absent = attached here). */
  inheritedFrom?: string
}

const MAX_CONTEXT_DOCS = 5

/** Distinct document ids attached to earlier messages of this conversation, most recent first. */
export function documentIdsFromHistory(messages: ApiMessage[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = messages.length - 1; i >= 0 && out.length < MAX_CONTEXT_DOCS; i--) {
    for (const id of messages[i]?.file_ids ?? []) {
      if (!seen.has(id) && out.length < MAX_CONTEXT_DOCS) {
        seen.add(id)
        out.push(id)
      }
    }
  }
  return out
}

/** Every distinct document attached to any loaded message of the conversation (oldest first, no cap). */
export function allDocumentIds(messages: ApiMessage[]): string[] {
  return [...new Set(messages.flatMap((m) => m.file_ids ?? []))]
}

/**
 * Documents attached earlier in this conversation stay in scope for follow-up questions (a question
 * like "what does section 2 say?" carries no file_ids of its own). They are shown to the user, can be
 * switched off, and are only sent while the backend still reports them READY.
 */
export function useDocumentContext(historyIds: string[], inheritedFrom: Record<string, string> = {}) {
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const results = useQueries({
    queries: historyIds.map((id) => ({
      queryKey: qk.file(id),
      queryFn: () => fileService.get(id),
      staleTime: 15_000,
      retry: false,
      // keep checking until the file settles (READY / FAILED / gone)
      refetchInterval: (q: { state: { data?: { status: FileStatus } } }) =>
        q.state.data && ['UPLOADED', 'SCANNING', 'PROCESSING', 'UPLOADING'].includes(q.state.data.status) ? 3000 : false,
    })),
  })

  const documents: ContextDocument[] = historyIds.map((id, i) => {
    const r = results[i]
    const rec = r?.data
    if (r?.isError || (rec && (rec.status === 'DELETED' || rec.status === 'DELETING')))
      return { id, name: rec?.filename ?? 'Unavailable file', status: 'UNKNOWN', usable: false, included: false, reason: 'No longer available' }
    if (!rec) return { id, name: 'Loading…', status: 'UNKNOWN', usable: false, included: false, reason: 'Checking…' }
    const usable = rec.status === 'READY'
    return {
      id,
      name: rec.filename,
      status: rec.status,
      usable,
      included: usable && !excluded.has(id),
      reason: usable ? undefined : rec.status === 'FAILED' ? 'Processing failed' : 'Still processing',
    }
  })

  // Provenance: documents that came from an ancestor conversation say where from.
  const documentsWithSource = documents.map((d) => (inheritedFrom[d.id] ? { ...d, inheritedFrom: inheritedFrom[d.id] } : d))

  return {
    documents: documentsWithSource,
    includedIds: documents.filter((d) => d.included).map((d) => d.id),
    toggle: (id: string) =>
      setExcluded((cur) => {
        const next = new Set(cur)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
  }
}
