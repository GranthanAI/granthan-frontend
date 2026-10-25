import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Composer } from '@/components/chat/Composer'
import { VideoCitation } from '@/components/chat/MessageItem'
import {
  canRetry, isFailure, isTerminal, isYoutubeDocName, parseYoutubeUrl, phaseOf, timecode, videoLink, youtubeDocTitle,
} from '@/features/uploads/youtube'
import { useAuthStore } from '@/stores/auth.store'
import { useDraftStore } from '@/stores/draft.store'
import type { YoutubeSource } from '@/services/youtube.service'

const VID_A = 'dQw4w9WgXcQ'
const VID_B = 'aaaaaaaaaa1'
const urlOf = (id: string) => `https://www.youtube.com/watch?v=${id}`

// ───────────────────────────────────────────────────────────────────────────────────────── pure helpers

describe('client-side link validation (instant feedback only; the server is authoritative)', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${VID_A}`], [`https://youtu.be/${VID_A}?si=x`], [`https://m.youtube.com/watch?v=${VID_A}&t=5`],
    [`https://www.youtube.com/shorts/${VID_A}`], [`https://www.youtube.com/embed/${VID_A}`], [`  https://youtube.com/watch?v=${VID_A}  `],
  ])('accepts %s', (u) => expect(parseYoutubeUrl(u)).toEqual({ ok: true, videoId: VID_A }))

  it.each([
    ['', 'Enter'], ['not a url', 'valid link'], [`http://www.youtube.com/watch?v=${VID_A}`, 'https'],
    [`https://evil.com/watch?v=${VID_A}`, 'youtube.com'], [`https://youtube.com@evil.com/watch?v=${VID_A}`, 'plain'],
    [`https://www.youtube.com.evil.com/watch?v=${VID_A}`, 'youtube.com'], [`https://www.youtube.com:444/watch?v=${VID_A}`, 'plain'],
    ['https://www.youtube.com/playlist?list=PL1', 'single video'], ['https://www.youtube.com/watch?v=short', 'video id'],
    ['javascript:alert(1)', 'https'],
  ])('rejects %s', (u, reason) => {
    const r = parseYoutubeUrl(u)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain(reason)
  })
})

const src = (over: Partial<YoutubeSource> = {}): YoutubeSource => ({
  document_id: 'doc-1', video_id: VID_A, canonical_url: urlOf(VID_A), title: null, language: null, is_generated: null,
  transcript_version: 0, segment_count: null, duration_seconds: null, extraction_status: 'PENDING', indexing_status: 'UPLOADING',
  ready: false, error_code: null, message: null, retryable: false, retry_after_seconds: null, created: true, ...over,
})

