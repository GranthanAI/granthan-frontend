import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Skeleton, TextField } from '@/components/ui/primitives'
import { ConfirmDialog } from '@/components/ui/overlays'
import { formatIstDate } from '@/lib/format'
import { toApiError } from '@/lib/errors'
import { orgService } from '@/services/org.service'
import type { DnsRecord, Me, OrgDomain } from '@/types/org'
import { orgErrorMessage } from './errors'
import { orgKeys } from './hooks'
import { Card, copyWithToast, FormError, Upsell } from './shared'

function Record({ record }: { record: DnsRecord }) {
  return (
    <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 rounded-lg bg-surface-2 p-3 text-sm" data-testid="dns-record">
      <dt className="text-ink-3">Type</dt><dd className="font-mono">{record.type}</dd><span />
      <dt className="text-ink-3">Host</dt><dd className="font-mono">{record.host}</dd><Button size="sm" aria-label="Copy host" onClick={() => void copyWithToast(record.host)}>Copy</Button>
      <dt className="text-ink-3">Value</dt><dd className="break-all font-mono">{record.value}</dd><Button size="sm" aria-label="Copy value" onClick={() => void copyWithToast(record.value)}>Copy</Button>
    </dl>
  )
}

/** Domains tab (owner and admin): claim an email domain by publishing a TXT record, then let its members join on their own. */
export function DomainsTab({ me }: { me: Me }) {
  const id = me.org.id
  const qc = useQueryClient()
  const [domain, setDomain] = useState('')
  const [sub, setSub] = useState(false)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const enabled = me.features.domains
  const list = useQuery({ queryKey: orgKeys.domains(id), queryFn: ({ signal }) => orgService.domains(id, signal), enabled })
  const refresh = () => qc.invalidateQueries({ queryKey: orgKeys.domains(id) })
  const fail = (e: unknown) => setError(orgErrorMessage(e))

  const add = useMutation({
    mutationFn: () => orgService.addDomain(id, domain.trim().toLowerCase(), sub),
    onSuccess: async () => { setDomain(''); setError(''); await refresh() }, onError: fail,
  })
  const verify = useMutation({
    mutationFn: (d: string) => orgService.verifyDomain(id, d),
    onSuccess: async (_r, d) => { setNotFound(null); setError(''); await refresh(); void d },
    onError: (e, d) => {
      const err = toApiError(e)
      if (err.status === 409) { setNotFound(d); setError('') } else fail(e)
    },
  })
  const patch = useMutation({
    mutationFn: (v: { domain: string; body: { auto_join?: boolean; include_subdomains?: boolean } }) => orgService.patchDomain(id, v.domain, v.body),
    onSuccess: refresh, onError: fail,
  })
  const remove = useMutation({
    mutationFn: (d: string) => orgService.deleteDomain(id, d),
    onSuccess: async () => { setDeleting(null); await refresh() }, onError: fail,
  })

  if (!enabled) return <Card title="Domains"><Upsell what="Email domains and auto-join" /></Card>
  return (
    <Card title="Domains">
      <p className="text-sm text-ink-2">Claim your email domain (like college.edu). People who sign up with a verified address on it can ask to join, or join straight away if you turn on auto-join.</p>
      <FormError message={error} />
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (domain.trim()) add.mutate() }}>
        <TextField label="Domain" placeholder="college.edu" value={domain} onChange={(e) => setDomain(e.target.value)} className="w-64" />
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={sub} onChange={(e) => setSub(e.target.checked)} /> Include subdomains</label>
        <Button type="submit" variant="primary" loading={add.isPending} disabled={!domain.trim()}>Add domain</Button>
      </form>
      {list.isPending && <Skeleton className="h-12 w-full" />}
      <ul className="space-y-3">
        {list.data?.items.map((d: OrgDomain) => (
          <li key={d.domain} className="space-y-2 rounded-xl border border-line p-3 text-sm" data-testid="domain-row">
            <div className="flex items-center gap-2">
              <strong className="min-w-0 flex-1 truncate">{d.domain}</strong>
              <span className="rounded bg-surface-2 px-2 py-0.5 text-xs">{d.status === 'verified' ? 'Verified' : 'Waiting for the DNS record'}</span>
              <Button size="sm" onClick={() => setDeleting(d.domain)}>Delete</Button>
            </div>
            {d.status === 'pending' && (
              <>
                <p>Add this TXT record at your DNS provider, then press Verify now.</p>
                {d.dns_record && <Record record={d.dns_record} />}
                <p className="text-xs text-ink-3">DNS changes can take a while to spread. We also check every hour for 7 days.</p>
                {notFound === d.domain && <Alert tone="warn">We could not find that record yet. Check that the host and value match exactly, wait a few minutes, then try again.</Alert>}
                <Button size="sm" variant="primary" loading={verify.isPending && verify.variables === d.domain} onClick={() => verify.mutate(d.domain)}>Verify now</Button>
              </>
            )}
            {d.status === 'verified' && (
              <div className="space-y-1">
                <p className="text-xs text-ink-3">Verified {formatIstDate(d.verified_at)}{d.verify_method === 'manual' ? ' by GranthanAI staff' : ''}.</p>
                <label className="flex items-center gap-2"><input type="checkbox" checked={d.auto_join} onChange={(e) => patch.mutate({ domain: d.domain, body: { auto_join: e.target.checked } })} /> Let people with this domain join automatically</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={d.include_subdomains} onChange={(e) => patch.mutate({ domain: d.domain, body: { include_subdomains: e.target.checked } })} /> Include subdomains</label>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting)} loading={remove.isPending}
        title={`Delete ${deleting ?? 'domain'}?`} description="People with this domain can no longer join on their own. Current members stay." confirmLabel="Delete" />
    </Card>
  )
}
