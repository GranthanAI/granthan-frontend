import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'
export const PANEL_MIN_WIDTH = 320
export const PANEL_MAX_WIDTH = 880
export const clampPanelWidth = (px: number, viewport = Infinity) =>
  Math.round(Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, px), Math.max(PANEL_MIN_WIDTH, viewport * 0.7)))

export type PanelTab = 'details' | 'files' | 'artifacts' | 'notes'

interface UiState {
  theme: Theme
  sidebarCollapsed: boolean
  mobileSidebarOpen: boolean
  panelOpen: boolean
  panelTab: PanelTab
  /** Stack mode: several sections (e.g. Artifacts and Notes) are open together, one above the other. */
  panelStack: boolean
  /** Composer toggle "Include diagram if necessary": sent with each message so the model may add a Mermaid/Manim diagram. */
  includeDiagrams: boolean
  /** User-chosen width of the right panel in px (null = default for the current mode). */
  panelWidth: number | null
  stackTabs: PanelTab[]
  setTheme: (t: Theme) => void
  toggleSidebar: () => void
  setMobileSidebar: (open: boolean) => void
  openPanel: (tab?: PanelTab) => void
  setPanelStack: (on: boolean) => void
  setPanelWidth: (px: number | null) => void
  setIncludeDiagrams: (on: boolean) => void
  /** A tab click: opens only that section, or in stack mode adds/removes it (the last open section stays). */
  selectPanelTab: (tab: PanelTab) => void
  closePanel: () => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      sidebarCollapsed: false,
      mobileSidebarOpen: false,
      panelOpen: false,
      panelTab: 'details',
      panelStack: false,
      panelWidth: null,
      includeDiagrams: false,
      stackTabs: ['details'],
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileSidebar: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
      openPanel: (tab) =>
        set((s) => {
          const next = tab ?? s.panelTab
          const stackTabs = s.panelStack && !s.stackTabs.includes(next) ? [...s.stackTabs, next] : s.stackTabs
          return { panelOpen: true, panelTab: next, stackTabs }
        }),
      setPanelWidth: (panelWidth) => set({ panelWidth }),
      setIncludeDiagrams: (includeDiagrams) => set({ includeDiagrams }),
      setPanelStack: (panelStack) => set((s) => ({ panelStack, stackTabs: [s.panelTab] })),
      selectPanelTab: (tab) =>
        set((s) => {
          if (!s.panelStack) return { panelTab: tab, stackTabs: [tab] }
          if (!s.stackTabs.includes(tab)) return { panelTab: tab, stackTabs: [...s.stackTabs, tab] }
          if (s.stackTabs.length === 1) return {}
          const stackTabs = s.stackTabs.filter((t) => t !== tab)
          return { stackTabs, panelTab: s.panelTab === tab ? stackTabs[stackTabs.length - 1]! : s.panelTab }
        }),
      closePanel: () => set({ panelOpen: false }),
    }),
    {
      name: 'granthan-ui',
      partialize: (s) => ({ theme: s.theme, sidebarCollapsed: s.sidebarCollapsed, panelStack: s.panelStack, panelWidth: s.panelWidth, includeDiagrams: s.includeDiagrams }),
    },
  ),
)

export function applyTheme(theme: Theme) {
  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}
