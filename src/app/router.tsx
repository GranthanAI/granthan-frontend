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
import { peekAfterAuthPath } from '@/features/org/pendingInvite'

const settingsPage = <K extends string>(name: K) =>
  lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: (m as unknown as Record<K, React.ComponentType>)[name] })))
const AdminLayout = lazy(() => import('@/features/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })))
const AdminHome = lazy(() => import('@/features/admin/AdminHome').then((m) => ({ default: m.AdminHome })))
const AdminAccounts = lazy(() => import('@/features/admin/AccountsPage').then((m) => ({ default: m.AccountsPage })))
const money = (name: 'CostsPage' | 'ReconciliationPage' | 'SettlementsPage' | 'PricesPage') => lazy(() => import('@/features/admin/MoneyPages').then((m) => ({ default: m[name] })))
const AdminCosts = money('CostsPage')
const AdminReconciliation = money('ReconciliationPage')
const AdminSettlements = money('SettlementsPage')
const AdminPrices = money('PricesPage')
const AdminPlans = lazy(() => import('@/features/admin/PlanEditorPage').then((m) => ({ default: m.PlanEditorPage })))
const AdminSimulator = lazy(() => import('@/features/admin/SimulatorPage').then((m) => ({ default: m.SimulatorPage })))
const AdminOrgs = lazy(() => import('@/features/org/StaffOrgPages').then((m) => ({ default: m.StaffOrgsPage })))
const JoinPage = lazy(() => import('@/features/org/JoinPage').then((m) => ({ default: m.JoinPage })))
const PricingPage = lazy(() => import('@/pages/PricingPage').then((m) => ({ default: m.PricingPage })))
const PublicSharePage = lazy(() => import('@/features/share/PublicSharePage').then((m) => ({ default: m.PublicSharePage })))
const AdminFeedback = lazy(() => import('@/features/admin/FeedbackPage').then((m) => ({ default: m.FeedbackPage })))
const SharedLinksSettings = settingsPage('SharedLinksSettings')
const SettingsLayout = settingsPage('SettingsLayout')
const ProfileSettings = settingsPage('ProfileSettings')
const SecuritySettings = settingsPage('SecuritySettings')
const AppearanceSettings = settingsPage('AppearanceSettings')
const TextStyleSettingsPage = settingsPage('TextStyleSettingsPage')
const AiPreferencesSettings = settingsPage('AiPreferencesSettings')
const MemorySettingsPage = settingsPage('MemorySettingsPage')
const DocumentsSettings = settingsPage('DocumentsSettings')
const CustomModesSettings = settingsPage('CustomModesSettings')
const BillingSettings = settingsPage('BillingSettings')
const OrganisationSettings = settingsPage('OrganisationSettings')

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
  if (status === 'authenticated') return <Navigate to={peekAfterAuthPath('/')} replace />
  return <Outlet />
}

function JoinRoute() {
  const status = useRestoreSession()
  return <Suspense fallback={<FullScreenLoader />}><JoinPage signedIn={status === 'authenticated'} restoring={status === 'loading'} /></Suspense>
}

export const routes = [
  // Public: reachable signed in and signed out (not under PublicOnly, which would bounce signed-in users).
  // Public: the invitation preview needs no session; Join itself does.
  { path: '/join/:token', element: <JoinRoute /> },
  // A shared snapshot: public, read-only, no auth guard and no app shell.
  { path: '/s/:token', element: <Suspense fallback={<FullScreenLoader />}><PublicSharePage /></Suspense> },
  { path: '/pricing', element: <Suspense fallback={<FullScreenLoader />}><PricingPage /></Suspense> },
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
    // Staff console: signed in, then the layout itself shows the 404 page to anyone who is not staff.
    element: <RequireAuth />,
    children: [
      {
        path: '/admin',
        element: <Suspense fallback={<FullScreenLoader />}><AdminLayout /></Suspense>,
        children: [
          { index: true, element: <Suspense fallback={null}><AdminHome /></Suspense> },
          { path: 'accounts', element: <Suspense fallback={null}><AdminAccounts /></Suspense> },
          { path: 'costs', element: <Suspense fallback={null}><AdminCosts /></Suspense> },
          { path: 'reconciliation', element: <Suspense fallback={null}><AdminReconciliation /></Suspense> },
          { path: 'settlements', element: <Suspense fallback={null}><AdminSettlements /></Suspense> },
          { path: 'plans', element: <Suspense fallback={null}><AdminPlans /></Suspense> },
          { path: 'orgs', element: <Suspense fallback={null}><AdminOrgs /></Suspense> },
          { path: 'feedback', element: <Suspense fallback={null}><AdminFeedback /></Suspense> },
          { path: 'simulator', element: <Suspense fallback={null}><AdminSimulator /></Suspense> },
          { path: 'prices', element: <Suspense fallback={null}><AdminPrices /></Suspense> },
        ],
      },
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
              { path: 'ai', element: <Suspense fallback={null}><AiPreferencesSettings /></Suspense> },
              { path: 'custom-modes', element: <Suspense fallback={null}><CustomModesSettings /></Suspense> },
              { path: 'memory', element: <Suspense fallback={null}><MemorySettingsPage /></Suspense> },
              { path: 'documents', element: <Suspense fallback={null}><DocumentsSettings /></Suspense> },
              { path: 'shared-links', element: <Suspense fallback={null}><SharedLinksSettings /></Suspense> },
              { path: 'billing', element: <Suspense fallback={null}><BillingSettings /></Suspense> },
              { path: 'organisation', element: <Suspense fallback={null}><OrganisationSettings /></Suspense> },
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
