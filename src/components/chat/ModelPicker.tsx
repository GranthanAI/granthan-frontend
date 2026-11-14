import { useEffect, useId, useRef, useState } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import { Cpu, Lock } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { toast } from '@/components/ui/overlays'
import { useModelSelection } from '@/features/billing/useModelSelection'
import { AUTO_MODEL } from '@/features/billing/model-selection'
import { useUpdatePreferences } from '@/features/preferences/usePreferences'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const planName = (code?: string | null) => (code ? cap(code) : 'a higher plan')

function PricingLink({ className, children, onNavigate }: { className: string; children: React.ReactNode; onNavigate: () => void }) {
  const inRouter = useInRouterContext()
  return inRouter ? (
    <Link to="/pricing" onClick={onNavigate} className={className}>{children}</Link>
  ) : (
    <a href="/pricing" className={className}>{children}</a>
  )
}

/**
 * Chooses the model for this conversation: Auto first, then Fast / Smart / Best / Ultra with the labels billing
 * returns. Models the plan does not include are greyed with the plan that unlocks them and link to /pricing.
 * Renders nothing when the model list could not be loaded.
 */
export function ModelPicker({ selectionKey, disabled }: { selectionKey: string; disabled?: boolean }) {
  const sel = useModelSelection(selectionKey)
  const savePref = useUpdatePreferences()
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

  if (!sel.available || !sel.data) return null
  const data = sel.data

  const setDefault = () =>
    savePref.mutate(
      { default_model: sel.value },
      { onSuccess: () => toast('Saved as your default model.', 'success'), onError: (e) => toast(errorMessage(e), 'error') },
    )

  const radio = (on: boolean) => (
    <span className={cn('mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border', on ? 'border-accent' : 'border-line')} aria-hidden>
      {on && <span className="size-2 rounded-full bg-accent" />}
    </span>
  )

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
        aria-label={`Model, ${sel.label}`}
        title="Choose the model for this conversation"
      >
        <Cpu className="size-4" />
        <span className="max-w-28 truncate max-sm:hidden">{sel.label}</span>
      </Button>

      {open && (
        <div id={panelId} role="dialog" aria-label="Models" className="animate-in absolute bottom-full left-0 z-30 mb-2 w-[min(22rem,88vw)] rounded-xl border border-line bg-raised p-1.5 shadow-pop">
          <div role="radiogroup" aria-label="Model" className="max-h-80 overflow-y-auto">
            <button
              role="radio"
              aria-checked={sel.value === AUTO_MODEL}
              onClick={() => { sel.select(AUTO_MODEL); setOpen(false) }}
              className={cn('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2', sel.value === AUTO_MODEL && 'bg-accent-soft')}
            >
              {radio(sel.value === AUTO_MODEL)}
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">Auto</span>
                <span className="block text-xs text-ink-2">Let GranthanAI choose the best model for each message.</span>
              </span>
            </button>
            {data.groups.map((g) => {
              const limited = g.allowed && g.daily_limit > 0
              return (
                <div key={g.group} role="group" aria-label={cap(g.group)} className="mt-1 border-t border-line pt-1">
                  <p className="flex items-center justify-between px-2.5 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
                    <span>{cap(g.group)}</span>
                    {limited && <span className="font-medium normal-case tracking-normal text-ink-2">{g.remaining_today} {cap(g.group)} left today</span>}
                  </p>
                  {g.models.map((m) => {
                    const on = sel.value === m.id
                    if (!g.allowed || !m.allowed) {
                      return (
                        <PricingLink
                          key={m.id}
                          onNavigate={() => setOpen(false)}
                          className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left opacity-60 hover:bg-surface-2"
                        >
                          <Lock className="mt-1 size-4 shrink-0 text-ink-3" aria-hidden />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-ink">{m.label}</span>
                            <span className="block text-xs text-ink-2">Available on {planName(g.upgrade_to)}. See plans</span>
                          </span>
                        </PricingLink>
                      )
                    }
                    return (
                      <button
                        key={m.id}
                        role="radio"
                        aria-checked={on}
                        onClick={() => { sel.select(m.id); setOpen(false) }}
                        className={cn('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2', on && 'bg-accent-soft')}
                      >
                        {radio(on)}
                        <span className="block text-sm font-medium text-ink">{m.label}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
          <div className="mt-1 flex items-center justify-between border-t border-line px-2.5 pt-1.5">
            <span className="text-xs text-ink-3">{sel.isSavedDefault ? 'Your default model' : 'For this conversation'}</span>
            {!sel.isSavedDefault && (
              <Button size="sm" variant="ghost" onClick={setDefault} disabled={savePref.isPending}>Set as default</Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
