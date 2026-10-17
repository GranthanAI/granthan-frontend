import { api, refreshSession } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth.store'
import type { MessageResult, TokenResponse, User } from '@/types/api'

export const authService = {
  register: (body: { email: string; password: string; full_name: string }) =>
    api.post<User>('/auth/register', body, { auth: false }),

  verifyEmail: (body: { email: string; code: string }) =>
    api.post<MessageResult>('/auth/verify-email', body, { auth: false }),

  resendVerification: (email: string) =>
    api.post<MessageResult>('/auth/resend-verification', { email }, { auth: false }),

  async login(body: { email: string; password: string }): Promise<User> {
    const t = await api.post<TokenResponse>('/auth/login', body, { auth: false })
    useAuthStore.getState().setSession(t.access_token)
    const user = await authService.me()
    useAuthStore.getState().setUser(user)
    return user
  },

  me: () => api.get<User>('/auth/me'),

  forgotPassword: (email: string) =>
    api.post<MessageResult>('/auth/forgot-password', { email }, { auth: false }),

  resetPassword: (body: { token: string; new_password: string }) =>
    api.post<MessageResult>('/auth/reset-password', body, { auth: false }),

  changePassword: (body: { old_password: string; new_password: string }) =>
    api.post<MessageResult>('/auth/change-password', body),

  updateProfile: (body: { full_name?: string }) => api.patch<User>('/auth/profile', body),

  /** Always clears local state, even if the network call fails. */
  async logout(): Promise<void> {
    try {
      await api.post('/auth/logout', undefined, { timeoutMs: 8000 })
    } catch {
      // Local sign-out proceeds regardless; the refresh cookie expires server-side.
    } finally {
      useAuthStore.getState().setAnonymous()
    }
  },

  /** Restores the session on page load from the HttpOnly refresh cookie. */
  async restore(): Promise<void> {
    const token = await refreshSession()
    if (!token) {
      useAuthStore.getState().setAnonymous()
      return
    }
    try {
      const user = await authService.me()
      useAuthStore.getState().setUser(user)
    } catch {
      useAuthStore.getState().setAnonymous()
    }
  },
}
