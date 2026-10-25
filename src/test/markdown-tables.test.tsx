import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import Markdown from '@/components/chat/Markdown'

const table = (cell: string) => `| Type | Basis |\n| --- | --- |\n| Tensor | ${cell} |\n`

describe('markdown line breaks in tables', () => {
  it('turns <br> variants inside a table cell into real line breaks (no literal tag)', () => {
    const { container } = render(<Markdown content={table('Model size.<br>• 7B model<br/>• 30B model<BR />• done')} />)
    const cell = container.querySelectorAll('tbody td')[1] as HTMLElement
    expect(cell.querySelectorAll('br')).toHaveLength(3)
    expect(cell.textContent).not.toContain('<br')
    expect(cell.textContent).toContain('• 7B model')
  })

  it('still does not render any other raw HTML', () => {
    const { container } = render(<Markdown content={table('<img src=x onerror=alert(1)><script>alert(1)</script>')} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('leaves ordinary text and tables unchanged', () => {
    const { container } = render(<Markdown content={table('plain text')} />)
    expect(container.querySelectorAll('table')).toHaveLength(1)
    expect(container.querySelector('tbody td:nth-child(2)')?.textContent).toBe('plain text')
  })
})

describe('multi-line code written as one inline span with <br>', () => {
  const cell = "`ts<br>function f<T>(x: T): T {<br>  return x;<br>}<br>`"

  it('renders a real code block with newlines and the language, never literal <br> tags', () => {
    const { container } = render(<Markdown content={table(cell)} />)
    const code = container.querySelector('tbody td:nth-child(2) pre code') as HTMLElement
    expect(code).not.toBeNull()
    expect(code.textContent?.replace(/\n$/, '')).toBe('function f<T>(x: T): T {\n  return x;\n}')
    expect(code.className).toContain('language-ts')
    expect(container.textContent).not.toContain('<br')
  })

  it('leaves ordinary inline code untouched', () => {
    const { container } = render(<Markdown content={table('`Array<string>`')} />)
    expect(container.querySelector('tbody td:nth-child(2) code')?.textContent).toBe('Array<string>')
    expect(container.querySelector('tbody td:nth-child(2) pre')).toBeNull()
  })
})
