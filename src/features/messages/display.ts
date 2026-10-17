import type { ApiMessage, Citation } from '@/types/api'
import type { ConversationRun } from '@/stores/chat.store'

export type DisplayStatus =
  | 'sent' // persisted and final
  | 'sending' // user message being submitted
  | 'send_failed' // user message could not be submitted
  | 'connecting' // assistant: opening stream / waiting for first token
  | 'streaming' // assistant: receiving chunks
  | 'pending' // assistant: server says generating, no local stream attached
  | 'failed' // assistant: generation failed

export interface DisplayMessage {
  key: string
  id: string | null
  sender: 'user' | 'assistant' | 'system'
  content: string
  status: DisplayStatus
  error?: string
  citations: Citation[]
  fileIds: string[]
  createdAt: string | null
  /** True for rows that exist only in the local overlay (not yet persisted history). */
  local: boolean
}

const asSender = (s: string): DisplayMessage['sender'] =>
  s === 'user' || s === 'system' ? s : 'assistant'

/**
 * Merges persisted history (single source of truth) with the transient streaming overlay.
 * An overlay row is dropped as soon as persisted data contains the same message id and is
 * no longer pending, so no message is ever shown twice.
 */
export function buildDisplay(
  server: ApiMessage[],
  run: ConversationRun | undefined,
  citations: Record<string, Citation[]>,
): DisplayMessage[] {
  const live = run?.assistant ?? null
  const pendingUser = run?.pendingUser ?? null
  const out: DisplayMessage[] = []
  const seen = new Set<string>()

  for (const m of server) {
    if (live?.replaces && m.message_id === live.replaces) continue
    seen.add(m.message_id)
    const sender = asSender(m.sender)
    const isLive = live && live.messageId === m.message_id
    let status: DisplayStatus = 'sent'
    let content = m.content
    let error: string | undefined
    if (sender === 'assistant') {
      if (isLive && (live.phase === 'streaming' || live.phase === 'waiting' || live.phase === 'connecting')) {
        status = live.phase === 'streaming' ? 'streaming' : 'connecting'
        content = live.text
      } else if (isLive && live.phase === 'failed') {
        status = 'failed'
        content = live.text
        error = live.error
      } else if (m.status === 'pending') {
        status = 'pending'
      } else if (m.status === 'failed') {
        status = 'failed'
        error = m.content
      }
    }
    out.push({
      key: m.message_id,
      id: m.message_id,
      sender,
      content,
      status,
      error,
      citations: citations[m.message_id] ?? [],
      fileIds: m.file_ids ?? [],
      createdAt: m.created_at,
      local: false,
    })
  }

  if (pendingUser && !(pendingUser.messageId && seen.has(pendingUser.messageId))) {
    out.push({
      key: `user:${pendingUser.tempId}`,
      id: pendingUser.messageId,
      sender: 'user',
      content: pendingUser.content,
      status: pendingUser.status === 'failed' ? 'send_failed' : pendingUser.status === 'sending' ? 'sending' : 'sent',
      error: pendingUser.error,
      citations: [],
      fileIds: pendingUser.fileIds,
      createdAt: null,
      local: true,
    })
  }

  if (live && !(live.messageId && seen.has(live.messageId))) {
    const status: DisplayStatus =
      live.phase === 'failed'
        ? 'failed'
        : live.phase === 'streaming'
          ? 'streaming'
          : live.phase === 'completed'
            ? 'sent'
            : 'connecting'
    out.push({
      key: live.messageId ? `a:${live.messageId}` : 'a:live',
      id: live.messageId,
      sender: 'assistant',
      content: live.text,
      status,
      error: live.error,
      citations: live.messageId ? (citations[live.messageId] ?? []) : [],
      fileIds: [],
      createdAt: null,
      local: true,
    })
  }
  return out
}
