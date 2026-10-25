import { createContext, isValidElement, memo, useContext } from 'react'
import type { ReactElement, ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { SourceBlock } from '@/features/source-edits/SourceBlock'

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node as ReactElement<{ children?: ReactNode }>).props.children)
  return ''
}

const ScopeCtx = createContext('0')

const pre = 'overflow-x-auto p-3 text-[13px] leading-6'

/**
 * Renders already-edited source through the SAME pipeline as the original answer (one highlighter, no second tokenizer):
 * the text becomes a fenced block that is longer than any backtick run inside it, so it can never close early.
 */
function renderHighlighted(code: string, info: string | undefined) {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((r) => r.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  const lang = /^[\w+#.-]{1,32}$/.test(info ?? '') ? info : ''
  return (
    <ReactMarkdown
      rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
      components={{ pre: ({ children }) => <pre className={pre}>{children}</pre> }}
    >
      {`${fence}${lang}\n${code}\n${fence}`}
    </ReactMarkdown>
  )
}

function CodeBlock({ children, node }: { children?: ReactNode; node?: { position?: { start?: { line?: number } } } }) {
  const scope = useContext(ScopeCtx)
  const code = isValidElement(children) ? (children as ReactElement<{ className?: string; children?: ReactNode }>) : null
  const lang = /language-([\w-]+)/.exec(code?.props.className ?? '')?.[1]
  const text = textOf(code?.props.children ?? children).replace(/\n$/, '')
  return (
    <SourceBlock
      code={text}
      info={lang}
      scope={scope}
      line={node?.position?.start?.line ?? 0}
      original={<pre className={pre}>{children}</pre>}
      renderHighlighted={renderHighlighted}
    />
  )
}

interface MdNode {
  type: string
  value?: string
  lang?: string | null
  children?: MdNode[]
}

const BR = /<br\s*\/?>/gi

/**
 * Models also put a whole snippet inside ONE inline `code span` and use `<br>` for its lines (typical in table cells, where
 * a real fenced block is impossible). Shown as-is that is an unreadable single line full of literal tags, so it becomes a
 * real code block: `<br>` → newline, and a leading bare language word ("ts<br>...") becomes the block's language.
 */
function brCodeToBlock(raw: string): MdNode {
  const lines = raw.split(/<br\s*\/?>/i)
  while (lines.length && !(lines[lines.length - 1] ?? '').trim()) lines.pop()
  let lang: string | null = null
  if (lines.length > 1 && /^[A-Za-z][\w+#-]{0,14}$/.test((lines[0] ?? '').trim())) lang = (lines.shift() ?? '').trim().toLowerCase()
  return { type: 'code', lang, value: lines.join('\n') }
}

/** Converts `<br>` tags (see above) into line breaks; inline code spans that use them become code blocks. */
export function remarkBreakTags() {
  const walk = (node: MdNode) => {
    if (!node.children) return
    const out: MdNode[] = []
    for (const child of node.children) {
      if (child.type === 'inlineCode' && child.value && /<br\s*\/?>/i.test(child.value)) {
        out.push(brCodeToBlock(child.value))
      } else if (child.type === 'html' && /^<br\s*\/?>$/i.test((child.value ?? '').trim())) {
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
  pre: ({ children, node }) => <CodeBlock node={node}>{children}</CodeBlock>,
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
function MarkdownImpl({ content, scope = '0' }: { content: string; scope?: string }) {
  return (
    <ScopeCtx.Provider value={scope}>
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkBreakTags]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
    </ScopeCtx.Provider>
  )
}

export default memo(MarkdownImpl)
