import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError } from '@/lib/errors'
import { applyFonts, useFontStore } from '@/stores/font.store'
import { applyTheme, useUiStore } from '@/stores/ui.store'

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => {
          if (error instanceof ApiError && ['auth', 'forbidden', 'not_found', 'validation'].includes(error.kind))
            return false
          return count < 2
        },
      },
    },
  })
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient)
  const theme = useUiStore((s) => s.theme)
  const inputFont = useFontStore((s) => s.input)
  const responseFont = useFontStore((s) => s.response)

  useEffect(() => applyFonts(inputFont, responseFont), [inputFont, responseFont])

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = () => applyTheme('system')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [theme])

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
