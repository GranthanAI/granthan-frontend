import { useEffect, useMemo, useRef } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Code2, FileSearch, GitBranch, Lightbulb } from 'lucide-react'
import { Composer } from '@/components/chat/Composer'
import { SelectionActions } from '@/components/chat/SelectionActions'
import { useSelectionBranch } from '@/features/conversations/useSelectionBranch'
import { MessageList } from '@/components/chat/MessageList'
import { Alert, Button, Logo, Skeleton } from '@/components/ui/primitives'
import { toast } from '@/components/ui/overlays'
import { useConversation, useCreateConversation } from '@/features/conversations/hooks'
import {
  dismissPending,
  regenerate,
  retryPending,
  sendMessage,
  watchPending,
} from '@/features/messages/chat-controller'
import { buildDisplay } from '@/features/messages/display'
import { useMessages } from '@/features/messages/hooks'
import { documentIdsFromHistory } from '@/features/uploads/useDocumentContext'
import { ApiError, errorMessage } from '@/lib/errors'
import { truncate } from '@/lib/utils'
import { EMPTY_RUN, isBusy, useChatStore } from '@/stores/chat.store'
import { NEW_CHAT_DRAFT } from '@/stores/draft.store'
import { adoptNewChatMode } from '@/features/tools/useTools'
import { useBranchContext } from '@/features/conversations/useBranchContext'

const EXAMPLES = [
  { icon: <Lightbulb className="size-4" />, text: 'Explain how Kafka partitions relate to consumer groups' },
  { icon: <Code2 className="size-4" />, text: 'Write a Python function that merges overlapping intervals' },
  { icon: <FileSearch className="size-4" />, text: 'Summarise the key points of a PDF I attach' },
  { icon: <GitBranch className="size-4" />, text: 'Compare two approaches to caching, then I will branch to explore each' },
]

