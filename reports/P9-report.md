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
