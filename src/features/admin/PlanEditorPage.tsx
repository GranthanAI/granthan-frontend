import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { groupLabel } from '@/content/plans'
import { Alert, Button, Skeleton, TextField } from '@/components/ui/primitives'
import { saveBlob } from '@/lib/download'
import { ApiError, errorMessage, toApiError } from '@/lib/errors'
import { formatIstDate, formatLimit, formatPaise } from '@/lib/format'
import { adminService } from '@/services/admin.service'
import { ReasonDialog } from './ReasonDialog'
import { useCanWrite } from './useCanWrite'
import {
  GROUPS, LIMIT_KEYS, LIMIT_LABELS, UNLIMITED, clone, errorsFor, fromPaise, nextVersion, setLimit, toPaise,
  type Catalog, type CatalogPayg, type CatalogPlan,
} from './planEditorModel'

interface CatalogResponse {
  catalog: Catalog
  catalog_version: string
  source: string
  published_at: string | null
  plan_versions: Array<{ plan_code: string; variant: string | null; version: number; price_month_paise: number | null; price_year_paise: number | null; created_at: string; retired_at: string | null; active_subscribers: number }>
}
interface PlanDiff {
  plan_code: string; variant: string | null; change: string
  prices: Array<{ interval: string; from: number | null; to: number | null }>
  limits: Array<{ name: string; from: number; to: number; direction: 'up' | 'down' }>
  groups: { added: string[]; removed: string[] }
  extra_models: { added: string[]; removed: string[] }
  other?: Array<{ name: string; from: unknown; to: unknown }>
}
interface Preview {
  draft_id: string
  diff: { plans: PlanDiff[]; payg: { unit_prices: Array<{ key: string; from: number | null; to: number | null }>; topup_packs: { added: Array<{ code: string; price: number }>; removed: Array<{ code: string }>; changed: Array<{ code: string; from: number; to: number }> }; other: Array<{ name: string; from: unknown; to: unknown }> }; models: { added: string[]; removed: string[]; moved: Array<{ id: string; from: string; to: string }>; relabelled: string[] } }
  impact: { plans: Array<{ plan_code: string; variant: string | null; current_version: number | null; active_subscribers: number }>; total_subscribers: number }
  warnings: string[]
}
interface Published { catalog_version: string; sync: string[]; limits_raised_applied: Array<{ plan_code: string; subscriptions_moved: number }>; apply_limits: Array<{ audit_id: number; plan_code: string | null; limits_lowered: string[] }> }

