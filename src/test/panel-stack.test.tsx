import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ContextPanel } from '@/components/layout/ContextPanel'
import { useUiStore } from '@/stores/ui.store'

const reset = (over: object = {}) =>
  useUiStore.setState({ panelOpen: true, panelTab: 'artifacts', panelStack: false, stackTabs: ['artifacts'], ...over })

describe('right panel store', () => {
  beforeEach(() => reset())

  it('one section at a time by default: a tab click replaces the section', () => {
    useUiStore.getState().selectPanelTab('notes')
    expect(useUiStore.getState()).toMatchObject({ panelTab: 'notes', stackTabs: ['notes'] })
  })

  it('stack mode keeps the current section and lets another be added, then removed', () => {
    const s = () => useUiStore.getState()
    s().setPanelStack(true)
    expect(s().stackTabs).toEqual(['artifacts'])
    s().selectPanelTab('notes')
    expect(s().stackTabs).toEqual(['artifacts', 'notes'])
    s().selectPanelTab('artifacts')
    expect(s().stackTabs).toEqual(['notes'])
    expect(s().panelTab).toBe('notes')
    s().selectPanelTab('notes') // the last open section can't be closed by its tab
    expect(s().stackTabs).toEqual(['notes'])
  })

  it('openPanel(tab) from elsewhere adds to the stack instead of replacing it', () => {
    const s = () => useUiStore.getState()
    s().setPanelStack(true)
    s().selectPanelTab('notes')
    s().openPanel('files')
    expect(s().stackTabs).toEqual(['artifacts', 'notes', 'files'])
  })

  it('leaving stack mode shows just the active section', () => {
    const s = () => useUiStore.getState()
    s().setPanelStack(true)
    s().selectPanelTab('notes')
    s().setPanelStack(false)
    expect(s().panelStack).toBe(false)
    expect(s().stackTabs).toEqual(['notes'])
  })
})

describe('right panel UI', () => {
  beforeEach(() => reset())
  const renderPanel = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ContextPanel conversation={undefined} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

  it('shows one section until "show several sections together" is switched on', async () => {
    const u = userEvent.setup()
    renderPanel()
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    await u.click(screen.getByRole('button', { name: 'Show several sections together' }))
    await u.click(screen.getByRole('tab', { name: /Notes/ }))
    const panels = screen.getAllByRole('tabpanel')
    expect(panels).toHaveLength(2)
    expect(within(panels[0]!).getByText('Artifacts')).toBeInTheDocument()
    expect(within(panels[1]!).getByText('Notes')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Artifacts/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Notes/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('a stacked section can be hidden from its own header', async () => {
    const u = userEvent.setup()
    reset({ panelStack: true, stackTabs: ['artifacts', 'notes'], panelTab: 'notes' })
    renderPanel()
    await u.click(screen.getByRole('button', { name: 'Hide Artifacts' }))
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /^Hide / })).toBeNull()
  })
})
