import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  LogOut,
  Monitor,
  Moon,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  SquarePen,
  Sun,
  X,
} from 'lucide-react'
import { ConversationTree, TreeSkeleton } from '@/components/conversation-tree/ConversationTree'
import { Menu } from '@/components/ui/overlays'
import { Alert, Button, EmptyState, Logo, Spinner } from '@/components/ui/primitives'
import { useDialogs } from '@/features/conversations/dialogs'
import { useTreeSource } from '@/features/conversations/hooks'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { authService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore, type Theme } from '@/stores/ui.store'

function initials(name?: string | null, email?: string) {
  const src = name?.trim() || email || '?'
  return src
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('')
}

export function Sidebar({ onNavigate, showClose }: { onNavigate?: () => void; showClose?: boolean }) {
  const { id: activeId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const { theme, setTheme, toggleSidebar } = useUiStore()
  const openDialog = useDialogs((s) => s.open)
  const { list, all } = useTreeSource(activeId)
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const matches = useMemo(
    () => (q ? all.filter((c) => c.title.toLowerCase().includes(q)) : []),
    [all, q],
  )

  // Infinite loading via a sentinel at the end of the list.
  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage()
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const logout = async () => {
    await authService.logout()
    qc.clear()
    navigate('/login', { replace: true })
  }

  const themeItems: { t: Theme; label: string; icon: React.ReactNode }[] = [
    { t: 'light', label: 'Light theme', icon: <Sun className="size-4" /> },
    { t: 'dark', label: 'Dark theme', icon: <Moon className="size-4" /> },
    { t: 'system', label: 'System theme', icon: <Monitor className="size-4" /> },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <Link to="/" onClick={onNavigate} className="rounded-lg px-1 py-1" aria-label="GranthanAI home">
          <Logo />
        </Link>
        {showClose ? (
          <Button variant="ghost" size="icon" onClick={onNavigate} aria-label="Close history">
            <X className="size-4" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="Collapse sidebar">
            <PanelLeftClose className="size-4" />
          </Button>
        )}
      </div>

      <div className="space-y-2 px-3 pb-2">
        <Button
          variant="secondary"
          className="w-full justify-start"
          onClick={() => {
            navigate('/')
            onNavigate?.()
          }}
        >
          <SquarePen className="size-4" /> New chat
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles"
            aria-label="Search loaded conversation titles"
            className="h-9 w-full rounded-lg border border-line bg-raised pl-8 pr-3 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
        </div>
      </div>

      <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {list.isPending ? (
          <TreeSkeleton />
        ) : list.isError ? (
          <div className="px-1 py-2">
            <Alert
              tone="error"
              action={
                <Button size="sm" variant="ghost" onClick={() => void list.refetch()}>
                  Retry
                </Button>
              }
            >
              {errorMessage(list.error)}
            </Alert>
          </div>
        ) : q ? (
          matches.length === 0 ? (
            <EmptyState icon={<Search className="size-5" />} title="No matching conversations">
              {hasNextPage
                ? 'Only loaded conversations are searched. Scroll or load more to include older ones.'
                : `Nothing matches "${query.trim()}".`}
            </EmptyState>
          ) : (
            <ul className="space-y-0.5" aria-label="Search results">
              {matches.map((c) => (
                <li key={c.conversation_id}>
                  <Link
                    to={`/c/${c.conversation_id}`}
                    onClick={onNavigate}
                    aria-current={c.conversation_id === activeId ? 'page' : undefined}
                    className={cn(
                      'block truncate rounded-lg px-3 py-2 text-sm hover:bg-surface-2',
                      c.conversation_id === activeId ? 'bg-accent-soft font-medium' : 'text-ink-2',
                    )}
                  >
                    {c.title}
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : all.length === 0 ? (
          <EmptyState icon={<Plus className="size-5" />} title="No conversations yet">
            Start a new chat and it will appear here.
          </EmptyState>
        ) : (
          <ConversationTree
            conversations={all}
            activeId={activeId}
            onNavigate={onNavigate}
            onRename={(c) => openDialog({ kind: 'rename', conversation: c })}
            onBranch={(c) => openDialog({ kind: 'branch', conversation: c })}
            onDelete={(c, n) => openDialog({ kind: 'delete', conversation: c, descendants: n })}
          />
        )}

        <div ref={sentinel} className="flex h-8 items-center justify-center">
          {isFetchingNextPage && <Spinner className="text-ink-3" />}
          {hasNextPage && !isFetchingNextPage && (
            <Button size="sm" variant="ghost" onClick={() => void fetchNextPage()}>
              Load more
            </Button>
          )}
        </div>
        {list.isFetchNextPageError && (
          <Alert tone="error" className="mx-1">
            Could not load more conversations.
          </Alert>
        )}
      </nav>

      <div className="border-t border-line p-2">
        <Menu
          label="Account menu"
          align="left"
          up
          className="w-full"
          trigger={({ props }) => (
            <button
              {...props}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-surface-2"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                {initials(user?.full_name, user?.email)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{user?.full_name || 'Account'}</span>
                <span className="block truncate text-xs text-ink-3">{user?.email}</span>
              </span>
            </button>
          )}
          items={[
            { label: 'Settings', icon: <Settings className="size-4" />, onSelect: () => { navigate('/settings'); onNavigate?.() } },
            'separator',
            ...themeItems.map((t) => ({
              label: `${t.label}${theme === t.t ? ' ✓' : ''}`,
              icon: t.icon,
              onSelect: () => setTheme(t.t),
            })),
            'separator',
            { label: 'Sign out', icon: <LogOut className="size-4" />, onSelect: () => void logout() },
          ]}
        />
      </div>
    </div>
  )
}
