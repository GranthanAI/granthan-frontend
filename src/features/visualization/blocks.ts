/**
 * Splits an assistant answer into ordered blocks (mirror of the backend parser in llm-service app/visualization/blocks.py).
 * Wire form stays plain Markdown: ```mermaid and ```manim fences carry visuals, everything else is text. An answer without
 * such fences is a single text block, so older messages and plain answers render exactly as before.
 */
export type Block =
  | { type: 'text'; content: string }
  | { type: 'mermaid'; source: string; title?: string }
  | { type: 'manim'; spec: Record<string, unknown> }
  | { type: 'pending'; kind: 'mermaid' | 'manim' } // fence still open (streaming)
  | { type: 'invalid'; kind: 'mermaid' | 'manim'; original: string; reason: 'malformed' | 'too_large' | 'empty' | 'limit' }

export const MAX_BLOCKS = 5
export const MAX_MERMAID_CHARS = 6000
export const MAX_MANIM_CHARS = 4000

const OPEN = /^ {0,3}(`{3,}|~{3,})\s*([A-Za-z]+)?[^`\n]*$/
const VISUAL = /^ {0,3}(`{3,}|~{3,})\s*(mermaid|manim)\b/im

export function hasVisualFence(content: string): boolean {
  return VISUAL.test(content)
}

export function splitBlocks(content: string, maxBlocks = MAX_BLOCKS): Block[] {
  const lines = content.split('\n')
  const blocks: Block[] = []
  let buf: string[] = []
  let visuals = 0
  let inOtherFence: string | null = null
  const flush = () => {
    const text = buf.join('\n')
    buf = []
    if (text.trim()) blocks.push({ type: 'text', content: text })
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const m = OPEN.exec(line)
    if (inOtherFence) {
      buf.push(line)
      const ch = inOtherFence.charAt(0)
      if (line.trim().startsWith(ch.repeat(inOtherFence.length)) && new Set(line.trim()).size === 1) inOtherFence = null
      continue
    }
    const lang = m?.[2]?.toLowerCase()
    if (!m || (lang !== 'mermaid' && lang !== 'manim')) {
      if (m) inOtherFence = m[1] ?? null // an ordinary code block: its contents are never interpreted as visuals
      buf.push(line)
      continue
    }
    const fence = m[1] ?? '```'
    let close = -1
    for (let j = i + 1; j < lines.length; j++) {
      const t = (lines[j] ?? '').trim()
      if (t.startsWith(fence.charAt(0).repeat(fence.length)) && new Set(t).size === 1) {
        close = j
        break
      }
    }
    const kind = lang
    if (close === -1) {
      flush()
      blocks.push({ type: 'pending', kind })
      return blocks
    }
    const body = lines.slice(i + 1, close).join('\n')
    const original = lines.slice(i, close + 1).join('\n')
    flush()
    const limit = kind === 'mermaid' ? MAX_MERMAID_CHARS : MAX_MANIM_CHARS
    if (visuals >= maxBlocks) blocks.push({ type: 'invalid', kind, original, reason: 'limit' })
    else if (!body.trim()) blocks.push({ type: 'invalid', kind, original, reason: 'empty' })
    else if (body.length > limit) blocks.push({ type: 'invalid', kind, original, reason: 'too_large' })
    else if (kind === 'mermaid') {
      let source = body.replace(/^\n+|\n+$/g, '')
      let title: string | undefined
      const tm = /^\s*%%\s*title:\s*(.+)\n?/i.exec(source)
      if (tm) {
        title = (tm[1] ?? '').trim().slice(0, 120)
        source = source.slice(tm[0].length)
      }
      if (source.trim()) {
        blocks.push({ type: 'mermaid', source, title })
        visuals++
      } else blocks.push({ type: 'invalid', kind, original, reason: 'empty' })
    } else {
      try {
        const spec = JSON.parse(body)
        if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('not an object')
        blocks.push({ type: 'manim', spec })
        visuals++
      } catch {
        blocks.push({ type: 'invalid', kind, original, reason: 'malformed' })
      }
    }
    i = close
  }
  flush()
  return blocks
}

/** Content-free text that replaces ONLY a failed block, so the rest of the answer stays complete. */
export function fallbackText(kind: 'mermaid' | 'manim', message?: string): string {
  const label = kind === 'mermaid' ? 'Diagram' : 'Animation'
  return `${label} unavailable${message ? `: ${message}` : '.'} The explanation above stands on its own.`
}