describe('what the user sees is derived only from the backend lifecycle', () => {
  const failed = (code: string, retryable = false) => src({ extraction_status: retryable ? 'FAILED_RETRYABLE' : 'FAILED_PERMANENT', error_code: code, retryable })

  it('maps every required condition to a distinct state', () => {
    expect(phaseOf(src())).toBe('fetching')
    expect(phaseOf(src({ extraction_status: 'FETCHING' }))).toBe('fetching')
    expect(phaseOf(src({ extraction_status: 'FETCHED', indexing_status: 'UPLOADED' }))).toBe('indexing')
    expect(phaseOf(src({ extraction_status: 'FETCHED', indexing_status: 'PROCESSING' }))).toBe('indexing')
    expect(phaseOf(src({ extraction_status: 'FETCHED', indexing_status: 'READY', ready: true }))).toBe('ready')
    expect(phaseOf(failed('NO_TRANSCRIPT'))).toBe('no_transcript')
    expect(phaseOf(failed('NO_SUPPORTED_LANGUAGE'))).toBe('unsupported_language')
    expect(phaseOf(failed('VIDEO_UNAVAILABLE'))).toBe('inaccessible')
    expect(phaseOf(failed('VIDEO_RESTRICTED'))).toBe('inaccessible')
    expect(phaseOf(failed('TRANSCRIPT_EMPTY'))).toBe('unusable')
    expect(phaseOf(failed('PROVIDER_BLOCKED', true))).toBe('temporary')
    expect(phaseOf(failed('TRANSIENT_DEPENDENCY', true))).toBe('temporary')
    expect(phaseOf(src({ extraction_status: 'FETCHED', indexing_status: 'FAILED', error_code: 'INDEXING_ERROR' }))).toBe('indexing_failed')
  })

  it('an accepted request or stored transcript is NOT ready until indexing completes', () => {
    expect(phaseOf(src({ extraction_status: 'FETCHED', indexing_status: 'UPLOADED', ready: false }))).not.toBe('ready')
    expect(isTerminal('indexing')).toBe(false)
    expect(isTerminal('ready')).toBe(true)
  })

  it('only transient failures offer Retry; permanent ones do not', () => {
    expect(canRetry('temporary')).toBe(true)
    expect(canRetry('indexing_failed')).toBe(true)
    expect(canRetry('no_transcript')).toBe(false)
    expect(canRetry('inaccessible')).toBe(false)
    expect(isFailure('ready')).toBe(false)
    expect(isFailure('fetching')).toBe(false)
    expect(isFailure('no_transcript')).toBe(true)
  })

  it('builds links only from a valid video id and formats timestamps', () => {
    expect(videoLink(VID_A, 754)).toBe(`https://www.youtube.com/watch?v=${VID_A}&t=754s`)
    expect(videoLink(VID_A)).toBe(urlOf(VID_A))
    expect(videoLink('"><script>', 5)).toBeNull()
    expect(timecode(0)).toBe('0:00')
    expect(timecode(754)).toBe('12:34')
    expect(timecode(3725)).toBe('1:02:05')
    expect(isYoutubeDocName('Lecture (YouTube transcript).json')).toBe(true)
    expect(isYoutubeDocName('notes.pdf')).toBe(false)
    expect(youtubeDocTitle('Lecture (YouTube transcript).json')).toBe('Lecture')
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────── composer flow (HTTP boundary mocked)

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface Script {
  /** Responses to successive requests about this video (POST attach first, then each GET poll); the last one repeats. */
  steps: Array<Partial<YoutubeSource> | { http: number; body: unknown }>
  retrySteps?: Array<Partial<YoutubeSource>>
}

class Backend {
  scripts = new Map<string, Script>()
  cursor = new Map<string, number>()
  posts: Array<{ url: string; conversation_id?: string }> = []
  gets: string[] = []
  retries: string[] = []
  fileRetries: string[] = []
  files: Record<string, { filename: string; status: string }> = {}
  messagePosts: Array<Record<string, unknown>> = []

  script(videoId: string, s: Script) {
    this.scripts.set(videoId, s)
  }

  retried = new Set<string>()

  private take(videoId: string, from: 'steps' | 'retrySteps') {
    const s = this.scripts.get(videoId)!
    const list = (from === 'retrySteps' ? s.retrySteps : s.steps) ?? s.steps
    const key = `${videoId}:${from}`
    const i = this.cursor.get(key) ?? 0
    this.cursor.set(key, i + 1)
    return list[Math.min(i, list.length - 1)]!
  }

  asResponse(videoId: string, step: Partial<YoutubeSource> | { http: number; body: unknown }, created = false) {
    if ('http' in step) return json(step.http, step.body)
    return json(created ? 202 : 200, src({ document_id: `doc-${videoId}`, video_id: videoId, canonical_url: urlOf(videoId), created, ...step }))
  }

  install() {
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      const path = url.pathname.replace('/api/v1', '')
      const method = init?.method ?? 'GET'
      if (method === 'POST' && path === '/files/youtube') {
        const body = JSON.parse(String(init!.body))
        this.posts.push(body)
        const id = /v=([\w-]{11})|youtu\.be\/([\w-]{11})/.exec(body.url)!
        const videoId = (id[1] ?? id[2])!
        return this.asResponse(videoId, this.take(videoId, 'steps'), true)
      }
      const get = /^\/files\/youtube\/doc-([\w-]{11})$/.exec(path)
      if (method === 'GET' && get) {
        this.gets.push(get[1]!)
        return this.asResponse(get[1]!, this.take(get[1]!, this.retried.has(get[1]!) ? 'retrySteps' : 'steps'))
      }
      const retry = /^\/files\/youtube\/doc-([\w-]{11})\/retry$/.exec(path)
      if (method === 'POST' && retry) {
        this.retries.push(retry[1]!)
        this.retried.add(retry[1]!)
        return this.asResponse(retry[1]!, this.take(retry[1]!, 'retrySteps'))
      }
      const fretry = /^\/files\/(doc-[\w-]{11})\/retry$/.exec(path)
      if (method === 'POST' && fretry) {
        this.fileRetries.push(fretry[1]!)
        return json(202, { document_id: fretry[1], status: 'PROCESSING', retry_count: 1 })
      }
      const f = /^\/files\/([^/]+)$/.exec(path)
      if (f && this.files[f[1]!]) {
        const r = this.files[f[1]!]!
        return json(200, { document_id: f[1], conversation_id: null, owner_id: 'u', filename: r.filename, content_type: 'application/json', size_bytes: 10, status: r.status, current_version: 1, created_at: '', updated_at: '' })
      }
      if (path.startsWith('/files/')) return json(404, { error_code: 'FileRecordNotFoundError', message: 'nope' })
      if (path === '/tools') return json(200, { tools: [], max_selected: 5 })
      return json(200, { items: [], next_cursor: null, has_more: false })
    }))
  }
}

let be: Backend

function renderComposer(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const onSend = vi.fn(async () => true)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={qc}>
      <Composer conversationId="c1" draftKey="c1" busy={false} onSend={onSend} {...props} />
    </QueryClientProvider>,
  )
  return { onSend, ...utils }
}

