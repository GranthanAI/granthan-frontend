import { api } from '@/lib/api-client'
import type { MemoryFact, MemoryFactList, MemorySettings } from '@/types/api'

const facts = '/memory/facts'

export const memoryService = {
  settings: (signal?: AbortSignal) => api.get<MemorySettings>('/memory/settings', { signal }),
  setEnabled: (memory_enabled: boolean) => api.put<MemorySettings>('/memory/settings', { memory_enabled }),
  list: (signal?: AbortSignal) => api.get<MemoryFactList>(facts, { signal }),
  update: (fact: Pick<MemoryFact, 'id' | 'category'>, statement: string) =>
    api.patch<MemoryFact>(`${facts}/${encodeURIComponent(fact.id)}`, { category: fact.category, statement }),
  remove: (fact: Pick<MemoryFact, 'id' | 'category'>) =>
    api.delete<void>(`${facts}/${encodeURIComponent(fact.id)}`, { query: { category: fact.category } }),
  clear: () => api.delete<{ deleted: number }>(facts),
}
