/**
 * remark-math only understands `$…$` / `$$…$$`, but models commonly write LaTeX as `\(…\)` and `\[…\]`, which would be
 * shown as literal text. This rewrites those delimiters before rendering. Code (fenced blocks and inline code spans) is
 * never touched, and a delimiter that is not closed yet (mid-stream) is left alone until its closing half arrives.
 */

const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/

const INLINE = /(?<!\\)\\\(([^\n]+?)(?<!\\)\\\)/g
const DISPLAY = /(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]/g

/** In a table row a bare `|` ends the cell even inside math, so `|x|` and `\left|x\right|` use `\vert` there. */
function inTableRow(whole: string, offset: number): boolean {
  const start = whole.lastIndexOf('\n', offset - 1) + 1
  return whole.slice(start, offset).trimStart().startsWith('|')
}
const cellSafe = (tex: string) => tex.replace(/(?<!\\)\|/g, '\\vert ')

/** Display math standing on its own lines stays a block; anywhere else (a table cell, a sentence) it must stay on one line. */
function display(match: string, body: string, offset: number, whole: string): string {
  const before = whole.slice(0, offset)
  const after = whole.slice(offset + match.length)
  const ownLines = /(^|\n)[ \t]*$/.test(before) && /^[ \t]*(\n|$)/.test(after)
  const tex = body.trim()
  if (ownLines) return `\n$$\n${tex}\n$$\n`
  const oneLine = tex.replace(/\s*\n\s*/g, ' ')
  return `$${inTableRow(whole, offset) ? cellSafe(oneLine) : oneLine}$`
}

export function normalizeMath(content: string): string {
  if (!content.includes('\\(') && !content.includes('\\[')) return content
  return content
    .split(CODE)
    .map((part, i) => {
      if (i % 2 === 1) return part // a code segment
      return part
        .replace(DISPLAY, (m, body: string, offset: number, whole: string) => display(m, body, offset, whole))
        .replace(INLINE, (_m, body: string, offset: number, whole: string) =>
          `$${inTableRow(whole, offset) ? cellSafe(body.trim()) : body.trim()}$`)
    })
    .join('')
}
