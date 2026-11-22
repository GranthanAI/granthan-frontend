import { useEffect, useState } from 'react'
import { SelectField, SettingsSection } from '@/components/settings/controls'
import { VOICE_COPY } from '@/content/quickwins'
import { speechSupported } from './readAloud'
import { useSpeechLang } from './VoiceControls'
import { READ_SPEEDS, useVoiceStore } from './voice.store'

/** Settings > AI preferences: read-aloud speed and voice. Both are stored in this browser only. */
export function VoiceSettings() {
  const speed = useVoiceStore((s) => s.speed)
  const setSpeed = useVoiceStore((s) => s.setSpeed)
  const voiceURI = useVoiceStore((s) => s.voiceURI)
  const setVoiceURI = useVoiceStore((s) => s.setVoiceURI)
  const lang = useSpeechLang().toLowerCase()
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    if (!speechSupported()) return
    const read = () => setVoices(globalThis.speechSynthesis.getVoices())
    read()
    globalThis.speechSynthesis.addEventListener?.('voiceschanged', read)
    return () => globalThis.speechSynthesis.removeEventListener?.('voiceschanged', read)
  }, [])

  if (!speechSupported()) return null
  const base = lang.split('-')[0]!
  const forLang = voices.filter((v) => v.lang.toLowerCase().startsWith(base))
  return (
    <SettingsSection title="Read aloud" description="Uses your browser's speech engine. These choices are stored on this device only.">
      <SelectField
        label={VOICE_COPY.speed}
        value={String(speed)}
        onChange={(v) => setSpeed(Number(v))}
        options={READ_SPEEDS.map((s) => ({ value: String(s), label: `${s}x` }))}
      />
      <SelectField
        label={VOICE_COPY.voice}
        value={voiceURI ?? ''}
        onChange={(v) => setVoiceURI(v || null)}
        options={[{ value: '', label: VOICE_COPY.voiceDefault }, ...forLang.map((v) => ({ value: v.voiceURI, label: `${v.name} (${v.lang})` }))]}
      />
    </SettingsSection>
  )
}
