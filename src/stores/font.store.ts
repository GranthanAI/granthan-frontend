import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { familyCss } from '@/lib/fonts'

export type FontTarget = 'input' | 'response'

export interface FontPrefs {
  /** Key into FONT_FAMILIES ('default' keeps the app font). */
  family: string
  /** '' keeps the natural weight, otherwise a CSS numeric weight. */
  weight: string
  style: 'normal' | 'italic'
  /** '' keeps the default size, otherwise pixels. */
  size?: string
}

export const FONT_WEIGHTS: { value: string; label: string }[] = [
  { value: '', label: 'Default' },
  { value: '300', label: 'Light' },
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semibold' },
  { value: '700', label: 'Bold' },
]

export const FONT_SIZES: { value: string; label: string }[] = [
  { value: '', label: 'Default' },
  ...[11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36].map((n) => ({ value: String(n), label: `${n} px` })),
]

export const DEFAULT_FONT: FontPrefs = { family: 'default', weight: '', style: 'normal', size: '' }

interface FontState {
  input: FontPrefs
  response: FontPrefs
  set: (target: FontTarget, patch: Partial<FontPrefs>) => void
  reset: (target?: FontTarget) => void
  /** Copies one block's settings onto the other so input and responses match. */
  applyToBoth: (from: FontTarget) => void
}

export const useFontStore = create<FontState>()(
  persist(
    (set) => ({
      input: DEFAULT_FONT,
      response: DEFAULT_FONT,
      set: (target, patch) => set((s) => ({ [target]: { ...s[target], ...patch } }) as Partial<FontState>),
      applyToBoth: (from) => set((s) => ({ input: { ...s[from] }, response: { ...s[from] } })),
      reset: (target) =>
        set(target ? ({ [target]: DEFAULT_FONT } as Partial<FontState>) : { input: DEFAULT_FONT, response: DEFAULT_FONT }),
    }),
    {
      name: 'granthan-fonts',
      // Preferences live in this browser only; they are never sent to the backend.
      partialize: (s) => ({ input: s.input, response: s.response }),
    },
  ),
)

/** Publishes the preferences as CSS variables read by `.font-input` / `.font-response` (see index.css). */
export function applyFonts(input: FontPrefs, response: FontPrefs, root: HTMLElement = document.documentElement) {
  const put = (name: string, value: string) =>
    value ? root.style.setProperty(name, value) : root.style.removeProperty(name)
  for (const [prefix, p] of [['input', input], ['response', response]] as const) {
    put(`--${prefix}-font-family`, familyCss(p.family))
    put(`--${prefix}-font-weight`, p.weight)
    put(`--${prefix}-font-style`, p.style === 'italic' ? 'italic' : '')
    put(`--${prefix}-font-size`, p.size ? `${p.size}px` : '')
  }
}
