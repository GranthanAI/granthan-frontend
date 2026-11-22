import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Skeleton, TextField } from '@/components/ui/primitives'
import { ConfirmDialog, toast } from '@/components/ui/overlays'
import { formatIstDate, formatPaise } from '@/lib/format'
import { cn } from '@/lib/utils'
import { orgService } from '@/services/org.service'
import type { Me, OrgRole } from '@/types/org'
import { CsvInvites } from './CsvInvites'
import { DomainsTab } from './DomainsTab'
import { INVITE_RESULT_COPY, orgErrorMessage } from './errors'
import { isOrgAdmin, orgKeys, useOrgMe } from './hooks'
import { InviteLinks } from './InviteLinks'
import { JoinRequestsTab, NoOrganisation } from './JoinRequests'
import { Card, Upsell } from './shared'

const TABS = ['Members', 'Invites', 'Join requests', 'Domains', 'Policies', 'Usage', 'Audit'] as const
type Tab = (typeof TABS)[number]

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' }

/** Settings → Organisation. Everyone in an organisation sees the summary; owners and admins also get the management tabs. */
export function OrganisationSettings() {
  const me = useOrgMe()
  if (me.isPending) return <Skeleton className="h-32 w-full" />
  if (me.isError) return <Alert tone="error">{orgErrorMessage(me.error)}</Alert>
  if (!me.data) return <NoOrganisation />
  return <OrgView me={me.data} />
}

function OrgView({ me }: { me: Me }) {
  const admin = isOrgAdmin(me.role)
  const [tab, setTab] = useState<Tab>('Members')
  return (
    <>
      <Summary me={me} />
      {admin && (
        <>
          <div role="tablist" aria-label="Manage organisation" className="flex gap-1 overflow-x-auto border-b border-line">
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={cn('shrink-0 px-3 py-2 text-sm', tab === t ? 'border-b-2 border-accent font-medium' : 'text-ink-2 hover:text-ink')}>{t}</button>
            ))}
          </div>
          <div role="tabpanel">
            {tab === 'Members' && <MembersTab me={me} />}
            {tab === 'Invites' && <InvitesTab me={me} />}
            {tab === 'Join requests' && <JoinRequestsTab me={me} />}
            {tab === 'Domains' && <DomainsTab me={me} />}
            {tab === 'Policies' && <PoliciesTab me={me} />}
            {tab === 'Usage' && <UsageTab me={me} />}
            {tab === 'Audit' && <AuditTab me={me} />}
          </div>
        </>
      )}
    </>
  )
}

function Summary({ me }: { me: Me }) {
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const leave = useMutation({
    mutationFn: () => orgService.leave(me.org.id),
    onSuccess: async () => { setConfirm(false); await qc.invalidateQueries({ queryKey: orgKeys.all }); toast('You left the organisation') },
    onError: (e) => setError(orgErrorMessage(e)),
  })
  const { seats, org } = me
  return (
    <section className="rounded-2xl border border-line bg-raised p-5" data-testid="org-summary">
      <h1 className="text-base font-semibold">{org.name}</h1>
      <p className="mt-1 text-sm text-ink-2">You are {me.role === 'admin' ? 'an' : 'a'} {(ROLE_LABEL[me.role] ?? me.role).toLowerCase()} of this {org.type}.</p>
      {org.status !== 'active' && org.status !== 'pilot' && <Alert tone="warn" className="mt-3">This organisation is {org.status.replace('_', ' ')}, so its plan is not applied right now.</Alert>}
      {org.pilot_ends_at && <p className="mt-2 text-sm text-ink-2">Pilot ends {formatIstDate(org.pilot_ends_at)}.</p>}
      {isOrgAdmin(me.role) && (
        <p className="mt-2 text-sm text-ink-2" data-testid="org-seats">
          Seats: {seats.used}{seats.bought != null ? ` of ${seats.bought}` : ''} used
          {seats.pending != null && <> · drops to {seats.pending} at the next renewal</>}
          {seats.over_by > 0 && <> · <strong>{seats.over_by} over</strong></>}
        </p>
      )}
      {me.role !== 'owner' && (
        <Button className="mt-4" onClick={() => { setError(''); setConfirm(true) }}>Leave organisation</Button>
      )}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => leave.mutate()} loading={leave.isPending} error={error}
        title={`Leave ${org.name}?`} description="You will lose the organisation’s plan. Your own chats and files stay with you." confirmLabel="Leave" />
    </section>
  )
}

