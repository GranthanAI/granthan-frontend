import { describe, expect, it } from 'vitest'
import { ApiError, parseErrorBody } from '@/lib/errors'
import { formatIstDate, formatIstTime, formatLimit, formatPaise } from '@/lib/format'
import { denial } from './billing-fixtures'

describe('billing denial parsing', () => {
  const cases: Array<[number, string, string, Record<string, unknown>]> = [
    [429, 'daily_limit', 'limit.daily', { resets_at: '2026-11-16T00:00:00+05:30' }],
    [429, 'monthly_limit', 'limit.monthly', { resets_at: '2026-12-01T00:00:00+05:30' }],
    [403, 'model_not_in_plan', 'plan.model_not_included', {}],
    [403, 'account_blocked', 'account.blocked', {}],
    [402, 'no_credit', 'credits.empty', {}],
    [402, 'spend_cap', 'credits.spend_cap', {}],
    [402, 'member_spend_cap', 'credits.member_cap', {}],
    [403, 'plan_limit', 'limit.file_size_mb', { limit: 'file_size_mb' }],
  ]
  for (const [status, reason, key, extra] of cases) {
    it(`exposes a typed denial for ${reason}`, () => {
      const e = parseErrorBody(status, denial(reason, { message_key: key, ...extra }))
      expect(e.billingDenial).toMatchObject({ reason, message_key: key, message: `backend says ${reason}`, upgrade_to: 'pro' })
      expect(e.billingDenial?.resets_at).toBe(extra.resets_at)
      expect(e.billingDenial?.limit).toBe(extra.limit)
      expect(e.message).toBe(`backend says ${reason}`)
    })
  }
  it('billing_unavailable (503) keeps its typed denial; other server bodies stay hidden', () => {
    const e = parseErrorBody(503, denial('billing_unavailable', { message_key: 'billing.degraded' }))
    expect(e.billingDenial).toMatchObject({ reason: 'billing_unavailable', message_key: 'billing.degraded' })
    const other = parseErrorBody(500, { detail: { code: 'billing_denied', reason: 'plan_limit', message: 'internal' } })
    expect(other.billingDenial).toBeNull()
    expect(other.message).not.toMatch(/internal/)
  })
  it('is null for other errors and falls back to the default message', () => {
    expect(parseErrorBody(403, { detail: 'nope' }).billingDenial).toBeNull()
    expect(parseErrorBody(403, { detail: { code: 'other', reason: 'x' } }).billingDenial).toBeNull()
    expect(new ApiError('network', 'x').billingDenial).toBeNull()
    const d = parseErrorBody(402, { detail: { code: 'billing_denied', reason: 'no_credit' } })
    expect(d.billingDenial?.message).toBe('Request failed.')
  })
})

describe('formatters', () => {
  it('formats paise with Indian grouping', () => {
    expect(formatPaise(14990000)).toBe('₹1,49,900')
    expect(formatPaise(49900)).toBe('₹499')
    expect(formatPaise(49950)).toBe('₹499.50')
    expect(formatPaise(0)).toBe('₹0')
  })
  it('formats dates and times in IST', () => {
    expect(formatIstDate('2026-11-15T20:00:00Z')).toBe('16 Nov 2026')
    expect(formatIstTime('2026-11-15T18:30:00Z')).toBe('12:00 am')
    expect(formatIstTime('2026-11-15T06:30:00Z')).toBe('12:00 pm')
    expect(formatIstDate(null)).toBe('')
  })
  it('shows -1 as Unlimited', () => {
    expect(formatLimit(-1)).toBe('Unlimited')
    expect(formatLimit(25)).toBe('25')
    expect(formatLimit(100000)).toBe('1,00,000')
  })
})
