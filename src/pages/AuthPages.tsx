import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm, type FieldValues, type Path, type UseFormSetError } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Logo, TextField } from '@/components/ui/primitives'
import { toApiError } from '@/lib/errors'
import {
  forgotSchema,
  loginSchema,
  otpSchema,
  resetSchema,
  signupSchema,
  type LoginValues,
  type SignupValues,
} from '@/lib/validation'
import { authService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/auth.store'

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo className="text-lg" />
        </div>
        <div className="rounded-2xl border border-line bg-raised p-6 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && <p className="mt-4 text-center text-sm text-ink-2">{footer}</p>}
      </div>
    </div>
  )
}

/** Maps backend field errors onto form fields; returns the general message otherwise. */
function applyServerError<T extends FieldValues>(e: unknown, setError: UseFormSetError<T>, fieldMap: Record<string, Path<T>> = {}): string {
  const err = toApiError(e)
  let mapped = false
  for (const [k, msg] of Object.entries(err.fields)) {
    const name = fieldMap[k] ?? (k as Path<T>)
    setError(name, { message: msg })
    mapped = true
  }
  return mapped ? '' : err.message
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const expired = useAuthStore((s) => s.expired)
  const [formError, setFormError] = useState('')
  const [needsVerify, setNeedsVerify] = useState(false)
  const from = (location.state as { from?: string } | null)?.from
  const flash = (location.state as { notice?: string } | null)?.notice
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError('')
    setNeedsVerify(false)
    try {
      qc.clear()
      await authService.login(v)
      navigate(from && from.startsWith('/') ? from : '/', { replace: true })
    } catch (e) {
      const err = toApiError(e)
      setNeedsVerify(/not verified/i.test(err.message))
      setFormError(
        err.kind === 'rate_limit'
          ? 'Too many sign-in attempts. Please wait a minute and try again.'
          : err.kind === 'auth'
            ? 'Incorrect email or password.'
            : err.message,
      )
    }
  })

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to continue to GranthanAI."
      footer={<>New here? <Link to="/signup" className="font-medium text-accent hover:underline">Create an account</Link></>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {expired && !formError && <Alert tone="warn">Your session expired. Please sign in again.</Alert>}
        {flash && <Alert tone="success">{flash}</Alert>}
        {formError && (
          <Alert tone="error">
            {formError}
            {needsVerify && (
              <>
                {' '}
                <Link className="font-medium underline" to={`/verify-email?email=${encodeURIComponent(form.getValues('email'))}`}>
                  Verify your email
                </Link>
              </>
            )}
          </Alert>
        )}
        <TextField label="Email" type="email" autoComplete="email" inputMode="email" error={form.formState.errors.email?.message} {...form.register('email')} />
        <TextField label="Password" type="password" autoComplete="current-password" error={form.formState.errors.password?.message} {...form.register('password')} />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-accent hover:underline">Forgot password?</Link>
        </div>
        <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  )
}

