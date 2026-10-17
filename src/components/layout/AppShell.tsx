import { useEffect } from 'react'
import { Outlet, useLocation, useParams } from 'react-router-dom'
import { GitBranch, Menu as MenuIcon, PanelLeftOpen, PanelRight } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { Toaster } from '@/components/ui/overlays'
import { ConversationDialogs, useDialogs } from '@/features/conversations/dialogs'
import { useConversation } from '@/features/conversations/hooks'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui.store'
import { ContextPanel } from './ContextPanel'
import { Sidebar } from './Sidebar'

export function AppShell() {
  const { id } = useParams()
  const location = useLocation()
  const conv = useConversation(id)
  const { sidebarCollapsed, toggleSidebar, mobileSidebarOpen, setMobileSidebar, panelOpen, openPanel, closePanel } =
    useUiStore()
  const openDialog = useDialogs((s) => s.open)

  // Close transient surfaces on navigation.
  useEffect(() => {
    setMobileSidebar(false)
  }, [location.pathname, setMobileSidebar])

  useEffect(() => {
    if (!mobileSidebarOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileSidebar(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileSidebarOpen, setMobileSidebar])

  const conversation = id ? conv.data : undefined
  const title = !id ? 'New chat' : conv.isPending ? 'Loading…' : (conv.data?.title ?? 'Conversation')
  const isSettings = location.pathname.startsWith('/settings')

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-raised focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <div
        className={cn(
          'hidden shrink-0 overflow-hidden border-r border-line transition-[width] duration-200 md:block',
          sidebarCollapsed ? 'w-0 border-r-0' : 'w-72',
        )}
      >
        <div className="h-full w-72">
          <Sidebar />
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileSidebar(false)} aria-hidden />
          <div role="dialog" aria-modal="true" aria-label="Conversation history" className="animate-in absolute inset-y-0 left-0 w-[min(20rem,88vw)] border-r border-line shadow-pop">
            <Sidebar showClose onNavigate={() => setMobileSidebar(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-2">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileSidebar(true)} aria-label="Open conversation history">
              <MenuIcon className="size-5" />
            </Button>
            {sidebarCollapsed && (
              <Button variant="ghost" size="icon" className="hidden md:inline-flex" onClick={toggleSidebar} aria-label="Expand sidebar">
                <PanelLeftOpen className="size-4" />
              </Button>
            )}
            <h1 className="min-w-0 flex-1 truncate px-2 text-sm font-medium">{isSettings ? 'Settings' : title}</h1>
            {conversation && (
              <Button variant="ghost" size="sm" onClick={() => openDialog({ kind: 'branch', conversation })} title="Start a linked conversation">
                <GitBranch className="size-4" /> <span className="max-sm:hidden">Branch</span>
              </Button>
            )}
            {!isSettings && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => (panelOpen ? closePanel() : openPanel())}
                aria-label={panelOpen ? 'Close context panel' : 'Open context panel'}
                aria-pressed={panelOpen}
              >
                <PanelRight className="size-4" />
              </Button>
            )}
          </header>
          <main id="main" className="flex min-h-0 flex-1 flex-col" tabIndex={-1}>
            <Outlet />
          </main>
        </div>

        {panelOpen && !isSettings && (
          <>
            <div className="hidden w-80 shrink-0 border-l border-line xl:block">
              <ContextPanel conversation={conversation} />
            </div>
            <div className="fixed inset-0 z-30 xl:hidden">
              <div className="absolute inset-0 bg-black/40" onClick={closePanel} aria-hidden />
              <div className="animate-in absolute inset-y-0 right-0 w-[min(24rem,92vw)] border-l border-line shadow-pop">
                <ContextPanel conversation={conversation} />
              </div>
            </div>
          </>
        )}
      </div>

      <ConversationDialogs />
      <Toaster />
    </div>
  )
}
