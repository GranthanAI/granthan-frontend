import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { TextStyleSettings } from '@/components/settings/TextStyleSettings'
import { applyFonts, DEFAULT_FONT, useFontStore } from '@/stores/font.store'

const root = () => document.documentElement

describe('font preferences', () => {
  beforeEach(() => {
    localStorage.clear()
    useFontStore.setState({ input: DEFAULT_FONT, response: DEFAULT_FONT })
    applyFonts(DEFAULT_FONT, DEFAULT_FONT)
  })

  it('publishes family, weight and style as CSS variables, per target', () => {
    applyFonts({ family: 'serif', weight: '700', style: 'italic' }, DEFAULT_FONT)
    expect(root().style.getPropertyValue('--input-font-family')).toContain('Georgia')
    expect(root().style.getPropertyValue('--input-font-weight')).toBe('700')
    expect(root().style.getPropertyValue('--input-font-style')).toBe('italic')
    expect(root().style.getPropertyValue('--response-font-family')).toBe('')
  })

  it('removes the variables again for defaults', () => {
    applyFonts({ family: 'mono', weight: '300', style: 'italic' }, DEFAULT_FONT)
    applyFonts(DEFAULT_FONT, DEFAULT_FONT)
    expect(root().style.getPropertyValue('--input-font-family')).toBe('')
    expect(root().style.getPropertyValue('--input-font-weight')).toBe('')
  })

  it('persists choices in localStorage only', () => {
    useFontStore.getState().set('response', { family: 'mono', weight: '500' })
    const saved = JSON.parse(localStorage.getItem('granthan-fonts')!)
    expect(saved.state.response).toMatchObject({ family: 'mono', weight: '500', style: 'normal', size: '' })
    expect(saved.state.input).toEqual(DEFAULT_FONT)
  })
})

describe('TextStyleSettings', () => {
  beforeEach(() => {
    localStorage.clear()
    useFontStore.setState({ input: DEFAULT_FONT, response: DEFAULT_FONT })
  })

  it('lets the user pick family, weight and style for input and responses independently', () => {
    render(<TextStyleSettings />)
    const families = screen.getAllByRole('combobox', { name: 'Font family' })
    const weights = screen.getAllByLabelText('Weight')
    const styles = screen.getAllByLabelText('Style')

    fireEvent.focus(families[0]!)
    fireEvent.click(screen.getByRole('option', { name: /^Serif/ }))
    fireEvent.change(weights[1]!, { target: { value: '300' } })
    fireEvent.change(styles[1]!, { target: { value: 'italic' } })

    expect(useFontStore.getState().input).toEqual({ ...DEFAULT_FONT, family: 'serif' })
    expect(useFontStore.getState().response).toEqual({ ...DEFAULT_FONT, weight: '300', style: 'italic' })
  })

  it('resets one block without touching the other', () => {
    useFontStore.setState({
      input: { family: 'mono', weight: '700', style: 'italic' },
      response: { family: 'serif', weight: '300', style: 'normal' },
    })
    render(<TextStyleSettings />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset to default' })[0]!)
    expect(useFontStore.getState().input).toEqual(DEFAULT_FONT)
    expect(useFontStore.getState().response.family).toBe('serif')
  })
})

describe('searchable font picker', () => {
  beforeEach(() => {
    localStorage.clear()
    useFontStore.setState({ input: DEFAULT_FONT, response: DEFAULT_FONT })
  })
  const box = () => screen.getAllByRole('combobox', { name: 'Font family' })[0]!

  it('offers a long, categorised list, each name in its own typeface', () => {
    render(<TextStyleSettings />)
    fireEvent.focus(box())
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options.length).toBeGreaterThan(40)
    const times = options.find((o) => o.textContent === 'Times New Roman')!
    expect(times.style.fontFamily).toContain('Times New Roman')
    const consolas = options.find((o) => o.textContent === 'Consolas')!
    expect(consolas.style.fontFamily).toContain('monospace')
  })

  it('filters as you type and picks with the keyboard', () => {
    render(<TextStyleSettings />)
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: 'couri' } })
    const names = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)
    expect(names).toEqual(['Courier', 'Courier New'])
    fireEvent.keyDown(box(), { key: 'ArrowDown' })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(useFontStore.getState().input.family).toBe('Courier New')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('says so when nothing matches, and Escape closes without changing the font', () => {
    render(<TextStyleSettings />)
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: 'zzzz' } })
    expect(screen.getByText(/No fonts match/)).toBeInTheDocument()
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(useFontStore.getState().input.family).toBe('default')
  })

  it('shows the chosen font in its own typeface when closed', () => {
    useFontStore.setState({ input: { ...DEFAULT_FONT, family: 'Georgia' }, response: DEFAULT_FONT })
    render(<TextStyleSettings />)
    expect((box() as HTMLInputElement).value).toBe('Georgia')
    expect(box().style.fontFamily).toContain('Georgia')
  })
})

describe('size and apply-to-both', () => {
  beforeEach(() => {
    localStorage.clear()
    useFontStore.setState({ input: DEFAULT_FONT, response: DEFAULT_FONT })
    applyFonts(DEFAULT_FONT, DEFAULT_FONT)
  })

  it('publishes the size in pixels and drops it for the default', () => {
    applyFonts({ ...DEFAULT_FONT, size: '18' }, DEFAULT_FONT)
    expect(root().style.getPropertyValue('--input-font-size')).toBe('18px')
    expect(root().style.getPropertyValue('--response-font-size')).toBe('')
  })

  it('has a size picker per block', () => {
    render(<TextStyleSettings />)
    fireEvent.change(screen.getAllByLabelText('Size')[1]!, { target: { value: '20' } })
    expect(useFontStore.getState().response.size).toBe('20')
    expect(useFontStore.getState().input.size).toBe('')
  })

  it('Apply to both copies a block onto the other', () => {
    useFontStore.setState({
      input: { family: 'Georgia', weight: '500', style: 'italic', size: '18' },
      response: DEFAULT_FONT,
    })
    render(<TextStyleSettings />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Apply to both' })[0]!)
    expect(useFontStore.getState().response).toEqual(useFontStore.getState().input)
    expect(useFontStore.getState().response.size).toBe('18')
  })

  it('copes with preferences saved before size existed', () => {
    useFontStore.setState({ input: { family: 'serif', weight: '', style: 'normal' }, response: DEFAULT_FONT })
    render(<TextStyleSettings />)
    expect((screen.getAllByLabelText('Size')[0] as HTMLSelectElement).value).toBe('')
  })
})
