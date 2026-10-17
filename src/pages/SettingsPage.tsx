import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Alert, Button, TextField } from '@/components/ui/primitives'
import { toast } from '@/components/ui/overlays'
import { toApiError } from '@/lib/errors'
import { passwordSchema } from '@/lib/validation'
import { authService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore, type Theme } from '@/stores/ui.store'
import { cn } from '@/lib/utils'

const profileSchema = z.object({ full_name: z.string().trim().min(2, 'At least 2 characters').max(100) })
const passwordForm = z
  .object({ old_password: z.string().min(1, 'Required'), new_password: passwordSchema, confirm: z.string() })
  .refine((v) => v.new_password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-raised p-5">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function SettingsPage() {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const { theme, setTheme } = useUiStore()
  const [profileError, setProfileError] = useState('')
  const [pwError, setPwError] = useState('')

  const profile = useForm<{ full_name: string }>({
    resolver: zodResolver(profileSchema),
    defaultValues: { full_name: user?.full_name ?? '' },
  })
  const pw = useForm<z.infer<typeof passwordForm>>({
    resolver: zodResolver(passwordForm),
    defaultValues: { old_password: '', new_password: '', confirm: '' },
  })

  const themes: { t: Theme; label: string; icon: React.ReactNode }[] = [
    { t: 'light', label: 'Light', icon: <Sun className="size-4" /> },
    { t: 'dark', label: 'Dark', icon: <Moon className="size-4" /> },
    { t: 'system', label: 'System', icon: <Monitor className="size-4" /> },
  ]

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-xl space-y-5 px-4 py-8">
        <Section title="Appearance">
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
        </Section>

        <Section title="Profile">
          <form
            noValidate
            className="space-y-4"
            onSubmit={profile.handleSubmit(async (v) => {
              setProfileError('')
              try {
                setUser(await authService.updateProfile({ full_name: v.full_name }))
                toast('Profile updated', 'success')
              } catch (e) {
                setProfileError(toApiError(e).message)
              }
            })}
          >
            {profileError && <Alert tone="error">{profileError}</Alert>}
            <TextField label="Email" value={user?.email ?? ''} readOnly disabled hint="Email cannot be changed." />
            <TextField label="Full name" error={profile.formState.errors.full_name?.message} {...profile.register('full_name')} />
            <Button type="submit" variant="primary" loading={profile.formState.isSubmitting}>
              Save changes
            </Button>
          </form>
        </Section>

        <Section title="Change password">
          <form
            noValidate
            className="space-y-4"
            onSubmit={pw.handleSubmit(async (v) => {
              setPwError('')
              try {
                await authService.changePassword({ old_password: v.old_password, new_password: v.new_password })
                pw.reset()
                toast('Password changed', 'success')
              } catch (e) {
                setPwError(toApiError(e).message)
              }
            })}
          >
            {pwError && <Alert tone="error">{pwError}</Alert>}
            <TextField label="Current password" type="password" autoComplete="current-password" error={pw.formState.errors.old_password?.message} {...pw.register('old_password')} />
            <TextField label="New password" type="password" autoComplete="new-password" error={pw.formState.errors.new_password?.message} {...pw.register('new_password')} />
            <TextField label="Confirm new password" type="password" autoComplete="new-password" error={pw.formState.errors.confirm?.message} {...pw.register('confirm')} />
            <Button type="submit" variant="primary" loading={pw.formState.isSubmitting}>
              Update password
            </Button>
          </form>
        </Section>
      </div>
    </div>
  )
}
