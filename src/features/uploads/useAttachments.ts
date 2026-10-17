import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '@/lib/errors'
import { uuid } from '@/lib/utils'
import { validateFile } from '@/lib/validation'
import { fileService } from '@/services/file.service'
import type { FileStatus } from '@/types/api'

export interface Attachment {
  localId: string
  file: File
  /** Upload phase (client) then backend lifecycle (UPLOADED -> PROCESSING -> READY | FAILED). */
  phase: 'uploading' | 'upload_failed' | 'processing' | 'ready' | 'failed'
  progress: number
  documentId: string | null
  backendStatus: FileStatus | null
  error?: string
}

const POLL_MS = 2000
const POLL_MAX_MS = 5 * 60_000

/**
 * Composer attachments: validate -> presigned upload -> complete -> poll status until the
 * backend reports READY (or FAILED). A file is only usable in a message once READY because
 * ingestion/indexing is asynchronous.
 */
export function useAttachments(conversationId: string | null) {
  const [items, setItems] = useState<Attachment[]>([])
  const [rejections, setRejections] = useState<string[]>([])
  const aborts = useRef(new Map<string, AbortController>())
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    const map = aborts.current
    return () => {
      alive.current = false
      map.forEach((c) => c.abort())
      map.clear()
    }
  }, [])

  const patch = useCallback((localId: string, p: Partial<Attachment>) => {
    if (!alive.current) return
    setItems((cur) => cur.map((a) => (a.localId === localId ? { ...a, ...p } : a)))
  }, [])

  const poll = useCallback(
    async (localId: string, documentId: string, signal: AbortSignal) => {
      const started = Date.now()
      while (!signal.aborted && Date.now() - started < POLL_MAX_MS) {
        try {
          const s = await fileService.status(documentId, signal)
          if (s.status === 'READY') return patch(localId, { phase: 'ready', backendStatus: s.status })
          if (s.status === 'FAILED' || s.status === 'DELETED' || s.status === 'DELETING')
            return patch(localId, {
              phase: 'failed',
              backendStatus: s.status,
              error: s.error_message || 'Processing failed. You can retry or remove this file.',
            })
          patch(localId, { phase: 'processing', backendStatus: s.status })
        } catch (e) {
          if (signal.aborted) return
          const msg = errorMessage(e)
          if (/not.?found|access/i.test(msg)) return patch(localId, { phase: 'failed', error: msg })
        }
        await new Promise((r) => setTimeout(r, POLL_MS))
      }
      if (!signal.aborted)
        patch(localId, { phase: 'failed', error: 'Processing is taking too long. Retry later.' })
    },
    [patch],
  )

  const start = useCallback(
    async (localId: string, file: File) => {
      const ctrl = new AbortController()
      aborts.current.set(localId, ctrl)
      patch(localId, { phase: 'uploading', progress: 0, error: undefined })
      try {
        const { document_id } = await fileService.upload(file, {
          conversationId,
          signal: ctrl.signal,
          onProgress: (f) => patch(localId, { progress: f }),
        })
        patch(localId, { documentId: document_id, phase: 'processing', progress: 1, backendStatus: 'UPLOADED' })
        await poll(localId, document_id, ctrl.signal)
      } catch (e) {
        if (!ctrl.signal.aborted) patch(localId, { phase: 'upload_failed', error: errorMessage(e) })
      }
    },
    [conversationId, patch, poll],
  )

  const add = useCallback(
    (files: File[]) => {
      const bad: string[] = []
      const fresh: Attachment[] = []
      for (const file of files) {
        const check = validateFile(file)
        if (!check.ok) {
          bad.push(check.reason)
          continue
        }
        fresh.push({
          localId: uuid(),
          file,
          phase: 'uploading',
          progress: 0,
          documentId: null,
          backendStatus: null,
        })
      }
      setRejections(bad)
      if (!fresh.length) return
      setItems((cur) => [...cur, ...fresh])
      fresh.forEach((a) => void start(a.localId, a.file))
    },
    [start],
  )

  const remove = useCallback((localId: string) => {
    aborts.current.get(localId)?.abort()
    aborts.current.delete(localId)
    setItems((cur) => cur.filter((a) => a.localId !== localId))
  }, [])

  const retry = useCallback(
    async (localId: string) => {
      const a = items.find((x) => x.localId === localId)
      if (!a) return
      if (a.phase === 'upload_failed' || !a.documentId) return void start(localId, a.file)
      // Backend processing failed: ask File Service to re-run ingestion.
      const ctrl = new AbortController()
      aborts.current.set(localId, ctrl)
      patch(localId, { phase: 'processing', error: undefined })
      try {
        await fileService.retry(a.documentId)
        await poll(localId, a.documentId, ctrl.signal)
      } catch (e) {
        if (!ctrl.signal.aborted) patch(localId, { phase: 'failed', error: errorMessage(e) })
      }
    },
    [items, patch, poll, start],
  )

  const clear = useCallback(() => {
    aborts.current.forEach((c) => c.abort())
    aborts.current.clear()
    setItems([])
    setRejections([])
  }, [])

  const readyIds = items.filter((a) => a.phase === 'ready' && a.documentId).map((a) => a.documentId!)
  const blocking = items.some((a) => a.phase === 'uploading' || a.phase === 'processing')
  const hasFailed = items.some((a) => a.phase === 'failed' || a.phase === 'upload_failed')

  return { items, rejections, add, remove, retry, clear, readyIds, blocking, hasFailed, dismissRejections: () => setRejections([]) }
}
