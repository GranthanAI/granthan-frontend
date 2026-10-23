import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Spinner } from '@/components/ui/primitives'
import { copyText } from '@/lib/clipboard'
import { renderMermaid } from '@/features/visualization/mermaidRender'

/**
 * Draws a persisted Mermaid source in the browser. Uses the same strict renderer as the chat (securityLevel strict, no
 * HTML labels, DOMPurify-sanitised SVG) and never asks a model to regenerate anything: an invalid source simply shows
 * the source with a copy action.
 */
export function MermaidPreview({ source }: { source: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'drawing' | 'ready' | 'invalid'>('drawing')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    renderMermaid(source)
      .then((svg) => {
        if (cancelled || !host.current) return
        host.current.replaceChildren(svg)
        setState('ready')
      })
      .catch(() => !cancelled && setState('invalid'))
    return () => {
      cancelled = true
    }
  }, [source])

  return (
    <div>
      {state === 'drawing' && (
        <div role="status" className="flex items-center justify-center gap-2 py-4 text-xs text-ink-3">
          <Spinner /> Drawing…
        </div>
      )}
      {state === 'invalid' && (
        <p role="alert" className="px-1 pb-2 text-xs text-ink-3" data-testid="mermaid-invalid">
          This diagram's source could not be drawn. The source is shown below.
        </p>
      )}
      <div ref={host} className={state === 'ready' ? 'overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full' : 'hidden'} />
      <details className="mt-2 text-xs" open={state === 'invalid'}>
        <summary className="cursor-pointer text-ink-3">Source</summary>
        <pre className="mt-1.5 max-h-48 overflow-auto rounded-md bg-code p-2 text-[11px]">{source}</pre>
        <button
          onClick={async () => {
            if (await copyText(source)) {
              setCopied(true)
              setTimeout(() => setCopied(false), 1800)
            }
          }}
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-ink-2 hover:bg-surface-2"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy source'}
        </button>
      </details>
    </div>
  )
}
