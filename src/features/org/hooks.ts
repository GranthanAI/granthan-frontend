import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/lib/errors'
import { orgService } from '@/services/org.service'
import { useAuthStore } from '@/stores/auth.store'

export const orgKeys = {
  all: ['org'] as const,
  me: ['org', 'me'] as const,
  members: (id: string) => ['org', id, 'members'] as const,
  invites: (id: string) => ['org', id, 'invites'] as const,
  links: (id: string) => ['org', id, 'links'] as const,
  policy: (id: string) => ['org', id, 'policy'] as const,
  usage: (id: string, from: string, to: string) => ['org', id, 'usage', from, to] as const,
  audit: (id: string) => ['org', id, 'audit'] as const,
  domains: (id: string) => ['org', id, 'domains'] as const,
  joinRequests: (id: string) => ['org', id, 'join-requests'] as const,
  domainMatch: ['org', 'domain-match'] as const,
  staff: ['org-admin'] as const,
}

/** The caller's organisation, or `null` when they are in none (the API's 404). Other failures stay errors. */
export function useOrgMe() {
  const enabled = useAuthStore((s) => !!s.accessToken)
  return useQuery({
    queryKey: orgKeys.me,
    queryFn: async ({ signal }) => {
      try {
        return await orgService.me(signal)
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null
        throw e
      }
    },
    enabled,
    staleTime: 30_000,
    retry: 1,
  })
}

export const isOrgAdmin = (role: string | undefined) => role === 'owner' || role === 'admin'
