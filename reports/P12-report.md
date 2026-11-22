# P12: granthan-frontend, organisations, report

## What changed
- `/join/:token` (public route): shows the invitation (public preview, no auth header), Sign in / Create account when signed out (returns here via `state.from`), Join with a stable Idempotency-Key when signed in, then Settings → Organisation. Dead links (`INVITE_INVALID`, `INVITE_EXPIRED`) show words and no Join button; every refusal code (SEATS_FULL, PAYMENT_DUE, ALREADY_IN_ORG, INVITE_EMAIL_MISMATCH, EMAIL_NOT_VERIFIED, ...) has copy in `features/org/errors.ts`.
- Settings → Organisation: summary and Leave for everyone; owners/admins also get tabs Members (role change owner-only, remove), Invites (email invites with per-address results, open invites resend/revoke, one-time invite link), Policies (lock modes, spend cap in rupees stored as paise), Usage, Audit. Seats show `3 of 5 used · drops to 4 at the next renewal`. 404 on `/org/me` means "no organisation", not an error.
- Admin console: `/admin/orgs` (search, detail with seats and members, create, set seats, suspend, reactivate, extend pilot, close with typed CLOSE) using the existing ReasonDialog. Writes need staff role `admin` (billing_admin and support are read-only here).
- `src/services/org.service.ts`, `org-admin.service.ts`, `src/types/org.ts`, `src/features/org/errors.ts`. `ApiError` now keeps the problem+json `code`.

## Checks
typecheck clean, build clean, eslint clean on changed files (one older warning in AuthPages). Vitest, touched files only: `org.test.tsx` 15, `org-admin.test.tsx` 5, `settings-pages` + `admin-shell` 18: all passed. Full suite not run (as asked).

## Not done
Domains / join requests tab, CSV upload, transfer ownership, invite batches, staff audit view: the API exists, no screen yet. Not checked in a real browser against the running stack.
