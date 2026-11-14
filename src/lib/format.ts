const IST = 'Asia/Kolkata'

/** Integer paise -> "₹1,49,900" (Indian digit grouping; paise shown only when non-zero: "₹499.50"). */
export function formatPaise(paise: number): string {
  const neg = paise < 0
  const abs = Math.abs(Math.round(paise))
  const rupees = Math.floor(abs / 100)
  const rem = abs % 100
  const s = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(rupees)
  return `${neg ? '-' : ''}₹${s}${rem ? `.${String(rem).padStart(2, '0')}` : ''}`
}

/** "15 Nov 2026" in IST. */
export function formatIstDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}

/** "12:00 am" in IST. */
export function formatIstTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(d)
    .replace(/\s?(AM|PM)$/, (_, m: string) => ` ${m.toLowerCase()}`)
}

/** -1 means unlimited. */
export function formatLimit(n: number | null | undefined): string {
  if (n === -1) return 'Unlimited'
  if (n == null) return '—'
  return new Intl.NumberFormat('en-IN').format(n)
}
