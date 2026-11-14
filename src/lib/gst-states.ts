/**
 * GST state / union-territory codes: the place of supply a customer picks at checkout, and the first two digits of a GSTIN.
 *
 * Source: copied from billing-service `src/billing/domain/india.py` (STATE_NAMES), which follows the GST state code
 * list published by the GST Council / CBIC (https://services.gst.gov.in). Billing does not expose this list over its API,
 * so this is the ONE place the frontend keeps it. Code 25 (Daman and Diu) was merged into 26 in 2020; billing accepts
 * the same codes, so keep both lists in step.
 */
export const GST_STATES: ReadonlyArray<{ code: string; name: string }> = [
  ['01', 'Jammu and Kashmir'],
  ['02', 'Himachal Pradesh'],
  ['03', 'Punjab'],
  ['04', 'Chandigarh'],
  ['05', 'Uttarakhand'],
  ['06', 'Haryana'],
  ['07', 'Delhi'],
  ['08', 'Rajasthan'],
  ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'],
  ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'],
  ['13', 'Nagaland'],
  ['14', 'Manipur'],
  ['15', 'Mizoram'],
  ['16', 'Tripura'],
  ['17', 'Meghalaya'],
  ['18', 'Assam'],
  ['19', 'West Bengal'],
  ['20', 'Jharkhand'],
  ['21', 'Odisha'],
  ['22', 'Chhattisgarh'],
  ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'],
  ['26', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['27', 'Maharashtra'],
  ['28', 'Andhra Pradesh (before 2014)'],
  ['29', 'Karnataka'],
  ['30', 'Goa'],
  ['31', 'Lakshadweep'],
  ['32', 'Kerala'],
  ['33', 'Tamil Nadu'],
  ['34', 'Puducherry'],
  ['35', 'Andaman and Nicobar Islands'],
  ['36', 'Telangana'],
  ['37', 'Andhra Pradesh'],
  ['38', 'Ladakh'],
  ['97', 'Other Territory'],
].map(([code, name]) => ({ code: code!, name: name! }))

/** Same shape billing enforces (subscriptions.py GSTIN_RE): 2 digits, 5 letters, 4 digits, letter, 1-9/A-Z, Z, check char. */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

/** Returns an error message, or null when the GSTIN is acceptable for this state. An empty GSTIN is fine (it is optional). */
export function gstinError(gstin: string, stateCode: string): string | null {
  const g = gstin.trim().toUpperCase()
  if (!g) return null
  if (g.length !== 15) return 'A GSTIN has 15 characters.'
  if (!GSTIN_RE.test(g)) return 'This does not look like a valid GSTIN.'
  if (stateCode && g.slice(0, 2) !== stateCode) return 'The first two digits of the GSTIN must match the state you selected.'
  return null
}
