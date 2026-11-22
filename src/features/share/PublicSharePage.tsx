import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { SHARE_COPY } from '@/content/quickwins'
import { ApiError } from '@/lib/errors'
import { qk } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { shareService } from '@/services/quickwins.service'
import type { SharedConversation, SharedSnapshot } from '@/types/api'

const Markdown = lazy(() => import('@/components/chat/Markdown'))

/** Manim blocks are replaced by a placeholder (the snapshot has no animation); everything else (Mermaid included) is real Markdown. */
export const hideManim = (content: string) => content.replace(/```manim[\s\S]*?```/g, `> ${SHARE_COPY.manim}`)

export function errorCopy(e: unknown): string {
  if (e instanceof ApiError && e.status === 429) return SHARE_COPY.tooMany
  return SHARE_COPY.notFound
}

/** The conversations of a snapshot that belong to one branch of the tree view: the chosen branch with its inherited ancestors. */
export function chainFor(snapshot: SharedSnapshot, id: string): { inherited: SharedConversation[]; own: SharedConversation | null } {
  const byId = new Map(snapshot.conversations.map((c) => [c.id, c]))
  const own = byId.get(id) ?? null
  const inherited: SharedConversation[] = []
  let cur = own?.parent ? byId.get(own.parent) : undefined
  while (cur && inherited.length < 50) {
    inherited.unshift(cur)
    cur = cur.parent ? byId.get(cur.parent) : undefined
  }
  return { inherited, own }
}

function Thread({ messages, muted }: { messages: SharedConversation['messages']; muted?: boolean }) {
  return (
    <div className={cn('space-y-5', muted && 'opacity-60')}>
      {messages.map((m, i) => (
        <div key={i} className={cn(m.sender === 'user' && 'flex justify-end')}>
          {m.sender === 'user' ? (
            <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface-2 px-4 py-2.5 text-[0.9375rem] [overflow-wrap:anywhere]">{m.content}</div>
          ) : (
            <div className="font-response">
              <Suspense fallback={<p className="whitespace-pre-wrap">{m.content}</p>}>
                <Markdown content={hideManim(m.content)} />
              </Suspense>
              {m.citations.length > 0 && (
                <p className="mt-2 text-xs text-ink-3">
                  {m.citations.map((c) => `${c.title}${c.page != null ? ` · page ${c.page}` : ''}`).join(' · ')}
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** /s/:token: a public, read-only snapshot. No auth guard and no app shell; the request carries no Authorization header. */
export function PublicSharePage() {
  const { token = '' } = useParams()
  const q = useQuery({
    queryKey: qk.sharePublic(token),
    queryFn: ({ signal }) => shareService.readPublic(token, signal),
    retry: false,
    staleTime: 60_000,
  })
  const [branch, setBranch] = useState<string | null>(null)

  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => void meta.remove()
  }, [])

  const snap = q.data
  const own = useMemo(() => snap?.conversations.filter((c) => !c.inherited) ?? [], [snap])
  const selected = branch ?? own[0]?.id ?? null
  const view = snap && selected ? chainFor(snap, selected) : null

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="flex h-12 items-center justify-between border-b border-line px-4">
        <span className="text-sm font-semibold">GranthanAI</span>
        <Link to="/signup" className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-sm font-medium text-accent-ink">
          {SHARE_COPY.tryIt}
        </Link>
      </header>
      {q.isPending ? (
        <p className="p-8 text-center text-sm text-ink-2" role="status">Loading…</p>
      ) : q.isError || !snap ? (
        <p role="alert" className="p-8 text-center text-sm text-ink-2">{errorCopy(q.error)}</p>
      ) : (
        <div className="mx-auto flex w-full max-w-5xl gap-6 px-4 py-6">
          {snap.scope === 'hierarchy' && own.length > 1 && (
            <nav aria-label={SHARE_COPY.branches} className="w-48 shrink-0">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">{SHARE_COPY.branches}</p>
              <ul className="space-y-0.5">
                {own.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => setBranch(c.id)}
                      aria-current={c.id === selected}
                      className={cn('w-full truncate rounded-lg px-3 py-2 text-left text-sm', c.id === selected ? 'bg-accent-soft font-medium' : 'text-ink-2 hover:bg-surface-2')}
                      style={{ paddingLeft: `${0.75 + depthOf(snap, c.id) * 0.75}rem` }}
                    >
                      {c.title}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <main className="min-w-0 flex-1">
            <h1 className="mb-5 text-xl font-semibold">{snap.title}</h1>
            {view && view.inherited.length > 0 && (
              <section aria-label={SHARE_COPY.earlier} className="mb-6 border-l-2 border-line pl-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">{SHARE_COPY.earlier}</p>
                {view.inherited.map((c) => (
                  <Thread key={c.id} messages={c.messages} muted />
                ))}
              </section>
            )}
            {view?.own && <Thread messages={view.own.messages} />}
          </main>
        </div>
      )}
    </div>
  )
}

function depthOf(snap: SharedSnapshot, id: string): number {
  const byId = new Map(snap.conversations.map((c) => [c.id, c]))
  let d = 0
  let cur = byId.get(id)
  while (cur?.parent && d < 20) {
    d++
    cur = byId.get(cur.parent)
  }
  return d
}
