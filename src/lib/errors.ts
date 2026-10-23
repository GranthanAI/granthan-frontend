export type ApiErrorKind =
  | 'auth' // 401
  | 'forbidden' // 403
  | 'not_found' // 404
  | 'conflict' // 409
  | 'validation' // 400 / 422
  | 'rate_limit' // 429
  | 'server' // 5xx
  | 'network' // fetch failed / offline
  | 'timeout'
  | 'aborted'
  | 'unknown'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null
  /** Field-level messages keyed by field name, parsed from FastAPI 422 bodies. */
  readonly fields: Record<string, string>
  /** The structured `detail` of a 4xx response (e.g. a version conflict's current document). Never set for 5xx bodies. */
  readonly detail?: unknown

  constructor(
    kind: ApiErrorKind,
    message: string,
    status: number | null = null,
    fields: Record<string, string> = {},
    detail?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
    this.fields = fields
    this.detail = detail
  }
}

export function kindFromStatus(status: number): ApiErrorKind {
  if (status === 401) return 'auth'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 400 || status === 422) return 'validation'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'server'
  return 'unknown'
}

function defaultMessage(kind: ApiErrorKind): string {
  switch (kind) {
    case 'auth':
      return 'Your session has expired. Please sign in again.'
    case 'forbidden':
      return "You don't have access to this resource."
    case 'not_found':
      return 'We could not find what you were looking for.'
    case 'rate_limit':
      return 'Too many requests. Please wait a moment and try again.'
    case 'validation':
      return 'Some of the information provided is invalid.'
    case 'conflict':
      return 'This was changed elsewhere. Reload and try again.'
    default:
      return 'Request failed.'
  }
}

/**
 * Parses the three error shapes in use:
 *  - FastAPI `{detail: string}`
 *  - FastAPI 422 `{detail: [{loc, msg}]}`
 *  - File Service `{error_code, message, request_id}`
 * Server (5xx) bodies are never shown to users; they get a generic message.
 */
export function parseErrorBody(status: number, body: unknown): ApiError {
  const kind = kindFromStatus(status)
  if (kind === 'server') {
    return new ApiError(
      kind,
      status === 503
        ? 'A required service is temporarily unavailable. Please try again shortly.'
        : 'Something went wrong on our side. Please try again.',
      status,
    )
  }
  let message = ''
  const fields: Record<string, string> = {}
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if (typeof b.detail === 'string') message = b.detail
    else if (b.detail && typeof b.detail === 'object' && !Array.isArray(b.detail)) {
      const m = (b.detail as Record<string, unknown>).message
      if (typeof m === 'string') message = m
    }
    else if (Array.isArray(b.detail)) {
      for (const d of b.detail as Array<{ loc?: unknown[]; msg?: string }>) {
        const field = Array.isArray(d.loc) ? String(d.loc[d.loc.length - 1]) : ''
        const msg = (d.msg ?? '').replace(/^Value error, /, '')
        if (field && msg && !(field in fields)) fields[field] = msg
        if (!message && msg) message = msg
      }
    } else if (typeof b.message === 'string') message = b.message
  }
  if (!message) message = defaultMessage(kind)
  const detail = body && typeof body === 'object' ? (body as Record<string, unknown>).detail : undefined
  return new ApiError(kind, message, status, fields, detail && typeof detail === 'object' ? detail : undefined)
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e
  if (e instanceof DOMException && e.name === 'AbortError')
    return new ApiError('aborted', 'Request cancelled.')
  return new ApiError('unknown', e instanceof Error ? e.message : 'Unexpected error.')
}

export const errorMessage = (e: unknown) => toApiError(e).message
