import { Link } from 'react-router-dom'

/** The 404 page. A normal user who types /admin gets this, exactly as for any unknown address. */
export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center" data-testid="not-found">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm text-ink-2">The page you were looking for does not exist.</p>
      <Link to="/" className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink">Go to GranthanAI</Link>
    </div>
  )
}
