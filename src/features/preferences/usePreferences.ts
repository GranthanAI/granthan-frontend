import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/errors'
import { qk } from '@/lib/query-keys'
import { preferencesService } from '@/services/preferences.service'
import type { Preferences, PreferencesPatch, PreferenceOptions } from '@/types/api'

const DEFAULT_OPTIONS: PreferenceOptions = {
  answer_length: ['concise', 'balanced', 'detailed'],
  tone: ['professional', 'friendly', 'simple'],
  citations: ['show', 'hide'],
  document_context: ['conversation', 'attached_only'],
  languages: [{ code: 'auto', name: 'Auto (match my message)' }],
  personal_instructions_max: 1000,
}

export const DEFAULT_PREFERENCES: Preferences = {
  default_mode: null,
  default_tools: [],
  answer_length: 'balanced',
  tone: 'professional',
  language: 'auto',
  personal_instructions: '',
  citations: 'show',
  document_context: 'conversation',
  version: 0,
  updated_at: null,
  options: DEFAULT_OPTIONS,
}

/** Tolerates partial / older server payloads: any missing field takes its default. */
export function normalizePreferences(raw: Partial<Preferences> | null | undefined): Preferences {
  const r = raw ?? {}
  return {
    ...DEFAULT_PREFERENCES,
    ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)),
    default_tools: Array.isArray(r.default_tools) ? r.default_tools : [],
    options: { ...DEFAULT_OPTIONS, ...(r.options ?? {}) },
  } as Preferences
}

/** Server-persisted preferences (they follow the user across devices). */
export function usePreferences() {
  return useQuery({
    queryKey: qk.preferences,
    queryFn: async ({ signal }) => normalizePreferences(await preferencesService.get(signal)),
    staleTime: 60_000,
    retry: 1,
  })
}

/**
 * Saves a partial change with the version last read, so a stale tab cannot overwrite a newer
 * change made elsewhere: on 409 the fresh server state is loaded and the error is surfaced.
 * Success is only reported after the server confirms.
 */
export function useUpdatePreferences() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: PreferencesPatch) => {
      const current = qc.getQueryData<Preferences>(qk.preferences)
      return preferencesService.update({ version: current?.version ?? 0, ...patch })
    },
    onSuccess: (data) => qc.setQueryData(qk.preferences, normalizePreferences(data)),
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) void qc.invalidateQueries({ queryKey: qk.preferences })
    },
  })
}

export function useResetPreferences() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => preferencesService.reset(),
    onSuccess: (data) => qc.setQueryData(qk.preferences, normalizePreferences(data)),
  })
}
