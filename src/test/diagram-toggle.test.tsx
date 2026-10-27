import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useUiStore } from '@/stores/ui.store'

// The toggle lives inside Composer; its store contract is what chat-controller reads at send time.
describe('Include diagram if necessary', () => {
  beforeEach(() => useUiStore.setState({ includeDiagrams: false }))

  it('is off by default and the store flips it', () => {
    expect(useUiStore.getState().includeDiagrams).toBe(false)
    useUiStore.getState().setIncludeDiagrams(true)
    expect(useUiStore.getState().includeDiagrams).toBe(true)
  })

  it('is a pressed/unpressed button in the composer toolbar that drives the store', async () => {
    const { Composer } = await import('@/components/chat/Composer')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const u = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Composer conversationId={null} draftKey="k" busy={false} onSend={async () => true} />
      </QueryClientProvider>,
    )
    const btn = screen.getByRole('button', { name: 'Include diagram if necessary' })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    await u.click(btn)
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(useUiStore.getState().includeDiagrams).toBe(true)
    await u.click(btn)
    expect(useUiStore.getState().includeDiagrams).toBe(false)
  })
})