const TABS = ['Plans', 'Pay as you Go', 'Models', 'History'] as const
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function PlanEditorPage() {
  const canWrite = useCanWrite()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'catalog'], queryFn: ({ signal }) => adminService.get<CatalogResponse>('/catalog', undefined, signal), retry: false, staleTime: 0 })
  const prices = useQuery({ queryKey: ['admin', 'prices'], queryFn: ({ signal }) => adminService.get<{ prices: Array<{ model: string; provider: string }> }>('/model-prices', undefined, signal), retry: false })
  const [tab, setTab] = useState<(typeof TABS)[number]>('Plans')
  const [draft, setDraft] = useState<Catalog | null>(null)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState<Published | null>(null)
  const [applying, setApplying] = useState<Published['apply_limits'][number] | null>(null)
  const [applied, setApplied] = useState<string[]>([])
  const [conflict, setConflict] = useState(false)

  useEffect(() => {
    if (q.data && !draft) setDraft({ ...clone(q.data.catalog), catalog_version: nextVersion(q.data.catalog_version) })
  }, [q.data, draft])

  const reload = async () => {
    setDraft(null); setPreview(null); setPublished(null); setErrors([]); setConflict(false); setApplied([])
    await qc.invalidateQueries({ queryKey: ['admin', 'catalog'] })
  }

  if (q.isPending || !draft) return <Skeleton className="h-64 w-full" />
  if (q.isError) return <Alert tone="error">{errorMessage(q.error)}</Alert>
  const base = q.data
  const edit = (fn: (c: Catalog) => void) => { const c = clone(draft); fn(c); setDraft(c); setPreview(null) }
  const individual = draft.plans.filter((p) => p.code !== 'payg' && !p.variants)
  const payg = draft.plans.find((p) => p.code === 'payg') as CatalogPayg | undefined

  const saveDraft = async () => {
    setSaving(true); setErrors([]); setConflict(false)
    try {
      setPreview(await adminService.post<Preview>('/catalog/drafts', { catalog: draft, note }))
    } catch (e) {
      const err = toApiError(e)
      setPreview(null)
      setErrors(err.problemErrors?.length ? err.problemErrors : [err.message])
    } finally { setSaving(false) }
  }

  const exportYaml = async () => {
    const text = await adminService.exportYaml()
    saveBlob(new Blob([typeof text === 'string' ? text : JSON.stringify(text)], { type: 'application/yaml' }), 'plans.yaml')
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Plan editor</h1>
          <p className="text-xs text-ink-3" data-testid="catalog-source">Active catalog {base.catalog_version} · from {base.source}{base.published_at ? `, published ${formatIstDate(base.published_at)}` : ''}</p>
        </div>
        <Button size="sm" onClick={() => void exportYaml()}><Download className="size-3.5" aria-hidden /> Download plans.yaml</Button>
      </div>
      {!canWrite && <Alert tone="info">You can read the catalog but not change it (read-only role).</Alert>}

      <div role="tablist" aria-label="Catalog sections" className="flex gap-1 border-b border-line">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm ${tab === t ? 'border-b-2 border-accent font-medium' : 'text-ink-2'}`}>{t}</button>)}
      </div>

      {errors.length > 0 && (
        <Alert tone="error"><p className="font-medium">The draft was not saved:</p><ul className="list-disc pl-5" aria-label="Draft errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert>
      )}

      {tab === 'Plans' && individual.map((p) => (
        <PlanCard key={p.code} plan={p} canWrite={canWrite} errors={errors} onChange={(fn) => edit((c) => fn(c.plans.find((x) => x.code === p.code)!))} />
      ))}
      {tab === 'Plans' && draft.plans.some((p) => p.variants) && <p className="text-xs text-ink-3">Organisation plans (with college / company variants) are changed in plans.yaml.</p>}

      {tab === 'Pay as you Go' && payg && <PaygCard payg={payg} canWrite={canWrite} errors={errors} onChange={(fn) => edit((c) => fn(c.plans.find((x) => x.code === 'payg') as CatalogPayg))} />}

      {tab === 'Models' && <ModelsTab draft={draft} canWrite={canWrite} errors={errors} priced={[...new Set((prices.data?.prices ?? []).map((p) => p.model))]} providers={Object.fromEntries((prices.data?.prices ?? []).map((p) => [p.model, p.provider]))} edit={edit} />}

      {tab === 'History' && (
        <table className="w-full text-left text-sm" aria-label="Plan versions">
          <thead><tr className="border-b border-line text-ink-3"><th className="py-2">Plan</th><th>Version</th><th>Month</th><th>Year</th><th>Subscribers</th><th>Created</th><th>Status</th></tr></thead>
          <tbody>
            {base.plan_versions.map((v) => (
              <tr key={`${v.plan_code}${v.variant}${v.version}`} className="border-b border-line/60">
                <td className="py-1.5">{v.plan_code}{v.variant ? `/${v.variant}` : ''}</td><td>v{v.version}</td>
                <td>{v.price_month_paise != null ? formatPaise(v.price_month_paise) : '—'}</td><td>{v.price_year_paise != null ? formatPaise(v.price_year_paise) : '—'}</td>
                <td>{v.active_subscribers}</td><td>{formatIstDate(v.created_at)}</td><td>{v.retired_at ? `retired ${formatIstDate(v.retired_at)}` : 'current'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canWrite && tab !== 'History' && (
        <section className="space-y-3 rounded-2xl border border-line bg-raised p-4" aria-label="Save a draft">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Catalog version (must change)" value={draft.catalog_version} onChange={(e) => edit((c) => { c.catalog_version = e.target.value })} />
            <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button variant="primary" onClick={() => void saveDraft()} loading={saving}>Save draft</Button>
        </section>
      )}

      {conflict && (
        <Alert tone="warn" action={<Button size="sm" onClick={() => void reload()}>Reload</Button>}>Someone published a newer catalog; reload and reapply your changes.</Alert>
      )}

      {preview && <PreviewPanel preview={preview} />}
      {preview && canWrite && !published && <div><Button variant="primary" onClick={() => setPublishing(true)}>Publish…</Button></div>}

      {published && (
        <section className="space-y-2 rounded-2xl border border-line bg-raised p-4" aria-label="Published" data-testid="published">
          <h2 className="font-semibold">Published {published.catalog_version}</h2>
          {published.limits_raised_applied.map((a) => <p key={a.plan_code} className="text-sm text-ok">{cap(a.plan_code)}: higher limits applied to {a.subscriptions_moved} subscriber(s) at once.</p>)}
          {published.apply_limits.length > 0 && (
            <div className="space-y-2" data-testid="apply-limits">
              <Alert tone="warn">Some limits went down. Existing subscribers keep the old limits until you apply the change.</Alert>
              {published.apply_limits.map((a) => (
                <div key={a.audit_id} className="flex items-center justify-between text-sm">
                  <span>{a.plan_code ?? 'plan'}: lowered {a.limits_lowered.map((n) => LIMIT_LABELS[n as keyof typeof LIMIT_LABELS] ?? n).join(', ')}</span>
                  {applied.includes(String(a.audit_id)) ? <span className="text-ok">Applied</span> : <Button size="sm" variant="primary" onClick={() => setApplying(a)}>Apply limits to existing subscribers</Button>}
                </div>
              ))}
            </div>
          )}
          <Button onClick={() => void reload()}>Start a new draft</Button>
        </section>
      )}

      {publishing && preview && (
        <ReasonDialog title="Publish this catalog?" description={`This replaces the active catalog (${base.catalog_version}) for everyone. New prices create new plan versions; existing subscribers keep their price.`} confirmLabel="Publish" typed="PUBLISH" onClose={() => setPublishing(false)}
          onConfirm={async (reason) => {
            try {
              setPublished(await adminService.post<Published>(`/catalog/drafts/${preview.draft_id}/publish`, { reason }))
              setPreview(null)
            } catch (e) {
              if (e instanceof ApiError && e.status === 409) { setConflict(true); return }
              throw e
            }
          }} />
      )}
      {applying && (
        <ReasonDialog title={`Apply the lower limits to ${applying.plan_code ?? 'the plan'}'s subscribers?`} description="They move to the new limits immediately." confirmLabel="Apply limits" onClose={() => setApplying(null)}
          onConfirm={async (reason) => { await adminService.post(`/catalog/apply-limits/${applying.audit_id}`, { reason }); setApplied((a) => [...a, String(applying.audit_id)]) }} />
      )}
    </>
  )
}

