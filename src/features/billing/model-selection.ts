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

/**
 * The model used until the user picks another: the plan's own `default_model` from /billing/me/models when it is allowed and
 * answering; otherwise (an older API, or it is not usable) a GPT-OSS model the plan allows (default group first, then Fast), else
 * the first allowed model. There is no "Auto": the user always sees, and can change, the model in use.
 */
export function defaultModelId(models: MyModelsResponse | undefined): string | undefined {
  if (!models) return undefined
  const allowed = (group?: string) =>
    models.groups.filter((g) => !group || g.group === group).flatMap((g) => g.models.filter((m) => m.allowed && m.available !== false))
  const oss = (list: ReturnType<typeof allowed>) => list.find((m) => m.id.includes('gpt-oss'))
  const planDefault = models.default_model ? allowed().find((m) => m.id === models.default_model) : undefined
  if (planDefault) return planDefault.id
  return (oss(allowed(models.default_group)) ?? oss(allowed('fast')) ?? oss(allowed()) ?? allowed(models.default_group)[0] ?? allowed()[0])?.id
}

export function isModelAllowed(models: MyModelsResponse | undefined, id: string): boolean {
  if (!models) return true // not loaded yet: let the server decide
  return models.groups.some((g) => g.models.some((m) => m.id === id && m.allowed && m.available !== false))
}

/** The plan includes it, but llm-service cannot answer with it right now. */
export function isModelUnavailable(models: MyModelsResponse | undefined, id: string): boolean {
  return !!models && models.groups.some((g) => g.models.some((m) => m.id === id && m.allowed && m.available === false))
}

/**
 * What to put in the request's `model` field for a conversation: undefined when the user never chose one (the backend
 * applies their saved default); a chosen model the plan no longer allows is sent as 'auto' rather than being refused.
 */
export function modelForRequest(qc: QueryClient, key: string): string | undefined {
  const models = qc.getQueryData<MyModelsResponse>(qk.billingModels)
  const chosen = useModelSelectionStore.getState().modelByKey[key]
  if (chosen && chosen !== AUTO_MODEL && isModelAllowed(models, chosen)) return chosen
  // Nothing (usable) chosen: the default model, sent explicitly so what the picker shows is what answers.
  return defaultModelId(models) ?? (chosen === AUTO_MODEL ? undefined : chosen)
}

/**
 * The model each conversation's latest request named (not persisted). When another allowed model answered, the message shows
 * a quiet "{picked} was busy, so {answered} answered." line; after a reload there is nothing to compare, so no line.
 */
export const useLastRequestedModel = create<{ byConversation: Record<string, string>; set: (cid: string, id: string | undefined) => void }>()((set) => ({
  byConversation: {},
  set: (cid, id) =>
    set((s) => {
      const { [cid]: _drop, ...rest } = s.byConversation
      void _drop
      return { byConversation: id && id !== AUTO_MODEL ? { ...rest, [cid]: id } : rest }
    }),
}))

/** The quiet line, or null when the model that answered is the one asked for. */
export function busyLine(requestedLabel: string | undefined, answeredLabel: string, same: boolean): string | null {
  return requestedLabel && !same ? `${requestedLabel} was busy, so ${answeredLabel} answered.` : null
}
