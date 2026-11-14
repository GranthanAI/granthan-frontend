import { API_BASE_URL } from '@/lib/config'

/** The origin of the API gateway: the only origin the payment simulator popup is served from. */
export const API_ORIGIN = new URL(API_BASE_URL).origin

export const SIM_SOURCE = 'granthan-sim-checkout'
export const RAZORPAY_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

/** simulator_url is a PATH on the API origin (e.g. /api/v1/billing/sim/checkout/<id>?t=<token>). Anything else is refused. */
export function simulatorUrl(path: string | undefined): string | null {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return null
  try {
    const url = new URL(path, API_ORIGIN)
    return url.origin === API_ORIGIN ? url.toString() : null
  } catch {
    return null
  }
}

export interface PaymentProof {
  razorpay_payment_id: string
  razorpay_subscription_id: string
  razorpay_signature: string
}

/** A message from the simulator popup, or null for everything else (wrong origin, wrong source, malformed). */
export function simulatorPayload(event: Pick<MessageEvent, 'origin' | 'data'>): PaymentProof | null {
  if (event.origin !== API_ORIGIN) return null
  const d = event.data as Record<string, unknown> | null
  if (!d || typeof d !== 'object' || d.source !== SIM_SOURCE) return null
  const { razorpay_payment_id: p, razorpay_subscription_id: s, razorpay_signature: g } = d
  if (typeof p !== 'string' || typeof s !== 'string' || typeof g !== 'string' || !p || !s || !g) return null
  return { razorpay_payment_id: p, razorpay_subscription_id: s, razorpay_signature: g }
}

interface RazorpayInstance {
  open: () => void
  on?: (event: string, cb: (r: unknown) => void) => void
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance
  }
}

let razorpayLoading: Promise<void> | null = null
/** Loads Razorpay's checkout.js once (shared across calls). Rejects after a timeout or on a script error, and may then be retried. */
export function loadRazorpay(timeoutMs = 15_000): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  if (razorpayLoading) return razorpayLoading
  razorpayLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = RAZORPAY_SRC
    s.async = true
    const fail = (why: string) => {
      clearTimeout(timer)
      s.remove()
      razorpayLoading = null
      reject(new Error(why))
    }
    const timer = setTimeout(() => fail('Payment window took too long to load.'), timeoutMs)
    s.onload = () => {
      clearTimeout(timer)
      window.Razorpay ? resolve() : fail('Payment window did not start.')
    }
    s.onerror = () => fail('Could not load the payment window. Check your connection and ad blocker.')
    document.head.appendChild(s)
  })
  return razorpayLoading
}
