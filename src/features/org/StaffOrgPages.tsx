import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Skeleton, TextField } from '@/components/ui/primitives'
import { ReasonDialog } from '@/features/admin/ReasonDialog'
import { useStaffRole } from '@/features/admin/useStaffRole'
import { formatIstDate } from '@/lib/format'
import { orgAdminService } from '@/services/org-admin.service'
import type { CreateOrgInput, OrgType, StaffOrg, StaffOrgDetail } from '@/types/org'
import { orgErrorMessage } from './errors'
import { orgKeys } from './hooks'

type Action = 'suspend' | 'reactivate' | 'close' | 'extend' | 'seats' | 'create'

/** Organisation writes need staff role `admin` (billing_admin may not), so this is stricter than the billing console's canWrite. */
const useOrgWriter = () => useStaffRole().role === 'admin'

/** /admin/orgs: find an organisation, see its seats and members, and (admin only) create, suspend, reactivate, extend or close one. */
export function StaffOrgsPage() {
  const writer = useOrgWriter()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [action, setAction] = useState<{ kind: Action; org?: StaffOrg } | null>(null)
  const list = useQuery({ queryKey: [...orgKeys.staff, 'list', submitted], queryFn: ({ signal }) => orgAdminService.search({ q: submitted || undefined, limit: 50 }, signal), retry: false })
  const refresh = () => qc.invalidateQueries({ queryKey: orgKeys.staff })
  return (
    <>
      <div className="flex items-center justify-between"><h1 className="text-xl font-semibold">Organisations</h1>{writer && <Button variant="primary" onClick={() => setAction({ kind: 'create' })}>New organisation</Button>}</div>
      <form role="search" className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); setSubmitted(q.trim()); setOpen(null) }}>
        <TextField label="Name or slug" value={q} onChange={(e) => setQ(e.target.value)} className="w-80" />
        <Button type="submit" variant="primary">Search</Button>
      </form>
      {list.isPending && <Skeleton className="h-20 w-full" />}
      {list.isError && <Alert tone="error">{orgErrorMessage(list.error)}</Alert>}
      {list.data?.items.length === 0 && <p className="text-sm text-ink-2">No organisations found.</p>}
      <ul className="divide-y divide-line rounded-xl border border-line">
        {list.data?.items.map((o) => (
          <li key={o.id} data-testid="staff-org-row">
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-surface-2" onClick={() => setOpen(open === o.id ? null : o.id)}>
              <span className="min-w-0 flex-1 truncate font-medium">{o.name}</span><span className="text-ink-2">{o.type}</span><span className="rounded bg-surface-2 px-2 py-0.5 text-xs">{o.status}</span>
            </button>
            {open === o.id && <OrgDetail id={o.id} org={o} writer={writer} onAction={(kind) => setAction({ kind, org: o })} />}
          </li>
        ))}
      </ul>
      {action && <ActionDialog action={action} onClose={() => setAction(null)} onDone={refresh} />}
    </>
  )
}

