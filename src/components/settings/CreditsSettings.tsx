import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Skeleton, TextField } from '@/components/ui/primitives'
import { toast } from '@/components/ui/overlays'
import { SettingsSection } from '@/components/settings/controls'
import { TopupDialog } from '@/features/billing/TopupDialog'
import { useWallet } from '@/features/billing/hooks'
import { errorMessage } from '@/lib/errors'
import { formatIstDate, formatPaise } from '@/lib/format'
import { qk } from '@/lib/query-keys'
import { billingService } from '@/services/billing.service'
import type { Wallet, WalletTransaction } from '@/types/billing'

const PAGE = 10

/** What a ledger transaction is called (billing's kinds). */
export const TX_LABEL: Record<string, string> = {
  wallet_topup: 'Top-up',
  payg_usage: 'Usage',
  credit_expiry: 'Credits expired',
  subscription_refund: 'Refund',
  refund: 'Refund',
}
export const txLabel = (kind: string) => TX_LABEL[kind] ?? kind.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** The credits that run out first: what, and when. */
export function expiringSoon(wallet: Wallet | null): { amount: number; at: string } | null {
  const lots = (wallet?.lots ?? []).filter((l) => l.remaining_paise > 0)
  if (!lots.length) return null
  const first = [...lots].sort((a, b) => +new Date(a.expires_at) - +new Date(b.expires_at))[0]!
  const at = first.expires_at
  return { amount: lots.filter((l) => l.expires_at === at).reduce((s, l) => s + l.remaining_paise, 0), at }
}

/** Settings → Billing → Credits. Rendered only while Pay as you Go is on (plans list payg and the wallet answers 200). */
export function CreditsSettings() {
  const { enabled, wallet } = useWallet()
  const [topup, setTopup] = useState(false)
  if (!enabled) return null
  const soon = expiringSoon(wallet)
  return (
    <>
      <SettingsSection title="Credits" description="Pay as you Go credits, including GST. They are spent only when a message uses a model your plan does not cover.">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm" data-testid="credits-summary">
          <dt className="text-ink-3">Balance</dt>
          <dd className="font-semibold" data-testid="credits-balance">{formatPaise(wallet?.balance_paise ?? 0)}</dd>
          {soon && (
            <>
              <dt className="text-ink-3">Expiring soon</dt>
              <dd data-testid="credits-expiring">{formatPaise(soon.amount)} on {formatIstDate(soon.at)}</dd>
            </>
          )}
        </dl>
        <div><Button variant="primary" onClick={() => setTopup(true)}>Top up credits</Button></div>
      </SettingsSection>
      <SpendCap wallet={wallet} />
      <Transactions />
      {topup && <TopupDialog onClose={() => setTopup(false)} />}
    </>
  )
}

function SpendCap({ wallet }: { wallet: Wallet | null }) {
  const qc = useQueryClient()
  const cap = wallet?.monthly_cap_paise ?? null
  const [rupees, setRupees] = useState<string | null>(null)
  const shown = rupees ?? (cap != null ? String(cap / 100) : '')
  const whole = /^\d{1,9}$/.test(shown.trim())
  const invalid = shown.trim() !== '' && !whole
  const save = useMutation({
    mutationFn: (paise: number | null) => billingService.saveWalletCap(paise),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.wallet })
      setRupees(null)
      toast('Spend cap saved', 'success')
    },
  })
  const used = wallet?.month_to_date_paise ?? 0
  return (
    <SettingsSection title="Monthly spend cap" description="Sending with credits pauses when you reach this amount in a month. We warn you at 80% and 100%.">
      <p className="text-sm text-ink-2" data-testid="cap-usage">
        {cap != null ? `${formatPaise(used)} of ${formatPaise(cap)} used this month` : `${formatPaise(used)} used this month, no cap set`}
      </p>
      {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
      <form noValidate className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (whole) save.mutate(Number(shown.trim()) * 100) }}>
        <TextField label="Cap in rupees (GST included)" inputMode="numeric" value={shown} onChange={(e) => setRupees(e.target.value)} error={invalid ? 'Enter a whole number of rupees.' : undefined} className="w-56" />
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!whole}>Save cap</Button>
        {cap != null && <Button onClick={() => save.mutate(null)} disabled={save.isPending}>Remove cap</Button>}
      </form>
    </SettingsSection>
  )
}

function Transactions() {
  const q = useQuery({ queryKey: qk.walletTransactions, queryFn: ({ signal }) => billingService.walletTransactions(200, signal), staleTime: 15_000 })
  const [page, setPage] = useState(0)
  const rows: WalletTransaction[] = q.data?.transactions ?? []
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const slice = rows.slice(page * PAGE, page * PAGE + PAGE)
  return (
    <SettingsSection title="Credit history" description="Top-ups, usage, refunds and expired credits, newest first.">
      {q.isPending && <Skeleton className="h-16 w-full" />}
      {q.isError && <Alert tone="error" action={<Button size="sm" onClick={() => void q.refetch()}>Retry</Button>}>Could not load your credit history. {errorMessage(q.error)}</Alert>}
      {q.isSuccess && rows.length === 0 && <p className="text-sm text-ink-3">No transactions yet.</p>}
      {slice.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Credit transactions">
          {slice.map((t, i) => (
            <li key={`${t.occurred_at}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div><p className="font-medium">{txLabel(t.kind)}</p><p className="text-xs text-ink-3">{formatIstDate(t.occurred_at)}</p></div>
              <span className={t.amount_paise >= 0 ? 'font-medium text-ok' : 'font-medium'}>{t.amount_paise >= 0 ? '+' : '-'}{formatPaise(Math.abs(t.amount_paise))}</span>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Button size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>Previous</Button>
          <span className="text-ink-3">Page {page + 1} of {pages}</span>
          <Button size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= pages - 1}>Next</Button>
        </div>
      )}
    </SettingsSection>
  )
}
