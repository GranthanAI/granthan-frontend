import { beforeEach, describe, expect, it } from 'vitest'
import { buildDisplay } from '@/features/messages/display'
import { useChatStore } from '@/stores/chat.store'
import type { ApiMessage, Citation } from '@/types/api'

const DOC: Citation = { file_id: 'doc-1', source_name: 'spec.pdf', page_number: 3, section: 'Intro' }
const VIDEO: Citation = {
  file_id: 'doc-2', source_name: 'Talk (YouTube transcript).json', page_number: null, section: 't=75-110',
  start_seconds: 75, end_seconds: 110,
}

const msg = (id: string, over: Partial<ApiMessage> = {}): ApiMessage => ({
  message_id: id, conversation_id: 'c1', sender: 'assistant', content: 'answer', created_at: '2026-01-01T00:00:00Z', status: 'sent', ...over,
})

describe('citations are rebuilt from durable history, not from in-memory state', () => {
  beforeEach(() => useChatStore.setState({ runs: {}, citations: {} }))

  it('a reload (empty live store) shows the persisted document and video citations in order', () => {
    const history = [msg('u1', { sender: 'user' }), msg('a1', { citations: [DOC, VIDEO] })]
    const [, answer] = buildDisplay(history, undefined, useChatStore.getState().citations)
    expect(answer!.citations).toEqual([DOC, VIDEO])
    expect(answer!.citations[1]).toMatchObject({ file_id: 'doc-2', start_seconds: 75, end_seconds: 110 })
  })

  it('survives a JSON round trip through the history payload (what the API actually returns)', () => {
    const wire = JSON.parse(JSON.stringify([msg('a1', { citations: [DOC, VIDEO] })])) as ApiMessage[]
    expect(buildDisplay(wire, undefined, {})[0]!.citations).toEqual([DOC, VIDEO])
  })

  it('older messages without the field render with no sources and do not throw', () => {
    const out = buildDisplay([msg('a1'), msg('a2', { citations: [] }), msg('a3', { citations: undefined })], undefined, {})
    expect(out.map((m) => m.citations)).toEqual([[], [], []])
  })

  it('persisted citations win over the transient live copy for the same message', () => {
    const out = buildDisplay([msg('a1', { citations: [DOC] })], undefined, { a1: [VIDEO] })
    expect(out[0]!.citations).toEqual([DOC])
  })

  it('the live copy bridges only until history carries the citations, and only for its own message', () => {
    const out = buildDisplay([msg('a1'), msg('a2')], undefined, { a1: [VIDEO] })
    expect(out[0]!.citations).toEqual([VIDEO])
    expect(out[1]!.citations).toEqual([])
  })

  it('each answer keeps its own sources when several answers are in one conversation', () => {
    const out = buildDisplay([msg('a1', { citations: [DOC] }), msg('a2', { citations: [VIDEO] })], undefined, {})
    expect(out.map((m) => m.citations)).toEqual([[DOC], [VIDEO]])
  })
})
