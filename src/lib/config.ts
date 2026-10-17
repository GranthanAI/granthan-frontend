const raw = import.meta.env.VITE_API_BASE_URL as string | undefined

/** API Gateway base URL (including /api/v1). The only backend origin the browser talks to. */
export const API_BASE_URL = (
  raw && raw.trim() ? raw.trim() : 'http://localhost:8080/api/v1'
).replace(/\/+$/, '')

export const REQUEST_TIMEOUT_MS = 30_000

/** File Service policy (file-service ALLOWED_MIME_TYPES / MAX_UPLOAD_SIZE_BYTES; see BACKEND_FOR_FRONTEND.md section 9). */
export const FILE_POLICY = {
  maxBytes: 104_857_600,
  allowedTypes: [
    'application/pdf',
    'text/plain',
    'text/markdown',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  accept: '.pdf,.txt,.md,.doc,.docx',
  label: 'PDF, text, Markdown or Word',
} as const
