import { create } from 'zustand'

/** Excerpt waiting to be sent with the next prompt, per composer (conversation id). In memory only. */
interface QuoteState {
  byKey: Record<string, string>
  set: (key: string, text: string) => void
  clear: (key: string) => void
}

export const useQuoteStore = create<QuoteState>((set) => ({
  byKey: {},
  set: (key, text) => set((s) => ({ byKey: { ...s.byKey, [key]: text } })),
  clear: (key) =>
    set((s) => {
      const { [key]: _drop, ...rest } = s.byKey
      void _drop
      return { byKey: rest }
    }),
}))
