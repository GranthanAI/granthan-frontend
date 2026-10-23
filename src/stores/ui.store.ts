import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'
export type PanelTab = 'details' | 'files' | 'artifacts' | 'memory'

interface UiState {
  theme: Theme
  sidebarCollapsed: boolean
  mobileSidebarOpen: boolean
  panelOpen: boolean
  panelTab: PanelTab
  setTheme: (t: Theme) => void
  toggleSidebar: () => void
  setMobileSidebar: (open: boolean) => void
  openPanel: (tab?: PanelTab) => void
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
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileSidebar: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
      openPanel: (tab) => set((s) => ({ panelOpen: true, panelTab: tab ?? s.panelTab })),
      closePanel: () => set({ panelOpen: false }),
    }),
    {
      name: 'granthan-ui',
      partialize: (s) => ({ theme: s.theme, sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
)

export function applyTheme(theme: Theme) {
  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}
