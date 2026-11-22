import { useEffect, useState } from 'react'
import { useBlocker } from 'react-router-dom'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { Dialog } from '@/components/ui/overlays'
import { TEMP_COPY } from '@/content/quickwins'

/** "Don't ask again" for the leave prompt: remembered on this device. */
export const useLeavePrompt = create<{ dontAsk: boolean; set: (v: boolean) => void }>()(
  persist((set) => ({ dontAsk: false, set: (dontAsk) => set({ dontAsk }) }), { name: 'granthan-temp-leave' }),
)

/** "in 23 hours", "in 40 minutes", "soon", from an expiry time. */
export function relativeExpiry(expiresAt: string | null | undefined, now = Date.now()): string {
  if (!expiresAt) return 'after 24 hours'
  const ms = new Date(expiresAt).getTime() - now
  if (!Number.isFinite(ms) || ms <= 60_000) return 'soon'
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`
  const hours = Math.round(mins / 60)
  return `in ${hours} hour${hours === 1 ? '' : 's'}`
}

export function TemporaryBanner({ expiresAt }: { expiresAt?: string | null }) {
  return (
    <div role="note" className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2 text-xs text-ink-2">
      <EyeOff className="size-3.5 shrink-0" aria-hidden />
      {TEMP_COPY.banner(relativeExpiry(expiresAt))}
    </div>
  )
}

/** Asks once before leaving a temporary chat (route change via the router's blocker, tab close via beforeunload). */
export function LeaveGuard() {
  const dontAsk = useLeavePrompt((s) => s.dontAsk)
  const setDontAsk = useLeavePrompt((s) => s.set)
  const [tick, setTick] = useState(false)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !dontAsk && currentLocation.pathname !== nextLocation.pathname)

  useEffect(() => {
    if (dontAsk) return
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [dontAsk])

  return (
    <Dialog
      open={blocker.state === 'blocked'}
      onClose={() => blocker.reset?.()}
      title={TEMP_COPY.leave}
      footer={
        <>
          <Button onClick={() => blocker.reset?.()}>{TEMP_COPY.stay}</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (tick) setDontAsk(true)
              blocker.proceed?.()
            }}
          >
            {TEMP_COPY.leaveAction}
          </Button>
        </>
      }
    >
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={tick} onChange={(e) => setTick(e.target.checked)} />
        {TEMP_COPY.dontAsk}
      </label>
    </Dialog>
  )
}