// --- one plan ---------------------------------------------------------------------------------------------------------

/** A rupees field that keeps what is being typed ("0." on the way to "0.60") and reports paise (NaN while it is not an amount). */
function MoneyField({ label, paise, disabled, hint, onPaise, className }: { label: string; paise: number | undefined; disabled?: boolean; hint?: string; onPaise: (paise: number) => void; className?: string }) {
  const [text, setText] = useState(Number.isNaN(paise) ? '' : fromPaise(paise))
  return (
    <TextField label={label} inputMode="decimal" disabled={disabled} value={text} hint={hint} className={className}
      onChange={(e) => { setText(e.target.value); onPaise(toPaise(e.target.value) ?? (Number.NaN as number)) }} />
  )
}

function Field({ errs }: { errs: string[] }) {
  return <>{errs.map((e) => <p key={e} role="alert" className="mt-1 text-xs text-danger">{e}</p>)}</>
}

function LimitsEditor({ plan, onChange, canWrite, errors }: { plan: CatalogPlan; onChange: (fn: (p: CatalogPlan) => void) => void; canWrite: boolean; errors: string[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-label={`${plan.code} limits`}>
      {LIMIT_KEYS.map((k) => {
        const v = plan.limits?.[k] ?? 0
        const unlimited = v === UNLIMITED
        return (
          <div key={k}>
            <div className="flex items-end gap-2">
              <TextField label={LIMIT_LABELS[k]} inputMode="numeric" value={unlimited || Number.isNaN(v) ? '' : String(v)} placeholder={unlimited ? 'Unlimited' : ''} disabled={!canWrite || unlimited} className="flex-1"
                onChange={(e) => { const n = e.target.value.trim(); onChange((p) => setLimit(p, k, /^\d+$/.test(n) ? Number(n) : (Number.NaN as number))) }} />
              <label className="mb-2 flex items-center gap-1 text-xs"><input type="checkbox" checked={unlimited} disabled={!canWrite} aria-label={`${LIMIT_LABELS[k]}: Unlimited`} onChange={(e) => onChange((p) => setLimit(p, k, e.target.checked ? UNLIMITED : 0))} />Unlimited</label>
            </div>
            <Field errs={errorsFor(errors, plan.code, k)} />
          </div>
        )
      })}
    </div>
  )
}

function PlanCard({ plan, canWrite, errors, onChange }: { plan: CatalogPlan; canWrite: boolean; errors: string[]; onChange: (fn: (p: CatalogPlan) => void) => void }) {
  const paid = plan.code !== 'free'
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-raised p-5" aria-label={`Plan ${plan.code}`}>
      <h2 className="text-lg font-semibold">{cap(plan.code)}</h2>
      <Field errs={errorsFor(errors, plan.code).filter((e) => !LIMIT_KEYS.some((k) => e.includes(`'${k}'`)) && !e.includes('prices'))} />
      {paid && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(['month', 'year'] as const).map((i) => (
            <div key={i}>
              <MoneyField label={`Price per ${i} (₹, GST included)`} disabled={!canWrite} paise={plan.prices?.[i]} onPaise={(n) => onChange((p) => { p.prices = { ...(p.prices ?? {}), [i]: n } })}
                hint={plan.prices?.[i] != null && !Number.isNaN(plan.prices[i]) ? `Stored as ${plan.prices[i]} paise` : undefined} />
              <Field errs={errorsFor(errors, plan.code, `prices.${i}`)} />
            </div>
          ))}
        </div>
      )}
      <LimitsEditor plan={plan} onChange={onChange} canWrite={canWrite} errors={errors} />
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Model groups</legend>
        <div className="flex flex-wrap gap-3">
          {GROUPS.map((g) => (
            <label key={g} className="flex items-center gap-1.5 text-sm"><input type="checkbox" disabled={!canWrite} checked={plan.models.groups.includes(g)} aria-label={`${cap(plan.code)} includes ${g}`}
              onChange={(e) => onChange((p) => { p.models.groups = e.target.checked ? [...p.models.groups, g] : p.models.groups.filter((x) => x !== g) })} />{groupLabel(g)}</label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Extra models (ids, comma separated)" disabled={!canWrite} value={(plan.models.extra ?? []).join(', ')}
          onChange={(e) => onChange((p) => { const ids = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); p.models.extra = ids })} />
        <label className="text-sm"><span className="mb-1.5 block font-medium">Default group</span>
          <select disabled={!canWrite} value={plan.default_group} onChange={(e) => onChange((p) => { p.default_group = e.target.value })} className="h-10 w-full rounded-lg border border-line bg-raised px-3 text-sm">
            {plan.models.groups.filter((g) => g !== 'best' && g !== 'ultra').map((g) => <option key={g} value={g}>{groupLabel(g)}</option>)}
          </select>
        </label>
      </div>
    </section>
  )
}

