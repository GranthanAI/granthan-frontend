/** Mirrors billing-service's REST response models (src/billing/api/rest/*). Money is integer paise (INR). -1 = unlimited. */

export type PlanCode = 'free' | 'pro' | 'max' | 'payg' | (string & {})
export type BillingInterval = 'month' | 'year'
export type ModelGroup = 'fast' | 'smart' | 'best' | 'ultra'

export interface PlanLimits {
  messages_per_day: number
  best_per_day: number
  branches_per_tree: number
  messages_per_conversation: number
  memory_facts: number
  context_tokens: number
  documents_per_tree: number
  file_size_mb: number
  youtube_per_month: number
  storage_mb: number
  custom_modes: number
  mode_instruction_chars: number
}
export type LimitName = keyof PlanLimits

/** Pay as you Go numbers (paise), sent with the payg entry of /billing/plans. */
export interface PaygInfo {
  unit_prices: Record<string, number>
  topup_packs: Array<{ code: string; price_paise: number }>
  credit_validity_months: number
  storage_over_10gb_per_gb_month: number
  long_message_tokens: number
  no_credit_fast_per_day: number
  max_messages_per_minute: number
}

export interface PlanEntry {
  payg?: PaygInfo
  code: PlanCode
  version: number
  rank: number
  prices: { month?: number; year?: number }
  groups: string[]
  extra_models: string[]
  limits: PlanLimits
}
export interface PlansResponse {
  catalog_version: number | string
  currency: 'INR'
  gst_inclusive: boolean
  plans: PlanEntry[]
}

export interface CatalogModel {
  id: string
  label: string
  provider: string
  group: ModelGroup | string
  sort_order: number
}
export interface ModelsCatalogResponse {
  models: CatalogModel[]
}

export type SubscriptionStatus = 'free' | 'active' | 'past_due' | 'suspended' | 'cancelling' | (string & {})

export interface PendingChange {
  kind: string
  plan_code: PlanCode
  interval: BillingInterval | null
  status: string
}
export interface UsageToday {
  total: number
  fast: number
  smart: number
  best: number
  ultra: number
  resets_at: string
}
export interface BillingMe {
  plan: { code: PlanCode; version: number; interval: BillingInterval | null; source: string }
  status: SubscriptionStatus
  current_period_end: string | null
  grace_until: string | null
  cancel_at_period_end: boolean
  pending_change: PendingChange | null
  limits: PlanLimits
  payment_mode: 'simulated' | 'live'
  payment_action_url: string | null
  usage_today: UsageToday
  usage_month: { youtube_videos: number }
  wallet: Record<string, unknown> | null
}

export interface MyModel {
  id: string
  label: string
  provider: string
  allowed: boolean
}
export interface MyModelGroup {
  group: ModelGroup | string
  allowed: boolean
  daily_limit: number
  remaining_today: number
  upgrade_to?: PlanCode | null
  funded_by?: string | null
  models: MyModel[]
}
export interface MyModelsResponse {
  plan: { code: PlanCode; source: string }
  default_group: string
  messages: { daily_limit: number; used_today: number; remaining_today: number; resets_at: string }
  groups: MyModelGroup[]
}

export interface UsageDay {
  day: string
  groups: Record<string, { messages: number; billable_units: number }>
}
export interface UsageResponse {
  from: string
  to: string
  days: UsageDay[]
}

export type InvoiceKind = 'tax_invoice' | 'bill_of_supply' | 'credit_note' | 'credit_note_bos' | (string & {})
export interface Invoice {
  id: string
  number: string
  kind: InvoiceKind
  issued_at: string
  taxable_paise: number
  cgst_paise: number
  sgst_paise: number
  igst_paise: number
  total_paise: number
  status: string
  original_number: string | null
  pdf_ready: boolean
}
export interface InvoicesResponse {
  invoices: Invoice[]
}
export const isCreditNote = (i: Pick<Invoice, 'kind'>) => i.kind.startsWith('credit_note')

