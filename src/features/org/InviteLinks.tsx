import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Skeleton, TextField } from '@/components/ui/primitives'
import { formatIstDate } from '@/lib/format'
import { orgService } from '@/services/org.service'
import type { Me } from '@/types/org'
import { orgErrorMessage } from './errors'
import { orgKeys } from './hooks'
import { Card, copyWithToast, FormError, Upsell } from './shared'

const STATUS_COPY: Record<string, string> = { open: 'Open', used_up: 'Used up', expired: 'Expired', revoked: 'Revoked' }

/** Invites tab: links anyone can use until they expire or run out. A link restricted to a domain needs a verified domain. */
export function InviteLinks({ me }: { me: Me }) {
  const id = me.org.id
  const qc = useQueryClient()
  const [maxUses, setMaxUses] = useState('100')
  const [days, setDays] = useState('14')
  const [restricted, setRestricted] = useState(false)
  const [error, setError] = useState('')
  const enabled = me.features.invite_links
  const links = useQuery({ queryKey: orgKeys.links(id), queryFn: ({ signal }) => orgService.links(id, signal), enabled })
  const domains = useQuery({ queryKey: orgKeys.domains(id), queryFn: ({ signal }) => orgService.domains(id, signal), enabled: enabled && me.features.domains })
  const hasVerifiedDomain = !!domains.data?.items.some((d) => d.status === 'verified')

  const uses = Number(maxUses)
  const dayCount = Number(days)
  const usesBad = !Number.isInteger(uses) || uses < 1 || uses > 5000
  const daysBad = !Number.isInteger(dayCount) || dayCount < 1 || dayCount > 30
  const create = useMutation({
    mutationFn: () => orgService.createLink(id, { max_uses: uses, expires_in_days: dayCount, domain_restricted: restricted && hasVerifiedDomain }),
    onSuccess: async (l) => { setError(''); await qc.invalidateQueries({ queryKey: orgKeys.links(id) }); await copyWithToast(l.url, 'Link created and copied') },
    onError: (e) => setError(orgErrorMessage(e)),
  })
  const revoke = useMutation({
    mutationFn: (linkId: string) => orgService.revokeLink(id, linkId),
    onSuccess: () => qc.invalidateQueries({ queryKey: orgKeys.links(id) }),
    onError: (e) => setError(orgErrorMessage(e)),
  })
  const copy = useMutation({
    mutationFn: (linkId: string) => orgService.linkUrl(id, linkId),
    onSuccess: (r) => copyWithToast(r.url, 'Link copied'),
    onError: (e) => setError(orgErrorMessage(e)),
  })

  if (!enabled) return <Card title="Invite links"><Upsell what="Invite links" /></Card>
  return (
    <Card title="Invite links">
      <FormError message={error} />
      <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); if (!usesBad && !daysBad) create.mutate() }}>
        <TextField label="Most people who can join (1 to 5000)" inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} error={usesBad ? 'Enter a number from 1 to 5000.' : undefined} />
        <TextField label="Expires after (1 to 30 days)" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} error={daysBad ? 'Enter a number from 1 to 30.' : undefined} />
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={restricted && hasVerifiedDomain} disabled={!hasVerifiedDomain} onChange={(e) => setRestricted(e.target.checked)} />
          Only people with an email on a verified domain
        </label>
        {!hasVerifiedDomain && <p className="col-span-2 text-xs text-ink-3">{me.features.domains ? 'Verify a domain first (Domains tab) to restrict a link to it.' : 'Domain restriction is available on Org Pro and above.'}</p>}
        <div className="col-span-2"><Button type="submit" variant="primary" loading={create.isPending} disabled={usesBad || daysBad}>Create link</Button></div>
      </form>
      {links.isPending && <Skeleton className="h-10 w-full" />}
      <ul className="divide-y divide-line text-sm" data-testid="link-list">
        {links.data?.items.map((l) => (
          <li key={l.link_id} className="flex flex-wrap items-center gap-2 py-2" data-testid="link-row">
            <span className="min-w-0 flex-1">{STATUS_COPY[l.status] ?? l.status} · {l.uses}/{l.max_uses ?? '∞'} used · expires {formatIstDate(l.expires_at)}{l.domain_restricted ? ' · domain only' : ''}</span>
            {l.status === 'open' && <><Button size="sm" onClick={() => copy.mutate(l.link_id)}>Copy link</Button><Button size="sm" onClick={() => revoke.mutate(l.link_id)}>Revoke</Button></>}
          </li>
        ))}
      </ul>
    </Card>
  )
}
