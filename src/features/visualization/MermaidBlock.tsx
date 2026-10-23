import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { artifactService } from '@/features/artifacts/service'
import { useArtifactSource } from '@/features/artifacts/source'
import { copyText } from '@/lib/clipboard'
import { fallbackText } from './blocks'
import { renderMermaid } from './mermaidRender'
import { vizService } from './service'
import { useZoomViewer } from './ZoomPane'

type Status = 'rendering' | 'repairing' | 'ready' | 'failed'

/** Diagrams already registered in this browser session (the server call is idempotent; this just avoids repeating it). */
const registered = new Set<string>()

/**
 * One Mermaid diagram (the parent keys it by its source, so a changed source starts over at attempt 1). Attempt 1 is the model's original; if it cannot be drawn, up to (max_attempts - 1) targeted repairs of
 * THIS block are requested (attempts 2..N). After the last failure only this block becomes a text fallback.
 */
export function MermaidBlock({
  source,
  title,
  maxAttempts,
  repair,
}: {
  source: string
  title?: string
  maxAttempts: number
  repair: boolean
}) {
  const [svg, setSvg] = useState<SVGElement | null>(null)
  const [current, setCurrent] = useState(source)
  const [attempt, setAttempt] = useState(1)
  const [status, setStatus] = useState<Status>('rendering')
  const [copied, setCopied] = useState(false)
  const artifactSource = useArtifactSource()
  const qc = useQueryClient()

  // Once a diagram has actually been drawn, persist its (possibly repaired) source so the Artifacts tab and exports can
  // show it. Idempotent on the server; failure is silent because the chat itself does not depend on it.
  useEffect(() => {
    if (status !== 'ready' || !artifactSource) return
    const key = `${artifactSource.conversationId}:${artifactSource.messageId}:${current}`
    if (registered.has(key)) return
    registered.add(key)
    artifactService
      .register({ conversation_id: artifactSource.conversationId, source_message_id: artifactSource.messageId, type: 'mermaid', content: current, title })
      .then(() => qc.invalidateQueries({ queryKey: ['artifacts'], predicate: (q) => q.queryKey[1] === 'list' }))
      .catch(() => registered.delete(key))
  }, [status, artifactSource, current, title, qc])

  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    ;(async () => {
      setStatus('rendering')
      try {
        const drawn = await renderMermaid(current)
        if (cancelled) return
        setSvg(drawn)
        setStatus('ready')
      } catch (e) {
        if (cancelled) return
        if (!repair || attempt >= maxAttempts) return setStatus('failed')
        setStatus('repairing')
        try {
          const error = String((e as Error)?.message ?? 'syntax').slice(0, 200)
          const r = await vizService.repair('mermaid', current, error, attempt + 1, ctrl.signal)
          if (cancelled) return
          if (r.ok && r.content) {
            setCurrent(r.content)
            setAttempt(attempt + 1)
          } else setStatus('failed')
        } catch {
          if (!cancelled) setStatus('failed')
        }
      }
    })()
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [current, attempt, maxAttempts, repair])

  const viewer = useZoomViewer(status === 'ready' ? svg : null)

  if (status === 'failed') {
    return (
      <div className="not-prose my-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-sm text-ink-3" data-testid="viz-fallback">
        <p className="italic">{fallbackText('mermaid')}</p>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs">Show diagram source</summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-code p-2 text-[12px]">{source}</pre>
        </details>
      </div>
    )
  }
  return (
    <figure className="not-prose my-3 overflow-hidden rounded-xl border border-line bg-surface" data-testid="viz-mermaid">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-xs text-ink-3">
        <span>
          {title ?? 'Diagram'}
          {status === 'repairing' ? ' — fixing…' : status === 'rendering' ? ' — drawing…' : ''}
        </span>
        <div className="flex items-center gap-1">
          {viewer.controls}
        <button
          onClick={async () => {
            if (await copyText(current)) {
              setCopied(true)
              setTimeout(() => setCopied(false), 1800)
            }
          }}
          aria-label={copied ? 'Copied' : 'Copy diagram source'}
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-surface-2 hover:text-ink"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy source'}
        </button>
        </div>
      </div>
      {viewer.body ?? <div className="h-24" />}
      {viewer.overlay}
    </figure>
  )
}
