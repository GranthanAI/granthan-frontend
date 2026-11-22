import { SUGGEST_COPY } from '@/content/quickwins'

/** Two or three follow-up questions under the LATEST answer. Clicking one sends it as a new message (it does not fill the composer). */
export function Suggestions({ items, onPick }: { items: string[]; onPick: (q: string) => void }) {
  if (!items.length) return null
  return (
    <ul className="mt-3 flex flex-wrap gap-2" aria-label={SUGGEST_COPY.label}>
      {items.map((q) => (
        <li key={q}>
          <button
            type="button"
            onClick={() => onPick(q)}
            className="rounded-full border border-line bg-raised px-3 py-1.5 text-left text-sm text-ink-2 transition-colors hover:border-accent/50 hover:bg-surface"
          >
            {q}
          </button>
        </li>
      ))}
    </ul>
  )
}
