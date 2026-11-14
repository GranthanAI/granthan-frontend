import { useMemo } from 'react'
import { useMyModels } from './hooks'
import { AUTO_MODEL, isModelAllowed, useModelSelectionStore } from './model-selection'
import { usePreferences } from '@/features/preferences/usePreferences'

/** Selection state for one composer. Hidden entirely (`available` false) when /billing/me/models fails. */
export function useModelSelection(key: string) {
  const query = useMyModels()
  const prefs = usePreferences()
  const stored = useModelSelectionStore((s) => s.modelByKey[key])
  const setStored = useModelSelectionStore((s) => s.setModel)
  const data = Array.isArray(query.data?.groups) ? query.data : undefined
  const savedDefault = prefs.data?.default_model || AUTO_MODEL
  const wanted = stored ?? savedDefault
  // A model the plan no longer allows shows (and is sent) as Auto.
  const value = isModelAllowed(data, wanted) ? wanted : AUTO_MODEL
  const label = useMemo(() => {
    if (value === AUTO_MODEL) return 'Auto'
    for (const g of data?.groups ?? []) for (const m of g.models) if (m.id === value) return m.label
    return value
  }, [data, value])
  return {
    query,
    data,
    available: !!data,
    value,
    label,
    savedDefault,
    isSavedDefault: value === savedDefault,
    select: (id: string) => setStored(key, id),
  }
}
