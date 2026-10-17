/** Quoted excerpts: text the user selected in the chat and wants to ask about. */

/** Keeps the prompt small (the backend trims prompts to a token budget; 8000 chars is the message limit). */
export const MAX_QUOTE_CHARS = 1000

/** Normalizes a raw browser selection: unified newlines, no runs of blank lines, trimmed, length-capped. */
export function cleanSelection(raw: string): string {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > MAX_QUOTE_CHARS ? `${text.slice(0, MAX_QUOTE_CHARS).trimEnd()}…` : text
}

/**
 * Branch title: the first 5 words of the selection. Markdown decoration (#, >, *, `, list dashes) is
 * dropped from each word so a selected heading or bullet reads naturally; wording is otherwise unchanged.
 */
export function branchTitle(selection: string, words = 5): string {
  const picked = selection
    .split(/\s+/)
    .map((w) => w.replace(/^[#>*_`~+-]+/, '').replace(/[*_`~]+$/, ''))
    .filter(Boolean)
    .slice(0, words)
    .join(' ')
    .replace(/[\s,;:.!?-]+$/, '')
  return (picked || 'New branch').slice(0, 255)
}

/** Message content with the excerpt as a markdown quote block above the user's prompt. */
export function formatQuoted(quote: string | null | undefined, prompt: string): string {
  const q = quote?.trim()
  if (!q) return prompt
  return `${q
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')}\n\n${prompt}`
}

/** Inverse of formatQuoted, for display: a leading block of `>` lines is the excerpt. */
export function parseQuoted(content: string): { quote: string | null; body: string } {
  const lines = content.split('\n')
  let i = 0
  while (i < lines.length && /^>( |$)/.test(lines[i]!)) i++
  if (i === 0) return { quote: null, body: content }
  const quote = lines
    .slice(0, i)
    .map((l) => l.replace(/^> ?/, ''))
    .join('\n')
    .trim()
  return { quote: quote || null, body: lines.slice(i).join('\n').replace(/^\n+/, '') }
}
