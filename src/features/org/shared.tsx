import type { ReactNode } from 'react'
import { toast } from '@/components/ui/overlays'
import { Alert } from '@/components/ui/primitives'
import { copyText } from '@/lib/clipboard'

export const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="space-y-3 rounded-2xl border border-line bg-raised p-5"><h2 className="text-base font-semibold">{title}</h2>{children}</section>
)

/** Shown where a feature is off for this organisation's plan, instead of hiding the section without a word. */
export const Upsell = ({ what }: { what: string }) => (
  <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2" data-testid="not-in-plan">{what}: available on Org Pro and above. Ask GranthanAI to change your plan.</p>
)

export const FormError = ({ message }: { message: string }) => (message ? <Alert tone="error">{message}</Alert> : null)

export async function copyWithToast(text: string, done = 'Copied'): Promise<void> {
  const ok = await copyText(text)
  if (ok) toast(done, 'success')
  else toast('Could not copy: select the text and copy it by hand', 'error')
}
