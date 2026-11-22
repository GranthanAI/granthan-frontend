import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Local, per-browser voice settings: nothing here goes to the server. */
interface VoiceState {
  /** Dictation language chosen on the mic button (null = follow preferences.language). */
  dictationLang: string | null
  setDictationLang: (tag: string | null) => void
  /** The one-time "processed by your browser's speech service" tooltip was shown. */
  micNoticeSeen: boolean
  markMicNoticeSeen: () => void
  /** Read-aloud speed (0.75, 1, 1.25, 1.5) and the chosen voice (voiceURI; null = pick by language). */
  speed: number
  setSpeed: (n: number) => void
  voiceURI: string | null
  setVoiceURI: (uri: string | null) => void
}

export const useVoiceStore = create<VoiceState>()(
  persist(
    (set) => ({
      dictationLang: null,
      setDictationLang: (dictationLang) => set({ dictationLang }),
      micNoticeSeen: false,
      markMicNoticeSeen: () => set({ micNoticeSeen: true }),
      speed: 1,
      setSpeed: (speed) => set({ speed }),
      voiceURI: null,
      setVoiceURI: (voiceURI) => set({ voiceURI }),
    }),
    { name: 'granthan-voice' },
  ),
)

export const READ_SPEEDS = [0.75, 1, 1.25, 1.5] as const
