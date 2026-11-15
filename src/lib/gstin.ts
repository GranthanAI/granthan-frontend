/** Same shape billing enforces: 2 digits, 5 letters, 4 digits, letter, 1-9/A-Z, Z, check character. */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

/** Returns an error message, or null when the GSTIN is acceptable for this state. An empty GSTIN is fine (it is optional). */
export function gstinError(gstin: string, stateCode: string): string | null {
  const g = gstin.trim().toUpperCase()
  if (!g) return null
  if (g.length !== 15) return 'A GSTIN has 15 characters.'
  if (!GSTIN_RE.test(g)) return 'This does not look like a valid GSTIN.'
  if (stateCode && g.slice(0, 2) !== stateCode) return 'The first two digits of the GSTIN must match the state you selected.'
  return null
}

/** Billing's 422 `errors` are "field: message"; this keys them by field for inline display. */
export function fieldErrors(errors: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of errors ?? []) {
    const i = e.indexOf(':')
    if (i > 0 && !(e.slice(0, i) in out)) out[e.slice(0, i).trim()] = e.slice(i + 1).trim()
  }
  return out
}
