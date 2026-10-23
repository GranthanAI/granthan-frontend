import { ApiError, errorMessage } from '@/lib/errors'
import { NotesConflictError, notesApi, type NotesApi, type NotesDoc } from './service'

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'

export interface NotesState {
  load: 'loading' | 'ready' | 'error'
  loadError: string | null
  text: string
  /** The server version this client last confirmed (0 = nothing saved yet). Every save is conditional on it. */
  version: number
  /** `updated_at` of the last confirmed save. */
  savedAt: string | null
  save: SaveStatus
  saveError: string | null
  /** The server's current document while `save === 'conflict'`. */
  conflict: NotesDoc | null
  maxChars: number
}

export const DEFAULT_DEBOUNCE_MS = 600

/** A bare "Not Found" says nothing: here it means the conversation is gone or this server does not offer notes yet. */
export function describeNotesError(e: unknown): string {
  if (e instanceof ApiError && e.status === 404) {
    return "Notes aren't available for this conversation (it may have been deleted, or the server hasn't been updated to support notes yet)"
  }
  return errorMessage(e)
}
const DEFAULT_MAX_CHARS = 100_000

/**
 * The single owner of one conversation's notes in this browser tab. Every editor instance for that conversation (the
 * desktop panel and the mobile overlay are mounted together; floating windows may add more) reads and writes THIS object,
 * so one tab never competes with itself. The rules that keep edits from being lost or reordered:
 *
 *   - Saves are SINGLE-FLIGHT: at most one PUT is in the air; edits made meanwhile only mark the text newer, and the loop
 *     sends them afterwards, with the version the previous response returned. An older response can therefore never
 *     overwrite newer text, and two requests never race each other.
 *   - Cancelling a request is never relied on (it may already have reached the server): the server applies each PUT only
 *     if its version is still current, so a stale one is rejected (409) instead of overwriting.
 *   - Typing is debounced, and text equal to what is already stored triggers no request at all.
 *   - A failed save keeps the text (state stays in this object, even after the editor unmounts) and is retried by the user
 *     or by the next edit. A conflict (another tab saved) keeps the user's text and asks which version to keep.
 */
export class NotesController {
  private state: NotesState
  private listeners = new Set<() => void>()
  private savedText = ''
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<void> | null = null
  private loading: Promise<void> | null = null
  private observers = 0

  constructor(
    readonly conversationId: string,
    private readonly api: NotesApi = notesApi,
    private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS,
  ) {
    this.state = {
      load: 'loading', loadError: null, text: '', version: 0, savedAt: null, save: 'idle', saveError: null,
      conflict: null, maxChars: DEFAULT_MAX_CHARS,
    }
  }

  // ── store contract (useSyncExternalStore) ─────────────────────────────────────────────────────────────────────────
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  getSnapshot = () => this.state

