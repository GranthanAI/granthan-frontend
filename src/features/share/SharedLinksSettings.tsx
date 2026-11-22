import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Skeleton } from '@/components/ui/primitives'
import { ConfirmDialog, toast } from '@/components/ui/overlays'
import { SettingsSection } from '@/components/settings/controls'
import { SHARE_COPY } from '@/content/quickwins'
import { errorMessage } from '@/lib/errors'
import { qk } from '@/lib/query-keys'
import { shareService } from '@/services/quickwins.service'
import type { ShareItem } from '@/types/api'

/** Settings > Shared links: update a snapshot or delete a link. A link's address is never shown again, only refreshed or revoked. */
export function SharedLinksSettings() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: qk.shares, queryFn: ({ signal }) => shareService.list(signal) })
  const [removing, setRemoving] = useState<ShareItem | null>(null)
  const refresh = useMutation({
    mutationFn: (id: string) => shareService.refresh(id),
    onSuccess: () => {
      toast('Snapshot updated', 'success')
      void qc.invalidateQueries({ queryKey: qk.shares })
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => shareService.revoke(id),
    onSuccess: () => {
      setRemoving(null)
      void qc.invalidateQueries({ queryKey: qk.shares })
    },
  })
  const items = list.data?.items ?? []

  return (
    <SettingsSection title={SHARE_COPY.settingsTitle} description={SHARE_COPY.warning}>
      {list.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : list.isError ? (
        <Alert tone="error" action={<Button size="sm" onClick={() => void list.refetch()}>Retry</Button>}>
          {errorMessage(list.error)}
        </Alert>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-2">{SHARE_COPY.settingsEmpty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((s) => (
            <li key={s.share_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{s.title}</p>
                <p className="text-xs text-ink-3">
                  {s.scope === 'hierarchy' ? SHARE_COPY.scopeHierarchy : SHARE_COPY.scopeConversation} · {s.message_count} messages · {s.view_count} views
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => refresh.mutate(s.share_id)} loading={refresh.isPending && refresh.variables === s.share_id}>
                  {SHARE_COPY.update}
                </Button>
                <Button size="sm" variant="danger" onClick={() => setRemoving(s)}>
                  {SHARE_COPY.remove}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={SHARE_COPY.removeTitle}
        description={SHARE_COPY.removeBody}
        confirmLabel={SHARE_COPY.remove}
        loading={revoke.isPending}
        error={revoke.isError ? errorMessage(revoke.error) : null}
        onConfirm={() => removing && revoke.mutate(removing.share_id)}
      />
    </SettingsSection>
  )
}
