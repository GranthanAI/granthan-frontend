import { z } from 'zod'
import { FILE_POLICY } from './config'

/** Mirrors auth-service `validate_password_strength`. */
export const passwordSchema = z
  .string()
  .min(12, 'At least 12 characters')
  .max(128, 'At most 128 characters')
  .regex(/[A-Z]/, 'Add an uppercase letter')
  .regex(/[a-z]/, 'Add a lowercase letter')
  .regex(/\d/, 'Add a digit')
  .regex(/[!@#$%^&*(),.?":{}|<>]/, 'Add a special character, e.g. ! @ # $ %')

export const emailSchema = z.string().trim().min(1, 'Email is required').email('Enter a valid email')

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
})
export type LoginValues = z.infer<typeof loginSchema>

export const signupSchema = z
  .object({
    full_name: z.string().trim().min(2, 'At least 2 characters').max(100, 'At most 100 characters'),
    email: emailSchema,
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })
export type SignupValues = z.infer<typeof signupSchema>

export const otpSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
})

export const forgotSchema = z.object({ email: emailSchema })

export const resetSchema = z
  .object({ new_password: passwordSchema, confirm: z.string() })
  .refine((v) => v.new_password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  })

export const titleSchema = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(255, 'At most 255 characters')

export type FileCheck = { ok: true } | { ok: false; reason: string }

export function inferType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'txt') return 'text/plain'
  return ''
}

/** Client-side pre-check mirroring File Service policy; the server remains authoritative. */
export function validateFile(file: Pick<File, 'name' | 'size' | 'type'>): FileCheck {
  if (file.size <= 0) return { ok: false, reason: `${file.name} is empty.` }
  if (file.size > FILE_POLICY.maxBytes)
    return {
      ok: false,
      reason: `${file.name} is larger than ${FILE_POLICY.maxBytes / 1024 / 1024} MB.`,
    }
  if (/[\\/]/.test(file.name)) return { ok: false, reason: `${file.name} has an invalid name.` }
  const type = (file.type || inferType(file.name)).toLowerCase()
  if (!(FILE_POLICY.allowedTypes as readonly string[]).includes(type))
    return { ok: false, reason: `${file.name}: only PDF and plain-text files are supported.` }
  return { ok: true }
}