function OrgDetail({ id, org, writer, onAction }: { id: string; org: StaffOrg; writer: boolean; onAction: (a: Action) => void }) {
  const d = useQuery({ queryKey: [...orgKeys.staff, 'detail', id], queryFn: ({ signal }) => orgAdminService.get(id, signal) })
  const members = useQuery({ queryKey: [...orgKeys.staff, 'members', id], queryFn: ({ signal }) => orgAdminService.members(id, { limit: 50 }, signal) })
  const det: StaffOrgDetail | undefined = d.data
  return (
    <div className="space-y-3 border-t border-line bg-surface-2/40 px-4 py-3 text-sm" data-testid="staff-org-detail">
      {d.isPending && <Skeleton className="h-10 w-full" />}
      {d.isError && <Alert tone="error">{orgErrorMessage(d.error)}</Alert>}
      {det && (
        <>
          <p>Billing email: {det.billing_email ?? 'none'} · {det.active_count} active members{det.pilot_ends_at ? ` · pilot ends ${formatIstDate(det.pilot_ends_at)}` : ''}</p>
          <p data-testid="staff-seats">{det.seat_state ? `${det.seat_state.plan_code} (${det.seat_state.variant}), ${det.seat_state.seats_bought ?? 'unlimited'} seats, ${det.seat_state.status}, set by ${det.seat_state.source}` : 'No seats set.'}</p>
        </>
      )}
      <ul className="max-h-40 overflow-y-auto">{members.data?.items.map((m) => <li key={m.user_id}>{m.name ?? m.email ?? m.user_id} · {m.role}</li>)}</ul>
      {writer ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onAction('seats')}>Set seats</Button>
          {org.status === 'suspended' ? <Button size="sm" onClick={() => onAction('reactivate')}>Reactivate</Button> : <Button size="sm" onClick={() => onAction('suspend')}>Suspend</Button>}
          {(org.status === 'pilot' || org.status === 'pilot_expired') && <Button size="sm" onClick={() => onAction('extend')}>Extend pilot</Button>}
          {org.status !== 'closed' && <Button size="sm" variant="danger" onClick={() => onAction('close')}>Close</Button>}
        </div>
      ) : <p className="text-xs text-ink-3">Read-only: changes need the admin staff role.</p>}
    </div>
  )
}

function ActionDialog({ action, onClose, onDone }: { action: { kind: Action; org?: StaffOrg }; onClose: () => void; onDone: () => unknown }) {
  const { kind, org } = action
  const [days, setDays] = useState('14')
  const [seats, setSeats] = useState('')
  const [plan, setPlan] = useState('org_pro')
  const [name, setName] = useState('')
  const [type, setType] = useState<OrgType>('college')
  const [billing, setBilling] = useState('')
  const [owner, setOwner] = useState('')
  const [pilot, setPilot] = useState(true)
  const id = org?.id ?? ''
  const run = async (reason: string) => {
    if (kind === 'suspend') await orgAdminService.suspend(id, reason)
    else if (kind === 'reactivate') await orgAdminService.reactivate(id, reason)
    else if (kind === 'close') await orgAdminService.close(id, reason)
    else if (kind === 'extend') await orgAdminService.extendPilot(id, Number(days), reason)
    else if (kind === 'seats') await orgAdminService.setSeats(id, { plan_code: plan, variant: org?.type === 'company' ? 'company' : 'college', seats_bought: Number(seats), reason })
    else {
      const body: CreateOrgInput = { name: name.trim(), type, billing_email: billing.trim(), owner_email: owner.trim(), pilot, reason }
      await orgAdminService.create(body)
    }
    await onDone()
  }
  const titles: Record<Action, string> = { suspend: 'Suspend organisation', reactivate: 'Reactivate organisation', close: 'Close organisation', extend: 'Extend pilot', seats: 'Set seats', create: 'New organisation' }
  return (
    <ReasonDialog title={`${titles[kind]}${org ? `: ${org.name}` : ''}`} confirmLabel={titles[kind]} typed={kind === 'close' ? 'CLOSE' : undefined}
      description={kind === 'close' ? 'Closing ends every membership. This cannot be undone.' : undefined} onConfirm={run} onClose={onClose}>
      {kind === 'extend' && <TextField label="Days (1 to 30)" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />}
      {kind === 'seats' && (<><TextField label="Plan code (org_pro or org_max)" value={plan} onChange={(e) => setPlan(e.target.value)} /><TextField label="Seats" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} /></>)}
      {kind === 'create' && (
        <>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="block text-sm">Type <select value={type} onChange={(e) => setType(e.target.value as OrgType)} className="ml-2 h-8 rounded-lg border border-line bg-raised px-2"><option value="college">College</option><option value="company">Company</option></select></label>
          <TextField label="Billing email" value={billing} onChange={(e) => setBilling(e.target.value)} />
          <TextField label="Owner email" value={owner} onChange={(e) => setOwner(e.target.value)} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pilot} onChange={(e) => setPilot(e.target.checked)} /> Start as a pilot</label>
        </>
      )}
    </ReasonDialog>
  )
}
