import { api } from '@/lib/api-client'

export interface VizConfig {
  enabled: boolean
  mermaid: boolean
  manim: boolean
  max_attempts: number
  repair: boolean
}

export interface RepairResult {
  ok: boolean
  content?: string | null
  failure?: string | null
}

export const DEFAULT_CONFIG: VizConfig = { enabled: true, mermaid: true, manim: false, max_attempts: 3, repair: true }

export const vizService = {
  config: (signal?: AbortSignal) => api.get<VizConfig>('/visualizations/config', { signal }),
  repair: (kind: 'mermaid' | 'manim', content: string, error: string, attempt: number, signal?: AbortSignal) =>
    api.post<RepairResult>('/visualizations/repair', { kind, content, error, attempt }, { signal }),
}