const UNIT_KEYS = ['fast', 'smart', 'best', 'ultra', 'youtube_video', 'manim_video'] as const
function PaygCard({ payg, canWrite, errors, onChange }: { payg: CatalogPayg; canWrite: boolean; errors: string[]; onChange: (fn: (p: CatalogPayg) => void) => void }) {
  const money = (label: string, value: number, set: (p: CatalogPayg, paise: number) => void, field: string) => (
    <div key={field}>
      <MoneyField label={`${label} (₹)`} disabled={!canWrite} paise={value} onPaise={(n) => onChange((p) => set(p, n))} />
      <Field errs={errorsFor(errors, 'payg', field)} />
    </div>
  )
  const whole = (label: string, value: number, set: (p: CatalogPayg, n: number) => void, field: string) => (
    <div key={field}>
      <TextField label={label} inputMode="numeric" disabled={!canWrite} value={Number.isNaN(value) ? '' : String(value)} onChange={(e) => onChange((p) => set(p, /^\d+$/.test(e.target.value.trim()) ? Number(e.target.value.trim()) : (Number.NaN as number)))} />
      <Field errs={errorsFor(errors, 'payg', field)} />
    </div>
  )
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-raised p-5" aria-label="Pay as you Go">
      <h2 className="text-lg font-semibold">Pay as you Go</h2>
      <Field errs={errorsFor(errors, 'payg').filter((e) => !e.includes('unit_prices') && !LIMIT_KEYS.some((k) => e.includes(`'${k}'`)))} />
      <h3 className="text-sm font-semibold">Price per message / unit</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        {UNIT_KEYS.map((k) => money(cap(k.replace('_', ' ')), payg.unit_prices[k] ?? 0, (p, n) => { p.unit_prices = { ...p.unit_prices, [k]: n } }, `unit_prices.${k}`))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {money('Storage above 10 GB, per GB per month', payg.storage_over_10gb_per_gb_month, (p, n) => { p.storage_over_10gb_per_gb_month = n }, 'storage_over_10gb_per_gb_month')}
        {whole('Long-message tokens', payg.long_message_tokens, (p, n) => { p.long_message_tokens = n }, 'long_message_tokens')}
        {whole('Fast messages a day with no credit', payg.no_credit_fast_per_day, (p, n) => { p.no_credit_fast_per_day = n }, 'no_credit_fast_per_day')}
        {whole('Messages per minute', payg.max_messages_per_minute, (p, n) => { p.max_messages_per_minute = n }, 'max_messages_per_minute')}
        {whole('Credit validity (months)', payg.credit_validity_months, (p, n) => { p.credit_validity_months = n }, 'credit_validity_months')}
        {money('Organisation minimum top-up', payg.org_min_topup, (p, n) => { p.org_min_topup = n }, 'org_min_topup')}
      </div>
      <h3 className="text-sm font-semibold">Top-up packs</h3>
      <ul className="space-y-2" aria-label="Top-up packs">
        {payg.topup_packs.map((pk, i) => (
          <li key={i} className="flex items-end gap-2">
            <TextField label="Code" disabled={!canWrite} value={pk.code} onChange={(e) => onChange((p) => { p.topup_packs[i]!.code = e.target.value })} className="w-40" />
            <MoneyField label="Price (₹)" disabled={!canWrite} paise={pk.price} onPaise={(n) => onChange((p) => { p.topup_packs[i]!.price = n })} className="w-40" />
            {canWrite && <Button size="sm" onClick={() => onChange((p) => { p.topup_packs.splice(i, 1) })}>Remove</Button>}
          </li>
        ))}
      </ul>
      {canWrite && <Button size="sm" onClick={() => onChange((p) => { p.topup_packs.push({ code: '', price: 0 }) })}>Add a pack</Button>}
      <Field errs={errorsFor(errors, 'payg', 'topup')} />
      <h3 className="text-sm font-semibold">Limits</h3>
      <LimitsEditor plan={payg} onChange={(fn) => onChange(fn as (p: CatalogPayg) => void)} canWrite={canWrite} errors={errors} />
    </section>
  )
}

