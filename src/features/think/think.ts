import { useEffect } from 'react'
import { create } from 'zustand'
import { AUTO_MODEL, defaultModelId, useModelSelectionStore } from '@/features/billing/model-selection'
import { useBillingMe, useMyModels } from '@/features/billing/hooks'
import type { BillingMe, MyModelsResponse } from '@/types/billing'

/** "Think longer" is per message but remembered for the session: not persisted. */
export const useThinkStore = create<{ on: boolean; set: (on: boolean) => void }>()((set) => ({ on: false, set: (on) => set({ on }) }))

export interface ThinkAvailability {
  /** The plan includes it (think_longer_per_day !== 0): otherwise the toggle is not shown at all. */
  visible: boolean
  /** The selected model (or, for Auto, any allowed model of the default group) has a reasoning control. */
  enabled: boolean
  reason: 'model' | null
}

const allowedModels = (models: MyModelsResponse, group?: string) =>
  models.groups.filter((g) => !group || g.group === group).flatMap((g) => g.models.filter((m) => m.allowed && m.available !== false))

/** Pure rule behind the toggle. `selected` undefined = nothing chosen (the plan default applies); 'auto' = Auto. */
export function thinkAvailability(me: BillingMe | undefined, models: MyModelsResponse | undefined, selected: string | undefined): ThinkAvailability {
  const limit = me?.limits?.think_longer_per_day
  if (limit === undefined || limit === 0) return { visible: false, enabled: false, reason: null }
  if (!models) return { visible: true, enabled: false, reason: 'model' }
  const chosen = selected && selected !== AUTO_MODEL ? selected : selected === AUTO_MODEL ? undefined : defaultModelId(models)
  const can = chosen
    ? allowedModels(models).some((m) => m.id === chosen && m.think === true)
    : allowedModels(models, models.default_group).some((m) => m.think === true)
  return { visible: true, enabled: can, reason: can ? null : 'model' }
}

/** The toggle's state for a composer (`selectionKey` = the draft key the model picker uses). Turns itself off when it cannot apply. */
export function useThink(selectionKey: string) {
  const me = useBillingMe().data
  const models = useMyModels().data
  const selected = useModelSelectionStore((s) => s.modelByKey[selectionKey])
  const availability = thinkAvailability(me, models, selected)
  const on = useThinkStore((s) => s.on)
  const set = useThinkStore((s) => s.set)
  const usable = availability.visible && availability.enabled
  useEffect(() => {
    if (on && !usable && me && models) set(false)
  }, [on, usable, me, models, set])
  return { ...availability, on: on && usable, toggle: () => set(!on) }
}

/** What goes in the request: true only when the toggle is on (the server also checks the plan). */
export const currentThink = (): true | undefined => (useThinkStore.getState().on ? true : undefined)
