import { describe, expect, it } from 'vitest'
import { LIMIT_COPY, limitCopy } from '@/content/plans'
import { MESSAGE_KEYS, NOTICE_KEY_PREFIXES, PLAN_LIMIT_NAMES } from '@/content/message-keys'
import { noticeKey } from '@/features/billing/noticeCopy'
import type { BillingDenied } from '@/types/billing'

describe('every message_key a backend can return has words', () => {
  it.each(MESSAGE_KEYS.map((k) => [k.key, k.source]))('%s (%s)', (key) => {
    expect(limitCopy(key), `LIMIT_COPY has no entry for ${key}`).not.toBeNull()
  })

  it.each(PLAN_LIMIT_NAMES.map((k) => [k.key, k.source]))('plan_limit %s (%s) -> limit.<name>', (name) => {
    expect(limitCopy(`limit.${name}`), `LIMIT_COPY has no entry for limit.${name}`).not.toBeNull()
    const d: BillingDenied = { reason: 'plan_limit', message_key: `limit.${name}`, message: 'x', limit: name }
    expect(noticeKey(d)).toBe(`limit.${name}`)
  })

  it('no key is listed twice and every LIMIT_COPY entry belongs to a listed key or a plan limit', () => {
    const keys = MESSAGE_KEYS.map((k) => k.key)
    expect(new Set(keys).size).toBe(keys.length)
    const known = new Set([...keys, ...PLAN_LIMIT_NAMES.map((n) => `limit.${n.key}`)])
    expect(Object.keys(LIMIT_COPY).filter((k) => !known.has(k))).toEqual([])
  })

  it('stream notices are worded by quietMessage (usage.threshold_*), not LIMIT_COPY', () => {
    expect(NOTICE_KEY_PREFIXES).toEqual(['usage.threshold_'])
  })

  it('every entry says its source repo', () => {
    for (const k of [...MESSAGE_KEYS, ...PLAN_LIMIT_NAMES]) expect(k.source).toMatch(/-service$/)
  })
})
