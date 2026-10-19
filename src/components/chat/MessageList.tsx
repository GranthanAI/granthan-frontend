import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import { Button, Spinner } from '@/components/ui/primitives'
import type { DisplayMessage } from '@/features/messages/display'
import { MessageItem } from './MessageItem'

interface Props {
  messages: DisplayMessage[]
  conversationId: string
  hasOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  canRegenerate: boolean
  onRegenerate: (id: string) => void
  onContinue?: () => void
  onRetrySend: () => void
  onDismissSend: () => void
  /** Announced to assistive tech without reading every streamed token. */
  statusText: string
}

const NEAR_BOTTOM_PX = 140

export function MessageList({
  messages,
  conversationId,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  canRegenerate,
  onRegenerate,
  onContinue,
  onRetrySend,
  onDismissSend,
  statusText,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const prevHeight = useRef<number | null>(null)
  const topSentinel = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scroller.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // New conversation: jump to the end.
  useLayoutEffect(() => {
    stick.current = true
    scrollToBottom()
  }, [conversationId, scrollToBottom])

  const last = messages[messages.length - 1]
  const tail = `${messages.length}:${last?.content.length ?? 0}:${last?.status}`
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (prevHeight.current !== null) {
      // Older messages were prepended: keep the viewport anchored.
      el.scrollTop += el.scrollHeight - prevHeight.current
      prevHeight.current = null
      return
    }
    if (stick.current) scrollToBottom()
  }, [tail, scrollToBottom])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    stick.current = near
    setShowJump(!near)
  }

  const loadOlder = useCallback(() => {
    if (!hasOlder || loadingOlder) return
    prevHeight.current = scroller.current?.scrollHeight ?? null
    onLoadOlder()
  }, [hasOlder, loadingOlder, onLoadOlder])

  useEffect(() => {
    const el = topSentinel.current
    if (!el || !hasOlder) return
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && loadOlder(), {
      root: scroller.current,
      rootMargin: '120px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [hasOlder, loadOlder])

  const lastAssistantIdx = messages.map((m) => m.sender).lastIndexOf('assistant')

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} data-chat-messages onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain" tabIndex={-1}>
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
          <div ref={topSentinel} className="flex h-6 items-center justify-center">
            {loadingOlder ? (
              <Spinner className="text-ink-3" />
            ) : hasOlder ? (
              <Button size="sm" variant="ghost" onClick={loadOlder}>
                Load earlier messages
              </Button>
            ) : null}
          </div>
          {messages.map((m, i) => (
            <MessageItem
              key={m.key}
              message={m}
              isLastAssistant={i === lastAssistantIdx}
              canRegenerate={canRegenerate}
              onRegenerate={onRegenerate}
              onContinue={onContinue}
              onRetrySend={onRetrySend}
              onDismissSend={onDismissSend}
            />
          ))}
        </div>
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {statusText}
      </div>
      {showJump && (
        <Button
          variant="secondary"
          size="icon"
          onClick={() => {
            stick.current = true
            scrollToBottom(true)
          }}
          aria-label="Jump to latest message"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-pop"
        >
          <ArrowDown className="size-4" />
        </Button>
      )}
    </div>
  )
}
