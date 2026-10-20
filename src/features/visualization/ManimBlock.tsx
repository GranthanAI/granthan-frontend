import { useEffect, useState } from 'react'
import { fallbackText } from './blocks'
import { vizService, type ManimJob } from './service'

type View = { s: 'pending'; job?: ManimJob } | { s: 'ready'; url: string } | { s: 'failed'; message?: string }
const POLL_MS = 1500
const MAX_WAIT_MS = 4 * 60 * 1000

/** One Manim animation: submits an idempotent job, polls its status, then plays the owner-authenticated video as a blob. */
export function ManimBlock({ spec, maxAttempts = 3, repair = true }: { spec: Record<string, unknown>; maxAttempts?: number; repair?: boolean }) {
  const [view, setView] = useState<View>({ s: 'pending' })
  const key = JSON.stringify(spec)

  useEffect(() => {
    const ctrl = new AbortController()
    let url: string | null = null
    let jobId: string | null = null
    let done = false
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    ;(async () => {
      try {
        // Attempt 1 is the model's spec. A spec the server rejects (422) is repaired (attempts 2..N) before giving up.
        let current = spec
        let job: ManimJob | null = null
        for (let attempt = 1; !job; attempt++) {
          try {
            job = await vizService.createJob(current, ctrl.signal)
          } catch (e) {
            const rejected = (e as { status?: number | null })?.status === 422
            if (!rejected || !repair || attempt >= maxAttempts) throw e
            const r = await vizService.repair('manim', JSON.stringify(current), 'invalid_spec', attempt + 1, ctrl.signal)
            if (!r.ok || !r.content) throw e
            current = JSON.parse(r.content) as Record<string, unknown>
          }
        }
        jobId = job.id
        const started = Date.now()
        while (!ctrl.signal.aborted) {
          if (job.state === 'ready') {
            const blob = await vizService.media(job.id, ctrl.signal)
            url = URL.createObjectURL(blob)
            done = true
            return setView({ s: 'ready', url })
          }
          if (job.state === 'failed' || job.state === 'cancelled' || job.state === 'expired') {
            done = true
            return setView({ s: 'failed', message: job.message })
          }
          if (Date.now() - started > MAX_WAIT_MS) {
            done = true
            return setView({ s: 'failed' })
          }
          setView({ s: 'pending', job })
          await sleep(POLL_MS)
          job = await vizService.getJob(job.id, ctrl.signal)
        }
      } catch (e) {
        if (!ctrl.signal.aborted) {
          done = true
          const detail = (e as { message?: string })?.message
          setView({ s: 'failed', message: detail && detail.length < 120 ? detail : undefined })
        }
      }
    })()
    return () => {
      ctrl.abort()
      if (url) URL.revokeObjectURL(url)
      // stop rendering for a block nobody is watching any more
      if (jobId && !done) void vizService.cancel(jobId).catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const title = typeof spec.title === 'string' ? spec.title : 'Animation'
  if (view.s === 'failed')
    return (
      <div className="not-prose my-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-sm italic text-ink-3" data-testid="viz-fallback">
        {fallbackText('manim', view.message)}
      </div>
    )
  return (
    <figure className="not-prose my-3 overflow-hidden rounded-xl border border-line bg-surface" data-testid="viz-manim">
      <figcaption className="border-b border-line px-3 py-1.5 text-xs text-ink-3">{title}</figcaption>
      {view.s === 'ready' ? (
        <video src={view.url} controls loop playsInline className="w-full" aria-label={title} />
      ) : (
        <div role="status" className="px-3.5 py-6 text-center text-sm text-ink-3">
          Rendering animation
          {view.job && view.job.attempt > 1 ? ` (retry ${view.job.attempt} of ${view.job.max_attempts})` : ''}…
        </div>
      )}
    </figure>
  )
}
