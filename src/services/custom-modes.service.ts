import { api } from '@/lib/api-client'
import type { CustomMode, CustomModeInput, CustomModeList } from '@/types/api'

const one = (id: string) => `/custom-modes/${encodeURIComponent(id)}`

export const customModeService = {
  list: (signal?: AbortSignal) => api.get<CustomModeList>('/custom-modes', { signal, query: { limit: 100 } }),
  create: (body: CustomModeInput) => api.post<CustomMode>('/custom-modes', body),
  /** Partial update. Send `version` to get a 409 instead of overwriting an edit made elsewhere. */
  update: (id: string, body: Partial<CustomModeInput> & { version?: number }) => api.patch<CustomMode>(one(id), body),
  /** Archives (soft delete): the mode stops being selectable. */
  archive: (id: string) => api.delete<CustomMode>(one(id)),
}
