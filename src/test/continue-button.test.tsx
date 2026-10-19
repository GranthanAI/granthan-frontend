import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessageItem } from '@/components/chat/MessageItem'
import { isTruncated, TRUNCATION_MARKER } from '@/lib/truncation'
import type { DisplayMessage } from '@/features/messages/display'

const cut = `Here is the start of a long answer\n\n---\n*${TRUNCATION_MARKER} Reply “continue” to get the rest.*`
const msg = (content: string, over: Partial<DisplayMessage> = {}): DisplayMessage => ({
  key: 'k', id: 'm1', sender: 'assistant', content, status: 'sent', citations: [], fileIds: [], createdAt: null, local: false, ...over,
})

function renderItem(m: DisplayMessage, over: Partial<React.ComponentProps<typeof MessageItem>> = {}) {
  const onContinue = vi.fn()
  render(
    <MessageItem message={m} isLastAssistant canRegenerate onRegenerate={vi.fn()} onContinue={onContinue} onRetrySend={vi.fn()} onDismissSend={vi.fn()} {...over} />,
  )
  return { onContinue }
}

describe('Continue button for an answer that stopped at the length limit', () => {
  it('detects the backend notice', () => {
    expect(isTruncated(cut)).toBe(true)
    expect(isTruncated('A normal, finished answer.')).toBe(false)
    expect(isTruncated(null)).toBe(false)
  })

  it('shows Continue on the last cut-off answer and sends it on click', async () => {
    const { onContinue } = renderItem(msg(cut))
    await userEvent.setup().click(await screen.findByRole('button', { name: /continue/i }))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('does not show Continue for a finished answer', () => {
    renderItem(msg('All done.'))
    expect(screen.queryByRole('button', { name: /continue/i })).toBeNull()
  })

  it('does not show Continue on older messages, while busy, while streaming or on failures', () => {
    for (const [over, m] of [
      [{ isLastAssistant: false }, msg(cut)],
      [{ canRegenerate: false }, msg(cut)],
      [{}, msg(cut, { status: 'streaming' })],
      [{}, msg(cut, { status: 'failed', error: 'x' })],
    ] as [Partial<React.ComponentProps<typeof MessageItem>>, DisplayMessage][]) {
      const props = { isLastAssistant: true, canRegenerate: true, ...over }
      const { unmount } = render(
        <MessageItem message={m} onRegenerate={vi.fn()} onContinue={vi.fn()} onRetrySend={vi.fn()} onDismissSend={vi.fn()} {...props} />,
      )
      expect(screen.queryByRole('button', { name: /continue/i })).toBeNull()
      unmount()
    }
  })
})
