import { api } from '@/lib/api-client'
import { uuid } from '@/lib/utils'
import type { CreateOrgInput, Member, Page, StaffOrg, StaffOrgDetail, AuditRow } from '@/types/org'

/** organisation-service's staff API through the gateway: /org/admin/<x> -> /admin/org/v1/<x>. Writes need staff role admin and a reason. */
const A = '/org/admin/orgs'
const idem = () => ({ headers: { 'Idempotency-Key': uuid() } })
const one = (orgId: string, rest = '') => `${A}/${encodeURIComponent(orgId)}${rest}`

export const orgAdminService = {
  search: (q: { q?: string; status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal) => api.get<Page<StaffOrg>>(A, { query: q, signal }),
  get: (orgId: string, signal?: AbortSignal) => api.get<StaffOrgDetail>(one(orgId), { signal }),
  members: (orgId: string, q: { cursor?: string; limit?: number } = {}, signal?: AbortSignal) => api.get<Page<Member>>(one(orgId, '/members'), { query: q, signal }),
  audit: (orgId: string, q: { cursor?: string; limit?: number } = {}, signal?: AbortSignal) => api.get<Page<AuditRow>>(one(orgId, '/audit'), { query: q, signal }),

  create: (body: CreateOrgInput) => api.post<StaffOrg & { owner_joined: boolean; owner_invite_pending: boolean }>(A, body, idem()),
  setSeats: (orgId: string, body: { plan_code: string; variant: string; seats_bought: number | null; reason: string }) => api.post<unknown>(one(orgId, '/seats'), body, idem()),
  suspend: (orgId: string, reason: string) => api.post<StaffOrg>(one(orgId, '/suspend'), { reason }, idem()),
  reactivate: (orgId: string, reason: string) => api.post<StaffOrg>(one(orgId, '/reactivate'), { reason }, idem()),
  extendPilot: (orgId: string, days: number, reason: string) => api.post<StaffOrg>(one(orgId, '/extend-pilot'), { days, reason }, idem()),
  close: (orgId: string, reason: string) => api.post<StaffOrg>(one(orgId, '/close'), { reason }, idem()),
}
