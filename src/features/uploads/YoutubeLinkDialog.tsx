import { useCallback, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Dialog } from '@/components/ui/overlays'
import { Button, TextField } from '@/components/ui/primitives'
import { parseYoutubeUrl } from './youtube'

export const MAX_LINKS_PER_BATCH = 5

/**
 * "Attach YouTube link": one or more links (use + to add more rows). Basic validation here is only for instant feedback;
 * the server validates again and is authoritative. Submitting hands the links to the composer, which shows each one's real
 * backend state (fetching / indexing / ready / the specific failure); this dialog never claims a video is ready.
 */
export function YoutubeLinkDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  /** Returns the links that were refused locally (e.g. already attached) as readable messages. */
  onSubmit: (urls: string[]) => string[]
}) {
  const [rows, setRows] = useState<string[]>([''])
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [refused, setRefused] = useState<string[]>([])

  const setRow = (i: number, v: string) => {
    setRows((cur) => cur.map((r, j) => (j === i ? v : r)))
    setErrors((cur) => {
      if (!(i in cur)) return cur
      const rest = { ...cur }
      delete rest[i]
      return rest
    })
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const filled = rows.map((r, i) => ({ r: r.trim(), i })).filter((x) => x.r)
    const errs: Record<number, string> = {}
    const seen = new Map<string, number>()
    for (const { r, i } of filled) {
      const p = parseYoutubeUrl(r)
      if (!p.ok) errs[i] = p.reason
      else if (seen.has(p.videoId)) errs[i] = 'You already entered this video.'
      else seen.set(p.videoId, i)
    }
    if (!filled.length) errs[0] = 'Enter a YouTube video link.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const bad = onSubmit(filled.map((x) => x.r))
    if (bad.length) return setRefused(bad)
    setRows([''])
    setRefused([])
    onClose()
  }

  // Stable identity matters: Dialog re-runs its focus handling whenever `onClose` changes, which would pull focus back to the
  // first field on every keystroke.
  const close = useCallback(() => {
    setErrors({})
    setRefused([])
    onClose()
  }, [onClose])

  return (
    <Dialog open={open} onClose={close} title="Attach YouTube link" description="The video's transcript is saved and searched for answers. Add several links with +.">
      <form onSubmit={submit} noValidate className="space-y-3">
        {rows.map((value, i) => (
          <div key={i} className="flex items-start gap-2">
            <TextField
              className="min-w-0 flex-1"
              label={`Video link ${i + 1}`}
              value={value}
              onChange={(e) => setRow(i, e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              inputMode="url"
              autoComplete="off"
              autoFocus={i === 0}
              error={errors[i]}
            />
            {rows.length > 1 && (
              <Button type="button" variant="ghost" size="icon" className="mt-7" onClick={() => setRows((c) => c.filter((_, j) => j !== i))} aria-label={`Remove link ${i + 1}`}>
                <X className="size-4" />
              </Button>
            )}
          </div>
        ))}
        {rows.length < MAX_LINKS_PER_BATCH && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setRows((c) => [...c, ''])} aria-label="Add another link">
            <Plus className="size-3.5" aria-hidden /> Add another link
          </Button>
        )}
        {refused.length > 0 && (
          <ul role="alert" className="space-y-1 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
            {refused.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Attach
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
