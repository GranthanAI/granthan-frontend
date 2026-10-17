import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { buildTree, edgePath, familyOf, GRAPH, layoutFamily } from '@/features/conversations/tree'
import { FloatingWindow } from '@/components/windows/FloatingWindow'
import { HierarchyGraph } from '@/components/windows/HierarchyGraph'
import { MAX_WINDOWS, MIN_H, MIN_W, useWindowsStore } from '@/stores/windows.store'
import type { Conversation } from '@/types/api'

const conv = (id: string, parent: string | null, n: number): Conversation => ({
  conversation_id: id,
  user_id: 'u',
  title: `Chat ${id}`,
  status: 'active',
  created_at: `2026-01-01T00:00:0${n}Z`,
  updated_at: `2026-01-01T00:00:0${n}Z`,
  parent_conversation_id: parent,
})

// master -> a -> a1, a2 ; master -> b ; other (separate family)
const ALL = [
  conv('master', null, 0),
  conv('a', 'master', 1),
  conv('a1', 'a', 2),
  conv('a2', 'a', 3),
  conv('b', 'master', 4),
  conv('other', null, 5),
]

describe('hierarchy layout', () => {
  const root = familyOf(ALL, 'a2')!
  const layout = layoutFamily(root)
  const at = (id: string) => layout.nodes.find((n) => n.id === id)!

  it('contains the whole master family, found from any member, and nothing else', () => {
    expect(root.conversation.conversation_id).toBe('master')
    expect(layout.nodes.map((n) => n.id)).toEqual(['master', 'a', 'a1', 'a2', 'b'])
  })

  it('grows downward one row per conversation and indents one step per level', () => {
    layout.nodes.forEach((n, i) => expect(n.y).toBe(GRAPH.padY + i * GRAPH.rowH))
    expect(at('master').x).toBeLessThan(at('a').x)
    expect(at('a').x).toBeLessThan(at('a1').x)
    expect(at('a1').x).toBe(at('a2').x)
    expect(at('b').x).toBe(at('a').x)
  })

  it('connects each child to its parent with a curved path', () => {
    expect(layout.edges).toHaveLength(4)
    const d = edgePath(at('a'), at('a1'))
    expect(d).toContain('Q')
    expect(d.startsWith(`M${at('a').x} `)).toBe(true)
  })

  it('treats an ancestor that is not loaded as the top of the family', () => {
    const partial = buildTree(ALL.filter((c) => c.conversation_id !== 'master'))
    expect(partial.map((r) => r.conversation.conversation_id).sort()).toEqual(['a', 'b', 'other'])
  })
})

describe('HierarchyGraph', () => {
  it('opens a conversation when its node is clicked or activated by keyboard', () => {
    const opened: string[] = []
    render(<HierarchyGraph root={familyOf(ALL, 'master')!} currentId="a" openIds={new Set(['b'])} onOpen={(id) => opened.push(id)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Chat a1' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open Chat b' }), { key: 'Enter' })
    expect(opened).toEqual(['a1', 'b'])
    expect(screen.getByRole('button', { name: 'Open Chat a' })).toHaveAttribute('aria-current', 'true')
  })
})

describe('windows store', () => {
  beforeEach(() => useWindowsStore.setState({ windows: [], topZ: 1 }))
  const { open } = useWindowsStore.getState()
  const wins = () => useWindowsStore.getState().windows

  it('stacks windows: the latest opened is on top, and re-opening raises instead of duplicating', () => {
    open('chat', 'a')
    open('chat', 'b')
    open('chat', 'a')
    expect(wins()).toHaveLength(2)
    const z = Object.fromEntries(wins().map((w) => [w.conversationId, w.z]))
    expect(z.a).toBeGreaterThan(z.b!)
  })

  it('cascades new windows so they do not hide each other', () => {
    open('chat', 'a')
    open('chat', 'b')
    const [a, b] = wins()
    expect(`${a!.x},${a!.y}`).not.toBe(`${b!.x},${b!.y}`)
  })

  it('keeps a chat window and a hierarchy window of the same conversation separate', () => {
    open('chat', 'a')
    open('hierarchy', 'a')
    expect(wins()).toHaveLength(2)
  })

  it('caps the number of windows by dropping the oldest', () => {
    for (let i = 0; i < MAX_WINDOWS + 2; i++) open('chat', `c${i}`)
    expect(wins()).toHaveLength(MAX_WINDOWS)
    expect(wins().some((w) => w.conversationId === 'c0')).toBe(false)
  })
})

