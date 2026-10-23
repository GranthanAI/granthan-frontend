import { Download } from 'lucide-react'
import { Spinner } from '@/components/ui/primitives'
import { artifactKeys, artifactService, type Artifact } from './service'
import { useBlobUrl } from './hooks'

const fileName = (title: string) => `${title.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'animation'}.mp4`

/**
 * Plays an already-rendered animation from its stored, authenticated object. It never submits a render: it only reads
 * the artifact that the registry already holds, and the same blob serves playback and the download button.
 */
export function ArtifactVideo({ artifact, className }: { artifact: Artifact; className?: string }) {
  const id = artifact.artifact_id
  const video = useBlobUrl(artifactKeys.media(id), (s) => artifactService.media(id, s), artifact.has_media)
  const poster = useBlobUrl(artifactKeys.thumb(id), (s) => artifactService.thumbnail(id, s), artifact.has_media && artifact.has_thumbnail)

  if (video.error)
    return (
      <p role="alert" className="px-3.5 py-6 text-center text-sm text-ink-3">
        The video could not be loaded. It may be rendering again; try reopening this in a moment.
      </p>
    )
  if (!video.url)
    return (
      <div role="status" className="flex items-center justify-center gap-2 px-3.5 py-6 text-sm text-ink-3">
        <Spinner /> Loading video…
      </div>
    )
  return (
    <div className={className}>
      <video src={video.url} poster={poster.url ?? undefined} controls loop playsInline className="w-full" aria-label={artifact.title} />
      <div className="flex justify-end border-t border-line px-2 py-1">
        <a
          href={video.url}
          download={fileName(artifact.title)}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
        >
          <Download className="size-3.5" aria-hidden /> Download MP4
        </a>
      </div>
    </div>
  )
}
