import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { ALL_FONT_FAMILIES, availableFontFamilies, type FontFamilyOption } from '@/lib/fonts'
import { cn } from '@/lib/utils'

interface Props {
  label: string
  value: string
  onChange: (id: string) => void
}

/**
 * Searchable font list. Type to filter; every font name is drawn in its own typeface so the choice is
 * recognisable at a glance (like the font box in a word processor). Only fonts installed on this device are listed.
 */
export function FontPicker({ label, value, onChange }: Props) {
  const uid = useId()
  const listId = `${uid}-list`
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const options = useMemo(() => availableFontFamilies(), [])
  const selected = ALL_FONT_FAMILIES.find((f) => f.id === value) ?? ALL_FONT_FAMILIES[0]!
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((f) => f.label.toLowerCase().includes(q) || f.category.toLowerCase().includes(q)) : options
  }, [options, query])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  })

  useEffect(() => {
    if (open) document.getElementById(`${uid}-opt-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active, open, uid])

  function close() {
    setOpen(false)
    setQuery('')
  }
  function pick(f: FontFamilyOption) {
    onChange(f.id)
    close()
    input.current?.blur()
  }
  function show() {
    if (open) return
    setOpen(true)
    setActive(Math.max(0, options.findIndex((f) => f.id === value)))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return show()
      const n = filtered.length
      if (n) setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n))
    } else if (e.key === 'Enter' && open) {
      e.preventDefault()
      const f = filtered[active]
      if (f) pick(f)
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      close()
    }
  }

  return (
    <div ref={root} className="relative">
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${uid}-opt-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={open ? query : selected.label}
        placeholder={open ? 'Search fonts…' : undefined}
        onFocus={(e) => {
          show()
          e.currentTarget.select()
        }}
        onClick={show}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          if (!open) setOpen(true)
        }}
        onKeyDown={onKeyDown}
        style={{ fontFamily: open ? undefined : selected.css || undefined }}
        className="h-9 w-full rounded-lg border border-line bg-raised pl-2 pr-8 text-sm focus:border-accent focus:outline-none"
      />
      <ChevronDown className="pointer-events-none absolute right-2 top-2.5 size-4 text-ink-3" aria-hidden />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} options`}
          className="absolute z-20 mt-1 max-h-64 w-full min-w-56 overflow-y-auto rounded-lg border border-line bg-raised py-1 shadow-pop"
        >
          {filtered.length === 0 && <li className="px-3 py-2 text-sm text-ink-3">No fonts match “{query}”.</li>}
          {filtered.map((f, i) => {
            const showHeading = i === 0 || filtered[i - 1]!.category !== f.category
            return (
              <li key={f.id} role="presentation">
                {showHeading && (
                  <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-3">{f.category}</div>
                )}
                <div
                  id={`${uid}-opt-${i}`}
                  role="option"
                  aria-selected={f.id === value}
                  // mousedown keeps focus in the input so the list does not close before the click lands
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(f)}
                  onMouseEnter={() => setActive(i)}
                  style={{ fontFamily: f.css || undefined }}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-[0.9375rem]',
                    i === active && 'bg-surface-2',
                    f.id === value && 'font-medium',
                  )}
                >
                  <span className="truncate">{f.label}</span>
                  {f.id === value && <Check className="size-3.5 shrink-0 text-accent" aria-hidden />}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
