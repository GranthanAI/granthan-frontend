/**
 * An invitation token that has to survive signing up. Email verification can happen in ANOTHER tab, where router state and
 * sessionStorage are gone, so it lives in localStorage for 24 hours. The token is a credential: it is never logged.
 */
const KEY = 'pendingOrgInvite'
export const PENDING_INVITE_TTL_MS = 24 * 60 * 60 * 1000

interface Pending { token: string; savedAt: number; redirected?: boolean }

function read(now = Date.now()): Pending | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<Pending>
    if (typeof p.token !== 'string' || !p.token || typeof p.savedAt !== 'number' || now - p.savedAt > PENDING_INVITE_TTL_MS || p.savedAt > now + 60_000) {
      localStorage.removeItem(KEY)
      return null
    }
    return { token: p.token, savedAt: p.savedAt, redirected: p.redirected === true }
  } catch {
    return null
  }
}

/** Remember the token (opening the same link again keeps the original time, so the 24 hours are not extended forever). */
export function savePendingInvite(token: string, now = Date.now()): void {
  if (!token) return
  const cur = read(now)
  if (cur?.token === token) return
  try { localStorage.setItem(KEY, JSON.stringify({ token, savedAt: now })) } catch { /* private mode: the router state still carries it */ }
}

export const pendingInviteToken = (now = Date.now()): string | null => read(now)?.token ?? null

export function clearPendingInvite(): void {
  try { localStorage.removeItem(KEY) } catch { /* nothing to clear */ }
}

/**
 * Where to go after a successful sign-in: the join page once for a valid pending token, otherwise `fallback`.
 * "Once": the token stays stored (it is cleared only by an accept or a final error on the join page), but the redirect
 * itself is not repeated, so a later visit to /login does not keep throwing the user back.
 */
export function afterAuthPath(fallback = '/', now = Date.now()): string {
  const p = read(now)
  if (!p || p.redirected) return fallback
  try { localStorage.setItem(KEY, JSON.stringify({ ...p, redirected: true })) } catch { /* ignore */ }
  return `/join/${encodeURIComponent(p.token)}`
}

/** Same as `afterAuthPath` but without marking it used: for a render (a signed-in user landing on /login or /verify-email). */
export function peekAfterAuthPath(fallback = '/', now = Date.now()): string {
  const p = read(now)
  return p && !p.redirected ? `/join/${encodeURIComponent(p.token)}` : fallback
}
