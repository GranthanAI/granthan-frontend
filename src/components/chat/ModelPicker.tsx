import { useEffect, useId, useRef, useState } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import { Cpu } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { toast } from '@/components/ui/overlays'
import { GROUP_DESCRIPTIONS, PAYG_COPY, PRICING_COPY, groupLabel, planCopy } from '@/content/plans'
import { usePaygPlan, usePlans } from '@/features/billing/hooks'
import { joinNames, planNames, plansIncluding, subscribablePlans } from '@/features/billing/includedModels'
import { useModelSelection } from '@/features/billing/useModelSelection'
import { useUpdatePreferences } from '@/features/preferences/usePreferences'
import { errorMessage } from '@/lib/errors'
import { formatIstTime, formatLimit, formatPaise } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { MyModel, MyModelGroup, MyModelsResponse, PlanEntry } from '@/types/billing'

/** A model the plan does not include, with the group it belongs to. */
interface Other {
  model: MyModel
  group: MyModelGroup
}

function PricingLink({ className, children, onNavigate }: { className: string; children: React.ReactNode; onNavigate: () => void }) {
  const inRouter = useInRouterContext()
  return inRouter ? (
    <Link to="/pricing" onClick={onNavigate} className={className}>{children}</Link>
  ) : (
    <a href="/pricing" className={className}>{children}</a>
  )
}

/** "5 Advanced answers every day" / "5 on Pro, 15 on Max": from the plans API, never typed in. */
function allowanceText(plans: PlanEntry[]): string | null {
  const counts = plans.map((p) => ({ name: planCopy(p.code).name, n: p.limits.best_per_day })).filter((c) => c.n !== 0)
  if (!counts.length) return null
  if (counts.every((c) => c.n === counts[0]!.n)) {
    return counts[0]!.n === -1 ? 'Advanced answers every day, with no daily count' : `${formatLimit(counts[0]!.n)} Advanced answers every day`
  }
  return `Advanced answers every day: ${counts.map((c) => `${c.n === -1 ? 'unlimited' : formatLimit(c.n)} on ${c.name}`).join(', ')}`
}

/** The plan a model with no access sits under: "On Pro", "On Max", or "With credits". */
function sectionOf(o: Other, plans: PlanEntry[] | undefined): { key: string; title: string; badge: string; rank: number } {
  const including = plansIncluding(plans, { id: o.model.id, label: o.model.label, provider: o.model.provider, group: o.group.group, sort_order: 0 })
  if (including.length) {
    const first = including[0]!
    const name = planCopy(first.code).name
    return { key: first.code, title: `On ${name}`, badge: name, rank: first.rank }
  }
  if (o.group.group === 'ultra' || o.group.upgrade_to === 'payg') return { key: 'credits', title: 'With credits', badge: 'Credits', rank: 1000 }
  const code = o.group.upgrade_to
  if (code) {
    const name = planCopy(code).name
    return { key: code, title: `On ${name}`, badge: name, rank: 500 }
  }
  return { key: 'other', title: 'On a bigger plan', badge: 'Plan', rank: 900 }
}

/** The friendly answer to choosing a model the plan does not include. Never an error. */
function infoText(o: Other, plans: PlanEntry[] | undefined, creditPrice: number | undefined): string {
  const label = o.model.label
  const including = plansIncluding(plans, { id: o.model.id, label, provider: o.model.provider, group: o.group.group, sort_order: 0 })
  if (!including.length) {
    if (o.group.group === 'ultra' || o.group.upgrade_to === 'payg') {
      return `${label} is available with credits${creditPrice != null ? `: ${formatPaise(creditPrice)} per answer` : ', paid per answer'}.`
    }
    return `${label} is included with ${o.group.upgrade_to ? planCopy(o.group.upgrade_to).name : 'a bigger plan'}.`
  }
  const names = joinNames(planNames(including))
  const allowance = o.group.group === 'best' ? allowanceText(including) : null
  return allowance ? `${label} is included with ${names}: ${allowance}.` : `${label} is included with ${names}.`
}

/** "4 Advanced answers left today · refreshes at 12:00 am", or what happens at 0. */
export function advancedLine(g: MyModelGroup, data: MyModelsResponse): string | null {
  if (g.group !== 'best' || !g.allowed || g.daily_limit <= 0) return null
  const time = formatIstTime(data.messages.resets_at)
  const refresh = time ? ` · refreshes at ${time}` : ''
  if (g.remaining_today <= 0) return `Today's Advanced answers are used · Smart continues${refresh}`
  return `${formatLimit(g.remaining_today)} Advanced ${g.remaining_today === 1 ? 'answer' : 'answers'} left today${refresh}`
}

/**
 * Chooses the model for this conversation. Included models are listed by group (Fast, Smart, Advanced, Ultra) with what each
 * group is for; models the plan does not include are not greyed out: they sit in their own "On Pro" / "On Max" / "With
 * credits" section, and choosing one explains what includes it. Renders nothing when the model list could not be loaded.
 */
