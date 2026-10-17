import { create } from 'zustand'

export type WindowKind = 'chat' | 'hierarchy'

export interface FloatingWin {
  key: string
  kind: WindowKind
  conversationId: string
  x: number
  y: number
  w: number
  h: number
  z: number
  collapsed: boolean
  /** Hierarchy windows only: re-target to whichever conversation is open in the main view. */
  follow: boolean
  /** Size stepper value; the current size counts as 100% after any manual resize. */
  pct: number
  /** Window opacity in percent (OPACITY_MIN-100). */
  opacity: number
}

export const MIN_W = 280
export const MIN_H = 180
export const MAX_WINDOWS = 10
export const OPACITY_MIN = 30
export const PCT_MIN = 50
export const PCT_MAX = 200
export const PCT_STEP = 10
const HEADER_H = 36

export const winKey = (kind: WindowKind, conversationId: string) => `${kind}:${conversationId}`

const DEFAULT_SIZE: Record<WindowKind, { w: number; h: number }> = {
  chat: { w: 440, h: 560 },
  hierarchy: { w: 400, h: 320 },
}

const viewport = () => ({
  w: typeof window === 'undefined' ? 1280 : window.innerWidth,
  h: typeof window === 'undefined' ? 800 : window.innerHeight,
})

/** Keeps at least the title bar reachable so a window can never be dragged out of sight. */
export function clampPosition(x: number, y: number, w: number) {
  const vp = viewport()
  const grab = Math.min(120, w)
  return {
    x: Math.min(Math.max(x, grab - w), vp.w - grab),
    y: Math.min(Math.max(y, 0), vp.h - HEADER_H),
  }
}

interface WindowsState {
  windows: FloatingWin[]
  topZ: number
  /** Opens a window, or raises (and expands) it if that conversation is already open. */
  open: (kind: WindowKind, conversationId: string, opts?: { follow?: boolean }) => void
  /** The main view switched conversation: followers show that conversation's hierarchy instead. */
  retarget: (conversationId: string) => void
  /** Sets the size stepper (50%-200%), scaling about the top-left corner within the minimum size and the screen. */
  setPct: (key: string, pct: number) => void
  setOpacity: (key: string, opacity: number) => void
  close: (key: string) => void
  closeAll: () => void
  focus: (key: string) => void
  toggleCollapsed: (key: string) => void
  setRect: (key: string, rect: Partial<Pick<FloatingWin, 'x' | 'y' | 'w' | 'h'>>) => void
}

export const useWindowsStore = create<WindowsState>()((set) => ({
  windows: [],
  topZ: 1,
  open: (kind, conversationId, opts) =>
    set((s) => {
      const key = winKey(kind, conversationId)
      const z = s.topZ + 1
      if (s.windows.some((w) => w.key === key)) {
        return {
          topZ: z,
          windows: s.windows.map((w) =>
            w.key === key ? { ...w, z, collapsed: false, follow: opts?.follow ?? w.follow } : w,
          ),
        }
      }
      const vp = viewport()
      const size = DEFAULT_SIZE[kind]
      const w = Math.min(size.w, Math.max(MIN_W, vp.w - 16))
      const h = Math.min(size.h, Math.max(MIN_H, vp.h - 80))
      // Cascade from the top-right so successive windows stack visibly instead of hiding each other.
      const step = s.windows.length % 7
      const pos = clampPosition(vp.w - w - 24 - step * 32, 56 + step * 32, w)
      const next: FloatingWin = { key, kind, conversationId, ...pos, w, h, z, collapsed: false, follow: !!opts?.follow, pct: 100, opacity: 100 }
      // Over the cap the oldest (lowest) window makes room.
      const kept =
        s.windows.length >= MAX_WINDOWS
          ? [...s.windows].sort((a, b) => a.z - b.z).slice(1)
          : s.windows
      return { topZ: z, windows: [...kept, next] }
    }),
  retarget: (conversationId) =>
    set((s) => {
      if (!s.windows.some((w) => w.kind === 'hierarchy' && w.follow && w.conversationId !== conversationId)) return s
      const key = winKey('hierarchy', conversationId)
      const moved = s.windows.map((w) =>
        w.kind === 'hierarchy' && w.follow && w.conversationId !== conversationId ? { ...w, conversationId, key } : w,
      )
      // A hierarchy window for that conversation may already exist: keep one (the pinned one wins).
      const keep = moved.filter((w) => w.key !== key)
      const same = moved.filter((w) => w.key === key)
      const winner = same.find((w) => !w.follow) ?? same.sort((a, b) => b.z - a.z)[0]
      return { windows: winner ? [...keep, winner] : keep }
    }),
  setPct: (key, pctRaw) =>
    set((s) => {
      const vp = viewport()
      const pct = Math.min(PCT_MAX, Math.max(PCT_MIN, Math.round(pctRaw)))
      return {
        windows: s.windows.map((w) => {
          if (w.key !== key || w.pct === pct) return w
          const factor = pct / w.pct
          const nw = Math.round(Math.min(Math.max(MIN_W, w.w * factor), vp.w - 16))
          const nh = Math.round(Math.min(Math.max(MIN_H, w.h * factor), vp.h - 16))
          const pos = clampPosition(Math.min(w.x, vp.w - nw - 8), Math.min(w.y, vp.h - nh - 8), nw)
          return { ...w, w: nw, h: nh, x: pos.x, y: Math.max(0, pos.y), pct }
        }),
      }
    }),
  setOpacity: (key, value) =>
    set((s) => {
      const opacity = Math.min(100, Math.max(OPACITY_MIN, Math.round(value)))
      return { windows: s.windows.map((w) => (w.key === key ? { ...w, opacity } : w)) }
    }),
  close: (key) => set((s) => ({ windows: s.windows.filter((w) => w.key !== key) })),
  closeAll: () => set({ windows: [] }),
  focus: (key) =>
    set((s) => {
      const top = Math.max(0, ...s.windows.map((w) => w.z))
      const cur = s.windows.find((w) => w.key === key)
      if (!cur || cur.z === top) return s
      const z = s.topZ + 1
      return { topZ: z, windows: s.windows.map((w) => (w.key === key ? { ...w, z } : w)) }
    }),
  toggleCollapsed: (key) =>
    set((s) => ({ windows: s.windows.map((w) => (w.key === key ? { ...w, collapsed: !w.collapsed } : w)) })),
  setRect: (key, rect) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        // Dragging only moves; a manual resize makes the new size the 100% baseline.
        w.key === key ? { ...w, ...rect, ...(rect.w !== undefined || rect.h !== undefined ? { pct: 100 } : {}) } : w,
      ),
    })),
}))
