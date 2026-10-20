import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { splitBlocks, hasVisualFence } from '@/features/visualization/blocks'

const mermaidMock = vi.hoisted(() => ({ render: vi.fn(), initialize: vi.fn() }))
vi.mock('mermaid', () => ({ default: mermaidMock }))

const svc = vi.hoisted(() => ({
  config: vi.fn(),
  repair: vi.fn(),
  createJob: vi.fn(),
  getJob: vi.fn(),
  cancel: vi.fn(),
  media: vi.fn(),
}))
vi.mock('@/features/visualization/service', async (orig) => ({
  ...(await orig<typeof import('@/features/visualization/service')>()),
  vizService: svc,
}))

import { MermaidBlock } from '@/features/visualization/MermaidBlock'
import { ManimBlock } from '@/features/visualization/ManimBlock'
import { ResponseBlocks } from '@/features/visualization/ResponseBlocks'
import { renderMermaid } from '@/features/visualization/mermaidRender'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><g><text>ok</text></g></svg>'

beforeEach(() => {
  vi.clearAllMocks()
  svc.config.mockResolvedValue({ enabled: true, mermaid: true, manim: true, max_attempts: 3, repair: true })
})

describe('splitBlocks', () => {
  it('leaves plain markdown as one text block', () => {
    expect(splitBlocks('hello\n\n```python\nprint(1)\n```')).toEqual([{ type: 'text', content: 'hello\n\n```python\nprint(1)\n```' }])
    expect(hasVisualFence('no fences')).toBe(false)
  })

  it('keeps interleaved order', () => {
    const b = splitBlocks('intro\n```mermaid\nflowchart TD\nA-->B\n```\nmiddle\n```manim\n{"template":"text_steps"}\n```\nend')
    expect(b.map((x) => x.type)).toEqual(['text', 'mermaid', 'text', 'manim', 'text'])
  })

  it('shows an open fence as pending and never as a diagram', () => {
    const b = splitBlocks('a\n```mermaid\nflowchart TD\nA-->')
    expect(b.map((x) => x.type)).toEqual(['text', 'pending'])
  })

  it('does not treat mermaid fences inside another code block as visuals', () => {
    const b = splitBlocks('````md\n```mermaid\nflowchart TD\nA-->B\n```\n````')
    expect(b.map((x) => x.type)).toEqual(['text'])
  })

  it('isolates malformed, empty, oversized and excess blocks without touching siblings', () => {
    const many = Array.from({ length: 3 }, () => '```mermaid\nflowchart TD\nA-->B\n```').join('\n')
    expect(splitBlocks('x\n```manim\nnot json\n```\ny').map((x) => x.type)).toEqual(['text', 'invalid', 'text'])
    expect(splitBlocks('```mermaid\n\n```')[0]).toMatchObject({ type: 'invalid', reason: 'empty' })
    expect(splitBlocks('```mermaid\n' + 'x'.repeat(7000) + '\n```')[0]).toMatchObject({ reason: 'too_large' })
    expect(splitBlocks(many, 2).map((x) => x.type)).toEqual(['mermaid', 'mermaid', 'invalid'])
  })

  it('reads an optional title line', () => {
    expect(splitBlocks('```mermaid\n%% title: Flow\nflowchart TD\nA-->B\n```')[0]).toMatchObject({ type: 'mermaid', title: 'Flow', source: 'flowchart TD\nA-->B' })
  })
})

describe('renderMermaid sanitisation', () => {
  it('strips scripts, event handlers, foreignObject and links from the SVG', async () => {
    mermaidMock.render.mockResolvedValue({
      svg:
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><foreignObject><div>x</div></foreignObject>' +
        '<a href="javascript:alert(1)"><text onclick="alert(1)">t</text></a></svg>',
    })
    const el = await renderMermaid('flowchart TD\nA-->B')
    const html = el.outerHTML
    expect(html).not.toMatch(/script|onload|onclick|foreignObject|javascript/i)
    expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict' }))
  })
})

