import type { QueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { qk } from '@/lib/query-keys'
import type { MyModelsResponse } from '@/types/billing'

export const AUTO_MODEL = 'auto'

/**
 * The model chosen for a CONVERSATION (key = conversation id; the new-chat composer uses its own key and hands the
 * choice to the conversation it creates). Absent = not chosen: the saved default (preferences.default_model) applies.
 */
interface ModelState {
  modelByKey: Record<string, string>
  setModel: (key: string, id: string | null) => void
}

export const useModelSelectionStore = create<ModelState>()(
  persist(
    (set) => ({
      modelByKey: {},
      setModel: (key, id) =>
        set((s) => {
          const { [key]: _drop, ...rest } = s.modelByKey
          void _drop
          return { modelByKey: id ? { ...rest, [key]: id } : rest }
        }),
    }),
    { name: 'granthan-conversation-model', partialize: (s) => ({ modelByKey: s.modelByKey }) },
  ),
)

/** Moves the model chosen in the new-chat composer to the conversation that was just created. */
export function adoptNewChatModel(newKey: string, conversationId: string) {
  const { modelByKey, setModel } = useModelSelectionStore.getState()
  const model = modelByKey[newKey]
  if (model) setModel(conversationId, model)
  setModel(newKey, null)
}

export function isModelAllowed(models: MyModelsResponse | undefined, id: string): boolean {
  if (id === AUTO_MODEL) return true
  if (!models) return true // not loaded yet: let the server decide
  return models.groups.some((g) => g.allowed && g.models.some((m) => m.id === id && m.allowed))
}

/**
 * What to put in the request's `model` field for a conversation: undefined when the user never chose one (the backend
 * applies their saved default); a chosen model the plan no longer allows is sent as 'auto' rather than being refused.
 */
export function modelForRequest(qc: QueryClient, key: string): string | undefined {
  const chosen = useModelSelectionStore.getState().modelByKey[key]
  if (!chosen) return undefined
  const models = qc.getQueryData<MyModelsResponse>(qk.billingModels)
  return isModelAllowed(models, chosen) ? chosen : AUTO_MODEL
}
