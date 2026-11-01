import { describe, expect, it } from 'vitest'
import { buildTree, lineageExtras } from '@/features/conversations/tree'
import type { GraphConversation } from '@/types/api'

const g = (id: string, status = 'ACTIVE'): GraphConversation =>
  ({
    conversation_id: id,
    user_id: 'u',
    title: id,
    status,
    created_at: '2026-10-30T10:00:00Z',
    updated_at: '2026-10-30T10:00:00Z',
    parent_conversation_id: null,
  }) as GraphConversation

describe('deleted branches', () => {
  it('are not offered from the graph lineage (opening one fails with "conversation not found")', () => {
    const extras = lineageExtras([g('root')], [g('kept'), g('gone', 'DELETED')], 'root')
    expect(extras.map((c) => c.conversation_id)).toEqual(['root', 'kept'])
  })

  it('also drops a deleted ancestor but keeps live ones', () => {
    const extras = lineageExtras([g('root'), g('mid', 'deleted'), g('parent')], [], 'leaf')
    expect(extras.map((c) => c.conversation_id)).toEqual(['root', 'parent'])
  })

  it('leaves live conversations and their parent links unchanged', () => {
    const extras = lineageExtras([g('root')], [g('a'), g('b')], 'root')
    expect(extras.map((c) => [c.conversation_id, c.parent_conversation_id])).toEqual([
      ['root', null],
      ['a', 'root'],
      ['b', 'root'],
    ])
    const tree = buildTree(extras)
    expect(tree).toHaveLength(1)
    expect(tree[0]!.children.map((n) => n.conversation.conversation_id)).toEqual(['a', 'b'])
  })
})
