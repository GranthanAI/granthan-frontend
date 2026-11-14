import { create } from 'zustand'
import { toApiError } from '@/lib/errors'
import type { BillingDenied, StreamNotice } from '@/types/billing'

/**
 * Inline billing notices, keyed by composer (a conversation id, or 'new' for the new-chat composer).
 *  - `denied`: a service refused the request (plan 4.6). Stays until dismissed or replaced; the draft is kept.
 *  - `quiet`: a server-sent usage notice (e.g. 80% used). Dismissible; once dismissed the same notice_key + metric
 *    is not shown again in this session.
 */
interface NoticeState {
  denied: Record<string, BillingDenied>
  quiet: Record<string, StreamNotice>
  dismissedQuiet: string[]
  showDenied: (key: string, d: BillingDenied) => void
  dismissDenied: (key: string) => void
  showQuiet: (key: string, n: StreamNotice) => void
  dismissQuiet: (key: string) => void
}

export const quietId = (n: StreamNotice) => `${n.notice_key}|${n.metric ?? ''}`

export const useBillingNoticeStore = create<NoticeState>((set) => ({
  denied: {},
  quiet: {},
  dismissedQuiet: [],
  showDenied: (key, d) => set((s) => ({ denied: { ...s.denied, [key]: d } })),
  dismissDenied: (key) =>
    set((s) => {
      const { [key]: _drop, ...rest } = s.denied
      void _drop
      return { denied: rest }
    }),
  showQuiet: (key, n) =>
    set((s) => (s.dismissedQuiet.includes(quietId(n)) ? s : { quiet: { ...s.quiet, [key]: n } })),
  dismissQuiet: (key) =>
    set((s) => {
      const { [key]: n, ...rest } = s.quiet
      return { quiet: rest, dismissedQuiet: n ? [...s.dismissedQuiet, quietId(n)] : s.dismissedQuiet }
    }),
}))

/**
 * If `error` is a billing refusal, shows it as an inline notice above the composer `key` and returns true
 * (the caller then skips its own toast / error text). Anything else returns false.
 */
export function reportBillingError(key: string, error: unknown): boolean {
  const d = toApiError(error).billingDenial
  if (!d) return false
  useBillingNoticeStore.getState().showDenied(key, d)
  return true
}
