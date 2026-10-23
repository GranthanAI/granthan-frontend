import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { mkArtifact } from './artifact-fixtures'

const mermaidMock = vi.hoisted(() => ({ render: vi.fn(), initialize: vi.fn() }))
vi.mock('mermaid', () => ({ default: mermaidMock }))
const art = vi.hoisted(() => ({ register: vi.fn(), get: vi.fn(), list: vi.fn(), retry: vi.fn(), media: vi.fn(), thumbnail: vi.fn() }))
vi.mock('@/features/artifacts/service', async (orig) => ({
  ...(await orig<typeof import('@/features/artifacts/service')>()),
  artifactService: art,
}))
const exp = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), download: vi.fn() }))
vi.mock('@/features/exports/service', async (orig) => ({
  ...(await orig<typeof import('@/features/exports/service')>()),
  exportService: exp,
}))
const dl = vi.hoisted(() => ({ saveBlob: vi.fn() }))
vi.mock('@/lib/download', async (orig) => ({ ...(await orig<typeof import('@/lib/download')>()), saveBlob: dl.saveBlob }))

import { ArtifactSourceProvider } from '@/features/artifacts/source'
import { ArtifactsTab } from '@/features/artifacts/ArtifactsTab'
import { ManimBlock } from '@/features/visualization/ManimBlock'
import { MermaidBlock } from '@/features/visualization/MermaidBlock'
import { ExportDialog } from '@/features/exports/ExportDialog'
import type { Conversation } from '@/types/api'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><g><text>ok</text></g></svg>'
const SRC = ['flowchart TD', 'A-->B'].join(String.fromCharCode(10))
const SPEC = { template: 'text_steps', title: 'Steps', params: { steps: ['a'] } }
const conv = (over: Partial<Conversation> = {}): Conversation => ({
  conversation_id: 'c-1', user_id: 'u', title: 'Root chat', created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z',
  status: 'active', parent_conversation_id: null, ...over,
})
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const wrap = (ui: React.ReactElement, qc = client()) => (
  <QueryClientProvider client={qc}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
)
const inMessage = (ui: React.ReactElement) => (
  <ArtifactSourceProvider conversationId="c-1" messageId="m-1">{ui}</ArtifactSourceProvider>
)

beforeEach(() => {
  vi.clearAllMocks()
  URL.createObjectURL = vi.fn(() => 'blob:video')
  URL.revokeObjectURL = vi.fn()
  art.media.mockResolvedValue(new Blob(['x'], { type: 'video/mp4' }))
})

