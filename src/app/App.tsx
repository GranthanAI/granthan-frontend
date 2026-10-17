import { useState } from 'react'
import { RouterProvider } from 'react-router-dom'
import { Providers } from './providers'
import { createRouter } from './router'

export function App() {
  const [router] = useState(createRouter)
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  )
}
