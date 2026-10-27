import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import Markdown from '@/components/chat/Markdown'
import { normalizeMath } from '@/features/messages/math'

describe('normalizeMath', () => {
  it('converts \\( \\) to inline math', () => {
    expect(normalizeMath('where \\(x_i\\) is the label')).toBe('where $x_i$ is the label')
  })

  it('keeps display math on its own lines as a block', () => {
    expect(normalizeMath('Loss:\n\\[\n\\frac{1}{N}\\sum x\n\\]\nDone')).toBe('Loss:\n\n$$\n\\frac{1}{N}\\sum x\n$$\n\nDone')
  })

  it('collapses display math inside a table cell onto one line so the row survives', () => {
    const out = normalizeMath('| A | B |\n|---|---|\n| MSE | \\[\n\\frac{1}{N}\n\\] | ok |')
    expect(out).toContain('| MSE | $\\frac{1}{N}$ |')
    expect(out.split('\n')).toHaveLength(3)
  })

  it('never touches code', () => {
    const src = 'use `\\(x\\)` and\n```\n\\[a\\]\n```\n'
    expect(normalizeMath(src)).toBe(src)
  })

  it('leaves existing $ math, escaped delimiters and unclosed (streaming) delimiters alone', () => {
    for (const s of ['$a+b$ and $$c$$', 'a \\\\(b\\\\) c', 'partial \\[ \\frac{1}{', 'plain text']) expect(normalizeMath(s)).toBe(s)
  })
})

describe('math renders as formulas, not literal text', () => {
  const answer = [
    'Formula: \\(\\hat{y}_i\\) is the prediction.',
    '',
    '\\[',
    '\\text{MSE} = \\frac{1}{N}\\sum_{i=1}^{N}(y_i-\\hat{y}_i)^2',
    '\\]',
    '',
    '| Loss | Formula |',
    '|---|---|',
    '| MAE | \\[ \\frac{1}{N}\\sum_{i=1}^{N}\\left|y_i-\\hat{y}_i\\right| \\] |',
    '',
    'Also $\\eta$ inline.',
  ].join('\n')

  it('renders inline, display and in-table formulas with KaTeX and no stray delimiters', () => {
    const { container } = render(<Markdown content={answer} />)
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(4)
    expect(container.querySelectorAll('.katex-display').length).toBe(1)
    expect(container.querySelector('table td .katex')).not.toBeNull()
    expect(container.querySelector('.katex-error')).toBeNull()
    expect(container.textContent).not.toMatch(/\\\[|\\\]|\\\(|\\\)/)
  })
})