export function ModelPicker({ selectionKey, disabled }: { selectionKey: string; disabled?: boolean }) {
  const sel = useModelSelection(selectionKey)
  const savePref = useUpdatePreferences()
  const prices = usePaygPlan()?.payg?.unit_prices
  const rawPlans = usePlans().data?.plans
  const plans = Array.isArray(rawPlans) ? rawPlans : undefined
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<Other | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (info) return setInfo(null)
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
  }, [open, info])

  // tell the user once, quietly, when the model they were on had to be swapped
  const note = sel.switchedNote
  const told = useRef<string | null>(null)
  useEffect(() => {
    if (note && told.current !== note) {
      told.current = note
      toast(note, 'info')
    }
  }, [note])

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

  // included models, by group; everything else goes to the "On Pro" / "On Max" / "With credits" sections
  // a model llm-service cannot answer with right now is hidden everywhere (also from "On Pro")
  const here = data.groups.map((g) => ({ ...g, models: g.models.filter((m) => m.available !== false) }))
  const includedGroups = here.map((g) => ({ g, models: g.models.filter((m) => m.allowed) })).filter((x) => x.models.length)
  const others: Other[] = here.flatMap((g) => g.models.filter((m) => !m.allowed).map((model) => ({ model, group: g })))
  const sections = new Map<string, { title: string; rank: number; items: Array<Other & { badge: string }> }>()
  for (const o of others) {
    const s = sectionOf(o, plans)
    const entry = sections.get(s.key) ?? { title: s.title, rank: s.rank, items: [] }
    entry.items.push({ ...o, badge: s.badge })
    sections.set(s.key, entry)
  }
  const orderedSections = [...sections.entries()].sort((a, b) => a[1].rank - b[1].rank)
  const hasBiggerPlan = subscribablePlans(plans).length > 0 || others.length > 0

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
          {sel.switchedNote && <p role="status" data-testid="model-switched-note" className="px-2.5 pb-1.5 pt-1 text-xs text-ink-2">{sel.switchedNote}</p>}
          <div role="radiogroup" aria-label="Model" className="max-h-80 overflow-y-auto">
            {includedGroups.map(({ g, models }) => {
              const line = advancedLine(g, data)
              return (
                <div key={g.group} role="group" aria-label={groupLabel(g.group)} className="mt-1 border-t border-line pt-1 first:mt-0 first:border-t-0 first:pt-0">
                  <div className="px-2.5 pb-1 pt-1.5" title={GROUP_DESCRIPTIONS[g.group]}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">{groupLabel(g.group)}</p>
                    {GROUP_DESCRIPTIONS[g.group] && <p className="text-xs text-ink-3">{GROUP_DESCRIPTIONS[g.group]}</p>}
                    {line && <p data-testid="advanced-line" className="mt-0.5 text-xs font-medium text-ink-2">{line}</p>}
                  </div>
                  {models.map((m) => {
                    const on = sel.value === m.id
                    return (
                      <button
                        key={m.id}
                        role="radio"
                        aria-checked={on}
                        onClick={() => { sel.select(m.id); setOpen(false); setInfo(null) }}
                        className={cn('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2', on && 'bg-accent-soft')}
                      >
                        {radio(on)}
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-ink">{m.label}</span>
                          <span className="block text-xs text-ink-3">
                            {groupLabel(g.group)}
                            {g.funded_by === 'credits' && ` · ${prices?.[g.group] != null ? PAYG_COPY.perMessage(formatPaise(prices[g.group]!)) : 'uses credits'}`}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )
            })}

            {orderedSections.map(([key, section]) => (
              <div key={key} role="group" aria-label={section.title} className="mt-1 border-t border-line pt-1">
                <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">{section.title}</p>
                {section.items.map((o) => (
                  <button
                    key={o.model.id}
                    onClick={() => setInfo(o)}
                    aria-haspopup="dialog"
                    className="flex w-full items-start justify-between gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{o.model.label}</span>
                      <span className="block text-xs text-ink-3">{groupLabel(o.group.group)}</span>
                    </span>
                    <span data-testid="plan-badge" className="mt-0.5 shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-2">{o.badge}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          {info && (
            <div role="dialog" aria-label={`About ${info.model.label}`} className="mt-1 rounded-lg border border-line bg-surface p-3 text-sm text-ink">
              <p>{infoText(info, plans, prices?.[info.group.group])}</p>
              <div className="mt-2 flex items-center gap-2">
                {hasBiggerPlan && (
                  <PricingLink onNavigate={() => { setInfo(null); setOpen(false) }} className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-sm font-medium text-accent-ink">
                    {PRICING_COPY.seePlans}
                  </PricingLink>
                )}
                <Button size="sm" variant="ghost" onClick={() => setInfo(null)}>Not now</Button>
              </div>
            </div>
          )}

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
