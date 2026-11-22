import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Logo, Skeleton } from '@/components/ui/primitives'
import { formatIstDate } from '@/lib/format'
import { uuid } from '@/lib/utils'
import { orgService } from '@/services/org.service'
import { DEAD_INVITE_CODES, FINAL_ACCEPT_CODES, orgErrorCode, orgErrorMessage } from './errors'
import { clearPendingInvite, savePendingInvite } from './pendingInvite'
import { orgKeys } from './hooks'

/**
 * /join/:token. The preview is public, so the page explains the invitation before anyone signs in; Join needs a session.
 * A signed-out visitor is sent to sign in or sign up and comes straight back here (the login screens honour `state.from`).
 */
export function JoinPage({ signedIn, restoring }: { signedIn: boolean; restoring: boolean }) {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const preview = useQuery({ queryKey: ['org', 'preview', token], queryFn: ({ signal }) => orgService.preview(token, signal), retry: false, enabled: !!token })
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const attempt = useRef(uuid()) // the same key on a retry of the same click

  const join = async () => {
    setJoining(true)
    setError(null)
    try {
      await orgService.accept(token, attempt.current)
      clearPendingInvite()
      await qc.invalidateQueries({ queryKey: orgKeys.all })
      navigate('/settings/organisation', { replace: true })
    } catch (e) {
      setError(e)
      if ((FINAL_ACCEPT_CODES as readonly string[]).includes(orgErrorCode(e) ?? '')) clearPendingInvite()
      attempt.current = uuid()
      setJoining(false)
    }
  }

  const from = `/join/${encodeURIComponent(token)}`
  const dead = preview.isError && (DEAD_INVITE_CODES as readonly string[]).includes(orgErrorCode(preview.error) ?? 'INVITE_INVALID')
  const p = preview.data
  // Signed out: remember the token so signing up (and verifying in another tab) comes back here. A dead link forgets it.
  useEffect(() => { if (!signedIn && !restoring && token) savePendingInvite(token) }, [signedIn, restoring, token])
  useEffect(() => { if (dead) clearPendingInvite() }, [dead])

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-5 py-10" data-testid="join-page">
      <Logo />
      {preview.isPending && <Skeleton className="h-24 w-full" />}
      {preview.isError && <Alert tone="error">{dead ? orgErrorMessage(preview.error) : 'We could not check this invitation. Please try again.'}</Alert>}
      {p && (
        <section className="space-y-3 rounded-2xl border border-line bg-raised p-5">
          <h1 className="text-lg font-semibold">Join {p.org_name}</h1>
          <p className="text-sm text-ink-2">
            {p.inviter_name} invited you to join this {p.org_type} as {p.role === 'member' ? 'a member' : `an ${p.role}`}.
          </p>
          {p.email_hint && <p className="text-sm text-ink-3">The invitation was sent to {p.email_hint}.</p>}
          <p className="text-xs text-ink-3">Valid until {formatIstDate(p.expires_at)}.</p>
          {!!error && <Alert tone="error">{orgErrorMessage(error)}</Alert>}
          {restoring ? (
            <Skeleton className="h-10 w-full" />
          ) : signedIn ? (
            <Button variant="primary" className="w-full" loading={joining} onClick={() => void join()}>Join {p.org_name}</Button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-ink-2">Sign in or create an account to join.</p>
              <div className="flex gap-2">
                <Link to="/login" state={{ from }} className="flex-1"><Button variant="primary" className="w-full">Sign in</Button></Link>
                <Link to="/signup" state={{ from }} className="flex-1"><Button className="w-full">Create account</Button></Link>
              </div>
            </div>
          )}
        </section>
      )}
      {signedIn && !restoring && <Link to="/" className="text-center text-sm text-ink-3 hover:underline">Not now</Link>}
    </main>
  )
}
