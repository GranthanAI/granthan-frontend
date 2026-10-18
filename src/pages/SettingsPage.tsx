import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { NavLink, Outlet } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/query-keys'
import { Brain, FileText, KeyRound, Monitor, Moon, Palette, Sparkles, Sun, Type, UserRound } from 'lucide-react'
import { Alert, Button, TextField } from '@/components/ui/primitives'
import { toast } from '@/components/ui/overlays'
import { toApiError } from '@/lib/errors'
import { passwordSchema } from '@/lib/validation'
import { authService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/auth.store'
import { TextStyleSettings } from '@/components/settings/TextStyleSettings'
import { useUiStore, type Theme } from '@/stores/ui.store'
import { cn } from '@/lib/utils'
import { SessionsSettings } from '@/components/settings/SessionsSettings'
import { AiPreferencesSettings } from '@/components/settings/AiPreferencesSettings'
import { MemorySettingsPage } from '@/components/settings/MemorySettingsPage'
import { DocumentsSettings } from '@/components/settings/DocumentsSettings'
import { Toggle } from '@/components/settings/controls'

export { AiPreferencesSettings, MemorySettingsPage, DocumentsSettings }

const profileSchema = z.object({
  full_name: z.string().trim().min(2, 'At least 2 characters').max(100),
  avatar_url: z.string().trim().refine((v) => v === '' || /^https:\/\/[^\s/]+\S*$/.test(v), 'Must be an https:// link'),
})
const passwordForm = z
  .object({ old_password: z.string().min(1, 'Required'), new_password: passwordSchema, confirm: z.string() })
  .refine((v) => v.new_password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })

/** One entry per settings domain; each has its own page under /settings. */
export const SETTINGS_PAGES = [
  { path: 'profile', label: 'Profile', icon: UserRound },
  { path: 'ai', label: 'AI preferences', icon: Sparkles },
  { path: 'memory', label: 'Memory', icon: Brain },
  { path: 'documents', label: 'Documents', icon: FileText },
  { path: 'security', label: 'Security', icon: KeyRound },
  { path: 'appearance', label: 'Appearance', icon: Palette },
  { path: 'text-style', label: 'Text style', icon: Type },
] as const

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-raised p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** Settings shell: a side menu (tabs on small screens) and the selected domain's page. */
export function SettingsLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav aria-label="Settings" className="shrink-0 border-b border-line md:w-52 md:border-b-0 md:border-r">
        <ul className="flex gap-1 overflow-x-auto p-2 md:flex-col md:p-3">
          {SETTINGS_PAGES.map(({ path, label, icon: Icon }) => (
            <li key={path} className="shrink-0">
              <NavLink
                to={`/settings/${path}`}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                    isActive ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                  )
                }
              >
                <Icon className="size-4" aria-hidden /> {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl space-y-5 px-4 py-8">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

export function ProfileSettings() {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const [error, setError] = useState('')
  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: { full_name: user?.full_name ?? '', avatar_url: user?.avatar_url ?? '' },
  })

  return (
    <Section title="Profile" description="How you appear in GranthanAI.">
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit(async (v) => {
          setError('')
          try {
            setUser(await authService.updateProfile({ full_name: v.full_name, avatar_url: v.avatar_url }))
            toast('Profile updated', 'success')
          } catch (e) {
            setError(toApiError(e).message)
          }
        })}
      >
        {error && <Alert tone="error">{error}</Alert>}
        <TextField label="Email" value={user?.email ?? ''} readOnly disabled hint="Email cannot be changed." />
        <TextField label="Full name" error={form.formState.errors.full_name?.message} {...form.register('full_name')} />
        <TextField label="Avatar link" placeholder="https://…" hint="Link to an image (https only). Leave empty to remove." error={form.formState.errors.avatar_url?.message} {...form.register('avatar_url')} />
        <p className="text-xs text-ink-3">
          Account: {user?.status?.toLowerCase() ?? 'unknown'} · email {user?.is_email_verified ? 'verified' : 'not verified'}
          {user?.created_at ? ` · member since ${new Date(user.created_at).toLocaleDateString()}` : ''}
        </p>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          Save changes
        </Button>
      </form>
    </Section>
  )
}

export function SecuritySettings() {
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const form = useForm<z.infer<typeof passwordForm>>({
    resolver: zodResolver(passwordForm),
    defaultValues: { old_password: '', new_password: '', confirm: '' },
  })

  return (
    <>
    <Section title="Change password" description="Changing your password signs out your other devices.">
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit(async (v) => {
          setError('')
          try {
            const r = (await authService.changePassword({ old_password: v.old_password, new_password: v.new_password })) as { other_sessions_signed_out?: number }
            form.reset()
            void qc.invalidateQueries({ queryKey: qk.sessions })
            toast(
              r.other_sessions_signed_out
                ? `Password changed. ${r.other_sessions_signed_out} other device(s) will be signed out.`
                : 'Password changed',
              'success',
            )
          } catch (e) {
            setError(toApiError(e).message)
          }
        })}
      >
        {error && <Alert tone="error">{error}</Alert>}
        <TextField label="Current password" type="password" autoComplete="current-password" error={form.formState.errors.old_password?.message} {...form.register('old_password')} />
        <TextField label="New password" type="password" autoComplete="new-password" error={form.formState.errors.new_password?.message} {...form.register('new_password')} />
        <TextField label="Confirm new password" type="password" autoComplete="new-password" error={form.formState.errors.confirm?.message} {...form.register('confirm')} />
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          Update password
        </Button>
      </form>
    </Section>
    <SessionsSettings />
    </>
  )
}

export function AppearanceSettings() {
  const { theme, setTheme, sidebarCollapsed, toggleSidebar } = useUiStore()
  const themes: { t: Theme; label: string; icon: ReactNode }[] = [
    { t: 'light', label: 'Light', icon: <Sun className="size-4" /> },
    { t: 'dark', label: 'Dark', icon: <Moon className="size-4" /> },
    { t: 'system', label: 'System', icon: <Monitor className="size-4" /> },
  ]

  return (
    <Section title="Appearance" description="Choose how GranthanAI looks. Saved in this browser.">
      <div role="radiogroup" aria-label="Theme" className="flex gap-2">
        {themes.map((t) => (
          <button
            key={t.t}
            role="radio"
            aria-checked={theme === t.t}
            onClick={() => setTheme(t.t)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm',
              theme === t.t ? 'border-accent bg-accent-soft font-medium' : 'border-line hover:bg-surface-2',
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <div className="mt-5">
        <Toggle
          label="Collapse the sidebar"
          description="Start with the conversation list collapsed on this browser."
          checked={sidebarCollapsed}
          onChange={() => toggleSidebar()}
        />
      </div>
    </Section>
  )
}

export function TextStyleSettingsPage() {
  return (
    <Section title="Text style" description="Font family, weight and style for what you type and what the AI replies.">
      <TextStyleSettings />
    </Section>
  )
}
