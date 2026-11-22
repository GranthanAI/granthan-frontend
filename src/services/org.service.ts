import { api, requestFile } from '@/lib/api-client'
import { uuid } from '@/lib/utils'
import type {
  AcceptResult, AuditRow, CreateInvitesResult, CsvUpload, DomainAdded, DomainMatch, InviteBatch, JoinRequestRow, OrgDomain, InvitePreview, InviteRow, LinkCreated, LinkRow, Me, Member, OrgRole, Page, Policy,
  PolicyInput, UsageReport,
} from '@/types/org'

/** organisation-service for members, owners and admins. The gateway maps /org/<x> to /org/v1/<x>. Every write carries an Idempotency-Key. */
const O = '/org'
const idem = (key?: string) => ({ headers: { 'Idempotency-Key': key ?? uuid() } })
const orgPath = (orgId: string, rest = '') => `${O}/orgs/${encodeURIComponent(orgId)}${rest}`

export const orgService = {
  /** 404 NOT_FOUND = the user is in no organisation (the caller shows nothing, not an error). */
  me: (signal?: AbortSignal) => api.get<Me>(`${O}/me`, { signal }),
  /** Public: works without signing in. */
  preview: (token: string, signal?: AbortSignal) => api.get<InvitePreview>(`${O}/invites/preview`, { query: { token }, signal, auth: false }),
  accept: (token: string, key?: string) => api.post<AcceptResult>(`${O}/invites/accept`, { token }, idem(key)),
  leave: (orgId: string) => api.post<{ left: boolean }>(orgPath(orgId, '/leave'), {}, idem()),

  members: (orgId: string, q: { cursor?: string; limit?: number; q?: string; role?: string } = {}, signal?: AbortSignal) =>
    api.get<Page<Member>>(orgPath(orgId, '/members'), { query: q, signal }),
  changeRole: (orgId: string, userId: string, role: Exclude<OrgRole, 'owner'>) =>
    api.patch<{ user_id: string; role: OrgRole }>(orgPath(orgId, `/members/${encodeURIComponent(userId)}`), { role }, idem()),
  removeMember: (orgId: string, userId: string) => api.delete<void>(orgPath(orgId, `/members/${encodeURIComponent(userId)}`), idem()),
  transferOwnership: (orgId: string, toUserId: string) => api.post<unknown>(orgPath(orgId, '/transfer-ownership'), { to_user_id: toUserId }, idem()),

  invites: (orgId: string, q: { cursor?: string; limit?: number } = {}, signal?: AbortSignal) => api.get<Page<InviteRow>>(orgPath(orgId, '/invites'), { query: q, signal }),
  invite: (orgId: string, emails: string[], role: Exclude<OrgRole, 'owner'>, key?: string) =>
    api.post<CreateInvitesResult>(orgPath(orgId, '/invites'), { emails, role }, idem(key)),
  resendInvite: (orgId: string, inviteId: string) => api.post<unknown>(orgPath(orgId, `/invites/${encodeURIComponent(inviteId)}/resend`), {}, idem()),
  revokeInvite: (orgId: string, inviteId: string) => api.delete<void>(orgPath(orgId, `/invites/${encodeURIComponent(inviteId)}`), idem()),

  links: (orgId: string, signal?: AbortSignal) => api.get<{ items: LinkRow[] }>(orgPath(orgId, '/invite-links'), { signal }),
  createLink: (orgId: string, body: { max_uses: number; expires_in_days: number; domain_restricted: boolean }) =>
    api.post<LinkCreated>(orgPath(orgId, '/invite-links'), body, idem()),
  revokeLink: (orgId: string, linkId: string) => api.delete<void>(orgPath(orgId, `/invite-links/${encodeURIComponent(linkId)}`), idem()),

  policy: (orgId: string, signal?: AbortSignal) => api.get<Policy>(orgPath(orgId, '/policies'), { signal }),
  savePolicy: (orgId: string, body: PolicyInput) => api.put<Policy>(orgPath(orgId, '/policies'), body, idem()),

  usage: (orgId: string, range: { from?: string; to?: string } = {}, signal?: AbortSignal) => api.get<UsageReport>(orgPath(orgId, '/usage'), { query: range, signal }),
  audit: (orgId: string, q: { cursor?: string; limit?: number } = {}, signal?: AbortSignal) => api.get<Page<AuditRow>>(orgPath(orgId, '/audit'), { query: q, signal }),

  // ---- CSV bulk invites (multipart: the browser sets the boundary, so no Content-Type here)
  uploadCsv: (orgId: string, file: File, role: Exclude<OrgRole, 'owner'>, dryRun: boolean, key?: string) => {
    const form = new FormData()
    form.set('file', file)
    form.set('role', role)
    form.set('dry_run', String(dryRun))
    return api.post<CsvUpload>(orgPath(orgId, '/invites/csv'), form, idem(key))
  },
  batch: (batchId: string, signal?: AbortSignal) => api.get<InviteBatch>(`${O}/invite-batches/${encodeURIComponent(batchId)}`, { signal }),
  batchErrors: (batchId: string) => requestFile(`${O}/invite-batches/${encodeURIComponent(batchId)}/errors.csv`),

  linkUrl: (orgId: string, linkId: string) => api.get<{ link_id: string; url: string }>(orgPath(orgId, `/invite-links/${encodeURIComponent(linkId)}/url`)),

  // ---- domains and join requests
  domains: (orgId: string, signal?: AbortSignal) => api.get<{ items: OrgDomain[] }>(orgPath(orgId, '/domains'), { signal }),
  addDomain: (orgId: string, domain: string, includeSubdomains: boolean) => api.post<DomainAdded>(orgPath(orgId, '/domains'), { domain, include_subdomains: includeSubdomains }, idem()),
  patchDomain: (orgId: string, domain: string, body: { auto_join?: boolean; include_subdomains?: boolean }) => api.patch<OrgDomain>(orgPath(orgId, `/domains/${encodeURIComponent(domain)}`), body, idem()),
  deleteDomain: (orgId: string, domain: string) => api.delete<void>(orgPath(orgId, `/domains/${encodeURIComponent(domain)}`), idem()),
  verifyDomain: (orgId: string, domain: string) => api.post<OrgDomain>(orgPath(orgId, `/domains/${encodeURIComponent(domain)}/verify`), {}, idem()),
  domainMatch: (signal?: AbortSignal) => api.get<DomainMatch>(`${O}/me/domain-match`, { signal }),
  requestJoin: () => api.post<{ id: string; org_id: string; status: string }>(`${O}/join-requests`, {}, idem()),
  cancelJoinRequest: (requestId: string) => api.delete<void>(`${O}/join-requests/${encodeURIComponent(requestId)}`, idem()),
  joinRequests: (orgId: string, signal?: AbortSignal) => api.get<Page<JoinRequestRow>>(orgPath(orgId, '/join-requests'), { query: { status: 'pending', limit: 100 }, signal }),
  approveJoinRequest: (orgId: string, id: string) => api.post<unknown>(orgPath(orgId, `/join-requests/${encodeURIComponent(id)}/approve`), {}, idem()),
  declineJoinRequest: (orgId: string, id: string) => api.post<unknown>(orgPath(orgId, `/join-requests/${encodeURIComponent(id)}/decline`), {}, idem()),
}
