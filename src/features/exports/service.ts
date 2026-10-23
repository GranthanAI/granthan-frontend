import { api, requestBlob } from '@/lib/api-client'

export type ExportScope = 'conversation' | 'hierarchy'
export type ExportFormat = 'markdown' | 'pdf'
export type ExportStatus = 'pending' | 'processing' | 'ready' | 'failed' | 'expired'

export interface ExportJob {
  job_id: string
  status: ExportStatus
  conversation_id: string
  scope: ExportScope
  format: ExportFormat
  include_media: boolean
  progress: { done: number; total: number }
  filename: string | null
  content_type: string | null
  size_bytes: number | null
  expires_at: string | null
  failure_code: string | null
  message: string | null
  created_at: string
  updated_at: string
  download_ready: boolean
}

export interface ExportRequest {
  conversation_id: string
  scope: ExportScope
  format: ExportFormat
  include_media: boolean
}

export const isExportActive = (j: Pick<ExportJob, 'status'> | undefined | null) =>
  !!j && (j.status === 'pending' || j.status === 'processing')

export const exportService = {
  /** Idempotent over an unchanged source: the same request returns the same job instead of building another file. */
  create: (body: ExportRequest) => api.post<ExportJob>('/exports', body),
  get: (id: string, signal?: AbortSignal) => api.get<ExportJob>(`/exports/${id}`, { signal }),
  download: (id: string, signal?: AbortSignal) => requestBlob(`/exports/${id}/download`, { signal }),
}