  private set(patch: Partial<NotesState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  /** True while there is text the server does not have (or a save that has not finished). */
  get hasUnsavedWork() {
    return this.state.text !== this.savedText || this.running !== null || this.state.save === 'error' || this.state.save === 'conflict'
  }
  get isIdle() {
    return !this.hasUnsavedWork && this.observers === 0
  }

  // ── observers: leaving a conversation flushes its pending edit immediately ─────────────────────────────────────────
  retain() {
    this.observers += 1
  }
  release() {
    this.observers = Math.max(0, this.observers - 1)
    if (this.observers === 0) void this.flush()
  }

  // ── loading ───────────────────────────────────────────────────────────────────────────────────────────────────────
  load(force = false): Promise<void> {
    if (this.loading && !force) return this.loading
    if (this.state.load === 'ready' && !force) return Promise.resolve()
    this.loading = (async () => {
      this.set({ load: this.state.load === 'ready' ? 'ready' : 'loading', loadError: null })
      try {
        const doc = await this.api.get(this.conversationId)
        // Never replace text the user has already started changing locally.
        if (this.state.load === 'ready' && this.hasUnsavedWork) {
          this.set({ maxChars: doc.max_chars })
          return
        }
        this.adopt(doc)
        this.set({ load: 'ready' })
      } catch (e) {
        this.set({ load: this.state.load === 'ready' ? 'ready' : 'error', loadError: describeNotesError(e) })
      } finally {
        this.loading = null
      }
    })()
    return this.loading
  }

  /** Picks up a save made in another tab, but only when this one has nothing of its own pending. */
  async refresh(): Promise<void> {
    if (this.state.load !== 'ready' || this.hasUnsavedWork || this.loading) return
    try {
      const doc = await this.api.get(this.conversationId)
      if (this.hasUnsavedWork || doc.version <= this.state.version) return        // typed meanwhile / nothing newer
      this.adopt(doc)
    } catch {
      /* a failed background refresh is silent: the next save would surface a real problem */
    }
  }

  private adopt(doc: NotesDoc) {
    this.savedText = doc.content
    this.set({
      text: doc.content, version: doc.version, savedAt: doc.updated_at, maxChars: doc.max_chars,
      save: doc.version > 0 ? 'saved' : 'idle', saveError: null, conflict: null,
    })
  }

  // ── editing ───────────────────────────────────────────────────────────────────────────────────────────────────────
  setText(text: string) {
    if (this.state.load !== 'ready' || text === this.state.text) return
    const max = this.state.maxChars
    const next = text.length > max ? text.slice(0, max) : text
    this.set({ text: next })
    if (this.state.save === 'conflict') return                       // text is kept; nothing is sent until it is resolved
    if (next === this.savedText && this.running === null) {
      this.clearTimer()
      this.set({ save: this.state.version > 0 ? 'saved' : 'idle', saveError: null })   // back to what is stored: no write
      return
    }
    if (this.running === null) {
      this.set({ save: 'dirty', saveError: null })
      this.schedule()
    }                                                               // else: the running loop sends it right after
  }

  private schedule() {
    this.clearTimer()
    this.timer = setTimeout(() => void this.flush(), this.debounceMs)
  }
  private clearTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Sends anything pending now and resolves when nothing is left to send (or a save failed / conflicted). */
  flush(): Promise<void> {
    this.clearTimer()
    if (this.state.load !== 'ready' || this.state.save === 'conflict') return this.running ?? Promise.resolve()
    if (this.running) return this.running
    if (this.state.text === this.savedText) return Promise.resolve()
    this.running = this.drain().finally(() => {
      this.running = null
      // text typed in the instant between the last check and the loop ending still gets its own save
      if (this.state.text !== this.savedText && this.state.save !== 'error' && this.state.save !== 'conflict') this.schedule()
    })
    return this.running
  }

  retry(): Promise<void> {
    if (this.state.save === 'error') this.set({ save: 'dirty', saveError: null })
    return this.flush()
  }

  private async drain(): Promise<void> {
    while (this.state.text !== this.savedText && this.state.save !== 'conflict') {
      const sent = this.state.text
      const version = this.state.version
      this.set({ save: 'saving', saveError: null })
      try {
        const doc = await this.api.put(this.conversationId, { content: sent, version })
        this.savedText = doc.content
        this.set({ version: doc.version, savedAt: doc.updated_at, maxChars: doc.max_chars })
      } catch (e) {
        if (e instanceof NotesConflictError) {
          this.set({ save: 'conflict', conflict: e.current, saveError: null })
        } else {
          this.set({ save: 'error', saveError: describeNotesError(e) })
        }
        return
      }
    }
    this.set({ save: this.state.version > 0 ? 'saved' : 'idle' })
  }

  // ── conflict resolution: the user's text is never discarded without being asked ─────────────────────────────────
  /** Keep what is in the editor and save it over the other version. */
  keepMine(): Promise<void> {
    const theirs = this.state.conflict
    if (!theirs) return Promise.resolve()
    this.savedText = theirs.content
    this.set({ version: theirs.version, savedAt: theirs.updated_at, conflict: null, save: 'dirty' })
    return this.flush()
  }
  /** Drop the editor's text and take the other version. */
  useTheirs() {
    const theirs = this.state.conflict
    if (theirs) this.adopt(theirs)
  }
}
