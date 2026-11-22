import { useCallback, useEffect, useRef, useState } from 'react'
import { VOICE_COPY } from '@/content/quickwins'

/** Minimal shape of the browser's SpeechRecognition (Chrome/Edge expose it as webkitSpeechRecognition). */
export interface RecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort?: () => void
}
export interface RecognitionEvent {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}
type Ctor = new () => RecognitionLike

export const recognitionCtor = (): Ctor | undefined => {
  const w = globalThis as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}
export const dictationSupported = () => Boolean(recognitionCtor())

/** Inserts `text` into `draft` at `cursor`, adding a leading space when the text before it does not end in whitespace. */
export function insertAtCursor(draft: string, cursor: number, text: string): { value: string; cursor: number } {
  const at = Math.max(0, Math.min(cursor, draft.length))
  const before = draft.slice(0, at)
  const after = draft.slice(at)
  const piece = text.trim()
  if (!piece) return { value: draft, cursor: at }
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const value = `${before}${lead}${piece}${after}`
  return { value, cursor: before.length + lead.length + piece.length }
}

export function dictationError(code: string): string | null {
  if (code === 'not-allowed' || code === 'service-not-allowed') return VOICE_COPY.denied
  if (code === 'network') return VOICE_COPY.network
  return null // no-speech, aborted, audio-capture...: stop quietly
}

/**
 * Dictation through the browser's speech engine. `onFinal` receives each finished phrase; `interim` is the greyed text still being
 * recognised. It restarts after the engine's own `onend` only while the user still has recording switched on, and stops on
 * stop(), unmount and (via the caller) a route change or a send.
 */
export function useDictation(lang: string, onFinal: (text: string) => void) {
  const supported = dictationSupported()
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<RecognitionLike | null>(null)
  const wanted = useRef(false)
  const finalCb = useRef(onFinal)
  useEffect(() => {
    finalCb.current = onFinal
  })

  const stop = useCallback(() => {
    wanted.current = false
    setListening(false)
    setInterim('')
    const r = rec.current
    rec.current = null
    if (r) {
      r.onend = null
      r.onresult = null
      r.onerror = null
      try {
        r.stop()
      } catch {
        /* already stopped */
      }
    }
  }, [])

  const begin = useCallback(() => {
    const C = recognitionCtor()
    if (!C) return
    const r = new C()
    r.lang = lang
    r.interimResults = true
    r.continuous = true
    r.onresult = (e) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!
        const text = res[0]?.transcript ?? ''
        if (res.isFinal) finalCb.current(text)
        else live += text
      }
      setInterim(live)
    }
    r.onerror = (e) => {
      const msg = dictationError(e.error)
      if (msg) setError(msg)
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'network') wanted.current = false
    }
    r.onend = () => {
      setInterim('')
      if (wanted.current && rec.current === r) {
        try {
          r.start() // the engine ended on its own (silence): carry on while the user still wants to dictate
          return
        } catch {
          /* fall through to stopped */
        }
      }
      rec.current = null
      wanted.current = false
      setListening(false)
    }
    rec.current = r
    try {
      r.start()
    } catch {
      rec.current = null
      wanted.current = false
      setListening(false)
    }
  }, [lang])

  const start = useCallback(() => {
    if (!supported || wanted.current) return
    setError(null)
    wanted.current = true
    setListening(true)
    begin()
  }, [supported, begin])

  useEffect(() => stop, [stop])
  return { supported, listening, interim, error, start, stop, clearError: () => setError(null) }
}
