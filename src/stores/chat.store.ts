import { create } from 'zustand'
import type { Citation } from '@/types/api'

/** A user message that has been submitted but not yet reconciled with persisted history. */
export interface PendingUser {
  tempId: string
  content: string
  fileIds: string[]
  /** Tool ids chosen for this message (undefined = saved defaults apply); kept so a retry sends
   * exactly the same request. */
  toolIds?: string[]
  /** Response mode chosen for this message (null = Auto); kept for retry. */
  mode: string | null
  idempotencyKey: string
  /** Server id once the POST was acknowledged. */
  messageId: string | null
  status: 'sending' | 'sent' | 'failed'
  error?: string
  createdAt: number
}

export type AssistantPhase = 'connecting' | 'waiting' | 'streaming' | 'completed' | 'failed'

/** The in-flight (or just-finished, not yet reconciled) assistant reply. */
export interface LiveAssistant {
  messageId: string | null
  text: string
  phase: AssistantPhase
  error?: string
  /** Assistant message that this reply supersedes (regenerate). */
  replaces?: string
}

export interface ConversationRun {
  pendingUser: PendingUser | null
  assistant: LiveAssistant | null
}

interface ChatState {
  runs: Record<string, ConversationRun>
  /** Retrieval sources, keyed by assistant message id. Not persisted by the backend. */
  citations: Record<string, Citation[]>
  patch: (cid: string, fn: (r: ConversationRun) => ConversationRun) => void
  clearRun: (cid: string) => void
  setCitations: (messageId: string, c: Citation[]) => void
}

const empty: ConversationRun = { pendingUser: null, assistant: null }

export const useChatStore = create<ChatState>((set) => ({
  runs: {},
  citations: {},
  patch: (cid, fn) =>
    set((s) => ({ runs: { ...s.runs, [cid]: fn(s.runs[cid] ?? empty) } })),
  clearRun: (cid) =>
    set((s) => {
      const { [cid]: _drop, ...rest } = s.runs
      void _drop
      return { runs: rest }
    }),
  setCitations: (messageId, c) =>
    set((s) => ({ citations: { ...s.citations, [messageId]: c } })),
}))

export const EMPTY_RUN = empty

/** True while a turn is being submitted or streamed. */
export function isBusy(run: ConversationRun | undefined): boolean {
  if (!run) return false
  if (run.pendingUser?.status === 'sending') return true
  const p = run.assistant?.phase
  return p === 'connecting' || p === 'waiting' || p === 'streaming'
}
