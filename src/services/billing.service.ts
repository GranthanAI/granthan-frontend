import { api, requestBlob } from '@/lib/api-client'
import { uuid } from '@/lib/utils'
import type {
  BillingMe,
  ChangePlanRequest,
  CheckoutRequest,
  CheckoutResponse,
  InvoicesResponse,
  ModelsCatalogResponse,
  MyModelsResponse,
  PlansResponse,
  SubscriptionResult,
  UsageResponse,
  VerifyRequest,
  VerifyResponse,
} from '@/types/billing'

/** Every billing POST needs an Idempotency-Key; pass the same key to retry the same attempt. */
const idem = (key?: string) => ({ headers: { 'Idempotency-Key': key ?? uuid() } })

export const billingService = {
  plans: (signal?: AbortSignal) => api.get<PlansResponse>('/billing/plans', { signal, auth: false }),
  models: (signal?: AbortSignal) => api.get<ModelsCatalogResponse>('/billing/models', { signal, auth: false }),
  me: (signal?: AbortSignal) => api.get<BillingMe>('/billing/me', { signal }),
  myModels: (signal?: AbortSignal) => api.get<MyModelsResponse>('/billing/me/models', { signal }),
  usage: (range?: { from?: string; to?: string }, signal?: AbortSignal) =>
    api.get<UsageResponse>('/billing/me/usage', { signal, query: range }),
  invoices: (signal?: AbortSignal) => api.get<InvoicesResponse>('/billing/invoices', { signal }),
  invoicePdf: (id: string) => requestBlob(`/billing/invoices/${encodeURIComponent(id)}/pdf`),

  checkout: (body: CheckoutRequest, key?: string) => api.post<CheckoutResponse>('/billing/checkout', body, idem(key)),
  verify: (body: VerifyRequest, key: string) => api.post<VerifyResponse>('/billing/checkout/verify', body, idem(key)),
  changePlan: (body: ChangePlanRequest, key?: string) =>
    api.post<CheckoutResponse>('/billing/subscription/change', body, idem(key)),
  cancel: (key?: string) => api.post<SubscriptionResult>('/billing/subscription/cancel', {}, idem(key)),
  resume: (key?: string) => api.post<CheckoutResponse>('/billing/subscription/resume', {}, idem(key)),
}