export function NewChatPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const create = useCreateConversation()

  const onSend = async (text: string, fileIds: string[], toolIds: string[] | undefined, mode: string | undefined) => {
    if (create.isPending) return false
    try {
      const c = await create.mutateAsync({ title: truncate(text, 60) })
      adoptNewChatMode(NEW_CHAT_DRAFT, c.conversation_id)
      sendMessage(qc, c.conversation_id, text, fileIds, toolIds, { mode })
      navigate(`/c/${c.conversation_id}`)
      return true
    } catch (e) {
      toast(errorMessage(e), 'error')
      return false // draft is preserved
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8">
        <Logo withName={false} className="[&_svg]:size-12" />
        <h2 className="mt-5 text-2xl font-semibold tracking-tight">What are we exploring today?</h2>
        <p className="mt-2 max-w-md text-center text-sm text-ink-2">
          Ask anything, attach documents, and branch any conversation to explore different paths without losing the original.
        </p>
        <ul className="mt-8 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
          {EXAMPLES.map((ex) => (
            <li key={ex.text}>
              <button
                disabled={create.isPending}
                onClick={() => void onSend(ex.text, [], undefined, undefined)}
                className="flex h-full w-full items-start gap-2.5 rounded-xl border border-line bg-raised p-3.5 text-left text-sm text-ink-2 transition-colors hover:border-accent/50 hover:bg-surface disabled:opacity-60"
              >
                <span className="mt-0.5 text-accent">{ex.icon}</span>
                {ex.text}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <Composer
        conversationId={null}
        draftKey={NEW_CHAT_DRAFT}
        busy={create.isPending}
        autoFocus
        onSend={onSend}
      />
    </div>
  )
}

export function ConversationPage() {
  const { id } = useParams()
  if (!id) return null
  return <ConversationView key={id} id={id} />
}

/** `embedded` renders the chat inside a floating window: no text-selection toolbar, no autofocus. */
export function ConversationView({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const qc = useQueryClient()
  const conv = useConversation(id)
  const msgs = useMessages(id)
  const run = useChatStore((s) => s.runs[id] ?? EMPTY_RUN)
  const citations = useChatStore((s) => s.citations)
  const busy = isBusy(run)
  const selection = useSelectionBranch(id)
  const inherited = useBranchContext(id)
  // This conversation's own documents first, then those inherited from its ancestors (no duplicates).
  const contextDocumentIds = useMemo(
    () => [...new Set([...documentIdsFromHistory(msgs.messages), ...inherited.documents.map((d) => d.document_id)])],
    [msgs.messages, inherited.documents],
  )

  const display = useMemo(() => buildDisplay(msgs.messages, run, citations), [msgs.messages, run, citations])

  // Attach to an assistant reply that is still generating on the server (e.g. after reload).
  const attempted = useRef(new Set<string>())
  useEffect(() => {
    if (run.assistant) return
    const pending = [...msgs.messages]
      .reverse()
      .find((m) => m.sender === 'assistant' && m.status === 'pending')
    if (pending && !attempted.current.has(pending.message_id)) {
      attempted.current.add(pending.message_id)
      watchPending(qc, id, pending.message_id)
    }
  }, [msgs.messages, run.assistant, qc, id])

  if (conv.isError) {
    const kind = conv.error instanceof ApiError ? conv.error.kind : 'unknown'
    const missing = kind === 'not_found' || kind === 'forbidden'
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <h2 className="text-lg font-semibold">
          {missing ? 'Conversation not found' : 'Could not load this conversation'}
        </h2>
        <p className="max-w-sm text-sm text-ink-2">
          {missing
            ? 'It may have been deleted, or it belongs to a different account.'
            : errorMessage(conv.error)}
        </p>
        <div className="flex gap-2">
          {!missing && <Button onClick={() => void conv.refetch()}>Try again</Button>}
          <Link to="/" className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink">
            Start a new chat
          </Link>
        </div>
      </div>
    )
  }

  const statusText =
    run.assistant?.phase === 'streaming'
      ? 'Assistant is responding'
      : run.assistant?.phase === 'completed'
        ? 'Response complete'
        : run.assistant?.phase === 'failed'
          ? 'Response failed'
          : ''

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {msgs.isPending ? (
        <div className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8" aria-busy aria-label="Loading messages">
          <Skeleton className="ml-auto h-10 w-2/5" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="ml-auto h-10 w-1/3" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : msgs.isError && display.length === 0 ? (
        <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
          <Alert tone="error" action={<Button size="sm" variant="ghost" onClick={() => void msgs.refetch()}>Retry</Button>}>
            Could not load messages. {errorMessage(msgs.error)}
          </Alert>
        </div>
      ) : display.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <h2 className="text-lg font-semibold">{conv.data?.title ?? 'New conversation'}</h2>
          <p className="mt-1 text-sm text-ink-2">
            {conv.data?.parent_conversation_id
              ? 'This branch starts with an empty context. Ask your first question below.'
              : 'No messages yet. Send the first one below.'}
          </p>
        </div>
      ) : (
        <MessageList
          messages={display}
          conversationId={id}
          hasOlder={!!msgs.hasNextPage}
          loadingOlder={msgs.isFetchingNextPage}
          onLoadOlder={() => void msgs.fetchNextPage()}
          canRegenerate={!busy}
          onRegenerate={(mid) => {
            if (!regenerate(qc, id, mid)) toast('Please wait for the current response to finish.', 'info')
          }}
          onRetrySend={() => retryPending(qc, id)}
          onDismissSend={() => dismissPending(id)}
          statusText={statusText}
        />
      )}
      {msgs.isError && display.length > 0 && (
        <div className="mx-auto w-full max-w-3xl px-4 pb-2">
          <Alert tone="warn">Could not refresh messages. Showing what was loaded. {errorMessage(msgs.error)}</Alert>
        </div>
      )}
      {!embedded && <SelectionActions onNewBranch={(t) => void selection.newBranch(t)} onThisBranch={selection.thisBranch} pending={selection.pending} />}
      <Composer
        conversationId={id}
        draftKey={id}
        busy={busy}
        autoFocus={!embedded}
        inputId={embedded ? `composer-input-${id}` : undefined}
        contextDocumentIds={contextDocumentIds}
        inheritedFrom={inherited.sources}
        onSend={(text, fileIds, toolIds, mode) => sendMessage(qc, id, text, fileIds, toolIds, { mode })}
      />
    </div>
  )
}
