import { useState, type ReactNode } from 'react'
import { Dialog } from '@/components/ui/overlays'
import { Alert, Button, TextField } from '@/components/ui/primitives'
import { errorMessage } from '@/lib/errors'

export const MIN_REASON = 3

/**
 * Every staff write goes through this: it states what is about to happen, asks for the reason billing requires (the API
 * refuses a write without one) and, for the dangerous ones, a typed word.
 */
export function ReasonDialog({
  title, description, confirmLabel = 'Confirm', typed, children, onConfirm, onClose,
}: {
  title: string
  description?: string
  confirmLabel?: string
  /** a word the user must type exactly (e.g. PUBLISH) */
  typed?: string
  /** extra fields for this action (an amount, a duration), shown above the reason */
  children?: ReactNode
  onConfirm: (reason: string) => Promise<unknown>
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [word, setWord] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = reason.trim().length >= MIN_REASON && (!typed || word === typed)
  const run = async () => {
    if (!ok || busy) return
    setBusy(true)
    setError('')
    try {
      await onConfirm(reason.trim())
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={busy ? () => undefined : onClose} title={title} description={description}>
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run() }}>
        {error && <Alert tone="error">{error}</Alert>}
        {children}
        <TextField label="Reason (kept in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000}
          error={reason.length > 0 && reason.trim().length < MIN_REASON ? `At least ${MIN_REASON} characters.` : undefined} />
        {typed && <TextField label={`Type ${typed} to confirm`} value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" />}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!ok}>{confirmLabel}</Button>
        </div>
      </form>
    </Dialog>
  )
}
