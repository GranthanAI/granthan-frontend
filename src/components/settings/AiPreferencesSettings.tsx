import { useMemo, useState } from 'react'
import { Alert, Button, Skeleton } from '@/components/ui/primitives'
import { ConfirmDialog, toast } from '@/components/ui/overlays'
import { SegmentedControl, SelectField, SettingsSection, TextAreaField } from '@/components/settings/controls'
import { usePreferences, useResetPreferences, useUpdatePreferences } from '@/features/preferences/usePreferences'
import { useTools } from '@/features/tools/useTools'
import { ApiError, toApiError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import type { Preferences, PreferencesPatch } from '@/types/api'

type Draft = Pick<
  Preferences,
  'default_mode' | 'default_tools' | 'answer_length' | 'tone' | 'language' | 'personal_instructions' | 'citations' | 'document_context'
>

const pick = (p: Preferences): Draft => ({
  default_mode: p.default_mode,
  default_tools: p.default_tools,
  answer_length: p.answer_length,
  tone: p.tone,
  language: p.language,
  personal_instructions: p.personal_instructions,
  citations: p.citations,
  document_context: p.document_context,
})

const sameTools = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** Settings → AI preferences. Defaults apply to future messages; per-message choices still win. */
export function AiPreferencesSettings() {
  const prefs = usePreferences()
  const tools = useTools()
  const update = useUpdatePreferences()
  const reset = useResetPreferences()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)

  // (Re)load the form whenever the saved version changes (first load, save, other device, 409 refetch).
  const saved = prefs.data
  if (saved && saved.version !== loadedVersion) {
    setLoadedVersion(saved.version)
    setDraft(pick(saved))
  }

  const max = tools.data?.max_selected ?? 5
  const modes = useMemo(() => tools.data?.modes ?? [], [tools.data])
  const toolList = useMemo(() => (tools.data?.tools ?? []).filter((t) => t.auto_runnable), [tools.data])

  if (prefs.isPending || !draft || !saved) {
    return prefs.isError ? (
      <SettingsSection title="AI preferences">
        <Alert tone="error" action={<Button size="sm" onClick={() => void prefs.refetch()}>Retry</Button>}>
          {toApiError(prefs.error).message}
        </Alert>
      </SettingsSection>
    ) : (
      <SettingsSection title="AI preferences">
        <Skeleton className="h-24 w-full" />
      </SettingsSection>
    )
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v })
  const original = pick(saved)
  const patch: PreferencesPatch = {}
  if (draft.default_mode !== original.default_mode) patch.default_mode = draft.default_mode
  if (!sameTools(draft.default_tools, original.default_tools)) patch.default_tools = draft.default_tools
  for (const k of ['answer_length', 'tone', 'language', 'personal_instructions', 'citations', 'document_context'] as const) {
    if (draft[k] !== original[k]) (patch as Record<string, unknown>)[k] = draft[k]
  }
  const dirty = Object.keys(patch).length > 0
  const tooLong = draft.personal_instructions.length > saved.options.personal_instructions_max

  // Saved defaults the backend no longer offers: say so instead of silently hiding them.
  const modeGone = !!draft.default_mode && tools.isSuccess && !modes.some((m) => m.id === draft.default_mode)
  const toolsGone = tools.isSuccess ? draft.default_tools.filter((id) => !toolList.some((t) => t.id === id)) : []

  const save = async () => {
    setError('')
    try {
      await update.mutateAsync(patch)
      toast('AI preferences saved', 'success')
    } catch (e) {
      const err = toApiError(e)
      setError(
        e instanceof ApiError && e.status === 409
          ? 'These preferences were changed somewhere else. The latest values are loaded; review and save again.'
          : err.message,
      )
    }
  }

  const toggleTool = (id: string) =>
    set(
      'default_tools',
      draft.default_tools.includes(id)
        ? draft.default_tools.filter((x) => x !== id)
        : draft.default_tools.length < max
          ? [...draft.default_tools, id]
          : draft.default_tools,
    )

  return (
    <>
      <SettingsSection
        title="AI preferences"
        description="These defaults apply to your future messages on every device. Anything you choose for a single message in the composer overrides them for that message only."
      >
        {error && <Alert tone="error">{error}</Alert>}
        {(modeGone || toolsGone.length > 0) && (
          <Alert tone="warn">
            {modeGone && <>Your saved default mode “{draft.default_mode}” is no longer available; Auto is used instead. </>}
            {toolsGone.length > 0 && <>Saved default tools no longer available: {toolsGone.join(', ')}. They are skipped until available again.</>}
          </Alert>
        )}

        <SelectField
          label="Default response mode"
          value={draft.default_mode ?? ''}
          onChange={(v) => set('default_mode', v || null)}
          options={[
            { value: '', label: 'Auto (let GranthanAI decide)' },
            ...modes.map((m) => ({ value: m.id, label: m.name })),
            ...(modeGone ? [{ value: draft.default_mode!, label: `${draft.default_mode} (unavailable)` }] : []),
          ]}
          hint={tools.isError ? 'Could not load the available modes.' : undefined}
        />

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink">Default tools</legend>
          <p className="mb-2 text-xs text-ink-2">
            Tools that are switched on for every message unless you pick others. Up to {max}.
          </p>
          {tools.isPending ? (
            <Skeleton className="h-8 w-full" />
          ) : toolList.length === 0 ? (
            <p className="text-sm text-ink-3">No tools are available right now.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {toolList.map((t) => {
                const on = draft.default_tools.includes(t.id)
                const blocked = !on && draft.default_tools.length >= max
                return (
                  <label
                    key={t.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm',
                      on ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2',
                      blocked && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <input type="checkbox" checked={on} disabled={blocked} onChange={() => toggleTool(t.id)} />
                    {t.name}
                  </label>
                )
              })}
            </div>
          )}
        </fieldset>

        <SegmentedControl
          label="Answer length"
          value={draft.answer_length}
          onChange={(v) => set('answer_length', v)}
          options={[
            { value: 'concise', label: 'Concise', description: 'Short, to the point.' },
            { value: 'balanced', label: 'Balanced', description: 'Enough detail without padding.' },
            { value: 'detailed', label: 'Detailed', description: 'Thorough, with explanation and examples.' },
          ]}
        />
        <SegmentedControl
          label="Tone"
          value={draft.tone}
          onChange={(v) => set('tone', v)}
          options={[
            { value: 'professional', label: 'Professional' },
            { value: 'friendly', label: 'Friendly' },
            { value: 'simple', label: 'Simple', description: 'Plain words, minimal jargon.' },
          ]}
        />
        <SelectField
          label="Answer language"
          value={draft.language}
          onChange={(v) => set('language', v)}
          options={saved.options.languages.map((l) => ({ value: l.code, label: l.name }))}
          hint="Auto replies in the language you write in."
        />
        <TextAreaField
          label="Personal instructions"
          value={draft.personal_instructions}
          onChange={(v) => set('personal_instructions', v)}
          maxLength={saved.options.personal_instructions_max}
          placeholder="e.g. I am a backend engineer; prefer Python examples."
          hint="Added to every request. They shape style only and cannot override safety rules or turn tools on or off."
        />
        <SegmentedControl
          label="Citations"
          value={draft.citations}
          onChange={(v) => set('citations', v)}
          options={[
            { value: 'show', label: 'Show sources' },
            { value: 'hide', label: 'Hide sources' },
          ]}
        />
        <SegmentedControl
          label="Document context"
          value={draft.document_context}
          onChange={(v) => set('document_context', v)}
          options={[
            { value: 'conversation', label: 'Whole conversation', description: 'Documents attached earlier stay in scope for follow-up questions.' },
            { value: 'attached_only', label: 'Attached only', description: 'Only documents attached to the current message are used.' },
          ]}
        />

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void save()} loading={update.isPending} disabled={!dirty || tooLong}>
            Save preferences
          </Button>
          <Button onClick={() => setDraft(pick(saved))} disabled={!dirty || update.isPending}>
            Discard changes
          </Button>
          <Button variant="ghost" onClick={() => setConfirmReset(true)} disabled={saved.version === 0}>
            Restore defaults
          </Button>
        </div>
      </SettingsSection>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Restore default preferences?"
        description="Mode, tools, length, tone, language, instructions, citations and document context go back to their defaults."
        confirmLabel="Restore defaults"
        loading={reset.isPending}
        error={reset.isError ? toApiError(reset.error).message : null}
        onConfirm={() =>
          reset.mutate(undefined, {
            onSuccess: () => {
              setConfirmReset(false)
              toast('Preferences restored to defaults', 'success')
            },
          })
        }
      />
    </>
  )
}
