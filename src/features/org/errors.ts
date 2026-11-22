import { toApiError } from '@/lib/errors'

/** What a person should read for each organisation-service error code. Anything unknown falls back to the server's own message. */
export const ORG_ERROR_COPY: Record<string, string> = {
  INVITE_INVALID: 'This invitation link is not valid. Ask your organisation for a new one.',
  INVITE_EXPIRED: 'This invitation has expired. Ask your organisation to send a new one.',
  INVITE_EMAIL_MISMATCH: 'This invitation was sent to a different email address. Sign in with the address it was sent to.',
  EMAIL_NOT_VERIFIED: 'Verify your email address first, then open the invitation again.',
  ALREADY_IN_ORG: 'You are already in an organisation. Leave it first to join another.',
  SEATS_FULL: 'This organisation has no free seats. Ask its admin to add seats.',
  PILOT_FULL: 'This pilot is full. Ask GranthanAI to extend it.',
  ORG_INACTIVE: 'This organisation is not active right now.',
  PAYMENT_DUE: 'This organisation has a payment due, so new members cannot join yet. Ask its admin.',
  LAST_OWNER: 'An organisation must keep an owner. Transfer ownership first.',
  FORBIDDEN_ROLE: 'You do not have permission to do that.',
  FEATURE_NOT_IN_PLAN: 'This organisation’s plan does not include that.',
  INVITE_ALREADY_OPEN: 'That person already has an open invitation.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  SEATS_MANAGED_BY_BILLING: 'Seats for this organisation are set by billing, not by hand.',
  UNKNOWN_USER: 'No GranthanAI account was found for that person.',
  VERSION_CONFLICT: 'Someone else changed this. Reload and try again.',
  CSV_INVALID: 'This file could not be read. Use a .csv with one email per row (a header row named email is fine) and save it as UTF-8.',
  REQUEST_TOO_LARGE: 'This file is too large. The limit is 1 MB.',
  PUBLIC_EMAIL_DOMAIN: 'That is a public email provider (like gmail.com), which no organisation can claim. Use your own domain.',
  DOMAIN_TAKEN: 'Another organisation has already verified this domain. If it is yours, contact GranthanAI support.',
  JOIN_REQUEST_PENDING: 'You already asked to join. Wait for an admin to answer.',
}

/** Accept refusals that no retry fixes: the stored token is dropped. */
export const FINAL_ACCEPT_CODES = ['INVITE_INVALID', 'INVITE_EXPIRED', 'ALREADY_IN_ORG'] as const

/** The invite codes that mean "this link is dead" (the join page shows no Join button for them). */
export const DEAD_INVITE_CODES = ['INVITE_INVALID', 'INVITE_EXPIRED'] as const

export const orgErrorCode = (e: unknown): string | undefined => toApiError(e).code

export function orgErrorMessage(e: unknown): string {
  const err = toApiError(e)
  if (err.code === 'RATE_LIMITED' || err.kind === 'rate_limit')
    return err.retryAfterSeconds ? `Too many attempts. Try again in ${err.retryAfterSeconds} seconds.` : ORG_ERROR_COPY.RATE_LIMITED!
  return (err.code && ORG_ERROR_COPY[err.code]) || err.message
}

/** Plain words for the reason on a CSV row. */
export const CSV_REASON_COPY: Record<string, string> = {
  invalid_email: 'Not a valid email address',
  duplicate_in_file: 'Listed more than once in the file',
  role_not_allowed: 'You cannot invite this role',
  already_member: 'Already a member',
  in_another_org: 'Already in another organisation',
  open_invite_exists: 'Already has an open invitation',
  over_seats: 'No free seat left for this row',
}

/** Per-result copy for the invite form (`results[].result`). */
export const INVITE_RESULT_COPY: Record<string, string> = {
  created: 'Invitation sent',
  invalid_email: 'Not a valid email address',
  duplicate_in_request: 'Listed twice',
  already_member: 'Already a member',
  in_another_org: 'Already in another organisation',
  open_invite_exists: 'Already has an open invitation',
}
