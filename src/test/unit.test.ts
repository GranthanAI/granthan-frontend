import { describe, expect, it } from 'vitest'
import { buildTree, flatten, mergeConversations, pathTo } from '@/features/conversations/tree'
import { buildDisplay } from '@/features/messages/display'
import { parseErrorBody } from '@/lib/errors'
import { SseParser } from '@/lib/streaming'
import { loginSchema, passwordSchema, signupSchema, validateFile } from '@/lib/validation'
import type { ApiMessage, Conversation } from '@/types/api'

const conv = (id: string, parent: string | null = null, t = '2026-01-01T00:00:00Z'): Conversation => ({
  conversation_id: id,
  user_id: 'u',
  title: `T-${id}`,
  created_at: t,
  updated_at: t,
  status: 'active',
  parent_conversation_id: parent,
})

describe('conversation tree', () => {
  it('nests children strictly by parent_conversation_id', () => {
    const tree = buildTree([conv('a'), conv('b', 'a'), conv('c', 'b'), conv('d')])
    const a = tree.find((n) => n.conversation.conversation_id === 'a')!
    expect(a.children.map((c) => c.conversation.conversation_id)).toEqual(['b'])
    expect(a.children[0]!.children[0]!.depth).toBe(2)
    expect(tree).toHaveLength(2)
  })

  it('does not invent relationships from titles or timestamps', () => {
    const tree = buildTree([conv('x'), conv('y')])
    expect(tree.every((n) => n.children.length === 0)).toBe(true)
  })

  it('marks nodes whose parent is not loaded as detached roots', () => {
    const tree = buildTree([conv('child', 'missing')])
    expect(tree[0]!.detached).toBe(true)
  })

  it('survives cycles and self-parenting', () => {
    const tree = buildTree([conv('a', 'b'), conv('b', 'a'), conv('s', 's')])
    expect(tree.length).toBe(3)
  })

  it('flatten honours expansion and pathTo resolves ancestors', () => {
    const all = [conv('a'), conv('b', 'a'), conv('c', 'b')]
    const tree = buildTree(all)
    expect(flatten(tree, new Set()).map((r) => r.node.conversation.conversation_id)).toEqual(['a'])
    expect(flatten(tree, new Set(['a', 'b'])).length).toBe(3)
    expect(pathTo(all, 'c')).toEqual(['a', 'b', 'c'])
  })

  it('merge prefers earlier sources', () => {
    const merged = mergeConversations([{ ...conv('a'), title: 'list' }], [{ ...conv('a'), title: 'graph' }])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.title).toBe('list')
  })
})

describe('SseParser', () => {
  it('parses frames split across chunks, ignoring comments', () => {
    const out: string[] = []
    const p = new SseParser((d) => out.push(d))
    p.push(': ok\n\n: heartbeat\n\ndata: {"a":')
    p.push('1}\n\ndata: {"b":2}\r\n\r\n')
    expect(out).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('joins multi-line data and reports event names', () => {
    const got: Array<[string, string]> = []
    const p = new SseParser((d, e) => got.push([d, e]))
    p.push('event: error\ndata: l1\ndata: l2\n\n')
    expect(got).toEqual([['l1\nl2', 'error']])
  })
})

describe('error parsing', () => {
  it('maps FastAPI string detail and status kinds', () => {
    const e = parseErrorBody(401, { detail: 'Incorrect email or password.' })
    expect(e.kind).toBe('auth')
    expect(e.message).toBe('Incorrect email or password.')
  })

  it('extracts 422 field errors', () => {
    const e = parseErrorBody(422, { detail: [{ loc: ['body', 'password'], msg: 'Value error, Too weak' }] })
    expect(e.kind).toBe('validation')
    expect(e.fields.password).toBe('Too weak')
  })

  it('reads the File Service error shape', () => {
    expect(parseErrorBody(400, { error_code: 'X', message: 'Unsupported type' }).message).toBe('Unsupported type')
  })

  it('never leaks server error bodies', () => {
    const e = parseErrorBody(500, { detail: 'Traceback: secret stuff' })
    expect(e.kind).toBe('server')
    expect(e.message).not.toMatch(/secret/)
  })
})

describe('validation', () => {
  it('enforces the backend password policy', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false)
    expect(passwordSchema.safeParse('alllowercase123!').success).toBe(false)
    expect(passwordSchema.safeParse('SecurePass123!').success).toBe(true)
  })

  it('validates login and signup forms', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false)
    const r = signupSchema.safeParse({ full_name: 'Al', email: 'a@b.co', password: 'SecurePass123!', confirm: 'different' })
    expect(r.success).toBe(false)
  })

  it('validates files against File Service policy', () => {
    expect(validateFile({ name: 'a.pdf', size: 10, type: 'application/pdf' }).ok).toBe(true)
    expect(validateFile({ name: 'a.txt', size: 10, type: '' }).ok).toBe(true)
    expect(validateFile({ name: 'a.exe', size: 10, type: 'application/x-msdownload' }).ok).toBe(false)
    expect(validateFile({ name: 'a.pdf', size: 0, type: 'application/pdf' }).ok).toBe(false)
    expect(validateFile({ name: 'big.pdf', size: 200 * 1024 * 1024, type: 'application/pdf' }).ok).toBe(false)
  })
})

describe('buildDisplay reconciliation', () => {
  const m = (id: string, sender: string, content: string, status = 'sent'): ApiMessage => ({
    message_id: id,
    conversation_id: 'c',
    sender,
    content,
    status,
    created_at: '2026-01-01T00:00:00Z',
  })

  it('shows persisted history unchanged with no live run', () => {
    const d = buildDisplay([m('1', 'user', 'hi'), m('2', 'assistant', 'hello')], undefined, {})
    expect(d.map((x) => x.content)).toEqual(['hi', 'hello'])
  })

  it('overlays streaming text on the pending server row without duplicating', () => {
    const d = buildDisplay(
      [m('1', 'user', 'hi'), m('2', 'assistant', '', 'pending')],
      {
        pendingUser: { tempId: 't', content: 'hi', fileIds: [], idempotencyKey: 'k', messageId: '1', status: 'sent', createdAt: 0 },
        assistant: { messageId: '2', text: 'Hel', phase: 'streaming' },
      },
      {},
    )
    expect(d).toHaveLength(2)
    expect(d[1]).toMatchObject({ content: 'Hel', status: 'streaming' })
  })

  it('appends optimistic rows that are not yet persisted, and hides a replaced answer', () => {
    const d = buildDisplay(
      [m('1', 'user', 'q'), m('2', 'assistant', 'old')],
      { pendingUser: null, assistant: { messageId: '3', text: 'new', phase: 'streaming', replaces: '2' } },
      {},
    )
    expect(d.map((x) => x.content)).toEqual(['q', 'new'])
  })

  it('surfaces failed assistant rows and failed sends', () => {
    const d = buildDisplay(
      [m('2', 'assistant', 'Upstream AI provider error occurred.', 'failed')],
      { pendingUser: { tempId: 't', content: 'x', fileIds: [], idempotencyKey: 'k', messageId: null, status: 'failed', error: 'offline', createdAt: 0 }, assistant: null },
      {},
    )
    expect(d[0]).toMatchObject({ status: 'failed' })
    expect(d[1]).toMatchObject({ status: 'send_failed', error: 'offline' })
  })
})
