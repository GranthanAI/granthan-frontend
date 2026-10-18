import { api } from '@/lib/api-client'
import type { Preferences, PreferencesPatch } from '@/types/api'

export const preferencesService = {
  get: (signal?: AbortSignal) => api.get<Preferences>('/preferences', { signal }),
  /** Partial update. Include `version` to get a 409 instead of overwriting a newer change. */
  update: (patch: PreferencesPatch) => api.patch<Preferences>('/preferences', patch),
  /** Restore every preference to its default. */
  reset: () => api.delete<Preferences>('/preferences'),
}
