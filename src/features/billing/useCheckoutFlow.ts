import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '@/lib/errors'
import { uuid } from '@/lib/utils'
import { billingService } from '@/services/billing.service'
import { qk } from '@/lib/query-keys'
import type { CheckoutResponse } from '@/types/billing'
import { invalidateBilling } from './hooks'
import { loadRazorpay, simulatorPayload, simulatorUrl, type PaymentProof } from './checkout-env'

export type FlowPhase = 'idle' | 'starting' | 'awaiting' | 'verifying' | 'success' | 'dismissed' | 'error'

const POPUP_NAME = 'granthan-checkout'
const POPUP_FEATURES = 'popup=yes,width=480,height=740'
/** After the popup closes, wait this long for a late message before calling it "not completed". */
const CLOSE_GRACE_MS = 800

/**
 * One payment attempt: start (POST /billing/checkout | change | resume) -> pay in the simulator popup or the Razorpay
 * modal -> POST /billing/checkout/verify (once, with an Idempotency-Key that is reused if the same attempt is retried).
 *
 * `begin` MUST be called synchronously from a click handler: it opens the popup immediately (so blockers allow it) and
 * only points it at the simulator once the server has answered. The popup is closed again on any error.
 */
/** What starting a payment returns: a subscription checkout or a wallet top-up order (both carry provider and razorpay options). */
export type PaymentStart = Pick<CheckoutResponse, 'provider' | 'simulator_url'> & { razorpay: CheckoutResponse['razorpay'] & { amount?: number; currency?: string } }

