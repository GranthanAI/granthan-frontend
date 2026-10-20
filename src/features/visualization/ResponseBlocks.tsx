import { lazy, Suspense, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { splitBlocks } from './blocks'
import { DEFAULT_CONFIG, vizService } from './service'
import { MermaidBlock } from './MermaidBlock'
import { ManimBlock } from './ManimBlock'

const Markdown = lazy(() => import('@/components/chat/Markdown'))

/**
 * Renders an answer as ordered blocks: text through the normal Markdown renderer, visuals through their own components.
 * While the answer streams, finished text shows immediately and visuals show a placeholder until the message is complete
 * (so a half-written diagram is never drawn and no job is started for a partial spec).
 */
export function ResponseBlocks({ content, streaming }: { content: string; streaming: boolean }) {
  const blocks = useMemo(() => splitBlocks(content), [content])
  const { data } = useQuery({
    queryKey: ['visualizations', 'config'],
    queryFn: ({ signal }) => vizService.config(signal),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const cfg = data ?? DEFAULT_CONFIG

  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'text')
          return (
            <Suspense key={i} fallback={<p className="whitespace-pre-wrap text-[0.9375rem]">{b.content}</p>}>
              <Markdown content={b.content} />
            </Suspense>
          )
        if (b.type === 'pending' || (streaming && (b.type === 'mermaid' || b.type === 'manim'))) {
          const kind = b.type === 'pending' ? b.kind : b.type
          return (
            <div key={i} role="status" className="not-prose my-3 rounded-xl border border-dashed border-line px-3.5 py-4 text-center text-sm text-ink-3">
              Preparing {kind === 'mermaid' ? 'diagram' : 'animation'}…
            </div>
          )
        }
        if (b.type === 'mermaid')
          return cfg.enabled && cfg.mermaid ? (
            <MermaidBlock key={`${i}:${b.source}`} source={b.source} title={b.title} maxAttempts={cfg.max_attempts} repair={cfg.repair} />
          ) : (
            <Suspense key={i} fallback={null}>
              <Markdown content={'```\n' + b.source + '\n```'} />
            </Suspense>
          )
        if (b.type === 'manim')
          return cfg.enabled && cfg.manim ? (
            <ManimBlock key={i} spec={b.spec} maxAttempts={cfg.max_attempts} repair={cfg.repair} />
          ) : (
            <p key={i} className="my-3 text-sm italic text-ink-3">
              Animation unavailable: this kind of visual is turned off.
            </p>
          )
        return (
          <p key={i} className="my-3 text-sm italic text-ink-3" data-testid="viz-invalid">
            {b.kind === 'mermaid' ? 'Diagram' : 'Animation'} unavailable: it could not be read. The explanation stands on its own.
          </p>
        )
      })}
    </>
  )
}
