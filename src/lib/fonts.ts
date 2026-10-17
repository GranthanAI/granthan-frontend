export type FontCategory = 'Generic' | 'Sans serif' | 'Serif' | 'Monospace' | 'Handwriting & display'

export interface FontFamilyOption {
  id: string
  label: string
  /** CSS font-family value; '' means "keep the app font". */
  css: string
  category: FontCategory
}

const GENERIC_FALLBACK: Record<Exclude<FontCategory, 'Generic'>, string> = {
  'Sans serif': 'sans-serif',
  Serif: 'serif',
  Monospace: 'monospace',
  'Handwriting & display': 'cursive',
}

/** Generic stacks that exist on every device. The ids are stored in saved preferences, so they stay stable. */
const GENERIC: FontFamilyOption[] = [
  { id: 'default', label: 'Default (Inter)', css: '', category: 'Generic' },
  { id: 'system', label: 'System UI', css: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", category: 'Generic' },
  { id: 'humanist', label: 'Humanist sans', css: "'Segoe UI', Candara, 'Gill Sans', Optima, Calibri, sans-serif", category: 'Generic' },
  { id: 'rounded', label: 'Rounded', css: "ui-rounded, 'Hiragino Maru Gothic ProN', Quicksand, Nunito, 'Segoe UI', sans-serif", category: 'Generic' },
  { id: 'serif', label: 'Serif', css: "Georgia, 'Times New Roman', Times, serif", category: 'Generic' },
  { id: 'mono', label: 'Monospace', css: "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace", category: 'Generic' },
  { id: 'handwritten', label: 'Handwritten', css: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive", category: 'Generic' },
]

/** Named fonts, in the spirit of the Word / Google Docs font list. Only the ones installed on the device are offered. */
const NAMED: [string, Exclude<FontCategory, 'Generic'>][] = [
  ['Arial', 'Sans serif'], ['Arial Narrow', 'Sans serif'], ['Arial Rounded MT Bold', 'Sans serif'], ['Avenir', 'Sans serif'],
  ['Avenir Next', 'Sans serif'], ['Calibri', 'Sans serif'], ['Candara', 'Sans serif'], ['Century Gothic', 'Sans serif'],
  ['Corbel', 'Sans serif'], ['DejaVu Sans', 'Sans serif'], ['Franklin Gothic Medium', 'Sans serif'], ['Futura', 'Sans serif'],
  ['Geneva', 'Sans serif'], ['Gill Sans', 'Sans serif'], ['Gill Sans MT', 'Sans serif'], ['Helvetica', 'Sans serif'],
  ['Helvetica Neue', 'Sans serif'], ['Impact', 'Sans serif'], ['Lucida Grande', 'Sans serif'], ['Lucida Sans Unicode', 'Sans serif'],
  ['Microsoft Sans Serif', 'Sans serif'], ['Noto Sans', 'Sans serif'], ['Open Sans', 'Sans serif'], ['Optima', 'Sans serif'],
  ['Roboto', 'Sans serif'], ['Segoe UI', 'Sans serif'], ['Segoe UI Variable', 'Sans serif'], ['SF Pro Text', 'Sans serif'],
  ['Tahoma', 'Sans serif'], ['Trebuchet MS', 'Sans serif'], ['Ubuntu', 'Sans serif'], ['Verdana', 'Sans serif'],

  ['Baskerville', 'Serif'], ['Big Caslon', 'Serif'], ['Bodoni MT', 'Serif'], ['Book Antiqua', 'Serif'],
  ['Bookman Old Style', 'Serif'], ['Calisto MT', 'Serif'], ['Cambria', 'Serif'], ['Century Schoolbook', 'Serif'],
  ['Charter', 'Serif'], ['Cochin', 'Serif'], ['Constantia', 'Serif'], ['Didot', 'Serif'], ['Garamond', 'Serif'],
  ['Georgia', 'Serif'], ['Goudy Old Style', 'Serif'], ['Hoefler Text', 'Serif'], ['Iowan Old Style', 'Serif'],
  ['Palatino', 'Serif'], ['Palatino Linotype', 'Serif'], ['Perpetua', 'Serif'], ['Rockwell', 'Serif'],
  ['Sitka Text', 'Serif'], ['Times', 'Serif'], ['Times New Roman', 'Serif'],

  ['American Typewriter', 'Monospace'], ['Andale Mono', 'Monospace'], ['Cascadia Code', 'Monospace'], ['Cascadia Mono', 'Monospace'],
  ['Consolas', 'Monospace'], ['Courier', 'Monospace'], ['Courier New', 'Monospace'], ['DejaVu Sans Mono', 'Monospace'],
  ['Fira Code', 'Monospace'], ['JetBrains Mono', 'Monospace'], ['Lucida Console', 'Monospace'], ['Menlo', 'Monospace'],
  ['Monaco', 'Monospace'], ['SF Mono', 'Monospace'],

  ['Bradley Hand', 'Handwriting & display'], ['Brush Script MT', 'Handwriting & display'], ['Chalkboard', 'Handwriting & display'],
  ['Comic Sans MS', 'Handwriting & display'], ['Copperplate', 'Handwriting & display'], ['Ink Free', 'Handwriting & display'],
  ['Lucida Handwriting', 'Handwriting & display'], ['Marker Felt', 'Handwriting & display'], ['Papyrus', 'Handwriting & display'],
  ['Segoe Print', 'Handwriting & display'], ['Segoe Script', 'Handwriting & display'], ['Snell Roundhand', 'Handwriting & display'],
  ['Trattatello', 'Handwriting & display'],
]

const named = (): FontFamilyOption[] =>
  NAMED.map(([name, category]) => ({
    id: name,
    label: name,
    css: `'${name}', ${GENERIC_FALLBACK[category]}`,
    category,
  }))

/** The whole catalogue (generic stacks + named fonts), before availability filtering. */
export const ALL_FONT_FAMILIES: FontFamilyOption[] = [...GENERIC, ...named()]

let ctx: CanvasRenderingContext2D | null | undefined
const widthCache = new Map<string, boolean>()

/**
 * True when `name` is installed: text drawn in it measures differently from each of three baseline
 * generics. If the environment cannot measure text (no canvas), every font is assumed available.
 */
export function isFontInstalled(name: string): boolean {
  const cached = widthCache.get(name)
  if (cached !== undefined) return cached
  if (ctx === undefined) {
    try {
      ctx = document.createElement('canvas').getContext('2d')
      if (ctx && typeof ctx.measureText !== 'function') ctx = null
    } catch {
      ctx = null
    }
  }
  let result = true
  if (ctx) {
    const c = ctx
    const sample = 'mmmmmmmmmmlliWWQ@#0123'
    const measure = (family: string) => {
      c.font = `72px ${family}`
      return c.measureText(sample).width
    }
    const base = ['monospace', 'serif', 'sans-serif']
    const baseWidths = base.map((b) => measure(b))
    // A missing font silently falls back to the baseline, so it equals the baseline width for each generic.
    result = base.some((b, i) => measure(`'${name}', ${b}`) !== baseWidths[i])
  }
  widthCache.set(name, result)
  return result
}

/** Font choices available on this device, grouped order preserved. */
export function availableFontFamilies(): FontFamilyOption[] {
  return ALL_FONT_FAMILIES.filter((f) => f.category === 'Generic' || isFontInstalled(f.id))
}

export const familyCss = (id: string): string => ALL_FONT_FAMILIES.find((f) => f.id === id)?.css ?? ''