export function useCheckoutFlow(opts: {
  email: string
  onSuccess?: () => void
  /** How the proof is confirmed (default: a subscription's /checkout/verify). A top-up passes /wallet/topups/verify. */
  verifyWith?: (proof: PaymentProof, idempotencyKey: string) => Promise<unknown>
}) {
  const qc = useQueryClient()
  const [phase, setPhase] = useState<FlowPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null)

  const popup = useRef<Window | null>(null)
  const closeTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const detach = useRef<(() => void) | null>(null)
  const proof = useRef<PaymentProof | null>(null)
  const verifyKey = useRef<string | null>(null)
  const verifying = useRef(false)
  const last = useRef<(() => Promise<PaymentStart>) | null>(null)
  const alive = useRef(true)
  const onSuccess = useRef(opts.onSuccess)
  onSuccess.current = opts.onSuccess
  const verifyWith = useRef(opts.verifyWith)
  verifyWith.current = opts.verifyWith
  const email = useRef(opts.email)
  email.current = opts.email

  /** Removes the message listener and the popup watcher. Safe to call repeatedly. */
  const cleanup = useCallback(() => {
    detach.current?.()
    detach.current = null
    if (closeTimer.current) clearInterval(closeTimer.current)
    closeTimer.current = null
  }, [])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      cleanup()
    }
  }, [cleanup])

  const closePopup = () => {
    try {
      popup.current?.close()
    } catch {
      /* already gone */
    }
    popup.current = null
  }

  const fail = useCallback((message: string) => {
    if (!alive.current) return
    setError(message)
    setPhase('error')
  }, [])

  const verify = useCallback(
    async (p: PaymentProof) => {
      if (verifying.current) return // a duplicate message must not verify twice
      verifying.current = true
      proof.current = p
      verifyKey.current ??= uuid()
      if (alive.current) {
        setError(null)
        setPhase('verifying')
      }
      try {
        await (verifyWith.current ?? ((proof, key) => billingService.verify({ razorpay_payment_id: proof.razorpay_payment_id, razorpay_subscription_id: proof.razorpay_subscription_id ?? '', razorpay_signature: proof.razorpay_signature }, key)))(p, verifyKey.current)
      } catch (e) {
        verifying.current = false
        fail(`We could not confirm your payment: ${errorMessage(e)} Your attempt is kept: retry to confirm it without paying again.`)
        return
      }
      cleanup()
      closePopup()
      // The plan, what it unlocks and the invoices have all changed: picker unlocks at once.
      invalidateBilling(qc, { all: true })
      void qc.invalidateQueries({ queryKey: qk.wallet }) // a top-up changes the balance; a plan change can add or drop credits' use
      if (alive.current) setPhase('success')
      onSuccess.current?.()
    },
    [cleanup, fail, qc],
  )

  const watchSimulator = useCallback(
    (win: Window | null) => {
      cleanup()
      const onMessage = (event: MessageEvent) => {
        const p = simulatorPayload(event) // wrong origin / wrong source / malformed: ignored
        if (p) void verify(p)
      }
      window.addEventListener('message', onMessage)
      detach.current = () => window.removeEventListener('message', onMessage)
      if (!win) return
      let closedAt: number | null = null
      closeTimer.current = setInterval(() => {
        if (!win.closed || verifying.current || proof.current) return
        closedAt ??= Date.now()
        if (Date.now() - closedAt >= CLOSE_GRACE_MS) {
          cleanup()
          if (alive.current) setPhase('dismissed')
        }
      }, 300)
    },
    [cleanup, verify],
  )

  const runRazorpay = useCallback(
    async (res: PaymentStart) => {
      try {
        await loadRazorpay()
      } catch (e) {
        fail(e instanceof Error ? e.message : 'Could not load the payment window.')
        return
      }
      const o = res.razorpay
      const rz = new window.Razorpay!({
        key: o.key,
        ...(o.subscription_id ? { subscription_id: o.subscription_id } : {}),
        ...(o.order_id ? { order_id: o.order_id } : {}),
        ...(o.amount != null ? { amount: o.amount, currency: o.currency ?? 'INR' } : {}),
        name: o.name,
        description: o.description,
        prefill: { email: o.prefill?.email ?? email.current },
        notes: o.notes,
        theme: o.theme ?? { color: '#4f46e5' },
        handler: (r: PaymentProof) => void verify(r),
        modal: { ondismiss: () => !verifying.current && alive.current && setPhase('dismissed') },
      })
      setPhase('awaiting')
      rz.open()
    },
    [fail, verify],
  )

  const proceed = useCallback(
    async (res: PaymentStart) => {
      if (res.provider === 'simulator') {
        const url = simulatorUrl(res.simulator_url)
        if (!url) {
          closePopup()
          return fail('The payment simulator link was not valid.')
        }
        watchSimulator(popup.current)
        if (popup.current && !popup.current.closed) popup.current.location.href = url
        else setBlockedUrl(url) // pop-ups are blocked: the user opens it with one click
        if (alive.current) setPhase('awaiting')
        return
      }
      closePopup() // Razorpay opens its own modal in this page
      await runRazorpay(res)
    },
    [fail, runRazorpay, watchSimulator],
  )

  /** Call from a click handler. `start` performs the POST that creates the checkout. */
  const begin = useCallback(
    (start: () => Promise<PaymentStart>) => {
      last.current = start
      proof.current = null
      verifyKey.current = null // a fresh attempt gets a fresh verify key
      verifying.current = false
      setBlockedUrl(null)
      setError(null)
      setPhase('starting')
      cleanup()
      // Synchronously, inside the click: this is what pop-up blockers allow.
      popup.current = window.open('about:blank', POPUP_NAME, POPUP_FEATURES)
      start().then(proceed, (e) => {
        closePopup()
        fail(errorMessage(e))
      })
    },
    [cleanup, fail, proceed],
  )

  /** "Open payment window": the manual path when the browser blocked the pop-up. Runs inside a click. */
  const openBlocked = useCallback(() => {
    if (!blockedUrl) return
    const w = window.open(blockedUrl, POPUP_NAME, POPUP_FEATURES)
    if (w) {
      popup.current = w
      setBlockedUrl(null)
      watchSimulator(w)
    }
  }, [blockedUrl, watchSimulator])

  /** After an error: confirms the payment that already went through (same Idempotency-Key), else starts again. */
  const retry = useCallback(() => {
    if (proof.current) void verify(proof.current)
    else if (last.current) begin(last.current)
  }, [begin, verify])

  const reset = useCallback(() => {
    cleanup()
    closePopup()
    proof.current = null
    verifyKey.current = null
    verifying.current = false
    setBlockedUrl(null)
    setError(null)
    setPhase('idle')
  }, [cleanup])

  return { phase, error, blockedUrl, begin, openBlocked, retry, reset }
}