describe('FloatingWindow drag, resize and collapse', () => {
  beforeEach(() => {
    useWindowsStore.setState({ windows: [], topZ: 1 })
    useWindowsStore.getState().open('hierarchy', 'a')
  })
  const win = () => useWindowsStore.getState().windows[0]!
  const mount = () => {
    const view = render(<FloatingWindow win={win()} title="Test window">body</FloatingWindow>)
    return {
      header: () => view.container.querySelector('[data-window-header]') as HTMLElement,
      handle: (e: string) => view.container.querySelector(`[data-resize="${e}"]`) as HTMLElement,
    }
  }

  it('moves when the title bar is dragged', () => {
    const { header } = mount()
    const start = { x: win().x, y: win().y }
    fireEvent.pointerDown(header(), { clientX: 500, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(header(), { clientX: 440, clientY: 160, pointerId: 1 })
    fireEvent.pointerUp(header(), { pointerId: 1 })
    expect(win().x).toBe(start.x - 60)
    expect(win().y).toBe(start.y + 60)
  })

  it('grows from the south-east corner and never shrinks below the minimum', () => {
    const { handle } = mount()
    const w0 = win().w
    fireEvent.pointerDown(handle('se'), { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(handle('se'), { clientX: 100, clientY: 50, pointerId: 1 })
    expect(win().w).toBe(w0 + 100)
    fireEvent.pointerMove(handle('se'), { clientX: -2000, clientY: -2000, pointerId: 1 })
    expect(win().w).toBe(MIN_W)
    expect(win().h).toBe(MIN_H)
  })

  it('resizing from the west edge keeps the right edge fixed', () => {
    const { handle } = mount()
    const right = win().x + win().w
    fireEvent.pointerDown(handle('w'), { clientX: 300, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(handle('w'), { clientX: 240, clientY: 0, pointerId: 1 })
    expect(win().x + win().w).toBe(right)
    expect(win().w).toBeGreaterThan(0)
  })

  it('collapses to its title bar and closes', () => {
    const { rerender } = render(<FloatingWindow win={win()} title="Collapsible">body</FloatingWindow>)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse window' }))
    expect(win().collapsed).toBe(true)
    rerender(<FloatingWindow win={win()} title="Collapsible">body</FloatingWindow>)
    expect(screen.queryByText('body')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }))
    expect(useWindowsStore.getState().windows).toHaveLength(0)
  })

  it('raises a window when it is pressed', () => {
    useWindowsStore.getState().open('chat', 'b')
    const first = useWindowsStore.getState().windows[0]!
    const { container } = render(<FloatingWindow win={first} title="First">x</FloatingWindow>)
    fireEvent.pointerDown(container.firstElementChild as HTMLElement)
    const z = (k: string) => useWindowsStore.getState().windows.find((w) => w.key === k)!.z
    expect(z(first.key)).toBeGreaterThan(z('chat:b'))
  })
})

describe('following the main conversation and scaling', () => {
  beforeEach(() => useWindowsStore.setState({ windows: [], topZ: 1 }))
  const st = () => useWindowsStore.getState()

  it('a followed hierarchy window switches to the newly selected conversation', () => {
    st().open('hierarchy', 'a', { follow: true })
    st().retarget('b')
    expect(st().windows).toHaveLength(1)
    expect(st().windows[0]).toMatchObject({ conversationId: 'b', key: 'hierarchy:b' })
  })

  it('a pinned hierarchy window (opened from a chat window) stays put', () => {
    st().open('hierarchy', 'a', { follow: false })
    st().retarget('b')
    expect(st().windows[0]!.conversationId).toBe('a')
  })

  it('does not duplicate when the target already has its own hierarchy window', () => {
    st().open('hierarchy', 'a', { follow: true })
    st().open('hierarchy', 'b', { follow: false })
    st().retarget('b')
    expect(st().windows).toHaveLength(1)
    expect(st().windows[0]!.follow).toBe(false)
  })

  it('size stepper goes from 100% down to 50% and up to 200% in steps', () => {
    st().open('chat', 'a')
    const { w } = st().windows[0]!
    st().setPct('chat:a', 75)
    expect(st().windows[0]).toMatchObject({ pct: 75 })
    expect(st().windows[0]!.w).toBeLessThan(w)
    st().setPct('chat:a', 100)
    expect(st().windows[0]!.w).toBe(w)
    st().setPct('chat:a', 10)
    expect(st().windows[0]!.pct).toBe(50)
    st().setPct('chat:a', 999)
    expect(st().windows[0]!.pct).toBe(200)
  })

  it('a manual resize makes the new size the 100% baseline', () => {
    st().open('chat', 'a')
    st().setPct('chat:a', 150)
    st().setRect('chat:a', { w: 500, h: 400 })
    expect(st().windows[0]!.pct).toBe(100)
  })

  it('the - 100% + control steps the window size', () => {
    st().open('hierarchy', 'a')
    render(<FloatingWindow win={st().windows[0]!} title="W">x</FloatingWindow>)
    expect(screen.getByRole('button', { name: /Window size 100%/ })).toHaveTextContent('100%')
    fireEvent.click(screen.getByRole('button', { name: 'Increase window size' }))
    expect(st().windows[0]!.pct).toBe(125)
  })
})
