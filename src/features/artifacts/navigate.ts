/**
 * Scrolls to a message of the open conversation and flashes it. Messages load lazily, so this waits briefly for the element;
 * it returns false (and the caller says so) when the message is not loaded, e.g. it is older than the loaded history.
 */
export async function scrollToMessage(messageId: string, timeoutMs = 2500): Promise<boolean> {
  const started = Date.now()
  const selector = `[data-message-id="${CSS.escape(messageId)}"]`
  for (;;) {
    const el = document.querySelector<HTMLElement>(selector)
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.classList.add('ring-2', 'ring-accent', 'rounded-xl')
      setTimeout(() => el.classList.remove('ring-2', 'ring-accent', 'rounded-xl'), 1800)
      return true
    }
    if (Date.now() - started > timeoutMs) return false
    await new Promise((r) => setTimeout(r, 120))
  }
}
