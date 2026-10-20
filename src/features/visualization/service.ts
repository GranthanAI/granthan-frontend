import { api, requestBlob } from '@/lib/api-client'

export interface VizConfig {
  enabled: boolean
  mermaid: boolean
  manim: boolean
  max_attempts: number
  repair: boolean
}

export interface ManimJob {
  id: string
  state: 'pending' | 'validating' | 'rendering' | 'repairing' | 'ready' | 'failed' | 'cancelled' | 'expired'
  attempt: number
  max_attempts: number
  failure: string | null
  message?: string
  ready: boolean
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
  createJob: (spec: Record<string, unknown>, signal?: AbortSignal) =>
    api.post<ManimJob>('/visualizations/manim/jobs', { spec }, { signal }),
  getJob: (id: string, signal?: AbortSignal) => api.get<ManimJob>(`/visualizations/manim/jobs/${id}`, { signal }),
  cancel: (id: string) => api.delete<ManimJob>(`/visualizations/manim/jobs/${id}`),
  /** The video needs the Authorization header, which <video src> cannot send: fetch it and play a blob URL. */
  media: (id: string, signal?: AbortSignal) => requestBlob(`/visualizations/manim/jobs/${id}/media`, { signal }),
}
