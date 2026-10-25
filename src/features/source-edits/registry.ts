import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth.store'
import { BlockEditController, type BlockMeta } from './controller'
import { sourceEditsApi, type SourceEditsApi } from './service'

const controllers = new Map<string, BlockEditController>()
const MAX_CONTROLLERS = 100

/**
 * One controller per (user, conversation, message, block) for this tab: two blocks, two messages, two conversations or two
 * accounts never share editor state, while every view of the same block (e.g. two chat windows) shares one save queue.
 */
export function getBlockController(userId: string | null, meta: BlockMeta, api: SourceEditsApi = sourceEditsApi): BlockEditController {
  const key = `${userId ?? 'anonymous'}:${meta.conversationId}:${meta.messageId}:${meta.blockId}`
  let c = controllers.get(key)
  if (!c) {
    if (controllers.size >= MAX_CONTROLLERS) evictIdle()
    c = new BlockEditController(meta, api)
    controllers.set(key, c)
  }
  return c
}

/** Drops saved, unobserved controllers (oldest first). A controller holding unsaved text is never evicted. */
function evictIdle() {
  for (const [key, c] of controllers) {
    if (c.isIdle) {
      controllers.delete(key)
      if (controllers.size < MAX_CONTROLLERS) return
    }
  }
}

export function resetBlockControllers() {
  controllers.clear()
}
export function anyUnsavedEdits(): boolean {
  return [...controllers.values()].some((c) => c.hasUnsavedWork)
}

let lastUser = useAuthStore.getState().user?.id ?? null
useAuthStore.subscribe((state) => {
  const next = state.user?.id ?? null
  if (next !== lastUser) {
    lastUser = next
    resetBlockControllers() // a different account must never see (or save) the previous user's text
  }
})

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (!anyUnsavedEdits()) return
    event.preventDefault()
    event.returnValue = ''
  })
}

/** All of the signed-in user's saved edits in one conversation: one cached request shared by every block. */
export function useSourceEditList(conversationId: string | undefined, api: SourceEditsApi = sourceEditsApi) {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  return useQuery({
    queryKey: ['source-edits', userId, conversationId],
    queryFn: ({ signal }) => api.list(conversationId as string, signal),
    enabled: !!conversationId && !!userId,
    staleTime: 30_000,
    retry: false,
  })
}

/** The edit state of ONE block, restored from the server list on load and kept in sync with it. */
export function useBlockEdit(meta: BlockMeta, api?: SourceEditsApi) {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const qc = useQueryClient()
  const { data } = useSourceEditList(meta.conversationId, api)
  const controller = useMemo(
    () => getBlockController(userId, meta, api),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, meta.conversationId, meta.messageId, meta.blockId, api],
  )
  const doc = data?.edits.find((e) => e.message_id === meta.messageId && e.block_id === meta.blockId)

  useEffect(() => {
    controller.retain()
    controller.setOnPersisted(() => void qc.invalidateQueries({ queryKey: ['source-edits', userId, meta.conversationId] }))
    return () => controller.release()
  }, [controller, qc, userId, meta.conversationId])

  useEffect(() => {
    if (data) controller.hydrate(doc)
  }, [controller, data, doc])

  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  return { state, controller, loaded: !!data }
}