function MembersTab({ me }: { me: Me }) {
  const id = me.org.id
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const [transferTo, setTransferTo] = useState<{ id: string; name: string } | null>(null)
  const list = useQuery({ queryKey: orgKeys.members(id), queryFn: ({ signal }) => orgService.members(id, { limit: 100 }, signal) })
  const done = () => qc.invalidateQueries({ queryKey: orgKeys.members(id) })
  const role = useMutation({
    mutationFn: (v: { userId: string; role: Exclude<OrgRole, 'owner'> }) => orgService.changeRole(id, v.userId, v.role),
    onSuccess: done, onError: (e) => setError(orgErrorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (userId: string) => orgService.removeMember(id, userId),
    onSuccess: async () => { setRemoving(null); await done() }, onError: (e) => setError(orgErrorMessage(e)),
  })
  const transfer = useMutation({
    mutationFn: (userId: string) => orgService.transferOwnership(id, userId),
    onSuccess: async () => { setTransferTo(null); await qc.invalidateQueries({ queryKey: orgKeys.all }); toast('Ownership transferred. You are now an admin.') },
    onError: (e) => { setTransferTo(null); setError(orgErrorMessage(e)) },
  })
  return (
    <Card title="Members">
      {error && <Alert tone="error">{error}</Alert>}
      {list.isPending && <Skeleton className="h-16 w-full" />}
      {list.isError && <Alert tone="error">{orgErrorMessage(list.error)}</Alert>}
      <ul className="divide-y divide-line">
        {list.data?.items.map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 py-2 text-sm" data-testid="member-row">
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{m.name ?? m.email ?? m.user_id}</p>{m.name && m.email && <p className="truncate text-xs text-ink-3">{m.email}</p>}</div>
            {m.role === 'owner' ? (
              <span className="text-ink-2">{ROLE_LABEL[m.role]}</span>
            ) : (
              <>
                {me.role === 'owner' ? (
                  <select aria-label={`Role of ${m.name ?? m.email}`} value={m.role} onChange={(e) => role.mutate({ userId: m.user_id, role: e.target.value as 'admin' | 'member' })}
                    className="h-8 rounded-lg border border-line bg-raised px-2 text-sm"><option value="member">Member</option><option value="admin">Admin</option></select>
                ) : <span className="text-ink-2">{ROLE_LABEL[m.role]}</span>}
                {me.role === 'owner' && m.role === 'admin' && <Button size="sm" onClick={() => { setError(''); setTransferTo({ id: m.user_id, name: m.name ?? m.email ?? 'this admin' }) }}>Make owner</Button>}
                {(me.role === 'owner' || m.role === 'member') && <Button size="sm" onClick={() => { setError(''); setRemoving(m.user_id) }}>Remove</Button>}
              </>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog open={!!transferTo} onClose={() => setTransferTo(null)} onConfirm={() => transferTo && transfer.mutate(transferTo.id)} loading={transfer.isPending}
        title={`Make ${transferTo?.name ?? ''} the owner?`} description="They become the owner of this organisation and you become an admin. Only the new owner can undo this." confirmLabel="Transfer ownership" />
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} onConfirm={() => removing && remove.mutate(removing)} loading={remove.isPending}
        title="Remove this member?" description="They lose the organisation’s plan straight away." confirmLabel="Remove" />
    </Card>
  )
}

function InvitesTab({ me }: { me: Me }) {
  const id = me.org.id
  const qc = useQueryClient()
  const [emails, setEmails] = useState('')
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const [error, setError] = useState('')
  const [results, setResults] = useState<Array<{ email: string; result: string }>>([])
  const invites = useQuery({ queryKey: orgKeys.invites(id), queryFn: ({ signal }) => orgService.invites(id, { limit: 50 }, signal) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['org', id] })
  const send = useMutation({
    mutationFn: () => orgService.invite(id, emails.split(/[\s,;]+/).filter(Boolean), role),
    onSuccess: async (r) => { setResults(r.results); setEmails(''); setError(''); await refresh() },
    onError: (e) => setError(orgErrorMessage(e)),
  })
  const revoke = useMutation({ mutationFn: (inviteId: string) => orgService.revokeInvite(id, inviteId), onSuccess: refresh, onError: (e) => setError(orgErrorMessage(e)) })
  const resend = useMutation({ mutationFn: (inviteId: string) => orgService.resendInvite(id, inviteId), onSuccess: () => toast('Invitation sent again'), onError: (e) => setError(orgErrorMessage(e)) })
  return (
    <>
      <Card title="Invite people">
        {error && <Alert tone="error">{error}</Alert>}
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (emails.trim()) send.mutate() }}>
          <TextField label="Email addresses (separate with spaces or commas)" value={emails} onChange={(e) => setEmails(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">Role
            <select value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')} className="h-8 rounded-lg border border-line bg-raised px-2 text-sm"><option value="member">Member</option>{me.role === 'owner' && <option value="admin">Admin</option>}</select>
          </label>
          <Button type="submit" variant="primary" loading={send.isPending} disabled={!emails.trim()}>Send invitations</Button>
        </form>
        {results.length > 0 && (
          <ul className="text-sm" data-testid="invite-results">{results.map((r) => <li key={r.email}>{r.email}: {INVITE_RESULT_COPY[r.result] ?? r.result}</li>)}</ul>
        )}
      </Card>
      <Card title="Open invitations">
        {invites.isPending && <Skeleton className="h-10 w-full" />}
        <ul className="divide-y divide-line">
          {invites.data?.items.filter((i) => i.status === 'open').map((i) => (
            <li key={i.invite_id} className="flex items-center gap-2 py-2 text-sm" data-testid="invite-row">
              <span className="min-w-0 flex-1 truncate">{i.email ?? 'Link'} · {i.role} · expires {formatIstDate(i.expires_at)}</span>
              <Button size="sm" onClick={() => resend.mutate(i.invite_id)}>Resend</Button>
              <Button size="sm" onClick={() => revoke.mutate(i.invite_id)}>Revoke</Button>
            </li>
          ))}
        </ul>
      </Card>
      <CsvInvites me={me} />
      <InviteLinks me={me} />
    </>
  )
}

function PoliciesTab({ me }: { me: Me }) {
  const id = me.org.id
  const qc = useQueryClient()
  const policy = useQuery({ queryKey: orgKeys.policy(id), queryFn: ({ signal }) => orgService.policy(id, signal) })
  const [lock, setLock] = useState<boolean | null>(null)
  const [cap, setCap] = useState<string | null>(null)
  const [error, setError] = useState('')
  const p = policy.data
  if (policy.isPending) return <Skeleton className="h-24 w-full" />
  if (!p) return <Alert tone="error">{orgErrorMessage(policy.error)}</Alert>
  const lockNow = lock ?? p.lock_modes
  const capNow = cap ?? (p.member_spend_cap_paise == null ? '' : String(p.member_spend_cap_paise / 100))
  const capPaise = capNow.trim() === '' ? null : Math.round(Number(capNow) * 100)
  const bad = capPaise != null && (!Number.isFinite(capPaise) || capPaise < 0)
  const save = async () => {
    setError('')
    try {
      await orgService.savePolicy(id, { lock_modes: lockNow, approved_mode_ids: p.approved_mode_ids, member_spend_cap_paise: me.features.spend_cap ? capPaise : p.member_spend_cap_paise })
      await qc.invalidateQueries({ queryKey: orgKeys.policy(id) })
      setLock(null); setCap(null); toast('Policies saved')
    } catch (e) { setError(orgErrorMessage(e)) }
  }
  return (
    <Card title="Policies">
      {error && <Alert tone="error">{error}</Alert>}
      {me.features.lock_modes
        ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={lockNow} onChange={(e) => setLock(e.target.checked)} /> Members may use only approved modes</label>
        : <Upsell what="Locking members to approved modes" />}
      {!me.features.spend_cap && <Upsell what="A monthly spend cap per member" />}
      {me.features.spend_cap && (
        <TextField label="Most one member can spend a month from the organisation wallet (₹, blank for no cap)" inputMode="decimal" value={capNow} onChange={(e) => setCap(e.target.value)} error={bad ? 'Enter an amount of 0 or more.' : undefined} />
      )}
      {p.member_spend_cap_paise != null && <p className="text-xs text-ink-3">Currently {formatPaise(p.member_spend_cap_paise)} a member.</p>}
      <Button variant="primary" disabled={bad || (lock === null && cap === null)} onClick={() => void save()}>Save</Button>
    </Card>
  )
}

const today = () => new Date().toISOString().slice(0, 10)
function UsageTab({ me }: { me: Me }) {
  const id = me.org.id
  const [from, setFrom] = useState(() => `${today().slice(0, 8)}01`)
  const [to, setTo] = useState(today)
  const usage = useQuery({ queryKey: orgKeys.usage(id, from, to), queryFn: ({ signal }) => orgService.usage(id, { from, to }, signal), enabled: me.features.usage_reports })
  if (!me.features.usage_reports) return <Card title="Usage"><Upsell what="Usage reports" /></Card>
  return (
    <Card title="Usage">
      <div className="flex gap-2"><TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      {usage.isPending && <Skeleton className="h-16 w-full" />}
      {usage.isError && <Alert tone="error">{orgErrorMessage(usage.error)}</Alert>}
      {usage.data && (
        <>
          <p className="text-sm" data-testid="usage-totals">{usage.data.totals.messages} messages · {usage.data.totals.billable_units} billable units</p>
          <ul className="divide-y divide-line text-sm">{usage.data.members.map((m) => <li key={m.user_id} className="flex justify-between py-1.5"><span>{m.name ?? m.email ?? m.user_id}</span><span>{m.messages}</span></li>)}</ul>
        </>
      )}
    </Card>
  )
}

function AuditTab({ me }: { me: Me }) {
  const id = me.org.id
  const audit = useQuery({ queryKey: orgKeys.audit(id), queryFn: ({ signal }) => orgService.audit(id, { limit: 50 }, signal) })
  return (
    <Card title="Audit log">
      {audit.isPending && <Skeleton className="h-16 w-full" />}
      {audit.isError && <Alert tone="error">{orgErrorMessage(audit.error)}</Alert>}
      <ul className="divide-y divide-line text-sm">{audit.data?.items.map((a) => <li key={a.id} className="py-1.5">{a.action} · {a.actor_label ?? a.actor_kind} · {formatIstDate(a.at)}</li>)}</ul>
    </Card>
  )
}
