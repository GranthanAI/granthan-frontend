import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { Mic, Square, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { Menu } from '@/components/ui/overlays'
import { VOICE_COPY } from '@/content/quickwins'
import { usePreferences } from '@/features/preferences/usePreferences'
import { cn } from '@/lib/utils'
import { useDraftStore } from '@/stores/draft.store'
import { DICTATION_LANGS, speechLang } from './languages'
import { speechSupported, useSpeech } from './readAloud'
import { dictationSupported, insertAtCursor, useDictation } from './useDictation'
import { useVoiceStore } from './voice.store'

/** The language dictation and read-aloud use: the one chosen on the mic menu, else the saved answer language. */
export function useSpeechLang(): string {
  const chosen = useVoiceStore((s) => s.dictationLang)
  const language = usePreferences().data?.language
  return chosen ?? speechLang(language)
}

/** Stops any reading when the route changes (mounted once in the app shell). */
export function useStopSpeechOnRoute() {
  const { pathname } = useLocation()
  useEffect(() => () => useSpeech.getState().stop(), [pathname])
}

/** Mic button for the composer. Hidden when the browser has no speech recognition. */
export function MicButton(props: MicProps) {
  return dictationSupported() ? <Mic_ {...props} /> : null
}

interface MicProps {
  draftKey: string
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  busy: boolean
  stopSignal: number
}

function Mic_({ draftKey, textareaRef, busy, stopSignal }: MicProps) {
  const lang = useSpeechLang()
  const setDraft = useDraftStore((s) => s.set)
  const lastCursor = useRef<number | null>(null)
  const noticeSeen = useVoiceStore((s) => s.micNoticeSeen)
  const markSeen = useVoiceStore((s) => s.markMicNoticeSeen)
  const setLang = useVoiceStore((s) => s.setDictationLang)

  const d = useDictation(lang, (text) => {
    const draft = useDraftStore.getState().drafts[draftKey] ?? ''
    const cursor = lastCursor.current ?? textareaRef.current?.selectionStart ?? draft.length
    const next = insertAtCursor(draft, cursor, text)
    lastCursor.current = next.cursor
    setDraft(draftKey, next.value)
  })

  // Stops on send (stopSignal changes) and on unmount (the composer is unmounted by a route change).
  const { stop } = d
  useEffect(() => stop(), [stopSignal, stop])
  if (!d.supported) return null

  const toggle = () => {
    if (d.listening) return d.stop()
    lastCursor.current = textareaRef.current?.selectionStart ?? null
    if (!noticeSeen) markSeen()
    d.start()
  }

  return (
    <>
      <span className="relative inline-flex">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          disabled={busy && !d.listening}
          aria-label={d.listening ? VOICE_COPY.stop : VOICE_COPY.mic}
          aria-pressed={d.listening}
          title={noticeSeen ? (d.listening ? VOICE_COPY.stop : VOICE_COPY.mic) : VOICE_COPY.firstUse}
        >
          {d.listening ? <Square className="size-4 text-danger" /> : <Mic className="size-4" />}
        </Button>
        {d.listening && <span className="absolute right-1 top-1 size-2 animate-pulse rounded-full bg-danger" aria-hidden data-testid="mic-dot" />}
      </span>
      <Menu
        label={VOICE_COPY.language}
        items={DICTATION_LANGS.map((l) => ({ label: l.label, hint: l.tag === lang ? '✓' : undefined, onSelect: () => setLang(l.tag) }))}
        trigger={({ props }) => (
          <button type="button" {...props} className="rounded px-1 text-xs text-ink-3 hover:text-ink" aria-label={`${VOICE_COPY.language}: ${lang}`}>
            {lang}
          </button>
        )}
      />
      {d.listening && (
        <span role="status" className="text-xs text-ink-3">
          {VOICE_COPY.listening}
        </span>
      )}
      {!noticeSeen && !d.listening && <span className="sr-only">{VOICE_COPY.firstUse}</span>}
      {d.error && (
        <span role="alert" className="text-xs text-danger">
          {d.error}
        </span>
      )}
      {d.interim && (
        <span className={cn('max-w-[40ch] truncate text-xs italic text-ink-3')} data-testid="interim" aria-hidden>
          {d.interim}
        </span>
      )}
    </>
  )
}

/** Speaker button on a sent answer: Play / Stop. Hidden when speechSynthesis is missing. */
export function SpeakButton(props: { messageKey: string; content: string }) {
  return speechSupported() ? <Speak_ {...props} /> : null
}

function Speak_({ messageKey, content }: { messageKey: string; content: string }) {
  const lang = useSpeechLang()
  const speaking = useSpeech((s) => s.speaking === messageKey)
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void useSpeech.getState().speak(messageKey, content, lang)}
      aria-label={speaking ? VOICE_COPY.stopSpeak : VOICE_COPY.speak}
      aria-pressed={speaking}
    >
      {speaking ? <Square className="size-3.5" /> : <Volume2 className="size-3.5" />}
    </Button>
  )
}