describe('ManimBlock never renders just because it is shown', () => {
  it('registers once, plays the stored video and does not poll a ready artifact', async () => {
    art.register.mockResolvedValue(mkArtifact({ status: 'ready' }))
    const { container } = render(wrap(inMessage(<ManimBlock spec={SPEC} />)))
    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe('blob:video'))
    await new Promise((r) => setTimeout(r, 1800))
    expect(art.register).toHaveBeenCalledTimes(1)
    expect(art.get).not.toHaveBeenCalled() // ready: no status polling
    expect(art.retry).not.toHaveBeenCalled()
    expect(art.media).toHaveBeenCalledTimes(1)
  })

  it('reopening the conversation (remount, same session) makes no further requests', async () => {
    art.register.mockResolvedValue(mkArtifact({ status: 'ready' }))
    const qc = client()
    const first = render(wrap(inMessage(<ManimBlock spec={SPEC} />), qc))
    await waitFor(() => expect(first.container.querySelector('video')).not.toBeNull())
    first.unmount()
    const second = render(wrap(inMessage(<ManimBlock spec={SPEC} />), qc))
    await waitFor(() => expect(second.container.querySelector('video')).not.toBeNull())
    expect(art.register).toHaveBeenCalledTimes(1)
    expect(art.media).toHaveBeenCalledTimes(1)
  })

  it('after a full reload only the idempotent lookup happens: no retry, no job', async () => {
    art.register.mockResolvedValue(mkArtifact({ status: 'ready' }))
    const { container } = render(wrap(inMessage(<ManimBlock spec={SPEC} />), client()))
    await waitFor(() => expect(container.querySelector('video')).not.toBeNull())
    expect(art.get).not.toHaveBeenCalled()
    expect(art.retry).not.toHaveBeenCalled()
  })

  it('shows real status while genuinely rendering, polls until ready, then stops', async () => {
    const a = mkArtifact({ status: 'rendering' })
    art.register.mockResolvedValue(a)
    art.get.mockResolvedValue({ ...a, status: 'ready', ready: true, active: false, has_media: true })
    const { container } = render(wrap(inMessage(<ManimBlock spec={SPEC} />)))
    expect(await screen.findByText(/Rendering animation/)).toBeTruthy()
    await waitFor(() => expect(container.querySelector('video')).not.toBeNull(), { timeout: 4000 })
    const calls = art.get.mock.calls.length
    expect(calls).toBeGreaterThanOrEqual(1)
    await new Promise((r) => setTimeout(r, 1800))
    expect(art.get.mock.calls.length).toBe(calls) // polling stopped at the terminal state
  })

  it('stops polling when the block is unmounted mid-render', async () => {
    const a = mkArtifact({ status: 'queued' })
    art.register.mockResolvedValue(a)
    art.get.mockResolvedValue(a)
    const view = render(wrap(inMessage(<ManimBlock spec={SPEC} />)))
    await screen.findByRole('status')
    await waitFor(() => expect(art.get).toHaveBeenCalled(), { timeout: 4000 })
    view.unmount()
    const calls = art.get.mock.calls.length
    await new Promise((r) => setTimeout(r, 1800))
    expect(art.get.mock.calls.length).toBe(calls)
  })

  it('failed: shows the fallback, and only an explicit Retry press requests another render', async () => {
    const failed = mkArtifact({ status: 'failed', failure_code: 'render_error', message: 'The animation could not be rendered.', retryable: true })
    art.register.mockResolvedValue(failed)
    art.retry.mockResolvedValue({ ...failed, status: 'pending', active: true })
    art.get.mockResolvedValue({ ...failed, status: 'pending', active: true })
    render(wrap(inMessage(<ManimBlock spec={SPEC} />)))
    await screen.findByTestId('viz-fallback')
    expect(art.retry).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /retry rendering/i }))
    await waitFor(() => expect(art.retry).toHaveBeenCalledWith(failed.artifact_id))
  })

  it('a failed artifact that is not retryable offers no retry', async () => {
    art.register.mockResolvedValue(mkArtifact({ status: 'failed', retryable: false, message: 'x' }))
    render(wrap(inMessage(<ManimBlock spec={SPEC} />)))
    await screen.findByTestId('viz-fallback')
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
  })

  it('does nothing until the message is persisted, and falls back if the registry is unreachable', async () => {
    render(wrap(<ManimBlock spec={SPEC} />))
    expect((await screen.findByRole('status')).textContent).toContain('Preparing animation')
    expect(art.register).not.toHaveBeenCalled()
    art.register.mockRejectedValue(new Error('Too many animations in progress.'))
    render(wrap(inMessage(<ManimBlock spec={{ ...SPEC, title: 'other' }} />)))
    expect((await screen.findByTestId('viz-fallback')).textContent).toContain('Too many animations')
  })
})

describe('MermaidBlock persists what it drew', () => {
  it('registers the drawn source once per message, never without a message', async () => {
    mermaidMock.render.mockResolvedValue({ svg: SVG })
    art.register.mockResolvedValue(mkArtifact({ type: 'mermaid' }))
    const qc = client()
    const a = render(wrap(inMessage(<MermaidBlock source={SRC} maxAttempts={3} repair />), qc))
    await waitFor(() => expect(art.register).toHaveBeenCalledTimes(1))
    expect(art.register.mock.calls[0]?.[0]).toMatchObject({ conversation_id: 'c-1', source_message_id: 'm-1', type: 'mermaid', content: SRC })
    a.unmount()
    render(wrap(inMessage(<MermaidBlock source={SRC} maxAttempts={3} repair />), qc))
    await waitFor(() => expect(document.querySelector('svg')).not.toBeNull())
    expect(art.register).toHaveBeenCalledTimes(1)
    art.register.mockClear()
    render(wrap(<MermaidBlock source="flowchart TD\nX-->Y" maxAttempts={3} repair />))
    await waitFor(() => expect(mermaidMock.render).toHaveBeenCalledTimes(3))
    expect(art.register).not.toHaveBeenCalled()
  })

  it('does not register a diagram that could not be drawn', async () => {
    mermaidMock.render.mockRejectedValue(new Error('bad'))
    render(wrap(inMessage(<MermaidBlock source="broken" maxAttempts={1} repair={false} />)))
    await screen.findByTestId('viz-fallback')
    expect(art.register).not.toHaveBeenCalled()
  })
})

