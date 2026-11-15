import { useQuery, type QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/errors'
import { qk } from '@/lib/query-keys'
import { billingService } from '@/services/billing.service'
import { useAuthStore } from '@/stores/auth.store'

const useSignedIn = () => useAuthStore((s) => !!s.accessToken)

/** The caller's plan, status, limits and today's usage. Refetched when the window regains focus. */
export function useBillingMe() {
  const enabled = useSignedIn()
  return useQuery({
    queryKey: qk.billingMe,
    queryFn: ({ signal }) => billingService.me(signal),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  })
}

/** Models grouped by what the plan allows. If this fails the model picker stays hidden. */
export function useMyModels() {
  const enabled = useSignedIn()
  return useQuery({
    queryKey: qk.billingModels,
    queryFn: ({ signal }) => billingService.myModels(signal),
    enabled,
    staleTime: 60_000,
    retry: 1,
  })
}

/** Public: works signed out. */
export function usePlans() {
  return useQuery({ queryKey: qk.billingPlans, queryFn: ({ signal }) => billingService.plans(signal), staleTime: 5 * 60_000, retry: 1 })
}

/** Public: the model catalog (ids, labels, groups) for naming models by group. */
export function useModelCatalog() {
  return useQuery({ queryKey: qk.billingCatalog, queryFn: ({ signal }) => billingService.models(signal), staleTime: 5 * 60_000, retry: 1 })
}

export function useUsage(range?: { from?: string; to?: string }) {
  const enabled = useSignedIn()
  return useQuery({
    queryKey: qk.billingUsage(range?.from, range?.to),
    queryFn: ({ signal }) => billingService.usage(range, signal),
    enabled,
    staleTime: 30_000,
  })
}

export function useInvoices() {
  const enabled = useSignedIn()
  return useQuery({ queryKey: qk.billingInvoices, queryFn: ({ signal }) => billingService.invoices(signal), enabled, staleTime: 30_000 })
}

/** After a completed chat turn (and after any billing change) usage and the plan summary are stale. */
export function invalidateBilling(qc: QueryClient, opts: { all?: boolean } = {}) {
  void qc.invalidateQueries({ queryKey: qk.billingMe, exact: true })
  void qc.invalidateQueries({ queryKey: qk.billingUsageAll })
  if (opts.all) {
    void qc.invalidateQueries({ queryKey: qk.billingModels })
    void qc.invalidateQueries({ queryKey: qk.billingInvoices })
  }
}

/** The GST state list, from billing (public, cacheable): there is no copy of it in the app. */
export function useGstStates() {
  return useQuery({ queryKey: qk.gstStates, queryFn: ({ signal }) => billingService.gstStates(signal), staleTime: 24 * 60 * 60_000, retry: 1 })
}

export function useBillingProfile() {
  const enabled = useSignedIn()
  return useQuery({ queryKey: qk.billingProfile, queryFn: ({ signal }) => billingService.profile(signal), enabled, staleTime: 30_000, retry: 1 })
}

/** The Pay as you Go entry of /billing/plans, when the API lists it. */
export function usePaygPlan() {
  const plans = usePlans().data?.plans
  return Array.isArray(plans) ? plans.find((p) => p.code === 'payg') : undefined
}

/**
 * Pay as you Go is on only when the plans list payg AND the wallet routes answer 200 (404 = off: nothing is shown, no error).
 * `known` is false until the wallet has answered, so callers can avoid flashing credits UI.
 */
export function useWallet() {
  const signedIn = useSignedIn()
  const payg = usePaygPlan()
  const q = useQuery({
    queryKey: qk.wallet,
    queryFn: ({ signal }) => billingService.wallet(signal),
    enabled: signedIn && !!payg,
    staleTime: 30_000,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  })
  const off = !payg || (q.isError && q.error instanceof ApiError && q.error.status === 404)
  return { enabled: !!payg && signedIn && !off && q.isSuccess, off, known: q.isSuccess || q.isError, wallet: q.data?.wallet ?? null, payg, query: q }
}
