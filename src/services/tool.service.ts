import { api } from '@/lib/api-client'
import type { ToolListResponse } from '@/types/api'

export const toolService = {
  /** Tools registered AND enabled in the backend right now (the only source of truth; nothing is hardcoded here). */
  list: (signal?: AbortSignal) => api.get<ToolListResponse>('/tools', { signal }),
}
