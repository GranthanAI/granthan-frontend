import { useQuery } from '@tanstack/react-query'
import { authService } from '@/services/auth.service'

export const STAFF_ROLES = ['support', 'billing_admin', 'admin'] as const

export interface StaffRole {
  loading: boolean
  /** support, billing_admin or admin */
  isStaff: boolean
  /** may change things: billing_admin or admin (support is read-only) */
  canWrite: boolean
  role: string | undefined
}

/** The signed-in user's staff role, from GET /auth/me. Nothing in the console shows without it. */
export function useStaffRole(): StaffRole {
  const q = useQuery({ queryKey: ['auth', 'me'], queryFn: () => authService.me(), staleTime: 30_000, retry: 1 })
  const role = q.data?.role
  const isStaff = !!role && (STAFF_ROLES as readonly string[]).includes(role)
  return { loading: q.isPending, isStaff, canWrite: role === 'billing_admin' || role === 'admin', role }
}
