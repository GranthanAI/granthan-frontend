import { useRef, useState } from 'react'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Dialog } from '@/components/ui/overlays'
import { Alert, Button, Spinner } from '@/components/ui/primitives'
import { errorMessage } from '@/lib/errors'
import { formatPaise } from '@/lib/format'
import { uuid } from '@/lib/utils'
import { authService } from '@/services/auth.service'
import { billingService } from '@/services/billing.service'
import type { TopupProof } from '@/types/billing'
import type { PaymentProof } from './checkout-env'
import { useBillingProfile, useWallet } from './hooks'
import { useCheckoutFlow } from './useCheckoutFlow'

/** Buy credits: pick a pack, pay in the simulator popup or Razorpay (the same handling as a subscription), then confirm. */
export function TopupDialog({ onClose }: { onClose: () => void }) {
  const { payg } = useWallet()
  const profile = useBillingProfile()
  const user = useQuery({ queryKey: ['auth', 'me'], queryFn: () => authService.me(), staleTime: 60_000 })
  const email = profile.data?.billing_email || user.data?.email || ''
  const packs = payg?.payg?.topup_packs ?? []
  const [pack, setPack] = useState('')
  const attemptKey = useRef<string | null>(null)
  const flow = useCheckoutFlow({
    email,
    verifyWith: (p: PaymentProof, key: string) => {
      const proof: TopupProof = { razorpay_order_id: p.razorpay_order_id ?? '', razorpay_payment_id: p.razorpay_payment_id, razorpay_signature: p.razorpay_signature }
      return billingService.verifyTopup(proof, key)
    },
  })
  const busy = flow.phase === 'starting' || flow.phase === 'awaiting' || flow.phase === 'verifying'
  const chosen = pack || packs[0]?.code || ''
  const price = packs.find((p) => p.code === chosen)?.price_paise

  const start = () => {
    if (!chosen) return
    attemptKey.current ??= uuid()
    const key = attemptKey.current
    const stateCode = profile.data?.state_code ?? undefined
    flow.begin(() => billingService.topup({ pack_code: chosen, ...(stateCode ? { state_code: stateCode } : {}), ...(email ? { email } : {}) }, key))
  }

  return (
    <Dialog open onClose={() => (flow.phase === 'verifying' ? undefined : onClose())} title="Top up credits" className="max-w-md">
      {flow.phase === 'success' ? (
        <div className="space-y-4 text-center" data-testid="topup-success">
          <CheckCircle2 className="mx-auto size-10 text-ok" aria-hidden />
          <p className="text-sm text-ink-2">Your credits are in your wallet.</p>
          <Button onClick={onClose}>Close</Button>
        </div>
      ) : (
        <div className="space-y-4">
          {packs.length === 0 ? (
            <Alert tone="warn">No top-up packs are available right now.</Alert>
          ) : (
            <div role="radiogroup" aria-label="Top-up pack" className="grid gap-2">
              {packs.map((p) => (
                <button key={p.code} role="radio" aria-checked={chosen === p.code} disabled={busy}
                  onClick={() => { attemptKey.current = null; setPack(p.code) }}
                  className={`flex items-center justify-between rounded-xl border px-3.5 py-3 text-left text-sm ${chosen === p.code ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2'}`}>
                  <span className="font-medium">{formatPaise(p.price_paise)}</span>
                  <span className="text-xs text-ink-3">incl. GST</span>
                </button>
              ))}
            </div>
          )}
          {flow.phase === 'awaiting' && !flow.blockedUrl && <p role="status" className="flex items-center gap-2 text-sm text-ink-2"><Spinner /> Complete the payment in the window we opened…</p>}
          {flow.blockedUrl && (
            <Alert tone="warn" action={<Button size="sm" variant="primary" onClick={flow.openBlocked}><ExternalLink className="size-3.5" /> Open payment window</Button>}>Your browser blocked the payment pop-up.</Alert>
          )}
          {flow.phase === 'verifying' && <p role="status" className="flex items-center gap-2 text-sm text-ink-2"><Spinner /> Confirming your payment…</p>}
          {flow.phase === 'dismissed' && <Alert tone="warn" action={<Button size="sm" onClick={flow.retry}>Try again</Button>}>Payment not completed. You haven't been charged for this attempt.</Alert>}
          {flow.phase === 'error' && flow.error && <Alert tone="error" action={<Button size="sm" onClick={flow.retry}>Try again</Button>}>{errorMessage(new Error(flow.error))}</Alert>}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose} disabled={flow.phase === 'verifying'}>Cancel</Button>
            <Button variant="primary" onClick={start} loading={flow.phase === 'starting'} disabled={busy || !chosen}>
              {price != null ? `Pay ${formatPaise(price)}` : 'Continue'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
