/** preferences.language -> a BCP-47 tag for the browser's speech engines. Hinglish and Auto use en-IN. */
const TAGS: Record<string, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  bn: 'bn-IN',
  mr: 'mr-IN',
  ta: 'ta-IN',
  te: 'te-IN',
  gu: 'gu-IN',
  kn: 'kn-IN',
  ml: 'ml-IN',
  pa: 'pa-IN',
  ur: 'ur-IN',
  hinglish: 'en-IN',
  auto: 'en-IN',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  pt: 'pt-BR',
  it: 'it-IT',
  nl: 'nl-NL',
  ru: 'ru-RU',
  ar: 'ar-SA',
  tr: 'tr-TR',
  zh: 'zh-CN',
  ja: 'ja-JP',
  ko: 'ko-KR',
  id: 'id-ID',
  vi: 'vi-VN',
}

export const speechLang = (language: string | undefined | null): string => TAGS[(language ?? 'auto').toLowerCase()] ?? 'en-IN'

/** The dictation languages offered in the small menu on the mic button. */
export const DICTATION_LANGS: Array<{ tag: string; label: string }> = [
  { tag: 'en-IN', label: 'English (India)' },
  { tag: 'hi-IN', label: 'Hindi' },
  { tag: 'bn-IN', label: 'Bengali' },
  { tag: 'mr-IN', label: 'Marathi' },
  { tag: 'ta-IN', label: 'Tamil' },
  { tag: 'te-IN', label: 'Telugu' },
  { tag: 'gu-IN', label: 'Gujarati' },
  { tag: 'kn-IN', label: 'Kannada' },
  { tag: 'ml-IN', label: 'Malayalam' },
  { tag: 'pa-IN', label: 'Punjabi' },
  { tag: 'ur-IN', label: 'Urdu' },
  { tag: 'en-US', label: 'English (US)' },
]
