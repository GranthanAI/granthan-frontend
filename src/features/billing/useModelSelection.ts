import { useMemo } from 'react'
import { useMyModels } from './hooks'
import { MODEL_SWITCHED_NOTE } from '@/content/plans'
import { AUTO_MODEL, defaultModelId, isModelAllowed, isModelUnavailable, useModelSelectionStore } from './model-selection'
import { usePreferences } from '@/features/preferences/usePreferences'

/** Selection state for one composer. Hidden entirely (`available` false) when /billing/me/models fails. */
export function useModelSelection(key: string) {
  const query = useMyModels()
  const prefs = usePreferences()
  const stored = useModelSelectionStore((s) => s.modelByKey[key])
  const setStored = useModelSelectionStore((s) => s.setModel)
  const data = Array.isArray(query.data?.groups) ? query.data : undefined
  const fallback = defaultModelId(data) ?? ''
  const usable = (id: string | undefined): id is string => !!id && id !== AUTO_MODEL && isModelAllowed(data, id)
  // the user's saved default when usable, else GPT-OSS; never "Auto"
  const savedDefault = usable(prefs.data?.default_model) ? prefs.data!.default_model! : fallback
  const value = usable(stored) ? stored : savedDefault
  // the model you were on (chosen here, or your saved default) cannot answer right now: we moved you to the plan's default
  const wanted = stored && stored !== AUTO_MODEL ? stored : prefs.data?.default_model
  const switchedFrom = wanted && wanted !== AUTO_MODEL && isModelUnavailable(data, wanted) ? wanted : undefined
  const label = useMemo(() => {
    for (const g of data?.groups ?? []) for (const m of g.models) if (m.id === value) return m.label
    return value
  }, [data, value])
  const labelOf = (id: string) => {
    for (const g of data?.groups ?? []) for (const m of g.models) if (m.id === id) return m.label
    return id
  }
  return {
    query,
    data,
    available: !!data,
    value,
    label,
    savedDefault,
    isSavedDefault: value === savedDefault,
    select: (id: string) => setStored(key, id),
    /** the quiet note shown when the chosen or default model is unavailable, else null */
    switchedNote: switchedFrom ? MODEL_SWITCHED_NOTE(labelOf(switchedFrom), labelOf(value)) : null,
  }
}
