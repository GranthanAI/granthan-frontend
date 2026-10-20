import { API_BASE_URL, REQUEST_TIMEOUT_MS } from './config'
import { ApiError, parseErrorBody } from './errors'
import { getAccessToken, useAuthStore } from '@/stores/auth.store'
import type { TokenResponse } from '@/types/api'

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | undefined | null>
  headers?: Record<string, string>
  signal?: AbortSignal
  /** Attach the bearer token and refresh once on 401. Default true. */
  auth?: boolean
  timeoutMs?: number
}

export function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
  if (!query) return url
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) qs.set(k, String(v))
  const s = qs.toString()
  return s ? `${url}?${s}` : url
}

/** Combines a caller signal with a timeout; returns the signal plus a cleanup. */
function withTimeout(signal: AbortSignal | undefined, ms: number) {
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, ms)
  const onAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) ctrl.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

async function doFetch(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const t = withTimeout(opts.signal, opts.timeoutMs ?? REQUEST_TIMEOUT_MS)
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers }
  if (opts.body !== undefined && !(opts.body instanceof FormData))
    headers['Content-Type'] = 'application/json'
  if (token && opts.auth !== false) headers.Authorization = `Bearer ${token}`
  try {
    return await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body:
        opts.body === undefined
          ? undefined
          : opts.body instanceof FormData
            ? opts.body
            : JSON.stringify(opts.body),
      credentials: 'include', // refresh_token cookie is HttpOnly on the gateway origin
      signal: t.signal,
    })
  } catch {
    if (t.timedOut()) throw new ApiError('timeout', 'The request timed out. Please try again.')
    if (opts.signal?.aborted) throw new ApiError('aborted', 'Request cancelled.')
    throw new ApiError('network', 'Cannot reach the server. Check your connection and try again.')
  } finally {
    t.done()
  }
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined
  const text = await res.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

let refreshing: Promise<string | null> | null = null

/**
 * Exchanges the HttpOnly refresh cookie for a new access token. Refresh tokens rotate and
 * reuse is treated as theft by auth-service (all sessions are revoked), so concurrent
 * callers MUST share one in-flight request.
 */
export function refreshSession(): Promise<string | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await doFetch('/auth/refresh', { method: 'POST', auth: false }, null)
        if (!res.ok) return null
        const data = (await readBody(res)) as TokenResponse
        useAuthStore.getState().setSession(data.access_token)
        return data.access_token
      } catch {
        return null
      } finally {
        setTimeout(() => {
          refreshing = null
        }, 0)
      }
    })()
  }
  return refreshing
}

export async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await doFetch(path, opts, getAccessToken())
  if (res.status === 401 && opts.auth !== false) {
    const fresh = await refreshSession()
    if (fresh) res = await doFetch(path, opts, fresh)
    else {
      useAuthStore.getState().clear({ expired: true })
      throw new ApiError('auth', 'Your session has expired. Please sign in again.', 401)
    }
  }
  const body = await readBody(res)
  if (!res.ok) {
    const err = parseErrorBody(res.status, body)
    if (res.status === 401 && opts.auth !== false) useAuthStore.getState().clear({ expired: true })
    throw err
  }
  return body as T
}

/** Authenticated binary download (same refresh-once-on-401 behaviour as `request`). */
export async function requestBlob(path: string, opts: RequestOptions = {}): Promise<Blob> {
  const withAccept = { ...opts, headers: { Accept: '*/*', ...opts.headers } }
  let res = await doFetch(path, withAccept, getAccessToken())
  if (res.status === 401 && opts.auth !== false) {
    const fresh = await refreshSession()
    if (!fresh) {
      useAuthStore.getState().clear({ expired: true })
      throw new ApiError('auth', 'Your session has expired. Please sign in again.', 401)
    }
    res = await doFetch(path, withAccept, fresh)
  }
  if (!res.ok) throw parseErrorBody(res.status, await readBody(res))
  return res.blob()
}

type Opts = Omit<RequestOptions, 'method' | 'body'>

export const api = {
  get: <T>(path: string, o?: Opts) => request<T>(path, { ...o, method: 'GET' }),
  post: <T>(path: string, body?: unknown, o?: Opts) => request<T>(path, { ...o, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, o?: Opts) =>
    request<T>(path, { ...o, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, o?: Opts) => request<T>(path, { ...o, method: 'PUT', body }),
  delete: <T>(path: string, o?: Opts) => request<T>(path, { ...o, method: 'DELETE' }),
}
