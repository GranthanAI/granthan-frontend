import type { Artifact } from '@/features/artifacts/service'

let n = 0

/** A server-shaped artifact. Tests override only what they care about. */
export function mkArtifact(over: Partial<Artifact> = {}): Artifact {
  n += 1
  const status = over.status ?? 'ready'
  return {
    artifact_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    type: 'manim',
    title: `Artifact ${n}`,
    status,
    ready: status === 'ready',
    active: status !== 'ready' && status !== 'failed',
    failure_code: null,
    message: null,
    retryable: false,
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
    conversation_id: 'c-1',
    source_message_id: 'm-1',
    block_id: 'b1',
    mime_type: status === 'ready' ? 'video/mp4' : null,
    size_bytes: status === 'ready' ? 2048 : null,
    has_media: over.type !== 'mermaid' && status === 'ready',
    has_thumbnail: false,
    source: over.type === 'mermaid' ? 'flowchart TD\n  A-->B' : null,
    ...over,
  }
}
