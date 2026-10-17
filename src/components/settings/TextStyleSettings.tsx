import { useId } from 'react'
import { Button } from '@/components/ui/primitives'
import { FontPicker } from './FontPicker'
import {
  FONT_SIZES,
  FONT_WEIGHTS,
  useFontStore,
  type FontPrefs,
  type FontTarget,
} from '@/stores/font.store'

const BLOCKS: { target: FontTarget; title: string; hint: string; sample: string; previewClass: string }[] = [
  {
    target: 'input',
    title: 'Your messages and input box',
    hint: 'Applies to what you type and to your sent messages.',
    sample: 'How do Kafka partitions relate to consumer groups?',
    previewClass: 'font-input',
  },
  {
    target: 'response',
    title: 'AI responses',
    hint: 'Applies to the assistant’s replies (code blocks stay monospace).',
    sample: 'A partition is read by exactly one consumer in a group, so more partitions allow more parallel readers.',
    previewClass: 'font-response',
  },
]

const selectClass =
  'h-9 w-full rounded-lg border border-line bg-raised px-2 text-sm focus:border-accent focus:outline-none'

/** Font family, weight and style for input and response text. Stored in this browser only. */
export function TextStyleSettings() {
  return (
    <div className="space-y-6">
      {BLOCKS.map((b) => (
        <Block key={b.target} {...b} />
      ))}
      <p className="text-xs text-ink-3">Saved in this browser only. Fonts come from your device, so nothing is downloaded.</p>
    </div>
  )
}

function Block({ target, title, hint, sample, previewClass }: (typeof BLOCKS)[number]) {
  const prefs = useFontStore((s) => s[target])
  const set = useFontStore((s) => s.set)
  const reset = useFontStore((s) => s.reset)
  const applyToBoth = useFontStore((s) => s.applyToBoth)
  const id = useId()

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{title}</legend>
      <p className="text-xs text-ink-3">{hint}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Font family" htmlFor={`${id}-family`}>
          <FontPicker label="Font family" value={prefs.family} onChange={(family) => set(target, { family })} />
        </Field>
        <Field label="Weight" htmlFor={`${id}-weight`}>
          <select id={`${id}-weight`} className={selectClass} value={prefs.weight} onChange={(e) => set(target, { weight: e.target.value })}>
            {FONT_WEIGHTS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Size" htmlFor={`${id}-size`}>
          <select id={`${id}-size`} className={selectClass} value={prefs.size ?? ''} onChange={(e) => set(target, { size: e.target.value })}>
            {FONT_SIZES.map((z) => (
              <option key={z.value} value={z.value}>
                {z.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Style" htmlFor={`${id}-style`}>
          <select
            id={`${id}-style`}
            className={selectClass}
            value={prefs.style}
            onChange={(e) => set(target, { style: e.target.value as FontPrefs['style'] })}
          >
            <option value="normal">Normal</option>
            <option value="italic">Italic</option>
          </select>
        </Field>
      </div>
      <p className={`${previewClass} rounded-lg border border-line bg-surface px-3 py-2 text-[0.9375rem] leading-relaxed`} aria-label={`${title} preview`}>
        {sample}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => applyToBoth(target)} title="Use these settings for both your messages and AI responses">
          Apply to both
        </Button>
        <Button size="sm" variant="ghost" onClick={() => reset(target)}>
          Reset to default
        </Button>
      </div>
    </fieldset>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink-2">
        {label}
      </label>
      {children}
    </div>
  )
}
