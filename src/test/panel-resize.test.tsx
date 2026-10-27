import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PanelResizer } from '@/components/layout/PanelResizer'
import { clampPanelWidth, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, useUiStore } from '@/stores/ui.store'

describe('right panel width', () => {
  beforeEach(() => useUiStore.setState({ panelWidth: null }))

  it('is clamped between the minimum, the maximum and 70% of the window', () => {
    expect(clampPanelWidth(10)).toBe(PANEL_MIN_WIDTH)
    expect(clampPanelWidth(5000)).toBe(PANEL_MAX_WIDTH)
    expect(clampPanelWidth(900, 1000)).toBe(700)
    expect(clampPanelWidth(500, 400)).toBe(PANEL_MIN_WIDTH)
  })

  it('arrow keys on the handle widen (left) and narrow (right), double-click resets', () => {
    useUiStore.setState({ panelWidth: 400 })
    render(<div><PanelResizer /></div>)
    const handle = screen.getByRole('separator', { name: 'Resize context panel' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(useUiStore.getState().panelWidth).toBe(424)
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(useUiStore.getState().panelWidth).toBe(376)
    fireEvent.doubleClick(handle)
    expect(useUiStore.getState().panelWidth).toBeNull()
  })
})
