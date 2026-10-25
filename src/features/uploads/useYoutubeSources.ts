import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, errorMessage } from '@/lib/errors'
import { uuid } from '@/lib/utils'
import { fileService } from '@/services/file.service'
import { youtubeService, type YoutubeSource } from '@/services/youtube.service'
import { isTerminal, parseYoutubeUrl, phaseOf, type YoutubePhase } from './youtube'

export interface YoutubeItem {
  localId: string
  url: string
  videoId: string
  phase: YoutubePhase
  documentId: string | null
  title: string | null
  language: string | null
  isGenerated: boolean | null
  /** Safe, user-facing explanation from the backend (or a local one for a rejected request). */
  message: string | null
  retryAfterSeconds: number | null
}

const POLL_MS = 2000
const POLL_MAX_MS = 5 * 60_000

/**
 * YouTube links attached in the composer. Same contract as file attachments: a source can ground an answer only once the
 * BACKEND reports it ready (transcript stored AND indexed): an accepted request is just "processing". Duplicates (the same
 * video, in any URL form) are refused locally; the server also deduplicates per user, so a retry never creates a second copy.
 */
export function useYoutubeSources(conversationId: string | null) {
  const [items, setItems] = useState<YoutubeItem[]>([])
  const [rejections, setRejections] = useState<string[]>([])
  const aborts = useRef(new Map<string, AbortController>())
  const alive = useRef(true)
  const itemsRef = useRef<YoutubeItem[]>([])
  useEffect(() => {
    itemsRef.current = items
  })

  useEffect(() => {
    alive.current = true
    const map = aborts.current
    return () => {
      alive.current = false
      map.forEach((c) => c.abort())
      map.clear()
    }
  }, [])

  const patch = useCallback((localId: string, p: Partial<YoutubeItem>) => {
    if (!alive.current) return
    setItems((cur) => cur.map((i) => (i.localId === localId ? { ...i, ...p } : i)))
  }, [])

  const apply = useCallback(
    (localId: string, s: YoutubeSource) => {
      const phase = phaseOf(s)
      patch(localId, {
        phase, documentId: s.document_id, title: s.title, language: s.language, isGenerated: s.is_generated,
        message: s.message, retryAfterSeconds: s.retry_after_seconds,
      })
      return phase
    },
    [patch],
  )

  const poll = useCallback(
    async (localId: string, documentId: string, signal: AbortSignal) => {
      const started = Date.now()
      while (!signal.aborted && Date.now() - started < POLL_MAX_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        if (signal.aborted) return
        try {
          const s = await youtubeService.get(documentId, signal)
          if (isTerminal(apply(localId, s))) return
        } catch (e) {
          if (signal.aborted) return
          if (e instanceof ApiError && e.status === 404) return patch(localId, { phase: 'failed', message: 'This source no longer exists.' })
          // a transient polling error: keep trying until the deadline
        }
      }
      if (!signal.aborted) patch(localId, { phase: 'temporary', message: 'This is taking too long. Try again in a moment.' })
    },
    [apply, patch],
  )

  const run = useCallback(
    async (localId: string, send: () => Promise<YoutubeSource>) => {
      const ctrl = new AbortController()
      aborts.current.get(localId)?.abort()
      aborts.current.set(localId, ctrl)
      patch(localId, { phase: 'checking', message: null })
      try {
        const s = await send()
        if (ctrl.signal.aborted) return
        if (isTerminal(apply(localId, s))) return
        await poll(localId, s.document_id, ctrl.signal)
      } catch (e) {
        if (ctrl.signal.aborted) return
        const reason = e instanceof ApiError && e.status === 429 ? 'You have added many videos recently. Try again later.' : errorMessage(e)
        patch(localId, { phase: e instanceof ApiError && e.kind === 'network' ? 'temporary' : 'failed', message: reason })
      }
    },
    [apply, patch, poll],
  )

  /** Adds links. Returns the ones that were refused locally (invalid or already attached) so a dialog can explain. */
  const add = useCallback(
    (urls: string[]) => {
      const bad: string[] = []
      const fresh: YoutubeItem[] = []
      const seen = new Set(itemsRef.current.map((i) => i.videoId))
      for (const raw of urls) {
        const p = parseYoutubeUrl(raw)
        if (!p.ok) {
          bad.push(`${raw.trim().slice(0, 60)}: ${p.reason}`)
          continue
        }
        if (seen.has(p.videoId)) {
          bad.push(`${raw.trim().slice(0, 60)}: this video is already attached.`)
          continue
        }
        seen.add(p.videoId)
        fresh.push({
          localId: uuid(), url: raw.trim(), videoId: p.videoId, phase: 'checking', documentId: null, title: null,
          language: null, isGenerated: null, message: null, retryAfterSeconds: null,
        })
      }
      setRejections(bad)
      if (fresh.length) {
        setItems((cur) => [...cur, ...fresh])
        fresh.forEach((i) => void run(i.localId, () => youtubeService.attach(i.url, conversationId)))
      }
      return bad
    },
    [conversationId, run],
  )

  const retry = useCallback(
    (localId: string) => {
      const i = itemsRef.current.find((x) => x.localId === localId)
      if (!i) return
      const id = i.documentId
      void run(localId, async () => {
        if (!id) return youtubeService.attach(i.url, conversationId)
        if (i.phase === 'indexing_failed') {
          await fileService.retry(id) // the transcript is stored; only indexing is re-run (existing File Service retry)
          return youtubeService.get(id)
        }
        return youtubeService.retry(id)
      })
    },
    [conversationId, run],
  )

  const remove = useCallback((localId: string) => {
    aborts.current.get(localId)?.abort()
    aborts.current.delete(localId)
    setItems((cur) => cur.filter((i) => i.localId !== localId))
  }, [])

  const clear = useCallback(() => {
    aborts.current.forEach((c) => c.abort())
    aborts.current.clear()
    setItems([])
    setRejections([])
  }, [])

  const readyIds = items.filter((i) => i.phase === 'ready' && i.documentId).map((i) => i.documentId!)
  const blocking = items.some((i) => i.phase === 'checking' || i.phase === 'fetching' || i.phase === 'indexing')
  return { items, rejections, add, retry, remove, clear, readyIds, blocking, dismissRejections: () => setRejections([]) }
}
