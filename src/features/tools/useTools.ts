import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import { toast } from '@/components/ui/overlays'
import { qk } from '@/lib/query-keys'
import { toolService } from '@/services/tool.service'
import { usePreferences } from '@/features/preferences/usePreferences'
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

/** Explicit response mode per composer. Absent = not chosen for this message (the user's saved
 * default applies, or Auto); 'auto' = explicitly Auto for this message. */
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
 * Selection for one composer.
 *
 * Untouched, the composer shows the user's saved defaults (Settings → AI preferences) and sends
 * nothing for mode/tools, so the backend applies those defaults authoritatively. Once the user
 * changes anything, the shown selection becomes an explicit per-message override (including
 * "Auto" or "no tools"), and it never changes the saved defaults.
 *
 * Ids the backend no longer offers are dropped with a notice, so the user never sends a tool or
 * mode that cannot run.
 */
export function useToolSelection(draftKey: string) {
  const query = useTools()
  const prefs = usePreferences()
  const explicitTools = useToolSelectionStore((s) => s.byKey[draftKey])
  const setSelected = useToolSelectionStore((s) => s.set)
  const clear = useToolSelectionStore((s) => s.clear)
  const storedMode = useModeSelectionStore((s) => s.modeByKey[draftKey])
  const setStoredMode = useModeSelectionStore((s) => s.setMode)

  const tools: ToolDescriptor[] = useMemo(() => query.data?.tools ?? [], [query.data])
  const modes = useMemo(() => query.data?.modes ?? [], [query.data])
  const max = query.data?.max_selected ?? 5

  // Saved defaults, limited to what the backend offers right now.
  const defaultTools = useMemo(() => {
    const available = new Set(tools.filter((t) => t.auto_runnable).map((t) => t.id))
    return (prefs.data?.default_tools ?? []).filter((id) => available.has(id)).slice(0, max)
  }, [prefs.data, tools, max])
  const savedDefaultMode = prefs.data?.default_mode ?? null
  const defaultMode = savedDefaultMode && modes.some((m) => m.id === savedDefaultMode) ? savedDefaultMode : null

  const toolsTouched = explicitTools !== undefined
  const selected = toolsTouched ? explicitTools : defaultTools.length ? defaultTools : NONE
  const modeTouched = storedMode !== undefined
  const mode = modeTouched ? (storedMode === 'auto' ? null : storedMode) : defaultMode

  useEffect(() => {
    if (!query.data || !explicitTools || explicitTools.length === 0) return
    const available = new Set(query.data.tools.map((t) => t.id))
    const keep = explicitTools.filter((id) => available.has(id))
    if (keep.length !== explicitTools.length) {
      const gone = explicitTools.filter((id) => !available.has(id))
      toast(`Tool${gone.length > 1 ? 's' : ''} no longer available: ${gone.join(', ')}`, 'info')
      setSelected(draftKey, keep)
    }
  }, [query.data, explicitTools, draftKey, setSelected])

  // A mode the backend no longer offers (turned off since the list was loaded) falls back to Auto.
  useEffect(() => {
    if (!query.data || !storedMode || storedMode === 'auto') return
    if (!(query.data.modes ?? []).some((m) => m.id === storedMode)) {
      toast(`Mode no longer available: ${storedMode}. Using Auto.`, 'info')
      setStoredMode(draftKey, null)
    }
  }, [query.data, storedMode, draftKey, setStoredMode])

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
    modes,
    mode,
    /** True while the shown tools / mode are the saved defaults (not chosen for this message). */
    toolsAreDefault: !toolsTouched && selected.length > 0,
    modeIsDefault: !modeTouched && mode !== null,
    /** Choose a mode for this message; null = Auto. */
    setMode: (id: string | null) => {
      if (id) setStoredMode(draftKey, id)
      // Auto when a saved default mode exists must be sent explicitly, otherwise the default applies.
      else setStoredMode(draftKey, defaultMode ? 'auto' : null)
    },
    modeNameOf: (id: string) => modes.find((m) => m.id === id)?.name ?? id,
    remove: (id: string) => setSelected(draftKey, selected.filter((x) => x !== id)),
    /** Back to the saved defaults (used after sending). */
    clear: () => {
      clear(draftKey)
      setStoredMode(draftKey, null)
    },
    nameOf: (id: string) => tools.find((t) => t.id === id)?.name ?? id,
    /** What to send: undefined = not chosen (backend applies saved defaults). */
    explicitTools: toolsTouched ? explicitTools : undefined,
    explicitMode: modeTouched ? storedMode : undefined,
  }
}
