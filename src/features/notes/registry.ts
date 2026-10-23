import { useAuthStore } from '@/stores/auth.store'
import { NotesController } from './controller'
import type { NotesApi } from './service'

const controllers = new Map<string, NotesController>()
const MAX_CONTROLLERS = 30

/**
 * One controller per (user, conversation) for this tab. Keying by conversation id means a notes document can never show up
 * in another conversation through stale client state; keying by user means a second account in the same tab never sees
 * (or saves over) the previous user's text.
 */
export function getNotesController(userId: string | null, conversationId: string, api?: NotesApi, debounceMs?: number): NotesController {
  const key = `${userId ?? 'anonymous'}:${conversationId}`
  let controller = controllers.get(key)
  if (!controller) {
    if (controllers.size >= MAX_CONTROLLERS) evictIdle()
    controller = new NotesController(conversationId, api, debounceMs)
    controllers.set(key, controller)
  }
  return controller
}

/** Drops controllers that are saved and unobserved (oldest first). Controllers holding unsaved text are never evicted. */
function evictIdle() {
  for (const [key, c] of controllers) {
    if (c.isIdle) {
      controllers.delete(key)
      if (controllers.size < MAX_CONTROLLERS) return
    }
  }
}

export function resetNotesControllers() {
  controllers.clear()
}

export function flushAllNotes(): Promise<void[]> {
  return Promise.all([...controllers.values()].map((c) => c.flush()))
}

export function anyUnsavedNotes(): boolean {
  return [...controllers.values()].some((c) => c.hasUnsavedWork)
}

// A different (or no) signed-in user: forget everything so nothing can leak across accounts.
let lastUser = useAuthStore.getState().user?.id ?? null
useAuthStore.subscribe((state) => {
  const next = state.user?.id ?? null
  if (next !== lastUser) {
    lastUser = next
    resetNotesControllers()
  }
})

if (typeof window !== 'undefined') {
  // Leaving the page: push pending text out, and warn when something still has not been saved.
  window.addEventListener('beforeunload', (event) => {
    if (!anyUnsavedNotes()) return
    void flushAllNotes()
    event.preventDefault()
    event.returnValue = ''
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushAllNotes()
  })
}
