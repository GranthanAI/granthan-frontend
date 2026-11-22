import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Skeleton } from '@/components/ui/primitives'
import { ApiError } from '@/lib/errors'
import { formatIstDate } from '@/lib/format'
import { orgService } from '@/services/org.service'
import type { Me } from '@/types/org'
import { orgErrorMessage } from './errors'
import { orgKeys } from './hooks'
import { Card, FormError, Upsell } from './shared'

/** Join requests tab (owner and admin): people with a verified address on one of your domains who asked to join. */
export function JoinRequestsTab({ me }: { me: Me }) {
  const id = me.org.id
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const enabled = me.features.domains
  const list = useQuery({ queryKey: orgKeys.joinRequests(id), queryFn: ({ signal }) => orgService.joinRequests(id, signal), enabled })
  const done = async () => { setError(''); await qc.invalidateQueries({ queryKey: ['org', id] }); await qc.invalidateQueries({ queryKey: orgKeys.me }) }
  const approve = useMutation({ mutationFn: (rid: string) => orgService.approveJoinRequest(id, rid), onSuccess: done, onError: (e) => setError(orgErrorMessage(e)) })
  const decline = useMutation({ mutationFn: (rid: string) => orgService.declineJoinRequest(id, rid), onSuccess: done, onError: (e) => setError(orgErrorMessage(e)) })
  if (!enabled) return <Card title="Join requests"><Upsell what="Join requests from your domain" /></Card>
  return (
    <Card title="Join requests">
      <FormError message={error} />
      {list.isPending && <Skeleton className="h-12 w-full" />}
      {list.isError && <Alert tone="error">{orgErrorMessage(list.error)}</Alert>}
      {list.data?.items.length === 0 && <p className="text-sm text-ink-2">No one is waiting.</p>}
      <ul className="divide-y divide-line text-sm">
        {list.data?.items.map((r) => (
          <li key={r.id} className="flex items-center gap-2 py-2" data-testid="join-request-row">
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{r.name ?? r.email}</p><p className="truncate text-xs text-ink-3">{r.email} · asked {formatIstDate(r.created_at)}</p></div>
            <Button size="sm" variant="primary" loading={approve.isPending && approve.variables === r.id} onClick={() => approve.mutate(r.id)}>Approve</Button>
            <Button size="sm" onClick={() => decline.mutate(r.id)}>Decline</Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** Shown when the user is in no organisation: if their verified email matches a verified domain, offer to ask to join. */
export function NoOrganisation() {
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const match = useQuery({
    queryKey: orgKeys.domainMatch,
    queryFn: async ({ signal }) => {
      try { return await orgService.domainMatch(signal) } catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e }
    },
    retry: false,
  })
  const refresh = () => qc.invalidateQueries({ queryKey: orgKeys.domainMatch })
  const request = useMutation({ mutationFn: () => orgService.requestJoin(), onSuccess: refresh, onError: (e) => setError(orgErrorMessage(e)) })
  const cancel = useMutation({ mutationFn: (rid: string) => orgService.cancelJoinRequest(rid), onSuccess: refresh, onError: (e) => setError(orgErrorMessage(e)) })
  const m = match.data
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-raised p-5" data-testid="org-none">
      <h1 className="text-base font-semibold">Organisation</h1>
      <FormError message={error} />
      {m ? (
        <div data-testid="domain-match">
          <p className="text-sm"><strong>{m.org_name}</strong> is on GranthanAI. Your email address belongs to it.</p>
          {m.pending_request_id ? (
            <div className="mt-3 flex items-center gap-3"><span className="text-sm text-ink-2" data-testid="request-pending">Request sent. An admin will answer.</span><Button size="sm" loading={cancel.isPending} onClick={() => cancel.mutate(m.pending_request_id!)}>Cancel request</Button></div>
          ) : m.can_request && <Button className="mt-3" variant="primary" loading={request.isPending} onClick={() => request.mutate()}>Request to join</Button>}
        </div>
      ) : (
        <p className="text-sm text-ink-2">You are not in an organisation. If your college or company invited you, open the link in your invitation email, or ask your admin to invite you.</p>
      )}
    </section>
  )
}