const list = (groups: unknown[], over = {}) => ({
  scope: 'hierarchy', root_conversation_id: 'c-1', conversation_id: 'c-1', is_root: true, groups,
  total: (groups as { artifacts: unknown[] }[]).reduce((n, g) => n + g.artifacts.length, 0), ...over,
})

describe('Artifacts tab', () => {
  it('shows loading, then real artifacts grouped by their originating conversation', async () => {
    let resolve!: (v: unknown) => void
    art.list.mockReturnValue(new Promise((r) => (resolve = r)))
    render(wrap(<ArtifactsTab conversation={conv()} />))
    expect(screen.getByLabelText('Loading artifacts')).toBeTruthy()
    resolve(list([
      { conversation_id: 'c-1', title: 'Root chat', parent_conversation_id: null, is_current: true,
        artifacts: [mkArtifact({ type: 'mermaid', title: 'Login flow' })] },
      { conversation_id: 'c-2', title: 'Branch A', parent_conversation_id: 'c-1', is_current: false,
        artifacts: [mkArtifact({ title: 'Sorting demo', conversation_id: 'c-2' })] },
    ]))
    expect(await screen.findByText('Login flow')).toBeTruthy()
    expect(screen.getByText('Sorting demo')).toBeTruthy()
    const groups = screen.getAllByRole('region')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Artifacts from Root chat', 'Artifacts from Branch A'])
    expect(within(groups[1]!).getByText('Sorting demo')).toBeTruthy()
    expect(screen.getAllByText('Ready').length).toBe(2)
  })

  it('root defaults to the whole hierarchy, a branch to itself, and the toggle widens/narrows', async () => {
    art.list.mockResolvedValue(list([]))
    const root = render(wrap(<ArtifactsTab conversation={conv()} />))
    await waitFor(() => expect(art.list).toHaveBeenCalled())
    expect(art.list.mock.calls[0]?.[1]).toMatchObject({ scope: 'hierarchy' })
    root.unmount()
    art.list.mockClear()
    render(wrap(<ArtifactsTab conversation={conv({ conversation_id: 'c-9', parent_conversation_id: 'c-1' })} />))
    await waitFor(() => expect(art.list).toHaveBeenCalled())
    expect(art.list.mock.calls[0]?.[1]).toMatchObject({ scope: 'self' })
    fireEvent.click(screen.getByRole('button', { name: 'Whole hierarchy' }))
    await waitFor(() => expect(art.list.mock.calls.at(-1)?.[1]).toMatchObject({ scope: 'hierarchy' }))
  })

  it('has a useful empty state, an error state with retry, and filters', async () => {
    art.list.mockResolvedValue(list([], { total: 0 }))
    render(wrap(<ArtifactsTab conversation={conv()} />))
    expect(await screen.findByText('No artifacts yet')).toBeTruthy()
    expect(screen.getByText(/Diagrams and animations generated in/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mermaid' }))
    await waitFor(() => expect(art.list.mock.calls.at(-1)?.[1]).toMatchObject({ type: 'mermaid' }))
    expect(await screen.findByText('No matching artifacts')).toBeTruthy()
  })

  it('shows an error with Retry that reloads', async () => {
    art.list.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(list([], { total: 0 }))
    render(wrap(<ArtifactsTab conversation={conv()} />))
    expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No artifacts yet')).toBeTruthy()
  })

  it('searches (debounced) with the typed text', async () => {
    art.list.mockResolvedValue(list([], { total: 0 }))
    render(wrap(<ArtifactsTab conversation={conv()} />))
    await screen.findByText('No artifacts yet')
    fireEvent.change(screen.getByLabelText('Search artifacts'), { target: { value: 'login' } })
    await waitFor(() => expect(art.list.mock.calls.at(-1)?.[1]).toMatchObject({ q: 'login' }))
  })

  it('previews a Mermaid artifact from its stored source, and shows the source when it is invalid', async () => {
    const good = mkArtifact({ type: 'mermaid', title: 'Good' })
    const bad = mkArtifact({ type: 'mermaid', title: 'Bad', source: 'not mermaid' })
    art.list.mockResolvedValue(list([{ conversation_id: 'c-1', title: 'Root chat', parent_conversation_id: null, is_current: true, artifacts: [good, bad] }]))
    mermaidMock.render.mockImplementation(async (_id: string, src: string) => {
      if (src === 'not mermaid') throw new Error('Parse error')
      return { svg: SVG }
    })
    render(wrap(<ArtifactsTab conversation={conv()} />))
    fireEvent.click(await screen.findByRole('button', { name: 'Preview Good' }))
    await waitFor(() => expect(document.querySelector('[data-artifact-id="' + good.artifact_id + '"] svg')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Preview Bad' }))
    expect(await screen.findByTestId('mermaid-invalid')).toBeTruthy()
    expect(screen.getByText('not mermaid')).toBeTruthy()
    expect(art.register).not.toHaveBeenCalled() // previews read; they never register or render
    expect(art.retry).not.toHaveBeenCalled()
  })

  it('plays and downloads a ready animation without any render request', async () => {
    const a = mkArtifact({ title: 'Sorting demo' })
    art.list.mockResolvedValue(list([{ conversation_id: 'c-1', title: 'Root chat', parent_conversation_id: null, is_current: true, artifacts: [a] }]))
    render(wrap(<ArtifactsTab conversation={conv()} />))
    fireEvent.click(await screen.findByRole('button', { name: 'Preview Sorting demo' }))
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Download Sorting demo' }))
    await waitFor(() => expect(dl.saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'Sorting-demo.mp4'))
    expect(art.media).toHaveBeenCalledTimes(1) // the cached blob served both playback and download
    expect(art.register).not.toHaveBeenCalled()
  })

  it('shows active status from the server and polls only while something is active', async () => {
    const active = mkArtifact({ status: 'rendering', title: 'Working' })
    art.list.mockResolvedValueOnce(list([{ conversation_id: 'c-1', title: 'Root chat', parent_conversation_id: null, is_current: true, artifacts: [active] }]))
      .mockResolvedValue(list([{ conversation_id: 'c-1', title: 'Root chat', parent_conversation_id: null, is_current: true, artifacts: [{ ...active, status: 'ready', ready: true, active: false, has_media: true }] }]))
    render(wrap(<ArtifactsTab conversation={conv()} />))
    expect(await screen.findByText('Rendering')).toBeTruthy()
    expect(await screen.findByText('Ready', {}, { timeout: 4000 })).toBeTruthy()
    const n = art.list.mock.calls.length
    await new Promise((r) => setTimeout(r, 1800))
    expect(art.list.mock.calls.length).toBe(n)
  })

  it('offers Retry only for failed, retryable artifacts', async () => {
    const failed = mkArtifact({ status: 'failed', title: 'Broken', retryable: true, message: 'The animation could not be rendered.' })
    art.list.mockResolvedValue(list([{ conversation_id: 'c-1', title: 'Root chat', parent_conversation_id: null, is_current: true, artifacts: [failed, mkArtifact({ title: 'Fine' })] }]))
    art.retry.mockResolvedValue({ ...failed, status: 'pending' })
    render(wrap(<ArtifactsTab conversation={conv()} />))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry rendering Broken' }))
    await waitFor(() => expect(art.retry).toHaveBeenCalledWith(failed.artifact_id))
    expect(screen.queryByRole('button', { name: 'Retry rendering Fine' })).toBeNull()
  })

  it('"Go to message" scrolls to the source message in the open conversation', async () => {
    const target = document.createElement('div')
    target.setAttribute('data-message-id', 'm-1')
    target.scrollIntoView = vi.fn()
    document.body.appendChild(target)
    art.list.mockResolvedValue(list([{ conversation_id: 'c-1', title: 'Root chat', parent_conversation_id: null, is_current: true, artifacts: [mkArtifact({ title: 'Jump' })] }]))
    render(wrap(<ArtifactsTab conversation={conv()} />))
    fireEvent.click(await screen.findByRole('button', { name: /Go to the message containing Jump/ }))
    await waitFor(() => expect(target.scrollIntoView).toHaveBeenCalled())
    target.remove()
  })
})

describe('Export dialog', () => {
  const job = (over = {}) => ({
    job_id: 'j-1', status: 'pending', conversation_id: 'c-1', scope: 'conversation', format: 'markdown', include_media: false,
    progress: { done: 0, total: 1 }, filename: null, content_type: null, size_bytes: null, expires_at: null, failure_code: null,
    message: null, created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z', download_ready: false, ...over,
  })

  it('exports this conversation as Markdown by default and downloads when ready', async () => {
    exp.create.mockResolvedValue(job({ status: 'ready', filename: 'root-chat-abc.md', size_bytes: 900, download_ready: true, expires_at: '2026-10-02T09:00:00Z' }))
    exp.download.mockResolvedValue(new Blob(['# md']))
    render(wrap(<ExportDialog conversation={conv()} onClose={() => {}} />))
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await screen.findByText(/root-chat-abc\.md/)
    expect(exp.create).toHaveBeenCalledWith({ conversation_id: 'c-1', scope: 'conversation', format: 'markdown', include_media: false })
    fireEvent.click(screen.getByRole('button', { name: /Download/ }))
    await waitFor(() => expect(dl.saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'root-chat-abc.md'))
  })

  it('only offers the media option for a Markdown hierarchy and sends it', async () => {
    exp.create.mockResolvedValue(job({ status: 'pending', scope: 'hierarchy', include_media: true }))
    exp.get.mockResolvedValue(job({ status: 'pending', scope: 'hierarchy' }))
    render(wrap(<ExportDialog conversation={conv({ parent_conversation_id: 'c-0' })} onClose={() => {}} />))
    expect(screen.queryByLabelText(/Include animation videos/)).toBeNull()
    fireEvent.click(screen.getByLabelText(/Whole hierarchy/))
    fireEvent.click(screen.getByLabelText(/Include animation videos/))
    fireEvent.click(screen.getByLabelText(/PDF/))
    expect(screen.queryByLabelText(/Include animation videos/)).toBeNull() // PDF never carries video
    fireEvent.click(screen.getByLabelText(/Markdown/))
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(exp.create).toHaveBeenCalled())
    expect(exp.create.mock.calls[0]?.[0]).toMatchObject({ scope: 'hierarchy', format: 'markdown' })
  })

  it('shows real progress while building, then the download once stored', async () => {
    exp.create.mockResolvedValue(job({ status: 'processing', scope: 'hierarchy', progress: { done: 1, total: 4 } }))
    exp.get.mockResolvedValue(job({ status: 'ready', scope: 'hierarchy', filename: 'x.zip', size_bytes: 3 * 1024 * 1024, download_ready: true }))
    render(wrap(<ExportDialog conversation={conv()} onClose={() => {}} />))
    fireEvent.click(screen.getByLabelText(/Whole hierarchy/))
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect((await screen.findByRole('status')).textContent).toContain('1 of 4 conversations')
    expect(await screen.findByText(/x\.zip/, {}, { timeout: 4000 })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Download/ })).toBeTruthy()
  })

  it('reports a failed export and lets the user try again', async () => {
    exp.create.mockResolvedValue(job({ status: 'failed', failure_code: 'too_large', message: 'This export is too large.' }))
    render(wrap(<ExportDialog conversation={conv()} onClose={() => {}} />))
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect((await screen.findByRole('alert')).textContent).toContain('too large')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
