import { errorMessage } from '@/lib/errors'
import { sha256Hex, type SourceFormat } from './files'
import { SourceEditConflictError, sourceEditsApi, type SourceEditDoc, type SourceEditsApi } from './service'

export type EditSaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

/** What identifies one editable block. `original` is the AI's text, exactly as the (immutable) message holds it. */
export interface BlockMeta {
  conversationId: string
  messageId: string
  blockId: string
  language: string
  format: SourceFormat
  original: string
}

export interface BlockEditState {
  editing: boolean
  /** The text in the editor. Kept here (not in the component) so it survives the editor closing or the conversation changing. */
  draft: string
  /** Server version this client last confirmed (0 = no saved edit). Every save is conditional on it. */
  version: number
  /** The saved edit's text, or null when there is none (the original is then the effective source). */
  saved: string | null
  updatedAt: string | null
  showOriginal: boolean
  save: EditSaveStatus
  error: string | null
  /** The server's current edit while `save === 'conflict'` (null inside = it was discarded elsewhere). */
  conflict: { current: SourceEditDoc | null } | null
}

/**
 * The single owner of one block's edit state in this browser tab (keyed by user, conversation, message and block by the
 * registry). Rules that keep edits from being lost, duplicated or reordered:
 *
 *   - Saves are explicit (button / Ctrl+S), never per keystroke, and SINGLE-FLIGHT: one request at a time, always sent with
 *     the version the previous response returned.
 *   - The server applies a save only if the version is still current. A retry after a lost response therefore cannot
 *     duplicate or clobber anything (identical text is acknowledged without a write), and a save from a stale tab is a 409
 *     that leaves the user's draft on screen and asks which version to keep.
 *   - Text equal to the stored (or, with no edit yet, the original) text sends nothing.
 *   - A failed save keeps the draft; entering/leaving edit mode never touches the message or triggers regeneration.
 */
export class BlockEditController {
  private state: BlockEditState
  private listeners = new Set<() => void>()
  private running: Promise<void> | null = null
  private observers = 0
  /** Called after the server accepted a change, so list caches can refresh. */
  private onPersisted: (() => void) | null = null
  setOnPersisted(fn: (() => void) | null) { this.onPersisted = fn }

  constructor(
    readonly meta: BlockMeta,
    private readonly api: SourceEditsApi = sourceEditsApi,
  ) {
    this.state = {
      editing: false, draft: meta.original, version: 0, saved: null, updatedAt: null, showOriginal: false,
      save: 'idle', error: null, conflict: null,
    }
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getSnapshot = () => this.state
  private set(patch: Partial<BlockEditState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  retain() { this.observers++ }
  release() { this.observers = Math.max(0, this.observers - 1) }

  /** The text this block currently stands for: the saved edit, else the AI's original. */
  get effective(): string { return this.state.saved ?? this.meta.original }
  get dirty(): boolean { return this.state.editing && this.state.draft !== this.effective }
  get hasUnsavedWork(): boolean {
    return this.dirty || this.running !== null || this.state.save === 'error' || this.state.save === 'conflict'
  }
  get isIdle(): boolean { return !this.hasUnsavedWork && this.observers === 0 && !this.state.editing }

  /** Adopts what the server has. Never replaces text the user is working on; never goes backwards in version. */
  hydrate(doc: SourceEditDoc | undefined): void {
    if (this.running || this.dirty || this.state.conflict) return
    const v = doc?.version ?? 0
    if (v < this.state.version) return
    if (v === this.state.version && (doc?.content ?? null) === this.state.saved) return
    this.set({ saved: doc?.content ?? null, version: v, updatedAt: doc?.updated_at ?? null, draft: doc?.content ?? this.meta.original })
  }

  startEdit() {
    if (!this.state.editing) this.set({ editing: true, save: 'idle', error: null })   // `draft` already equals the effective text
  }

  setDraft(text: string) {
    if (text === this.state.draft) return
    this.set({ draft: text, save: this.state.save === 'saving' || this.state.save === 'conflict' ? this.state.save : 'idle', error: null })
  }

  /** Throws away unsaved changes (back to the last saved text, or the original). */
  resetDraft() { this.set({ draft: this.effective, save: 'idle', error: null }) }

  close() {
    if (this.running) return
    this.set({ editing: false, draft: this.effective, save: 'idle', error: null, conflict: null })
  }

  toggleOriginal() { this.set({ showOriginal: !this.state.showOriginal }) }

  save(): Promise<void> {
    if (this.running) return this.running
    this.running = this.doSave().finally(() => {
      this.running = null
      this.listeners.forEach((l) => l())
    })
    return this.running
  }

  private async doSave(): Promise<void> {
    const sent = this.state.draft
    if (sent === this.effective) {
      this.set({ save: 'saved', error: null })                       // nothing to store: no request
      return
    }
    this.set({ save: 'saving', error: null })
    try {
      const doc = await this.api.put(this.meta.conversationId, this.meta.messageId, this.meta.blockId, {
        content: sent, version: this.state.version, language: this.meta.language, source_format: this.meta.format,
        original_sha256: await sha256Hex(this.meta.original),
      })
      this.set({ saved: doc.content, version: doc.version, updatedAt: doc.updated_at, save: this.state.draft === doc.content ? 'saved' : 'idle', error: null })
      this.onPersisted?.()
    } catch (e) {
      if (e instanceof SourceEditConflictError) this.set({ save: 'conflict', conflict: { current: e.current }, error: null })
      else this.set({ save: 'error', error: errorMessage(e) })      // the draft stays; Retry sends the same request
    }
  }

  /** Conflict: keep my text and save it over the other version. */
  async keepMine(): Promise<void> {
    const c = this.state.conflict
    if (!c) return
    this.set({ conflict: null, version: c.current?.version ?? 0, saved: c.current?.content ?? null, save: 'idle' })
    await this.save()
  }

  /** Conflict: drop my text and use the other version. */
  useTheirs() {
    const c = this.state.conflict
    if (!c) return
    this.set({
      conflict: null, save: 'idle', error: null, version: c.current?.version ?? 0, saved: c.current?.content ?? null,
      updatedAt: c.current?.updated_at ?? null, draft: c.current?.content ?? this.meta.original,
    })
  }

  /** Discards the saved edit: the block goes back to the original answer text. */
  async revertToOriginal(): Promise<void> {
    if (this.running) return this.running
    if (this.state.version === 0) {
      this.set({ draft: this.meta.original, save: 'idle', error: null })
      return
    }
    this.running = (async () => {
      this.set({ save: 'saving', error: null })
      try {
        await this.api.remove(this.meta.conversationId, this.meta.messageId, this.meta.blockId, this.state.version)
        this.set({ saved: null, version: 0, updatedAt: null, draft: this.meta.original, editing: false, showOriginal: false, save: 'idle', error: null })
        this.onPersisted?.()
      } catch (e) {
        if (e instanceof SourceEditConflictError) this.set({ save: 'conflict', conflict: { current: e.current } })
        else this.set({ save: 'error', error: errorMessage(e) })
      }
    })().finally(() => {
      this.running = null
      this.listeners.forEach((l) => l())
    })
    return this.running
  }
}
