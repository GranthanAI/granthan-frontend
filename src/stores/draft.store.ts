import { create } from 'zustand'

/** Unsent composer text per conversation (in memory: survives navigation, not reload). */
interface DraftState {
  drafts: Record<string, string>
  set: (key: string, text: string) => void
  clear: (key: string) => void
}

export const useDraftStore = create<DraftState>((set) => ({
  drafts: {},
  set: (key, text) => set((s) => ({ drafts: { ...s.drafts, [key]: text } })),
  clear: (key) =>
    set((s) => {
      const { [key]: _drop, ...rest } = s.drafts
      void _drop
      return { drafts: rest }
    }),
}))

export const NEW_CHAT_DRAFT = 'new'
