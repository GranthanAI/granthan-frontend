import { Brain } from 'lucide-react'
import { THINK_COPY } from '@/content/quickwins'
import { cn } from '@/lib/utils'
import { useThink } from './think'

/** "Think longer" (Brain icon) next to the model picker. Hidden when the plan has none; disabled when the model can't. */
export function ThinkToggle({ selectionKey, disabled }: { selectionKey: string; disabled?: boolean }) {
  const t = useThink(selectionKey)
  if (!t.visible) return null
  const blocked = !t.enabled
  const title = blocked ? THINK_COPY.modelCannot : t.on ? 'On: the model reasons before answering. Click to turn off' : THINK_COPY.label
  return (
    <button
      type="button"
      onClick={t.toggle}
      disabled={disabled || blocked}
      aria-pressed={t.on}
      aria-label={THINK_COPY.label}
      title={title}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        t.on ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2 hover:bg-surface-2',
      )}
    >
      <Brain className="size-4" aria-hidden />
      <span className="max-sm:hidden">{THINK_COPY.label}</span>
      {blocked && <span className="sr-only">{THINK_COPY.modelCannot}</span>}
    </button>
  )
}
