import { Link, NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { FullScreenLoader } from '@/pages/AuthPages'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { useBillingMe } from '@/features/billing/hooks'
import { useStaffRole } from './useStaffRole'

const NAV = [
  { to: 'accounts', label: 'Accounts' },
  { to: 'costs', label: 'Costs' },
  { to: 'reconciliation', label: 'Reconciliation' },
  { to: 'settlements', label: 'Settlements' },
  { to: 'prices', label: 'Prices and FX' },
  { to: 'plans', label: 'Plan editor' },
] as const

/** /admin: only for staff (support, billing_admin, admin); anyone else sees the ordinary 404 page. Support is read-only. */
export function AdminLayout() {
  const staff = useStaffRole()
  const me = useBillingMe().data
  if (staff.loading) return <FullScreenLoader label="Checking your access…" />
  if (!staff.isStaff) return <NotFoundPage />
  const simulated = me?.payment_mode === 'simulated'
  return (
    <div className="flex min-h-dvh bg-canvas text-ink" data-testid="admin-shell">
      <nav aria-label="Admin" className="w-52 shrink-0 border-r border-line p-3">
        <Link to="/" className="mb-3 block px-3 text-sm text-ink-3 hover:underline">← Back to chat</Link>
        <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Billing admin</p>
        <ul className="space-y-0.5">
          {[...NAV, ...(simulated ? [{ to: 'simulator', label: 'Simulator tools' }] : [])].map((n) => (
            <li key={n.to}>
              <NavLink to={n.to} className={({ isActive }) => cn('block rounded-lg px-3 py-2 text-sm', isActive ? 'bg-accent-soft font-medium' : 'text-ink-2 hover:bg-surface-2')}>{n.label}</NavLink>
            </li>
          ))}
        </ul>
        <p className="mt-4 px-3 text-xs text-ink-3" data-testid="staff-role">
          Signed in as <strong>{staff.role}</strong>{staff.canWrite ? '' : ' (read-only)'}
        </p>
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-5xl space-y-5 px-5 py-8"><Outlet context={{ canWrite: staff.canWrite }} /></div></main>
    </div>
  )
}
