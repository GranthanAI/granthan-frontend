import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Skeleton } from '@/components/ui/primitives'
import { ConfirmDialog, toast } from '@/components/ui/overlays'
import { SettingsSection } from '@/components/settings/controls'
import { toApiError } from '@/lib/errors'
import { qk } from '@/lib/query-keys'
import { authService } from '@/services/auth.service'
import type { DeviceSession } from '@/types/api'

const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

/** Security → signed-in devices. Revoking takes effect when that device's access token expires. */
export function SessionsSettings() {
  const qc = useQueryClient()
  const sessions = useQuery({ queryKey: qk.sessions, queryFn: ({ signal }) => authService.sessions(signal), retry: 1 })
  const [target, setTarget] = useState<DeviceSession | 'others' | null>(null)
  const reload = () => qc.invalidateQueries({ queryKey: qk.sessions })

  const revoke = useMutation({
    mutationFn: (t: DeviceSession | 'others') => (t === 'others' ? authService.revokeOtherSessions() : authService.revokeSession(t.id)),
    onSuccess: () => {
      setTarget(null)
      void reload()
      toast('Signed out', 'success')
    },
  })

  const items = Array.isArray(sessions.data) ? sessions.data : []
  const others = items.filter((s) => !s.is_current)
  return (
    <>
      <SettingsSection
        title="Signed-in devices"
        description="Devices where you are signed in. Signing a device out stops it from renewing its session; it is fully signed out within about 15 minutes."
        actions={
          others.length > 0 ? (
            <Button size="sm" variant="danger" onClick={() => setTarget('others')}>
              Sign out other devices
            </Button>
          ) : undefined
        }
      >
        {sessions.isPending && <Skeleton className="h-12 w-full" />}
        {sessions.isError && (
          <Alert tone="error" action={<Button size="sm" onClick={() => void sessions.refetch()}>Retry</Button>}>
            {toApiError(sessions.error).message}
          </Alert>
        )}
        {sessions.data && items.length === 0 && <p className="text-sm text-ink-3">No active sessions found.</p>}
        {items.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {items.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {[s.browser, s.os].filter(Boolean).join(' on ') || s.device || 'Unknown device'}
                    {s.is_current && <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-xs font-normal">This device</span>}
                  </p>
                  <p className="text-xs text-ink-3">
                    {s.ip_address ? `${s.ip_address} · ` : ''}Last active {when(s.last_seen)}
                  </p>
                </div>
                {!s.is_current && (
                  <Button size="sm" onClick={() => setTarget(s)}>
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title={target === 'others' ? 'Sign out all other devices?' : 'Sign out this device?'}
        description="It will not be able to renew its session and is signed out within about 15 minutes."
        confirmLabel="Sign out"
        loading={revoke.isPending}
        error={revoke.isError ? toApiError(revoke.error).message : null}
        onConfirm={() => target && revoke.mutate(target)}
      />
    </>
  )
}
