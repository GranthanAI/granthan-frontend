# P13: granthan-frontend, organisations finished, report

## What changed
- **F1 invite survives signup.** `features/org/pendingInvite.ts`: localStorage `pendingOrgInvite` = `{token, savedAt}`, valid 24 h (opening the same link again does not extend it; corrupt values are ignored; the token is never logged). `/join/:token` saves it while signed out. Login (and signup when verification is off) goes to `/join/<token>` once via `afterAuthPath`; a signed-in visit to `/login` or `/verify-email` does the same (`PublicOnly`). Cleared after a successful accept, on `INVITE_INVALID` / `INVITE_EXPIRED` / `ALREADY_IN_ORG`, on a dead preview, and on expiry. A retryable refusal (`SEATS_FULL`) keeps it.
- **F2 CSV upload** (`CsvInvites.tsx`): browser checks (.csv, not empty, at most 1 MiB, role selector with Admin for the owner only), dry run (multipart, `dry_run=true`) showing counts, the first 20 errors in plain words, payment-due and too-few-seats warnings; "Send N invites" uploads the same file with its own Idempotency-Key; the batch is polled every 5 s until `done`/`stopped` (stopped shows why); "Download errors" saves `errors.csv` under the server's Content-Disposition name. The API has no list-of-batches route, so batches are linked from the upload result only. `CSV_INVALID`, `REQUEST_TOO_LARGE`, `RATE_LIMITED` (with Retry-After seconds) have copy. `ApiError` now carries `retryAfterSeconds`; `requestFile()` returns the filename.
- **F3 invite links** (`InviteLinks.tsx`): max uses 1-5000, days 1-30 (checked before sending), domain restriction only when a verified domain exists; list with uses/max, expiry, status, restriction; Copy link (via `/url`), Revoke.
- **F4 transfer ownership**: "Make owner" on admins, owner only, confirm dialog naming the person, `LAST_OWNER` copy.
- **F5**: with no organisation, `/org/me/domain-match` is asked: "<org> is on GranthanAI", Request to join, pending state, Cancel; otherwise the ask-your-admin text. Join requests tab (owner/admin): name and email, Approve, Decline, seat refusals in words.
- **F6 Domains tab**: add (with subdomains), `PUBLIC_EMAIL_DOMAIN` / `DOMAIN_TAKEN` copy; pending domains show the TXT record (type, host, value) with copy buttons, Verify now (not-found copy keeps the expected record), the hourly-for-7-days note; verified domains have auto-join and subdomain toggles and a confirmed delete.
- **F7 gating**: every feature that is off shows "<feature>: available on Org Pro and above" (CSV, links, domains, join requests, lock toggle, spend cap, usage) instead of vanishing. The Usage tab stays and says so.
- **F8 staff** (`/admin/orgs`): add member by user id (`UNKNOWN_USER` copy), manual domain verify, resend owner invite (by invite id), audit log with reasons (paged), members paged ("Load more"). All writes use ReasonDialog; support and billing_admin stay read-only. Error codes inside the dialog now show their words.
- Email invite form: Admin role offered to the owner only (as for CSV).

## Checks
- typecheck clean; `vite build` clean.
- Vitest: new files `org-invite-flow` 12, `org-csv` 15, `org-more` 27, plus P12's `org` 15 and `org-admin` 5: all passed in the foreground. Full suite (background): **720 passed, 1 failed**: `notes.test.tsx` "previews Markdown", a 4.5 s timeout under full-suite load; it passes alone (23/23) and is not touched by this work. An earlier full run had 4 more load timeouts (`ui` settings test, two of my flow tests, one org test): I raised the flow tests' timeout and fixed the tab count; `ui.test` passed alone.
- eslint: no errors in anything I added or changed. `eslint .` still reports 8 errors in older files (`ReasonDialog`, `PlanEditorPage`, `useCheckoutFlow`, `checkout-env`, a test): React-compiler/`no-explicit-any` rules, untouched by this work.

## Browser smoke: what I did and did not see
Playwright is not installed here and installing a browser costs disk, so **I did not drive a browser**. I ran the same three flows against the real stack (gateway 8080 → organisation-service 8010) with a script (deleted afterwards) that calls the API the way the screens do:
1. Staff created a pilot (201, owner invite pending). The owner invite previewed without a token and the owner accepted it (`owner`, 25 pilot seats, csv/links/domains on).
2. The owner's CSV dry run on a 7-row file: 5 ok, 2 failed (`invalid_email`, `duplicate_in_file`); the 5-row file sent (multipart through the gateway worked); the batch reached `done`, 5 sent; `errors.csv` downloaded (BOM, header).
3. An invite link was created, previewed signed out, and a new user accepted it and became `member`. A stranger's domain-match was 404.
**Not seen:** a real signup and email verification in a browser. Auth sends real email through SMTP, so the verification code could not be read; the signup → verify in a new tab → login → join sequence is covered by the vitest flow test (fresh router per "tab", same localStorage), not by a live run. The dev data left behind: one "Smoke College" organisation.

## Notes
- The dev email queue of organisation-service still holds thousands of invites from an earlier load test (it logs `DEV EMAIL` lines for them), so a new invite's dev email would arrive late; for the smoke run I derived the owner token from the invite row.
- Nothing pushed.