// --- models -------------------------------------------------------------------------------------------------------------

function ModelsTab({ draft, canWrite, errors, priced, providers, edit }: { draft: Catalog; canWrite: boolean; errors: string[]; priced: string[]; providers: Record<string, string>; edit: (fn: (c: Catalog) => void) => void }) {
  const listed = new Set(Object.values(draft.model_groups).flat().map((m) => m.id))
  const available = priced.filter((m) => !listed.has(m))
  return (
    <div className="space-y-4" aria-label="Models">
      <Field errs={errorsFor(errors, 'model_groups')} />
      {GROUPS.map((g) => (
        <section key={g} className="rounded-2xl border border-line bg-raised p-4" aria-label={`${cap(g)} models`}>
          <h2 className="mb-2 font-semibold">{groupLabel(g)}</h2>
          <ul className="space-y-2">
            {(draft.model_groups[g] ?? []).map((m, i, all) => (
              <li key={m.id} className="flex items-end gap-2">
                <span className="w-56 truncate text-sm text-ink-2" title={m.id}>{m.id}</span>
                <TextField label="Label" disabled={!canWrite} value={m.label} onChange={(e) => edit((c) => { c.model_groups[g]![i]!.label = e.target.value })} className="flex-1" />
                {canWrite && (
                  <>
                    <Button size="sm" aria-label={`Move ${m.id} up`} disabled={i === 0} onClick={() => edit((c) => { const a = c.model_groups[g]!; [a[i - 1], a[i]] = [a[i]!, a[i - 1]!] })}>↑</Button>
                    <Button size="sm" aria-label={`Move ${m.id} down`} disabled={i === all.length - 1} onClick={() => edit((c) => { const a = c.model_groups[g]!; [a[i + 1], a[i]] = [a[i]!, a[i + 1]!] })}>↓</Button>
                    <Button size="sm" aria-label={`Remove ${m.id}`} onClick={() => edit((c) => { c.model_groups[g]!.splice(i, 1) })}>Remove</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {canWrite && (
            <label className="mt-3 block text-sm">
              <span className="sr-only">Add a model to {g}</span>
              <select aria-label={`Add a model to ${g}`} value="" onChange={(e) => { const id = e.target.value; if (id) edit((c) => { (c.model_groups[g] ??= []).push({ id, label: id, provider: providers[id] ?? '' }) }) }} className="h-9 rounded-lg border border-line bg-raised px-2 text-sm">
                <option value="">Add a model from the price book…</option>
                {available.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </label>
          )}
        </section>
      ))}
    </div>
  )
}

// --- the server's preview ----------------------------------------------------------------------------------------------------

const val = (n: number) => (n === UNLIMITED ? 'Unlimited' : formatLimit(n))

function PreviewPanel({ preview }: { preview: Preview }) {
  const { diff, impact, warnings } = preview
  const nothing = diff.plans.length === 0 && !diff.payg.unit_prices.length && !diff.payg.other.length && !Object.values(diff.payg.topup_packs).some((x) => x.length) && !diff.models.added.length && !diff.models.removed.length && !diff.models.moved.length && !diff.models.relabelled.length
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-raised p-5" aria-label="Preview" data-testid="preview">
      <h2 className="font-semibold">What this draft changes</h2>
      {nothing && <p className="text-sm text-ink-3">No differences from the active catalog.</p>}
      {diff.plans.map((p) => (
        <div key={`${p.plan_code}${p.variant}`} className="text-sm" data-testid={`diff-${p.plan_code}`}>
          <p className="font-medium">{cap(p.plan_code)}{p.variant ? `/${p.variant}` : ''} {p.change === 'added' && '(new)'}</p>
          <ul className="ml-4 list-disc">
            {p.prices.map((x) => <li key={x.interval}>{x.interval} price: {x.from != null ? formatPaise(x.from) : '—'} → {x.to != null ? formatPaise(x.to) : '—'}</li>)}
            {p.limits.map((l) => (
              <li key={l.name} data-direction={l.direction} className={l.direction === 'up' ? 'text-ok' : 'text-warn'}>{LIMIT_LABELS[l.name as keyof typeof LIMIT_LABELS] ?? l.name}: {val(l.from)} → {val(l.to)} ({l.direction === 'up' ? 'higher' : 'lower'})</li>
            ))}
            {p.groups.added.map((g) => <li key={`+${g}`}>model group added: {groupLabel(g)}</li>)}
            {p.groups.removed.map((g) => <li key={`-${g}`}>model group removed: {groupLabel(g)}</li>)}
            {p.extra_models.added.map((m) => <li key={`+${m}`}>extra model added: {m}</li>)}
            {p.extra_models.removed.map((m) => <li key={`-${m}`}>extra model removed: {m}</li>)}
            {(p.other ?? []).map((o) => <li key={o.name}>{o.name}: {String(o.from)} → {String(o.to)}</li>)}
          </ul>
        </div>
      ))}
      {(diff.payg.unit_prices.length > 0 || diff.payg.other.length > 0 || Object.values(diff.payg.topup_packs).some((x) => x.length)) && (
        <div className="text-sm" data-testid="diff-payg"><p className="font-medium">Pay as you Go</p>
          <ul className="ml-4 list-disc">
            {diff.payg.unit_prices.map((u) => <li key={u.key}>{u.key} price: {u.from != null ? formatPaise(u.from) : '—'} → {u.to != null ? formatPaise(u.to) : '—'}</li>)}
            {diff.payg.topup_packs.added.map((k) => <li key={`+${k.code}`}>pack added: {k.code} ({formatPaise(k.price)})</li>)}
            {diff.payg.topup_packs.removed.map((k) => <li key={`-${k.code}`}>pack removed: {k.code}</li>)}
            {diff.payg.topup_packs.changed.map((k) => <li key={`~${k.code}`}>pack {k.code}: {formatPaise(k.from)} → {formatPaise(k.to)}</li>)}
            {diff.payg.other.map((o) => <li key={o.name}>{o.name}: {String(o.from)} → {String(o.to)}</li>)}
          </ul>
        </div>
      )}
      {(diff.models.added.length + diff.models.removed.length + diff.models.moved.length + diff.models.relabelled.length) > 0 && (
        <p className="text-sm">Models: {[...diff.models.added.map((m) => `+${m}`), ...diff.models.removed.map((m) => `-${m}`), ...diff.models.moved.map((m) => `${m.id} ${m.from}→${m.to}`), ...diff.models.relabelled.map((m) => `${m} relabelled`)].join(', ')}</p>
      )}
      <div data-testid="impact">
        <p className="text-sm font-medium">Impact: {impact.total_subscribers} active subscriber{impact.total_subscribers === 1 ? '' : 's'} on the plans that change</p>
        <ul className="ml-4 list-disc text-sm">{impact.plans.map((p) => <li key={`${p.plan_code}${p.variant}`}>{p.plan_code}{p.variant ? `/${p.variant}` : ''} v{p.current_version}: {p.active_subscribers}</li>)}</ul>
      </div>
      {warnings.length > 0 && <Alert tone="warn"><ul className="list-disc pl-4" aria-label="Warnings">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert>}
    </section>
  )
}
