import { api, request } from '@/lib/api-client'
import { uuid } from '@/lib/utils'

/** Billing's staff API through the gateway: /billing/admin/<x> -> /admin/billing/v1/<x>. */
const A = '/billing/admin'
const key = () => ({ headers: { 'Idempotency-Key': uuid() } })

/** The payment simulator's control routes (simulation mode only; billing_admin through the gateway). */
const S = '/billing/sim'

export interface Reasoned {
  reason: string
}

export const adminService = {
  get: <T>(path: string, query?: Record<string, string | number | undefined>, signal?: AbortSignal) => api.get<T>(`${A}${path}`, { query, signal }),
  post: <T>(path: string, body: unknown) => api.post<T>(`${A}${path}`, body, key()),
  put: <T>(path: string, body: unknown) => api.put<T>(`${A}${path}`, body, key()),
  sim: {
    get: <T>(path: string, query?: Record<string, string>) => api.get<T>(`${S}${path}`, { query }),
    post: <T>(path: string, body: unknown = {}) => api.post<T>(`${S}${path}`, body, key()),
  },
  /** The plans.yaml text. */
  exportYaml: () => request<string>(`${A}/catalog/export.yaml`, { headers: { Accept: 'application/yaml, text/plain, */*' } }),
}
