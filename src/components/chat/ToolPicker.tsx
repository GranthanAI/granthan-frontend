import { useEffect, useId, useRef, useState } from 'react'
import { Check, Wrench } from 'lucide-react'
import { Button, Spinner } from '@/components/ui/primitives'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import type { useToolSelection } from '@/features/tools/useTools'

type Selection = ReturnType<typeof useToolSelection>

/**
 * Lists the tools the backend currently offers (GET /tools) and lets the user pick any of them for the
 * next message. Loading, empty and error states are explicit; at most `max` tools can be chosen.
 */
export function ToolPicker({ selection, disabled }: { selection: Selection; disabled?: boolean }) {
  const { query, tools, selected, max, toggle, modes, mode, setMode } = selection
  const active = selected.length + (mode ? 1 : 0)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        root.current?.querySelector<HTMLElement>('button')?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={active ? `Tools, ${active} selected` : 'Tools'}
        title="Choose a mode and tools for this message"
      >
        <Wrench className="size-4" />
        <span className="max-sm:hidden">Tools</span>
        {active > 0 && (
          <span className="rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-ink">{active}</span>
        )}
      </Button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Available tools"
          className="animate-in absolute bottom-full left-0 z-30 mb-2 w-[min(22rem,88vw)] rounded-xl border border-line bg-raised p-1.5 shadow-pop"
        >
          {query.isPending ? (
            <div role="status" className="flex items-center gap-2 px-3 py-4 text-sm text-ink-2">
              <Spinner /> Loading tools…
            </div>
          ) : query.isError ? (
            <div role="alert" className="space-y-2 px-3 py-3 text-sm">
              <p className="text-danger">Could not load tools. {errorMessage(query.error)}</p>
              <Button size="sm" onClick={() => void query.refetch()}>
                Try again
              </Button>
            </div>
          ) : tools.length === 0 && modes.length === 0 ? (
            <p className="px-3 py-4 text-sm text-ink-2">No tools are enabled right now.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {modes.length > 0 && (
                <div role="radiogroup" aria-label="Mode" className="mb-1 border-b border-line pb-1.5">
                  <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">Mode</p>
                  {[{ id: '', name: 'Auto', description: 'Let GranthanAI choose how to answer.' }, ...modes].map((m) => {
                    const on = (mode ?? '') === m.id
                    return (
                      <button
                        key={m.id || 'auto'}
                        role="radio"
                        aria-checked={on}
                        onClick={() => setMode(m.id || null)}
                        className={cn('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2', on && 'bg-accent-soft')}
                      >
                        <span
                          className={cn('mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border', on ? 'border-accent' : 'border-line')}
                          aria-hidden
                        >
                          {on && <span className="size-2 rounded-full bg-accent" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-ink">{m.name}</span>
                          <span className="block text-xs text-ink-2">{m.description}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
              {tools.length > 0 && <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">Tools</p>}
            <ul role="group" aria-label="Tools">
              {tools.map((t) => {
                const on = selected.includes(t.id)
                const blocked = (!on && selected.length >= max) || !t.auto_runnable
                return (
                  <li key={t.id}>
                    <button
                      role="checkbox"
                      aria-checked={on}
                      disabled={blocked}
                      onClick={() => toggle(t.id)}
                      className={cn(
                        'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2 disabled:opacity-50',
                        on && 'bg-accent-soft',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
                          on ? 'border-accent bg-accent text-accent-ink' : 'border-line',
                        )}
                        aria-hidden
                      >
                        {on && <Check className="size-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink">{t.name}</span>
                        <span className="block text-xs text-ink-2">{t.description}</span>
                        {!t.auto_runnable && (
                          <span className="block text-xs text-ink-3">Needs input that chat can't provide yet.</span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            </div>
          )}
          {tools.length > 0 && (
            <p className="px-3 pb-1.5 pt-1 text-xs text-ink-3">
              Selected tools run for your next message. Up to {max}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
