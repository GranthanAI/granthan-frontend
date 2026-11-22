import { create } from 'zustand'
import { VOICE_COPY } from '@/content/quickwins'
import { useVoiceStore } from './voice.store'

const MAX_UTTERANCE = 200

/** Markdown -> text a speech engine can read: code, diagrams and tables are announced, not read; links keep their text. */
export function markdownToSpeech(md: string): string {
  let t = md.replace(/\r\n/g, '\n')
  // fenced blocks: diagrams (mermaid / manim) and code
  t = t.replace(/```(\w*)[^\n]*\n[\s\S]*?```/g, (_m, lang: string) => {
    const l = lang.toLowerCase()
    return `\n${l === 'mermaid' || l === 'manim' ? VOICE_COPY.diagramSkipped : VOICE_COPY.codeSkipped}.\n`
  })
  t = t.replace(/```[\s\S]*$/g, `\n${VOICE_COPY.codeSkipped}.\n`) // an unterminated fence
  // tables: a run of lines that start with a pipe
  t = t.replace(/(?:^\|.*\|[ \t]*\n?)+/gm, `\n${VOICE_COPY.tableSkipped}.\n`)
  // math: $$...$$ and $...$ -> its plain text
  t = t.replace(/\$\$([\s\S]*?)\$\$/g, (_m, x: string) => ` ${plainMath(x)} `)
  t = t.replace(/\$([^$\n]+)\$/g, (_m, x: string) => ` ${plainMath(x)} `)
  // images dropped, links keep their text
  t = t.replace(/!\[[^\]]*]\([^)]*\)/g, '')
  t = t.replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
  t = t.replace(/<[^>]+>/g, '')
  // inline code keeps its text; markup characters go
  t = t.replace(/`([^`]*)`/g, '$1')
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  t = t.replace(/^\s*>\s?/gm, '')
  t = t.replace(/^\s*[-*+]\s+/gm, '')
  t = t.replace(/^\s*\d+[.)]\s+/gm, '')
  t = t.replace(/(\*\*|__|\*|_|~~)/g, '')
  t = t.replace(/^[-*_]{3,}\s*$/gm, '')
  return t.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
}

function plainMath(x: string): string {
  return x
    .replace(/\\frac\{([^}]*)}\{([^}]*)}/g, '$1 over $2')
    .replace(/\\sqrt\{([^}]*)}/g, 'square root of $1')
    .replace(/\\(?:cdot|times)/g, ' times ')
    .replace(/\\(?:le|leq)\b/g, ' less than or equal to ')
    .replace(/\\(?:ge|geq)\b/g, ' greater than or equal to ')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/\^/g, ' to the power of ')
    .replace(/[{}_\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Sentences of at most ~200 characters: long single utterances stop early in Chrome. */
export function splitSentences(text: string, max = MAX_UTTERANCE): string[] {
  const out: string[] = []
  const pieces = text
    .split(/\n+/)
    .flatMap((line) => line.match(/[^.!?।]+[.!?।]+["')\]]*\s*|[^.!?।]+$/g) ?? [line])
    .map((s) => s.trim())
    .filter(Boolean)
  for (const piece of pieces) {
    if (piece.length <= max) {
      out.push(piece)
      continue
    }
    let rest = piece
    while (rest.length > max) {
      let cut = rest.lastIndexOf(' ', max)
      if (cut < max * 0.4) cut = max
      out.push(rest.slice(0, cut).trim())
      rest = rest.slice(cut).trim()
    }
    if (rest) out.push(rest)
  }
  return out
}

export const speechSupported = () => typeof globalThis !== 'undefined' && 'speechSynthesis' in globalThis && typeof SpeechSynthesisUtterance !== 'undefined'

/** The voice for a language tag: the same tag first (en-IN for English), then the same language, else null (default voice). */
export function pickVoice(voices: SpeechSynthesisVoice[], lang: string, uri?: string | null): SpeechSynthesisVoice | null {
  if (uri) {
    const chosen = voices.find((v) => v.voiceURI === uri)
    if (chosen) return chosen
  }
  const l = lang.toLowerCase()
  const base = l.split('-')[0]!
  return voices.find((v) => v.lang.toLowerCase().replace('_', '-') === l) ?? voices.find((v) => v.lang.toLowerCase().startsWith(base)) ?? null
}

async function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = globalThis.speechSynthesis
  const now = synth.getVoices()
  if (now.length) return now
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices())
    synth.addEventListener?.('voiceschanged', done, { once: true })
    setTimeout(done, 1000) // some browsers never fire it
  })
}

interface SpeechState {
  /** Key of the message being read (one reading at a time across the app). */
  speaking: string | null
  speak: (key: string, markdown: string, lang: string) => Promise<void>
  stop: () => void
}

let session = 0

export const useSpeech = create<SpeechState>()((set, get) => ({
  speaking: null,
  stop: () => {
    session++
    if (speechSupported()) globalThis.speechSynthesis.cancel()
    set({ speaking: null })
  },
  speak: async (key, markdown, lang) => {
    if (!speechSupported()) return
    if (get().speaking === key) return get().stop()
    get().stop() // starting another reading stops the first
    const mine = ++session
    const sentences = splitSentences(markdownToSpeech(markdown))
    if (!sentences.length) return
    set({ speaking: key })
    const voices = await loadVoices()
    if (mine !== session) return
    const { speed, voiceURI } = useVoiceStore.getState()
    const voice = pickVoice(voices, lang, voiceURI)
    const synth = globalThis.speechSynthesis
    sentences.forEach((s, i) => {
      const u = new SpeechSynthesisUtterance(s)
      u.lang = voice?.lang ?? lang
      if (voice) u.voice = voice
      u.rate = speed
      const last = i === sentences.length - 1
      u.onend = () => {
        if (last && mine === session) set({ speaking: null })
      }
      u.onerror = () => {
        if (mine === session) set({ speaking: null })
      }
      synth.speak(u)
    })
  },
}))