export function SignupPage() {
  const navigate = useNavigate()
  const [formError, setFormError] = useState('')
  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { full_name: '', email: '', password: '', confirm: '' },
  })
  const pw = form.watch('password') ?? ''

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError('')
    try {
      await authService.register({ email: v.email, password: v.password, full_name: v.full_name })
      navigate(`/verify-email?email=${encodeURIComponent(v.email)}`, { replace: true })
    } catch (e) {
      const err = toApiError(e)
      const general = applyServerError(e, form.setError)
      setFormError(
        err.status === 409 || /already/i.test(err.message) ? 'An account with this email already exists. Try signing in.' : general,
      )
    }
  })

  const rules = [
    ['12+ characters', pw.length >= 12],
    ['Uppercase letter', /[A-Z]/.test(pw)],
    ['Lowercase letter', /[a-z]/.test(pw)],
    ['A digit', /\d/.test(pw)],
    ['A special character', /[!@#$%^&*(),.?":{}|<>]/.test(pw)],
  ] as const

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start exploring conversations that remember where they came from."
      footer={<>Already have an account? <Link to="/login" className="font-medium text-accent hover:underline">Sign in</Link></>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextField label="Full name" autoComplete="name" error={form.formState.errors.full_name?.message} {...form.register('full_name')} />
        <TextField label="Email" type="email" autoComplete="email" inputMode="email" error={form.formState.errors.email?.message} {...form.register('email')} />
        <TextField label="Password" type="password" autoComplete="new-password" error={form.formState.errors.password?.message} {...form.register('password')} />
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs" aria-label="Password requirements">
          {rules.map(([label, ok]) => (
            <li key={label} className={ok ? 'text-ok' : 'text-ink-3'}>
              {ok ? '✓' : '○'} {label}
            </li>
          ))}
        </ul>
        <TextField label="Confirm password" type="password" autoComplete="new-password" error={form.formState.errors.confirm?.message} {...form.register('confirm')} />
        <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const email = params.get('email') ?? ''
  const navigate = useNavigate()
  const [formError, setFormError] = useState('')
  const [info, setInfo] = useState('')
  const [resending, setResending] = useState(false)
  const form = useForm<{ code: string }>({ resolver: zodResolver(otpSchema), defaultValues: { code: '' } })

  const onSubmit = form.handleSubmit(async ({ code }) => {
    setFormError('')
    try {
      await authService.verifyEmail({ email, code })
      navigate('/login', { replace: true, state: { notice: 'Email verified. You can sign in now.' } })
    } catch (e) {
      setFormError(toApiError(e).message)
    }
  })
  const resend = async () => {
    setResending(true)
    setFormError('')
    setInfo('')
    try {
      const r = await authService.resendVerification(email)
      setInfo(r.message)
    } catch (e) {
      setFormError(toApiError(e).message)
    } finally {
      setResending(false)
    }
  }

  return (
    <AuthLayout
      title="Verify your email"
      subtitle={email ? `Enter the 6-digit code sent to ${email}.` : 'Enter the 6-digit code from your email.'}
      footer={<Link to="/login" className="font-medium text-accent hover:underline">Back to sign in</Link>}
    >
      {!email ? (
        <Alert tone="warn">
          Missing email address. <Link to="/signup" className="underline">Sign up again</Link> or <Link to="/login" className="underline">sign in</Link>.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}
          {info && <Alert tone="success">{info}</Alert>}
          <TextField label="Verification code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" error={form.formState.errors.code?.message} {...form.register('code')} />
          <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
            Verify email
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => void resend()} loading={resending}>
            Resend code
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

export function ForgotPasswordPage() {
  const [formError, setFormError] = useState('')
  const [sent, setSent] = useState('')
  const form = useForm<{ email: string }>({ resolver: zodResolver(forgotSchema), defaultValues: { email: '' } })
  const onSubmit = form.handleSubmit(async ({ email }) => {
    setFormError('')
    try {
      const r = await authService.forgotPassword(email)
      setSent(r.message)
    } catch (e) {
      setFormError(toApiError(e).message)
    }
  })
  return (
    <AuthLayout title="Reset your password" subtitle="We will email you a link to choose a new one." footer={<Link to="/login" className="font-medium text-accent hover:underline">Back to sign in</Link>}>
      {sent ? (
        <Alert tone="success">{sent}</Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}
          <TextField label="Email" type="email" autoComplete="email" error={form.formState.errors.email?.message} {...form.register('email')} />
          <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const [formError, setFormError] = useState('')
  const form = useForm<{ new_password: string; confirm: string }>({
    resolver: zodResolver(resetSchema),
    defaultValues: { new_password: '', confirm: '' },
  })
  const onSubmit = form.handleSubmit(async (v) => {
    setFormError('')
    try {
      await authService.resetPassword({ token, new_password: v.new_password })
      navigate('/login', { replace: true, state: { notice: 'Password updated. Sign in with your new password.' } })
    } catch (e) {
      setFormError(toApiError(e).message)
    }
  })
  return (
    <AuthLayout title="Choose a new password" footer={<Link to="/login" className="font-medium text-accent hover:underline">Back to sign in</Link>}>
      {!token ? (
        <Alert tone="error">This reset link is missing its token. Request a new one from <Link to="/forgot-password" className="underline">forgot password</Link>.</Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}
          <TextField label="New password" type="password" autoComplete="new-password" error={form.formState.errors.new_password?.message} {...form.register('new_password')} />
          <TextField label="Confirm new password" type="password" autoComplete="new-password" error={form.formState.errors.confirm?.message} {...form.register('confirm')} />
          <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

export function FullScreenLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex h-dvh items-center justify-center bg-canvas text-ink-2">
      <div className="flex flex-col items-center gap-3">
        <Logo />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  )
}
