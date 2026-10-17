import { api } from '@/lib/api-client'
import { ApiError } from '@/lib/errors'
import { inferType } from '@/lib/validation'
import type {
  DownloadResponse,
  FileListResponse,
  FileRecord,
  FileStatusResponse,
  InitiateUploadResponse,
} from '@/types/api'

const f = (id: string) => `/files/${encodeURIComponent(id)}`

/**
 * PUTs/POSTs the bytes straight to object storage using the presigned URL (never through
 * the gateway). Uses XHR because fetch cannot report upload progress.
 */
function uploadToStorage(
  init: InitiateUploadResponse,
  file: File,
  contentType: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(init.upload_method, init.upload_url)
    let body: XMLHttpRequestBodyInit = file
    if (init.upload_method === 'POST') {
      const fd = new FormData()
      for (const [k, v] of Object.entries(init.form_data ?? {})) fd.append(k, v)
      fd.append('file', file)
      body = fd
    } else {
      xhr.setRequestHeader('Content-Type', contentType)
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError('server', 'Upload to storage failed. Please retry.', xhr.status))
    xhr.onerror = () =>
      reject(new ApiError('network', 'Upload failed. Check your connection and try again.'))
    xhr.onabort = () => reject(new ApiError('aborted', 'Upload cancelled.'))
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(body)
  })
}

export const fileService = {
  /** initiate -> upload bytes -> complete. Status afterwards is polled via `status`. */
  async upload(
    file: File,
    opts: { conversationId?: string | null; onProgress?: (fraction: number) => void; signal?: AbortSignal },
  ): Promise<{ document_id: string }> {
    const contentType = file.type || inferType(file.name)
    const init = await api.post<InitiateUploadResponse>('/files/upload/initiate', {
      conversation_id: opts.conversationId ?? null,
      filename: file.name,
      content_type: contentType,
      size_bytes: file.size,
    })
    await uploadToStorage(init, file, contentType, opts.onProgress ?? (() => {}), opts.signal)
    await api.post(`${f(init.document_id)}/complete`, {})
    return { document_id: init.document_id }
  },

  get: (id: string) => api.get<FileRecord>(f(id)),
  status: (id: string, signal?: AbortSignal) => api.get<FileStatusResponse>(`${f(id)}/status`, { signal }),
  list: (params: { conversationId?: string; cursor?: string | null; limit?: number } = {}) =>
    api.get<FileListResponse>('/files', {
      query: { conversation_id: params.conversationId, cursor: params.cursor, limit: params.limit },
    }),
  download: (id: string) => api.get<DownloadResponse>(`${f(id)}/download`),
  retry: (id: string) => api.post<FileStatusResponse>(`${f(id)}/retry`),
  remove: (id: string) => api.delete<{ document_id: string; status: string }>(f(id)),
}
