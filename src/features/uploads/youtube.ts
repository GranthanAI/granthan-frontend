import type { YoutubeSource } from '@/services/youtube.service'

/**
 * Client-side YouTube link handling. This only exists for instant feedback: the server is authoritative and re-validates
 * everything (strict https host allow-list, video id), and the link itself is never fetched by the browser or the server.
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])

export type ParsedYoutube = { ok: true; videoId: string } | { ok: false; reason: string }

export function parseYoutubeUrl(raw: string): ParsedYoutube {
  const text = raw.trim()
  if (!text) return { ok: false, reason: 'Enter a YouTube video link.' }
  let u: URL
  try {
    u = new URL(text)
  } catch {
    return { ok: false, reason: 'That does not look like a valid link.' }
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'Only https:// YouTube links are supported.' }
  if (u.username || u.password || u.port) return { ok: false, reason: 'Only plain youtube.com or youtu.be links are supported.' }
  const host = u.hostname.toLowerCase()
  const segs = u.pathname.split('/').filter(Boolean)
  let id: string | null = null
  if (host === 'youtu.be') id = segs.length === 1 ? (segs[0] ?? null) : null
  else if (WATCH_HOSTS.has(host)) {
    if (u.pathname.replace(/\/$/, '') === '/watch') id = u.searchParams.get('v')
    else if (segs.length === 2 && ['embed', 'live', 'shorts'].includes(segs[0] ?? '')) id = segs[1] ?? null
    else if (['playlist', 'channel', 'c', 'user', 'results', 'feed'].includes(segs[0] ?? ''))
      return { ok: false, reason: 'Link a single video, not a playlist, channel or search page.' }
  } else return { ok: false, reason: 'Only youtube.com and youtu.be links are supported.' }
  return id && VIDEO_ID.test(id) ? { ok: true, videoId: id } : { ok: false, reason: 'Could not find a valid video id in that link.' }
}

/** What the user sees for a source. Derived ONLY from the backend's lifecycle (never from an HTTP 2xx alone). */
export type YoutubePhase =
  | 'checking' // request in flight
  | 'fetching' // transcript being downloaded
  | 'indexing' // transcript stored, being indexed for search
  | 'ready'
  | 'no_transcript'
  | 'unsupported_language'
  | 'inaccessible'
  | 'unusable' // empty / malformed / too long
  | 'temporary' // provider blocked or dependency outage: retry later
  | 'indexing_failed'
  | 'failed' // request rejected or unexpected error

export function phaseOf(s: YoutubeSource): YoutubePhase {
  if (s.ready) return 'ready'
  if (s.extraction_status === 'FAILED_PERMANENT' || s.extraction_status === 'FAILED_RETRYABLE') {
    switch (s.error_code) {
      case 'NO_TRANSCRIPT':
        return 'no_transcript'
      case 'NO_SUPPORTED_LANGUAGE':
        return 'unsupported_language'
      case 'VIDEO_UNAVAILABLE':
      case 'VIDEO_RESTRICTED':
        return 'inaccessible'
      case 'TRANSCRIPT_EMPTY':
      case 'TRANSCRIPT_MALFORMED':
      case 'TRANSCRIPT_TOO_LARGE':
        return 'unusable'
      default:
        return s.extraction_status === 'FAILED_RETRYABLE' ? 'temporary' : 'failed'
    }
  }
  if (s.extraction_status === 'FETCHED') return s.indexing_status === 'FAILED' ? 'indexing_failed' : 'indexing'
  return 'fetching'
}

export const isTerminal = (p: YoutubePhase) => p !== 'checking' && p !== 'fetching' && p !== 'indexing'
export const isFailure = (p: YoutubePhase) => !['checking', 'fetching', 'indexing', 'ready'].includes(p)
export const canRetry = (p: YoutubePhase) => p === 'temporary' || p === 'indexing_failed' || p === 'failed'

export const PHASE_LABEL: Record<YoutubePhase, string> = {
  checking: 'Checking link…',
  fetching: 'Fetching transcript…',
  indexing: 'Indexing transcript…',
  ready: 'Transcript ready',
  no_transcript: 'No transcript available',
  unsupported_language: 'No transcript in a supported language',
  inaccessible: 'Video not accessible',
  unusable: 'Transcript unusable',
  temporary: 'Temporarily unavailable',
  indexing_failed: 'Indexing failed',
  failed: 'Could not attach',
}

/** Link to the moment in the video. Built only from a validated 11-character id. */
export function videoLink(videoId: string, seconds?: number | null): string | null {
  if (!VIDEO_ID.test(videoId)) return null
  const t = seconds && seconds > 0 ? `&t=${Math.floor(seconds)}s` : ''
  return `https://www.youtube.com/watch?v=${videoId}${t}`
}

export function timecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

const SUFFIX = / \(YouTube transcript\)\.json$/
export const isYoutubeDocName = (name: string) => SUFFIX.test(name)
export const youtubeDocTitle = (name: string) => name.replace(SUFFIX, '')
