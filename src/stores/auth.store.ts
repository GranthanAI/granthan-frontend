import { create } from 'zustand'
import type { User } from '@/types/api'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

interface AuthState {
  status: AuthStatus
  /** Access token lives in memory only: never written to localStorage/sessionStorage. */
  accessToken: string | null
  user: User | null
  /** Set when a session ended involuntarily so the login screen can explain why. */
  expired: boolean
  /** A message for the login screen after a deliberate end of session (e.g. the account was deleted). */
  notice: string | null
  setSession: (token: string, user?: User | null) => void
  setUser: (user: User) => void
  clear: (opts?: { expired?: boolean }) => void
  setAnonymous: () => void
  /** Ends the session and tells the login screen why (survives the redirect that the route guard performs). */
  endSession: (notice: string) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  accessToken: null,
  user: null,
  expired: false,
  notice: null,
  setSession: (accessToken, user) =>
    set((s) => ({ accessToken, user: user ?? s.user, status: 'authenticated', expired: false, notice: null })),
  setUser: (user) => set({ user }),
  clear: (opts) =>
    set({ accessToken: null, user: null, status: 'anonymous', expired: !!opts?.expired }),
  setAnonymous: () => set({ accessToken: null, user: null, status: 'anonymous' }),
  endSession: (notice) => set({ accessToken: null, user: null, status: 'anonymous', expired: false, notice }),
}))

export const getAccessToken = () => useAuthStore.getState().accessToken
