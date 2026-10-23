import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useAuthStore } from '@/stores/auth.store'
import { getNotesController } from './registry'

/**
 * The notes of ONE conversation. Every component using the same conversation id shares one controller (and so one save
 * queue); switching conversation switches controller, and the one being left flushes its pending text on the way out.
 */
export function useNotes(conversationId: string) {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const controller = useMemo(() => getNotesController(userId, conversationId), [userId, conversationId])

  useEffect(() => {
    controller.retain()
    void controller.load()
    // Another tab may have saved while this one was in the background: pick it up when it comes back, if nothing is pending here.
    const refresh = () => {
      if (document.visibilityState === 'visible') void controller.refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      controller.release()
    }
  }, [controller])

  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  return { state, controller }
}
