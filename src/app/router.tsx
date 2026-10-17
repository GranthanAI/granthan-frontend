import { lazy, Suspense, useEffect } from 'react'
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import {
  ForgotPasswordPage,
  FullScreenLoader,
  LoginPage,
  ResetPasswordPage,
  SignupPage,
  VerifyEmailPage,
} from '@/pages/AuthPages'
import { ConversationPage, NewChatPage } from '@/pages/ChatPages'
import { authService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/auth.store'

const settingsPage = <K extends string>(name: K) =>
  lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: (m as unknown as Record<K, React.ComponentType>)[name] })))
const SettingsLayout = settingsPage('SettingsLayout')
const ProfileSettings = settingsPage('ProfileSettings')
const SecuritySettings = settingsPage('SecuritySettings')
const AppearanceSettings = settingsPage('AppearanceSettings')
const TextStyleSettingsPage = settingsPage('TextStyleSettingsPage')

/** Restores the session once on first load from the HttpOnly refresh cookie. */
let restoreStarted = false
export function useRestoreSession() {
  const status = useAuthStore((s) => s.status)
  useEffect(() => {
    if (restoreStarted || status !== 'loading') return
    restoreStarted = true
    void authService.restore()
  }, [status])
  return status
}

export function RequireAuth() {
  const status = useRestoreSession()
  const location = useLocation()
  if (status === 'loading') return <FullScreenLoader label="Restoring your session…" />
  if (status === 'anonymous')
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <Outlet />
}

export function PublicOnly() {
  const status = useRestoreSession()
  if (status === 'loading') return <FullScreenLoader />
  if (status === 'authenticated') return <Navigate to="/" replace />
  return <Outlet />
}

export const routes = [
  {
    element: <PublicOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignupPage /> },
      { path: '/verify-email', element: <VerifyEmailPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <NewChatPage /> },
          { path: '/c/:id', element: <ConversationPage /> },
          {
            path: '/settings',
            element: (
              <Suspense fallback={<FullScreenLoader />}>
                <SettingsLayout />
              </Suspense>
            ),
            children: [
              { index: true, element: <Navigate to="profile" replace /> },
              { path: 'profile', element: <Suspense fallback={null}><ProfileSettings /></Suspense> },
              { path: 'security', element: <Suspense fallback={null}><SecuritySettings /></Suspense> },
              { path: 'appearance', element: <Suspense fallback={null}><AppearanceSettings /></Suspense> },
              { path: 'text-style', element: <Suspense fallback={null}><TextStyleSettingsPage /></Suspense> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]

export const createRouter = () => createBrowserRouter(routes)