describe('MermaidBlock attempts', () => {
  it('renders on the first attempt without repair', async () => {
    mermaidMock.render.mockResolvedValue({ svg: SVG })
    const { container } = render(<MermaidBlock source="flowchart TD\nA-->B" maxAttempts={3} repair />)
    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull())
    expect(svc.repair).not.toHaveBeenCalled()
  })

  it('repairs once (attempt 2) then renders', async () => {
    mermaidMock.render.mockRejectedValueOnce(new Error('Parse error')).mockResolvedValue({ svg: SVG })
    svc.repair.mockResolvedValue({ ok: true, content: 'flowchart TD\nA-->B' })
    const { container } = render(<MermaidBlock source="bad" maxAttempts={3} repair />)
    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull())
    expect(svc.repair).toHaveBeenCalledTimes(1)
    expect(svc.repair).toHaveBeenCalledWith('mermaid', 'bad', 'Parse error', 2, expect.anything())
  })

  it('makes exactly three total attempts, then falls back for this block only', async () => {
    mermaidMock.render.mockRejectedValue(new Error('Parse error'))
    svc.repair.mockResolvedValue({ ok: true, content: 'still bad' })
    render(<MermaidBlock source="bad" maxAttempts={3} repair />)
    await screen.findByTestId('viz-fallback')
    expect(mermaidMock.render).toHaveBeenCalledTimes(3) // original + 2 repairs
    expect(svc.repair.mock.calls.map((c) => c[3])).toEqual([2, 3])
  })

  it('falls back immediately when repair is disabled or the repair fails', async () => {
    mermaidMock.render.mockRejectedValue(new Error('x'))
    const a = render(<MermaidBlock source="bad" maxAttempts={3} repair={false} />)
    await screen.findByTestId('viz-fallback')
    expect(svc.repair).not.toHaveBeenCalled()
    a.unmount()
    svc.repair.mockResolvedValue({ ok: false })
    render(<MermaidBlock source="bad" maxAttempts={3} repair />)
    await screen.findByTestId('viz-fallback')
    expect(mermaidMock.render).toHaveBeenCalledTimes(2)
  })
})

describe('ManimBlock lifecycle', () => {
  const job = (state: string, extra = {}) => ({ id: 'mj_' + 'a'.repeat(32), state, attempt: 1, max_attempts: 3, failure: null, ready: state === 'ready', ...extra })

  it('polls until ready and plays the authenticated video', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:video')
    URL.revokeObjectURL = vi.fn()
    svc.createJob.mockResolvedValue(job('pending'))
    svc.getJob.mockResolvedValue(job('ready'))
    svc.media.mockResolvedValue(new Blob(['x'], { type: 'video/mp4' }))
    const { container } = render(<ManimBlock spec={{ template: 'text_steps' }} />)
    expect(await screen.findByRole('status')).toBeTruthy()
    await waitFor(() => expect(container.querySelector('video')?.getAttribute('src')).toBe('blob:video'), { timeout: 4000 })
    expect(svc.media).toHaveBeenCalledTimes(1)
  })

  it('shows a text fallback when the job fails', async () => {
    svc.createJob.mockResolvedValue(job('failed', { failure: 'render_error', message: 'The visual could not be generated.' }))
    render(<ManimBlock spec={{ template: 'text_steps' }} />)
    const el = await screen.findByTestId('viz-fallback')
    expect(el.textContent).toContain('unavailable')
  })

  it('shows a fallback when the job cannot even be created', async () => {
    svc.createJob.mockRejectedValue(new Error('Too many animations in progress.'))
    render(<ManimBlock spec={{ template: 'text_steps' }} />)
    expect((await screen.findByTestId('viz-fallback')).textContent).toContain('Too many animations')
  })
})

describe('ResponseBlocks', () => {
  const wrap = (ui: React.ReactElement) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
  )

  it('streams text and holds visuals back until the answer is complete', async () => {
    const content = 'Intro text\n```mermaid\nflowchart TD\nA-->B\n```\nOutro'
    mermaidMock.render.mockResolvedValue({ svg: SVG })
    const { container, rerender } = render(wrap(<ResponseBlocks content={content} streaming />))
    expect(await screen.findByText('Intro text')).toBeTruthy()
    expect(screen.getByText(/Preparing diagram/)).toBeTruthy()
    expect(mermaidMock.render).not.toHaveBeenCalled()
    rerender(wrap(<ResponseBlocks content={content} streaming={false} />))
    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull())
    expect(screen.getByText('Outro')).toBeTruthy()
  })

  it('keeps text intact when a sibling diagram fails for good', async () => {
    mermaidMock.render.mockRejectedValue(new Error('bad'))
    svc.repair.mockResolvedValue({ ok: false })
    render(wrap(<ResponseBlocks content={'Before\n```mermaid\nflowchart TD\nA[\n```\nAfter'} streaming={false} />))
    await screen.findByTestId('viz-fallback')
    expect(screen.getByText('Before')).toBeTruthy()
    expect(screen.getByText('After')).toBeTruthy()
  })

  it('shows a turned-off message for animations when the backend has Manim disabled', async () => {
    svc.config.mockResolvedValue({ enabled: true, mermaid: true, manim: false, max_attempts: 3, repair: true })
    render(wrap(<ResponseBlocks content={'```manim\n{"template":"text_steps"}\n```'} streaming={false} />))
    expect(await screen.findByText(/turned off/)).toBeTruthy()
    expect(svc.createJob).not.toHaveBeenCalled()
  })
})
