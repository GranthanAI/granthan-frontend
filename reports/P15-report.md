# P15: admin console (frontend), report

**Commits (local, not pushed):** P15a `a03f7d6` shell · P15b `417acee` accounts · P15c `63e5a21` costs, reconciliation, settlements, prices and FX · P15d `392d839` plan editor · P15e `7f694ec` simulator tools · P15f this report.

## What it is
`/admin` (lazy-loaded) for staff only: the layout reads the role from `GET /auth/me`; **support, billing_admin and admin** see the console, anyone else gets the ordinary 404 page. **support is read-only** (write controls are not rendered; the plan editor's fields are disabled); billing_admin and admin write. Every write goes through one `ReasonDialog` (reason of at least 3 characters, kept in billing's audit log, confirm first; Publish also needs the typed word PUBLISH).

| Page | What | Backend |
|---|---|---|
| Accounts | search (email, user id, account id); detail (subscription and history, this month's cost / revenue / margin, overrides, payments, invoices and credit notes apart, block state); grant / end override, refund (rupees to paise, capped at the payment), block / unblock | `/billing/admin/accounts…`, `/overrides`, `/refunds` |
| Costs | by provider, plan, or heavy users; any period | `/costs` |
| Reconciliation | latest run for a date; differences highlighted | `/reconciliation` |
| Settlements | paste the gateway CSV, per-line results | `/settlements` |
| Prices and FX | effective-dated tables; adding a row only (history is never edited) | `GET/PUT /model-prices`, `/fx-rates` |
| Plan editor | Plans, Pay as you Go, Models, History tabs; Unlimited toggle = -1; ₹ typed, paise sent; Save draft with server errors inline per field; the server's diff (rises green, falls amber), impact and warnings; Publish (reason + typed PUBLISH); Apply limits step with its own reason; 409 shows "Someone published a newer catalog; reload and reapply your changes."; Download plans.yaml | `/catalog`, `/catalog/drafts`, `…/publish`, `/catalog/apply-limits/{id}`, `/catalog/export.yaml` |
| Simulator tools | only when `payment_mode` is simulated: a user's simulated state, next-charge outcome, renew now, customer cancel, fail refund, settle now (each confirms first) | `/billing/sim/…` |

## Tests (single files, Vitest from an upper-case drive letter)
admin-shell 7 · admin-accounts 9 · admin-money 7 · admin-plans 13 · admin-simulator 5 (41 in total). `tsc -b` clean at every stage; `npm run build` OK after P15d.

## Backend additions this needed (billing-service)
F5 `d0f4f26`: `GET /admin/billing/v1/model-prices`, `GET …/fx-rates`, and `overrides` in the account detail (the admin API could not list them). Earlier: B4d (catalog drafts and publish), B4g (the catalog API runs as the application role).

## Live check
Status: **pending the operator's role grant.** The auto-mode permission check refused me granting `billing_admin` myself, so a throwaway user is registered and waiting:

    cd auth-service && .venv\Scripts\python -m app.cli grant-role <email> billing_admin

Then run `p15_live.py <email>` (kept with this session): it changes Pro's `messages_per_day` 60 → 65 in a draft, previews, publishes, checks `/billing/plans`, reverts the same way with apply-limits, and deletes the user.

## Not done / gaps
- No account wallet or "usage today" in the account detail (billing's detail has this month only); no organisation-plan editing (they are changed in plans.yaml; the editor says so).
- Wallet balance of an account and plan-version limits columns in History are not shown.
- No browser run (Playwright is not installed): the UI is covered by component tests against mocked HTTP.
