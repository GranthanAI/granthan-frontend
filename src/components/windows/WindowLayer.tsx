import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExternalLink, MessageSquare, Network } from 'lucide-react'
import { Spinner } from '@/components/ui/primitives'
import { ConversationView } from '@/pages/ChatPages'
import { useConversation } from '@/features/conversations/hooks'
import { useFamily } from '@/features/conversations/useFamily'
import { truncate } from '@/lib/utils'
import { useWindowsStore, type FloatingWin } from '@/stores/windows.store'
import { FloatingWindow, WinButton } from './FloatingWindow'
import { HierarchyGraph } from './HierarchyGraph'

/** Renders every open floating window above the app. The layer itself never blocks clicks. */
export function WindowLayer() {
  const windows = useWindowsStore((s) => s.windows)
  const closeAll = useWindowsStore((s) => s.closeAll)
  // Windows belong to a signed-in session.
  useEffect(() => closeAll, [closeAll])

  return (
    <div className="pointer-events-none fixed inset-0 z-30" aria-live="off">
      {windows.map((w) => (w.kind === 'hierarchy' ? <HierarchyWindow key={w.key} win={w} /> : <ChatWindow key={w.key} win={w} />))}
    </div>
  )
}

function HierarchyWindow({ win }: { win: FloatingWin }) {
  const open = useWindowsStore((s) => s.open)
  const windows = useWindowsStore((s) => s.windows)
  const family = useFamily(win.conversationId)
  const openIds = useMemo(
    () => new Set(windows.filter((w) => w.kind === 'chat').map((w) => w.conversationId)),
    [windows],
  )

  return (
    <FloatingWindow win={win} title="Chat hierarchy" icon={<Network className="size-3.5" />}>
      {family.root ? (
        <>
          <HierarchyGraph root={family.root} currentId={win.conversationId} openIds={openIds} onOpen={(id) => open('chat', id)} />
          <p className="shrink-0 border-t border-line px-3 py-1 text-[11px] text-ink-3">
            Click a node to open that conversation in its own window.{family.loadingMore ? ' Loading more…' : ''}
          </p>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-ink-2">
          {family.isPending ? <Spinner /> : 'This conversation could not be placed in a hierarchy yet.'}
        </div>
      )}
    </FloatingWindow>
  )
}

function ChatWindow({ win }: { win: FloatingWin }) {
  const navigate = useNavigate()
  const open = useWindowsStore((s) => s.open)
  const conv = useConversation(win.conversationId)
  const title = conv.data?.title ? truncate(conv.data.title, 60) : conv.isPending ? 'Loading…' : 'Conversation'

  return (
    <FloatingWindow
      win={win}
      title={title}
      icon={<MessageSquare className="size-3.5" />}
      actions={
        <>
          <WinButton label="Chat hierarchy" onClick={() => open('hierarchy', win.conversationId, { follow: false })}>
            <Network className="size-3.5" />
          </WinButton>
          <WinButton label="Open in main view" onClick={() => navigate(`/c/${win.conversationId}`)}>
            <ExternalLink className="size-3.5" />
          </WinButton>
        </>
      }
    >
      <ConversationView id={win.conversationId} embedded />
    </FloatingWindow>
  )
}