const advance = async (ms = 2100) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

async function attach(u: ReturnType<typeof user>, ...links: string[]) {
  await u.click(screen.getByRole('button', { name: 'Attach YouTube link' }))
  const dialog = await screen.findByRole('dialog')
  for (let i = 0; i < links.length; i++) {
    if (i > 0) await u.click(within(dialog).getByRole('button', { name: 'Add another link' }))
    await u.type(within(dialog).getByLabelText(`Video link ${i + 1}`), links[i]!)
  }
  await u.click(within(dialog).getByRole('button', { name: 'Attach' }))
}

const ready = { extraction_status: 'FETCHED', indexing_status: 'READY', ready: true } as const
const chipFor = (text: string) => screen.getAllByTestId('youtube-chip').find((c) => c.textContent?.includes(text))!

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  be = new Backend()
  be.install()
  useAuthStore.setState({ user: { id: 'u1' } as never, accessToken: 't', status: 'authenticated' } as never)
  useDraftStore.setState({ drafts: {} } as never)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Attach YouTube link in the composer', () => {
  it('opens an accessible dialog and the + action adds more link fields', async () => {
    const u = user()
    renderComposer()
    await u.click(screen.getByRole('button', { name: 'Attach YouTube link' }))
    const dialog = await screen.findByRole('dialog', { name: 'Attach YouTube link' })
    expect(within(dialog).getByLabelText('Video link 1')).toBeInTheDocument()
    await u.click(within(dialog).getByRole('button', { name: 'Add another link' }))
    await u.click(within(dialog).getByRole('button', { name: 'Add another link' }))
    expect(within(dialog).getByLabelText('Video link 3')).toBeInTheDocument()
    await u.click(within(dialog).getByRole('button', { name: 'Remove link 2' }))
    expect(within(dialog).queryByLabelText('Video link 3')).toBeNull()
  })

  it('validates in the dialog without sending anything', async () => {
    const u = user()
    renderComposer()
    await attach(u, 'https://evil.com/watch?v=' + VID_A)
    expect(await screen.findByText(/Only youtube.com and youtu.be/)).toBeInTheDocument()
    expect(be.posts).toHaveLength(0)
    expect(screen.queryByTestId('youtube-chip')).toBeNull()
  })

  it('attaches several videos at once; a 202 is only "fetching": not ready, and sending is blocked until the backend says ready', async () => {
    be.script(VID_A, { steps: [{ extraction_status: 'PENDING' }, { extraction_status: 'FETCHING' }, { extraction_status: 'FETCHED', indexing_status: 'UPLOADED', title: 'Gradient Descent', language: 'en', is_generated: false }, { ...ready, title: 'Gradient Descent', language: 'en', is_generated: false }] })
    be.script(VID_B, { steps: [{ extraction_status: 'FETCHED', indexing_status: 'UPLOADED' }, { ...ready, title: 'Backprop', language: 'hi', is_generated: true }] })
    const u = user()
    const { onSend } = renderComposer()
    await u.type(screen.getByLabelText('Message GranthanAI'), 'what is covered?')
    await attach(u, urlOf(VID_A), urlOf(VID_B))
    await waitFor(() => expect(be.posts).toHaveLength(2))
    expect(be.posts.map((p) => p.conversation_id)).toEqual(['c1', 'c1'])
    expect(await screen.findAllByTestId('youtube-chip')).toHaveLength(2)

    // accepted != ready
    expect(chipFor(VID_A).textContent).toContain('Fetching transcript')
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()

    await advance()                                        // A: FETCHING, B: ready
    await advance()                                        // A: stored, being indexed
    expect(chipFor('Gradient Descent').textContent).toContain('Indexing transcript')
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
    await advance()                                        // A: ready
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).not.toBeDisabled())
    expect(chipFor('Gradient Descent').textContent).toContain('Transcript ready · en')
    expect(chipFor('Backprop').textContent).toContain('hi (auto-generated)')

    await u.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onSend).toHaveBeenCalledTimes(1)
    const fileIds = (onSend.mock.calls[0] as unknown as [string, string[]])[1]
    expect(new Set(fileIds)).toEqual(new Set([`doc-${VID_A}`, `doc-${VID_B}`]))
    await waitFor(() => expect(screen.queryByTestId('youtube-chip')).toBeNull())           // consumed by the sent message
  })

  it('adds a video later in an ongoing conversation next to documents already in context', async () => {
    be.files['d-old'] = { filename: 'Lecture (YouTube transcript).json', status: 'READY' }
    be.script(VID_A, { steps: [{ ...ready }] })
    const u = user()
    const { onSend } = renderComposer({ contextDocumentIds: ['d-old'] })
    await screen.findByText('Lecture')                                       // the earlier video, shown by title
    await u.type(screen.getByLabelText('Message GranthanAI'), 'and the new one?')
    await attach(u, urlOf(VID_A))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).not.toBeDisabled())
    await u.click(screen.getByRole('button', { name: 'Send message' }))
    const fileIds = (onSend.mock.calls[0] as unknown as [string, string[]])[1]
    expect(new Set(fileIds)).toEqual(new Set(['d-old', `doc-${VID_A}`]))
  })

  it.each([
    ['NO_TRANSCRIPT', 'This video has no transcript (captions are off or unavailable).'],
    ['NO_SUPPORTED_LANGUAGE', 'This video has captions, but none in a supported language.'],
    ['VIDEO_UNAVAILABLE', 'This video is unavailable (private, removed, or not viewable from here).'],
  ])('shows %s as a permanent, specific failure with no Retry', async (code, message) => {
    be.script(VID_A, { steps: [{ extraction_status: 'FAILED_PERMANENT', error_code: code, message }] })
    const u = user()
    renderComposer()
    await attach(u, urlOf(VID_A))
    const chip = await screen.findByTestId('youtube-chip')
    expect(chip.textContent).toContain(message)
    expect(within(chip).queryByRole('button', { name: /^Retry/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()                // nothing ready, nothing typed
  })

  it('a temporary provider failure offers Retry, which really re-runs and ends ready', async () => {
    be.script(VID_A, {
      steps: [{ extraction_status: 'FAILED_RETRYABLE', error_code: 'PROVIDER_BLOCKED', message: 'YouTube temporarily blocked the request. Try again later.', retryable: true, retry_after_seconds: 30 }],
      retrySteps: [{ extraction_status: 'FETCHING' }, { ...ready }],
    })
    const u = user()
    renderComposer()
    await attach(u, urlOf(VID_A))
    const chip = await screen.findByTestId('youtube-chip')
    expect(chip.textContent).toContain('temporarily blocked')
    await u.click(within(chip).getByRole('button', { name: /^Retry/ }))
    expect(be.retries).toEqual([VID_A])
    await advance()
    await waitFor(() => expect(screen.getByTestId('youtube-chip').textContent).toContain('Transcript ready'))
  })

  it('a network failure never reads as success and can be retried (same idempotent request)', async () => {
    be.script(VID_A, { steps: [{ http: 500, body: { detail: 'boom' } }] })
    const u = user()
    renderComposer()
    await attach(u, urlOf(VID_A))
    const chip = await screen.findByTestId('youtube-chip')
    expect(chip.textContent).not.toContain('ready')
    expect(within(chip).getByRole('button', { name: /^Retry/ })).toBeInTheDocument()
    be.script(VID_A, { steps: [{ ...ready }] })
    await u.click(within(chip).getByRole('button', { name: /^Retry/ }))
    await waitFor(() => expect(screen.getByTestId('youtube-chip').textContent).toContain('Transcript ready'))
    expect(be.posts).toHaveLength(2)
  })

  it('an indexing failure is retried through the existing file retry, not a new fetch', async () => {
    be.script(VID_A, { steps: [{ extraction_status: 'FETCHED', indexing_status: 'FAILED', error_code: 'INDEXING_ERROR', message: 'The document could not be indexed right now.' }, { ...ready }] })
    const u = user()
    renderComposer()
    await attach(u, urlOf(VID_A))
    const chip = await screen.findByTestId('youtube-chip')
    expect(chip.textContent).toContain('indexed')
    await u.click(within(chip).getByRole('button', { name: /^Retry/ }))
    expect(be.fileRetries).toEqual([`doc-${VID_A}`])
    expect(be.retries).toEqual([])
    await waitFor(() => expect(screen.getByTestId('youtube-chip').textContent).toContain('Transcript ready'))
  })

  it('prevents duplicates: the same video in different URL forms is attached once', async () => {
    be.script(VID_A, { steps: [{ extraction_status: 'FETCHING' }] })
    const u = user()
    renderComposer()
    await attach(u, urlOf(VID_A))
    await screen.findByTestId('youtube-chip')
    await attach(u, `https://youtu.be/${VID_A}`)
    expect(await screen.findByText(/already attached/)).toBeInTheDocument()
    expect(be.posts).toHaveLength(1)
    expect(screen.getAllByTestId('youtube-chip')).toHaveLength(1)
  })

  it('catches the same video typed twice inside one dialog before sending anything', async () => {
    const u = user()
    renderComposer()
    await attach(u, urlOf(VID_A), `https://youtu.be/${VID_A}`)
    expect(await screen.findByText('You already entered this video.')).toBeInTheDocument()
    expect(be.posts).toHaveLength(0)
  })

  it('removing a chip drops it and stops polling for it', async () => {
    be.script(VID_A, { steps: [{ extraction_status: 'FETCHING' }] })
    const u = user()
    renderComposer()
    await attach(u, urlOf(VID_A))
    await screen.findByTestId('youtube-chip')
    await advance()
    const before = be.gets.length
    await u.click(within(screen.getByTestId('youtube-chip')).getByRole('button', { name: /^Remove/ }))
    expect(screen.queryByTestId('youtube-chip')).toBeNull()
    await advance(6000)
    expect(be.gets.length).toBe(before)
  })

  it('surfaces the quota error clearly', async () => {
    be.script(VID_A, { steps: [{ http: 429, body: { error_code: 'YoutubeQuotaExceeded', message: 'Too many videos added recently. Try again later.' } }] })
    const u = user()
    renderComposer()
    await attach(u, urlOf(VID_A))
    expect((await screen.findByTestId('youtube-chip')).textContent).toMatch(/many videos recently/)
  })
})

describe('context toggles and inheritance for video sources (same rules as documents)', () => {
  it('shows an inherited video with its origin, lets it be switched off locally, and then it is not sent', async () => {
    be.files['d-parent'] = { filename: 'Parent lecture (YouTube transcript).json', status: 'READY' }
    be.files['d-child'] = { filename: 'Child talk (YouTube transcript).json', status: 'READY' }
    const u = user()
    const { onSend } = renderComposer({ contextDocumentIds: ['d-parent', 'd-child'], inheritedFrom: { 'd-parent': 'Main chat' } })
    const ctx = await screen.findByRole('list', { name: 'Message context' })
    await within(ctx).findByText('Parent lecture')
    expect(within(ctx).getByText('from Main chat')).toBeInTheDocument()                       // inherited
    expect(within(ctx).queryByText('from Main chat', { selector: 'li:nth-child(2) *' })).toBeNull()   // the child's own video is not marked
    await u.click(within(ctx).getByRole('button', { name: 'Stop using Parent lecture (YouTube transcript).json as context' }))
    await u.type(screen.getByLabelText('Message GranthanAI'), 'hello')
    await u.click(screen.getByRole('button', { name: 'Send message' }))
    expect((onSend.mock.calls[0] as unknown as [string, string[]])[1]).toEqual(['d-child'])
  })

  it('a video that is still processing is shown as such and not sent', async () => {
    be.files['d-pending'] = { filename: 'Pending (YouTube transcript).json', status: 'PROCESSING' }
    const u = user()
    const { onSend } = renderComposer({ contextDocumentIds: ['d-pending'] })
    expect(await screen.findByText('Still processing')).toBeInTheDocument()
    await u.type(screen.getByLabelText('Message GranthanAI'), 'hello')
    await u.click(screen.getByRole('button', { name: 'Send message' }))
    expect((onSend.mock.calls[0] as unknown as [string, string[]])[1]).toEqual([])
  })
})

describe('citations for video passages', () => {
  const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

  it('links to the exact moment in the video and shows the title and time range', async () => {
    be.script(VID_A, { steps: [{ title: 'Gradient Descent' }] })
    wrap(<VideoCitation c={{ file_id: `doc-${VID_A}`, source_name: 'Gradient Descent (YouTube transcript).json', page_number: null, section: 't=754-801', start_seconds: 754, end_seconds: 801 }} />)
    const link = await screen.findByRole('link', { name: 'Open the video at 12:34' })
    expect(link).toHaveAttribute('href', `https://www.youtube.com/watch?v=${VID_A}&t=754s`)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.textContent).toBe('12:34–13:21')
    expect(screen.getByText('Gradient Descent')).toBeInTheDocument()
  })

  it('falls back to the plain time range when the source cannot be resolved (no link is invented)', async () => {
    wrap(<VideoCitation c={{ file_id: 'doc-zzzzzzzzzzz', source_name: 'Lecture (YouTube transcript).json', page_number: null, section: 't=60-90', start_seconds: 60, end_seconds: 90 }} />)
    expect(await screen.findByText('Lecture')).toBeInTheDocument()
    expect(screen.getByText('1:00–1:30')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