export interface CheckoutRequest {
  plan_code: PlanCode
  interval: BillingInterval
  state_code: string
  email: string
  legal_name?: string
  gstin?: string
}
export interface ChangePlanRequest {
  plan_code: PlanCode
  interval: BillingInterval
}
export interface RazorpayCheckoutOptions {
  key: string
  subscription_id?: string
  order_id?: string
  name: string
  description: string
  prefill: { email: string }
  notes: Record<string, string>
  theme?: { color?: string }
}
/** What a plan change or resume costs and when it starts: computed by billing, never in the browser. */
export interface ChangeQuote {
  kind: 'upgrade' | 'downgrade' | 'interval_change' | 'resume'
  amount_due_now_paise: number
  refund_paise: number
  effective_at: string
  new_period_end: string
  price_paise: number
}

export interface BillingProfile {
  billing_email: string | null
  state_code: string | null
  state_name: string | null
  gstin: string | null
  legal_name: string | null
}
export interface BillingProfileInput {
  billing_email: string
  state_code: string
  gstin?: string | null
  legal_name?: string | null
}
export interface GstState {
  code: string
  name: string
}

export interface WalletLot {
  amount_paise: number
  remaining_paise: number
  expires_at: string
}
/** GET /billing/wallet -> { wallet }: null before the first top-up. Amounts are GST-inclusive paise. */
export interface Wallet {
  balance_paise: number | null
  monthly_cap_paise: number | null
  month_to_date_paise?: number | null
  lots?: WalletLot[]
}
export interface WalletTransaction {
  occurred_at: string
  kind: string
  ref_type?: string
  ref_id?: string
  /** positive for a top-up, negative for spending */
  amount_paise: number
}
export interface TopupRequest {
  pack_code: string
  state_code?: string
  email?: string
}
export interface TopupResponse {
  order_id: string
  amount_paise: number
  provider: 'razorpay' | 'simulator'
  simulator_url?: string
  razorpay: RazorpayCheckoutOptions & { amount?: number; currency?: string }
}
export interface TopupProof {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

export interface CheckoutResponse extends Partial<ChangeQuote> {
  subscription_id: string
  status: string
  razorpay: RazorpayCheckoutOptions
  provider: 'razorpay' | 'simulator'
  /** A PATH on the API origin (e.g. /api/v1/billing/sim/checkout/<id>?t=<token>). */
  simulator_url?: string
  change?: { id: string; kind: string }
}
export interface VerifyRequest {
  razorpay_payment_id: string
  razorpay_subscription_id: string
  razorpay_signature: string
}
export interface VerifyResponse {
  subscription_id: string
  status: string
}
export interface SubscriptionResult {
  subscription_id: string
  status: string
}

/** Plan 4.6: why a service refused a request. */
export type BillingDenyReason =
  | 'daily_limit'
  | 'monthly_limit'
  | 'model_not_in_plan'
  | 'account_blocked'
  | 'no_credit'
  | 'spend_cap'
  | 'member_spend_cap'
  | 'billing_unavailable'
  | 'plan_limit'

export interface BillingDenied {
  reason: BillingDenyReason | (string & {})
  message_key: string
  message: string
  resets_at?: string
  upgrade_to?: PlanCode | null
  limit?: string
  /** the model that was refused, when the service says (model_not_in_plan) */
  model?: string
}
/** A plan_limit denial: `limit` names which one (file_size_mb, branches_per_tree, ...). */
export interface PlanLimitDenied extends BillingDenied {
  reason: 'plan_limit'
  limit: string
}
export const isPlanLimitDenied = (d: BillingDenied | null | undefined): d is PlanLimitDenied => !!d && d.reason === 'plan_limit'

/** SSE `notice` event (e.g. usage.threshold_80). */
export interface StreamNotice {
  notice_key: string
  metric?: string
  used?: number
  limit?: number
  resets_at?: string
}
