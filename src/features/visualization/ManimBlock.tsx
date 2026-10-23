import { Button } from '@/components/ui/primitives'
import { ArtifactVideo } from '@/features/artifacts/ArtifactVideo'
import { useBlockArtifact, useRetryArtifact } from '@/features/artifacts/hooks'
import { useArtifactSource } from '@/features/artifacts/source'
import { errorMessage } from '@/lib/errors'
import { fallbackText } from './blocks'

const STATUS_TEXT: Record<string, string> = {
  pending: 'Waiting to render',
  queued: 'Queued for rendering',
  rendering: 'Rendering animation',
  uploading: 'Saving animation',
}

/**
 * One Manim animation in a message. It looks the animation up in the artifact registry and plays the stored video.
 *
 * Opening, refreshing or revisiting a conversation only READS: the registry returns the existing artifact (which is
 * already rendered) and the server decides whether anything needs to be produced. A render only ever starts for a
 * genuinely new artifact or when the user explicitly presses Retry; status is polled while it is being produced and
 * polling stops at `ready` / `failed` or when this block unmounts.
 */
export function ManimBlock({ spec }: { spec: Record<string, unknown>; maxAttempts?: number; repair?: boolean }) {
  const source = useArtifactSource()
  const title = typeof spec.title === 'string' ? spec.title : 'Animation'
  const { artifact, loading, error } = useBlockArtifact({
    conversationId: source?.conversationId,
    messageId: source?.messageId,
    type: 'manim',
    content: spec,
  })
  const retry = useRetryArtifact()

  if (error)
    return (
      <div className="not-prose my-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-sm italic text-ink-3" data-testid="viz-fallback">
        {fallbackText('manim', errorMessage(error).slice(0, 120))}
      </div>
    )
  if (artifact?.status === 'failed')
    return (
      <div className="not-prose my-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-sm italic text-ink-3" data-testid="viz-fallback">
        {fallbackText('manim', artifact.message ?? undefined)}
        {artifact.retryable && (
          <div className="mt-2 not-italic">
            <Button size="sm" loading={retry.isPending} onClick={() => retry.mutate(artifact.artifact_id)}>
              Retry rendering
            </Button>
            {retry.isError && <span className="ml-2 text-xs text-danger">{errorMessage(retry.error)}</span>}
          </div>
        )}
      </div>
    )
  return (
    <figure className="not-prose my-3 overflow-hidden rounded-xl border border-line bg-surface" data-testid="viz-manim">
      <figcaption className="border-b border-line px-3 py-1.5 text-xs text-ink-3">{title}</figcaption>
      {artifact?.status === 'ready' ? (
        <ArtifactVideo artifact={artifact} />
      ) : (
        <div role="status" className="px-3.5 py-6 text-center text-sm text-ink-3">
          {!source || loading || !artifact ? 'Preparing animation' : (STATUS_TEXT[artifact.status] ?? 'Rendering animation')}…
        </div>
      )}
    </figure>
  )
}
