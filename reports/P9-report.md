# P9: frontend billing UI, report

**Commits (local main, not pushed after P9e):** P9a `ac13f2a` data layer · P9b `80f3907` model picker and usage meter · P9c `a2e33d8` billing notices · P9d `bd98c33` pricing and checkout · P9e `0356024` billing, AI and account settings · P9f docs and this report. P9a to P9e were pushed on request (`3982e2b..0356024`).

## Tests (single files, `npx vitest run src/test/<file>`, run from a shell with an upper-case drive letter)
New: billing-data.test.tsx 13 · model-picker.test.tsx 19 · billing-notices.test.tsx 36 · checkout.test.tsx 30 · billing-settings.test.tsx 19 (117 total).
Touched and re-run: chat-flow.test.ts 15 · tools-and-documents.test.tsx 25 · continue-button.test.tsx 4 · settings-pages.test.tsx 11 · custom-modes.test.tsx 13 · youtube.test.tsx 38 · ui.test.tsx 11 · selection-branching.test.tsx 20. All passed. Full suite not run.
Static: `tsc --noEmit` clean; `npm run build` OK (twice).

## Exit check
- Gateway CORS from `http://localhost:5173` with credentials: OK for GET/POST preflights **except `Idempotency-Key`** (below). Billing `FRONTEND_ORIGIN=http://localhost:5173`: matches.
- Live by curl through the gateway (no browser automation; Playwright is not installed): sign-up, public plans, Free limits, plan_limit denial (4th custom mode, 403 `custom_modes`), simulator checkout with UPI `success@razorpay` (OTP 123456), verify twice with the same key (same answer), Pro active, Smart unlocked, explicit Smart model granted and returned on the assistant message, Best on Pro 403 `model_not_in_plan`, invoice PDF via 302 to storage (storage CORS allows the page origin), account deleted (204, login 401), Vite stopped.
- By tests only: every UI state (picker, meter, notices, banners, pricing, checkout dialog, popup/Razorpay paths, settings, delete account).
- Not run live: the browser popup/postMessage round trip, hitting a daily limit in chat.

## Decisions needed / deviations
1. **Blocker (backend):** gateway CORS rejects the `Idempotency-Key` header (preflight 400), so browsers cannot POST to billing. Fix: `api-gateway/app/middleware/cors.py` line 14, add `"Idempotency-Key"` to `allow_headers` (hardcoded, not a setting).
2. Upgrade copy cannot show the refund amount: change/resume responses carry no amounts. The dialog shows the new plan price and says unused days go back, without a number.
3. Billing exposes no read/edit of billing email, state or GSTIN: Settings → Billing shows the account email and says state/GSTIN are on each invoice.
4. Unverified-email step offers resend and "check again" only (the OTP page is public-only).
5. Resume banner links to Settings → Billing. "Contact support" uses `VITE_SUPPORT_EMAIL` (default support@granthan.ai): confirm the address.
6. Vitest on Windows fails in setup when the shell cwd has a lower-case drive letter.

---

# Follow-ups after P9 (P9i, P9h, P9g)

**Commits (local, not pushed):** P9i `f571123` plan change amounts and billing profile · P9h `15cf33b` plan-sheet content · P9g `1043de9` wallet.

## Tests (single files; Vitest from an upper-case drive letter)
New: billing-followups 17 · plan-sheet 18 · wallet 14. Re-run after the changes: checkout 30 · billing-notices 36 · billing-settings 19 · billing-data 13 · model-picker 19. `tsc -b` and `npm run build` clean at the end of each stage (`tsc --noEmit` alone misses unused imports; use `tsc -b`).

## What changed
- **P9i:** the change and resume dialogs call `POST /billing/subscription/change/preview` (and `/resume/preview`) and show billing's numbers (nothing is computed in the browser). Settings → Billing has a Billing details form (`/billing/me/billing-profile`, per-field server errors, "applies to future invoices"); the checkout dialog prefills from it and saves it. The GST state list comes from `GET /billing/gst-states`: the hardcoded list is deleted. The support address comes only from `VITE_SUPPORT_EMAIL` (no default in code; unset hides the links).
- **P9h:** `src/content/plans.ts` holds all marketing and limit copy. The pricing page has the full comparison table (every row of the plan sheet) with numbers from `/billing/plans`; the Pay as you Go column appears only when the API lists payg. Limit notices are keyed by `message_key` (our words, the API message as fallback) with the right action per key.
- **P9g:** Pay as you Go is shown only when the plans list payg and the wallet routes answer 200 (404 = off, nothing shown). Pricing card, Settings → Billing → Credits (balance, expiring-soon, paged history, spend cap), top-up through the same popup/Razorpay handling (order proofs, own Idempotency-Key, `/wallet/topups/verify`), picker "uses credits · ₹X per message", Top up / Raise your cap notices, an expiring-credits banner.

## Backend pieces these needed (billing-service, local commits)
F2 `185ae09` (preview + amounts), F3 `df391b7` (billing profile, GST state list), F4 `9805fdd` (payg unit prices, packs and validity in `/plans`), F5 `d0f4f26` (admin reads for prices, FX, overrides).

## Decisions / gaps
1. `/billing/plans` now carries a `payg` block (F4); without it the table cannot show "₹1 each".
2. Wallet transactions are not paged by the server: the UI pages the newest 200 locally.
3. No live browser run (Playwright is not installed): the popup round trip is by tests only.
