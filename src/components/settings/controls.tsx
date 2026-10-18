import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A titled settings card (shared by every settings page). */
export function SettingsSection({
  title,
  description,
  children,
  actions,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-line bg-raised p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="mt-4 space-y-5">{children}</div>
    </section>
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: string
  description?: string
}

/** Single choice from a few options (radiogroup; arrow keys move the selection). */
export function SegmentedControl<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  description?: string
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  const labelId = useId()
  const descId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selected = options.find((o) => o.value === value)

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const next = (i + delta + options.length) % options.length
    onChange(options[next]!.value)
    refs.current[next]?.focus()
  }

  return (
    <div>
      <p id={labelId} className="mb-1.5 text-sm font-medium text-ink">{label}</p>
      {description && <p id={descId} className="mb-2 text-xs text-ink-2">{description}</p>}
      <div role="radiogroup" aria-labelledby={labelId} aria-describedby={description ? descId : undefined} className="flex flex-wrap gap-2">
        {options.map((o, i) => {
          const on = o.value === value
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on || (!selected && i === 0) ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50',
                on ? 'border-accent bg-accent-soft font-medium text-ink' : 'border-line text-ink-2 hover:bg-surface-2',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      {selected?.description && <p className="mt-1.5 text-xs text-ink-3">{selected.description}</p>}
    </div>
  )
}

/** On/off switch with a visible label and description. */
export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string
  description?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-ink">{label}</label>
        {description && <p className="mt-0.5 text-xs text-ink-2">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50',
          checked ? 'bg-accent' : 'bg-surface-2 border border-line',
        )}
      >
        <span
          aria-hidden
          className={cn('absolute top-0.5 size-5 rounded-full bg-raised shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')}
        />
      </button>
    </div>
  )
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  hint,
  disabled,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  hint?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="h-10 w-full rounded-lg border border-line bg-raised px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint && <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-3">{hint}</p>}
    </div>
  )
}

export function TextAreaField({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
  hint,
  rows = 4,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  maxLength: number
  placeholder?: string
  hint?: string
  rows?: number
}) {
  const id = useId()
  const over = value.length > maxLength
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-count${hint ? ` ${id}-hint` : ''}`}
        aria-invalid={over || undefined}
        className={cn(
          'w-full resize-y rounded-lg border bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25',
          over ? 'border-danger' : 'border-line',
        )}
      />
      <div className="mt-1 flex items-start justify-between gap-3 text-xs">
        {hint ? <p id={`${id}-hint`} className="text-ink-3">{hint}</p> : <span />}
        <span id={`${id}-count`} className={cn('shrink-0 tabular-nums', over ? 'font-medium text-danger' : 'text-ink-3')}>
          {value.length}/{maxLength}
        </span>
      </div>
    </div>
  )
}
