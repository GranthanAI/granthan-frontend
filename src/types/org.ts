/** organisation-service bodies, through the gateway: /org/<x> -> /org/v1/<x>, /org/admin/<x> -> /admin/org/v1/<x>. */

export type OrgRole = 'owner' | 'admin' | 'member'
export type OrgType = 'college' | 'company'

export interface Me {
  org: { id: string; name: string; slug: string; type: OrgType; status: string; pilot_ends_at: string | null }
  role: OrgRole
  seats: { plan_code: string | null; status: string | null; used: number; bought: number | null; over_by: number; pending: number | null }
  features: {
    lock_modes: boolean
    shared_modes_max: number | null
    usage_reports: boolean
    spend_cap: boolean
    csv_invites: boolean
    invite_links: boolean
    domains: boolean
  }
}

export interface InvitePreview {
  org_name: string
  org_type: OrgType
  inviter_name: string
  role: OrgRole
  email_hint: string | null
  expires_at: string
}
export interface AcceptResult { org_id: string; org_name: string; role: OrgRole }

export interface Member { user_id: string; name: string | null; email: string | null; role: OrgRole; source: string; joined_at: string }
export interface Page<T> { items: T[]; next_cursor: string | null }

export interface SeatsInfo { used: number; bought: number | null; open_invites: number; warning: boolean; payment_due: boolean }
export interface InviteResult { email: string; result: string; invite_id: string | null }
export interface CreateInvitesResult { results: InviteResult[]; seats: SeatsInfo }
export interface InviteRow {
  invite_id: string
  email: string | null
  role: OrgRole
  status: 'open' | 'accepted' | 'expired' | 'revoked'
  created_at: string
  expires_at: string
  last_sent_at: string | null
  resend_count: number
}
export interface LinkRow {
  link_id: string
  created_at: string
  expires_at: string
  max_uses: number | null
  uses: number
  domain_restricted: boolean
  status: 'open' | 'used_up' | 'expired' | 'revoked'
}
export interface LinkCreated { link_id: string; url: string; max_uses: number; expires_at: string; domain_restricted: boolean }

export interface Policy {
  version: number
  lock_modes: boolean
  approved_mode_ids: string[]
  member_spend_cap_paise: number | null
  updated_at: string | null
}
export interface PolicyInput { lock_modes: boolean; approved_mode_ids: string[]; member_spend_cap_paise: number | null }

export interface UsageMember {
  user_id: string
  name: string | null
  email: string | null
  role: OrgRole | null
  messages: number
  billable_units: number
  by_model_group: Record<string, Record<string, number>>
}
export interface UsageReport {
  from: string
  to: string
  totals: { messages: number; billable_units: number; by_model_group: Record<string, Record<string, number>> }
  members: UsageMember[]
}

export interface AuditRow { id: string; action: string; actor_label: string | null; actor_kind: string; target_type: string | null; target_id: string | null; reason: string | null; at: string }

// ---- staff
export interface StaffOrg {
  id: string
  name: string
  slug: string
  type: OrgType
  legal_name: string | null
  billing_email: string | null
  status: 'pilot' | 'active' | 'suspended' | 'pilot_expired' | 'closed' | string
  pilot_ends_at: string | null
  created_at: string
}
export interface StaffOrgDetail extends StaffOrg {
  seat_state: { plan_code: string; variant: string; seats_bought: number | null; status: string; period_end: string | null; source: string } | null
  active_count: number
}
export interface CreateOrgInput {
  name: string
  type: OrgType
  billing_email: string
  owner_email: string
  pilot: boolean
  reason: string
}

// ---- CSV, domains, join requests
export interface CsvError { row: number; email: string; reason: string }
export interface CsvUpload {
  batch_id: string
  dry_run: boolean
  rows_total: number
  rows_ok: number
  rows_failed: number
  errors_preview: CsvError[]
  seats: { used: number; bought: number | null; open_invites: number; payment_due: boolean }
}
export interface InviteBatch {
  batch_id: string
  status: string
  dry_run: boolean
  rows_total: number
  rows_ok: number
  rows_failed: number
  sent: number
  pending_send: number
  not_sent: number
  errors_note: string | null
  created_at: string
  finished_at: string | null
}
export interface DnsRecord { type: string; host: string; value: string }
export interface OrgDomain {
  domain: string
  status: 'pending' | 'verified'
  include_subdomains: boolean
  auto_join: boolean
  verified_at: string | null
  verify_method: string | null
  added_at: string | null
  dns_record: DnsRecord | null
}
export interface DomainAdded { domain: string; status: string; include_subdomains: boolean; dns_record: DnsRecord; instructions: string }
export interface DomainMatch { org_id: string; org_name: string; org_type: OrgType; can_request: boolean; pending_request_id: string | null }
export interface JoinRequestRow { id: string; user_id: string; name: string | null; email: string | null; domain: string; status: string; created_at: string }
