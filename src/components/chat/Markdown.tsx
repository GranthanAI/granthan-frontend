import { isValidElement, memo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy } from 'lucide-react'
import { copyText } from '@/lib/clipboard'

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node as ReactElement<{ children?: ReactNode }>).props.children)
  return ''
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const code = isValidElement(children) ? (children as ReactElement<{ className?: string; children?: ReactNode }>) : null
  const lang = /language-([\w-]+)/.exec(code?.props.className ?? '')?.[1]
  const onCopy = async () => {
    if (await copyText(textOf(code?.props.children ?? children).replace(/\n$/, ''))) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }
  return (
    <div className="not-prose overflow-hidden rounded-xl border border-line bg-code">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-xs text-ink-3">
        <span className="font-mono">{lang ?? 'text'}</span>
        <button
          onClick={onCopy}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-surface-2 hover:text-ink"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-6">{children}</pre>
    </div>
  )
}

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
}

const BR = /<br\s*\/?>/gi

/**
 * Models often write `<br>` to get a line break inside a table cell (Markdown tables cannot contain real newlines).
 * Raw HTML stays disabled (security), so without this the tag is printed literally. This converts only that tag into
 * a real line break node; every other piece of HTML is still shown as text and never executed.
 */
export function remarkBreakTags() {
  const walk = (node: MdNode) => {
    if (!node.children) return
    const out: MdNode[] = []
    for (const child of node.children) {
      if (child.type === 'html' && /^<br\s*\/?>$/i.test((child.value ?? '').trim())) {
        out.push({ type: 'break' })
      } else if (child.type === 'text' && child.value && BR.test(child.value)) {
        BR.lastIndex = 0
        child.value.split(BR).forEach((part, i, all) => {
          if (part) out.push({ type: 'text', value: part })
          if (i < all.length - 1) out.push({ type: 'break' })
        })
      } else {
        BR.lastIndex = 0
        walk(child)
        out.push(child)
      }
    }
    node.children = out
  }
  return (tree: MdNode) => walk(tree)
}

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="table-wrap">
      <table>{children}</table>
    </div>
  ),
}

/**
 * Renders AI output as Markdown. Raw HTML is NOT enabled (no rehype-raw), and
 * react-markdown's default URL transform strips javascript: and similar schemes.
 */
function MarkdownImpl({ content }: { content: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkBreakTags]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default memo(MarkdownImpl)
