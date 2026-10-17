import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import { toast } from '@/components/ui/overlays'
import { qk } from '@/lib/query-keys'
import { toolService } from '@/services/tool.service'
import type { ToolDescriptor } from '@/types/api'

/** Selected tool ids per composer (draft key). In memory: survives navigation, not reload. */
interface SelectionState {
  byKey: Record<string, string[]>
  set: (key: string, ids: string[]) => void
  clear: (key: string) => void
}

export const useToolSelectionStore = create<SelectionState>((set) => ({
  byKey: {},
  set: (key, ids) => set((s) => ({ byKey: { ...s.byKey, [key]: ids } })),
  clear: (key) =>
    set((s) => {
      const { [key]: _drop, ...rest } = s.byKey
      void _drop
      return { byKey: rest }
    }),
}))

/** Selected response mode per composer (null / absent = Auto: the planner decides). */
interface ModeState {
  modeByKey: Record<string, string>
  setMode: (key: string, id: string | null) => void
}

export const useModeSelectionStore = create<ModeState>((set) => ({
  modeByKey: {},
  setMode: (key, id) =>
    set((s) => {
      const { [key]: _drop, ...rest } = s.modeByKey
      void _drop
      return { modeByKey: id ? { ...rest, [key]: id } : rest }
    }),
}))

const NONE: string[] = []

export function useTools() {
  return useQuery({
    queryKey: qk.tools,
    queryFn: ({ signal }) => toolService.list(signal),
    staleTime: 60_000,
    retry: 1,
  })
}

/**
 * Selection for one composer. Ids that the backend no longer offers (tool disabled or removed since
 * the list was loaded) are dropped with a notice, so the user never sends a tool that cannot run.
 */
export function useToolSelection(draftKey: string) {
  const query = useTools()
  const selected = useToolSelectionStore((s) => s.byKey[draftKey] ?? NONE)
  const setSelected = useToolSelectionStore((s) => s.set)
  const clear = useToolSelectionStore((s) => s.clear)
  const mode = useModeSelectionStore((s) => s.modeByKey[draftKey] ?? null)
  const setMode = useModeSelectionStore((s) => s.setMode)

  const tools: ToolDescriptor[] = useMemo(() => query.data?.tools ?? [], [query.data])
  const max = query.data?.max_selected ?? 5

  useEffect(() => {
    if (!query.data || selected.length === 0) return
    const available = new Set(query.data.tools.map((t) => t.id))
    const keep = selected.filter((id) => available.has(id))
    if (keep.length !== selected.length) {
      const gone = selected.filter((id) => !available.has(id))
      toast(`Tool${gone.length > 1 ? 's' : ''} no longer available: ${gone.join(', ')}`, 'info')
      setSelected(draftKey, keep)
    }
  }, [query.data, selected, draftKey, setSelected])

  // A mode the backend no longer offers (turned off since the list was loaded) falls back to Auto.
  useEffect(() => {
    if (!query.data || !mode) return
    if (!(query.data.modes ?? []).some((m) => m.id === mode)) {
      toast(`Mode no longer available: ${mode}. Using Auto.`, 'info')
      setMode(draftKey, null)
    }
  }, [query.data, mode, draftKey, setMode])

  const toggle = (id: string) => {
    if (selected.includes(id)) setSelected(draftKey, selected.filter((x) => x !== id))
    else if (selected.length < max) setSelected(draftKey, [...selected, id])
  }

  return {
    query,
    tools,
    selected,
    max,
    toggle,
    modes: query.data?.modes ?? [],
    mode,
    setMode: (id: string | null) => setMode(draftKey, id),
    modeNameOf: (id: string) => query.data?.modes?.find((m) => m.id === id)?.name ?? id,
    remove: (id: string) => setSelected(draftKey, selected.filter((x) => x !== id)),
    clear: () => {
      clear(draftKey)
      setMode(draftKey, null)
    },
    nameOf: (id: string) => tools.find((t) => t.id === id)?.name ?? id,
  }
}
