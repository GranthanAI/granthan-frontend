# GranthanAI Frontend

React + Vite + TypeScript (strict) + Tailwind CSS v4 client for the GranthanAI platform: persistent conversations,
a **conversation tree** for branching, streaming answers, file uploads with retrieval citations, light/dark themes.

It talks only to the **API Gateway**. See [docs/INTEGRATION.md](docs/INTEGRATION.md) for exactly which backend
contracts are integrated, which are missing, and findings for backend owners.

## Quick start

```bash
# 1. backend (from the repo root): infra + services, then confirm everything is up
make start && make health      # gateway on :8080

# 2. frontend
cd granthan-frontend
cp .env.example .env           # VITE_API_BASE_URL=http://127.0.0.1:8080/api/v1
npm install
npm run dev                    # http://127.0.0.1:3000
```

> **Open `http://127.0.0.1:3000` (not `localhost`) and keep `VITE_API_BASE_URL` on `127.0.0.1`.**
> The refresh cookie is `SameSite=Strict` and auth-service only accepts allow-listed origins on `/auth/refresh`
> (`ALLOWED_CORS_ORIGINS` includes `http://127.0.0.1:3000`). To use another origin, add it to auth-service
> `ALLOWED_CORS_ORIGINS` and gateway `CORS_ALLOW_ORIGINS`.

New accounts must verify their email with a 6-digit OTP. Email delivery depends on `notification-service`
(not implemented yet); in development fetch the code with
`cd auth-service && .venv/Scripts/python.exe get_otp.py --email you@example.com`.

Requires Node ≥ 22. (`npm install` may print `EBADENGINE` warnings on 22.11; they are harmless here.)

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server on 127.0.0.1:3000 |
| `npm run build` | Type-check (`tsc -b`) + production build to `dist/` |
| `npm run preview` | Serve the production build on 127.0.0.1:3000 |
| `npm run typecheck` / `npm run lint` / `npm run format` | TypeScript, ESLint, Prettier |
| `npm test` | Vitest + Testing Library (happy-dom). Run single files (`npx vitest run src/test/<file>.test.tsx`); on Windows start from a shell whose working directory has an upper-case drive letter (`C:/...`), otherwise Vitest fails in its setup file |

## Architecture

```
src/
  app/            providers, router (route guards, session restore)
  components/     ui/ (primitives, overlays), layout/ (shell, sidebar, context panel),
                  chat/ (composer, message list/item, markdown), conversation-tree/
  features/       conversations/ (tree logic, hooks, dialogs), messages/ (chat controller, display merge),
                  uploads/ (attachment lifecycle)
  lib/            api-client (timeouts, 401→refresh→retry, single-flight), streaming (fetch-based SSE),
                  errors, validation (zod, mirrors backend rules), config
  services/       one file per backend service (typed adapters)
  stores/         zustand: auth (token in memory only), ui (theme/layout), chat (live turns), drafts
  types/api.ts    contract types, one place
  test/
```

Key decisions:

- **Auth**: access token is kept in memory only; the session is restored on load from the HttpOnly refresh cookie.
  Refresh is single-flight because refresh-token reuse revokes all sessions. A 401 triggers one refresh + retry,
  otherwise the user is returned to login with an "expired" notice.
- **Streaming**: SSE is read with `fetch` (not `EventSource`) so the token travels in the `Authorization` header,
  not the URL. Turns run in a controller outside React (`features/messages/chat-controller.ts`), so a reply keeps
  streaming while you browse other conversations. The client POSTs the message, then opens a *resumable* stream
  (`?message_id=<assistant id>&since=<event_id>`): the server replays events the browser missed and follows live, so
  there is no subscription race. It reconnects from the last `event_id` with backoff, dedupes by `sequence_number`,
  replaces the buffer with the final event's `full_content`, and runs a 5 s persisted-history check in parallel so a
  turn always resolves (reply, failure, or a clear timeout error) even if the stream is unavailable. A recent
  timeout-failed row keeps being polled because the real reply can still land later.
- **Duplicate-submit protection**: one active turn per conversation, plus an `X-Idempotency-Key` that is reused on
  retry so a lost acknowledgement cannot create a second message.
- **Conversation tree**: built strictly from `parent_conversation_id`; nothing is inferred from titles/timestamps.
  Nodes whose parent is not loaded yet are shown as top-level with a branch marker and re-nest as pages load.
  The path to the active conversation is fetched from the Graph Service (ancestors) and expanded automatically.
  "Branch" creates a **linked** conversation; the backend does not copy history or memory into it, and the UI says so.
- **Safety**: Markdown is rendered without raw HTML, links open with `rel="noopener noreferrer nofollow"`, server
  5xx bodies are never shown to users, no secrets are stored or committed.

## Tools and documents in chat

- **Mode and tool selector** (composer, wrench button): *Mode* is Auto (default) or one of the backend's modes (Tutor, Code, Web search, Smart, Deep research; only those enabled), sent as `mode`. The tool list comes from `GET /tools`, so it always matches the backend
  registry (enabled tools only; loading, empty and error states; limited by the backend's `max_selected`). Chosen
  tools are sent as `selected_tools` and survive retry. A tool that disappears from the backend is dropped with a notice.
- **Documents**: a file is only attachable once the backend reports it `READY` (indexed and searchable). A file that
  fails shows the backend's reason (for example a scanned PDF with no text). Documents attached earlier in the
  conversation are shown as "In context" chips on later questions, can be switched off, and are only sent while still
  `READY`. The right panel's **Files** tab lists every document attached to the conversation, including ones
  uploaded from the new-chat screen (which File Service cannot link to a conversation).
- If an attached document cannot be searched (no access, still indexing, indexing failed, service down) the reply is
  a clear error instead of an answer that pretends to have read it.

## Billing, plans and payments

The UI for the billing integration (plans, model picker, usage meter, limit messages, checkout, invoices, account
deletion). Everything goes through the gateway under `/api/v1/billing/...`; the amounts, limits and model lists always
come from the API, never from constants in the UI (the one exception is the GST state list, see below).

| Where | What |
|---|---|
| Composer | **Model picker** next to the tool picker (Auto, then Fast / Smart / Best / Ultra; models the plan does not include are greyed with the plan that unlocks them and link to `/pricing`; the choice is kept per conversation; "Set as default" saves `default_model`). **Usage meter** under the box ("31 of 80 messages today · resets 12:00 am", amber at 80%, red at 100%). Hidden when `/billing/me/models` fails. |
| Above the composer | **Billing notices**: an inline banner (never a toast, the draft is kept) for every refusal in plan 4.6: daily / monthly limit ("Resets at <IST time>"), model not in plan, blocked, no credit, spend caps, billing unavailable, and `plan_limit` from any service (uploads, YouTube, branches, documents, messages per conversation, custom modes, instruction length, memory facts). A quiet dismissible banner for the server's `notice` stream events ("You've used 80% of today's messages"). |
| Top of every page | Payments are simulated, payment failed (Pay now), suspended, plan ends on <date> (Resume). |
| `/pricing` | Public (works signed out). Monthly / yearly, GST-inclusive prices, limits, current plan marked. Signed out: Upgrade goes to sign-up and back. |
| Checkout dialog | Needs a verified email. Asks for the GST state (place of supply) and optionally a GSTIN and business name, then pays through the simulator or Razorpay. Also used to change plan and to resume. |
| Settings → Billing | Plan, status, renewal / end date, change plan, cancel (confirmation shows the access-until date), resume, invoices and credit notes listed separately with authenticated PDF download. |
| Settings → AI preferences | Default model. |
| Settings → Memory | "5 of 50 facts used". |
| Settings → Security | Delete account (password re-check, subscription cancelled, data deleted after 30 days). |

### Environment

| Variable | Meaning |
|---|---|
| `VITE_API_BASE_URL` | Gateway base URL including `/api/v1`. The simulator popup is opened on **this origin** and only messages from it are accepted. |
| `VITE_SUPPORT_EMAIL` | Optional. Target of "Contact support" (a `mailto:`). Default `support@granthan.ai`. |

For the payment simulator to hand its result back, the page you open must be exactly the origin that billing-service
has as `FRONTEND_ORIGIN` (the dev value is `http://localhost:5173`), and the API host must be on the same site (the refresh
cookie is `SameSite=Strict`):

```bash
VITE_API_BASE_URL=http://localhost:8080/api/v1 npm run dev -- --host localhost --port 5173   # open http://localhost:5173
```

The gateway must also allow the `Idempotency-Key` request header in CORS: every billing POST sends it (billing requires
it). If the browser console shows a failed preflight on `/billing/checkout`, that header is missing from the gateway's
`allow_headers` (see `reports/P9-report.md`).

### How the simulator popup works

1. The click handler opens a blank popup **synchronously** (`window.open('about:blank', ...)`) so pop-up blockers allow it.
2. `POST /billing/checkout` returns `provider: "simulator"` and `simulator_url`, a **path** (`/api/v1/billing/sim/checkout/<id>?t=<token>`).
   The UI builds the URL from the origin of `VITE_API_BASE_URL` (a value that is not a plain path is refused) and points the popup at it.
   If anything fails, the popup is closed again.
3. The simulated payment page calls `window.opener.postMessage({ source: 'granthan-sim-checkout', razorpay_payment_id, razorpay_subscription_id, razorpay_signature }, FRONTEND_ORIGIN)`.
4. The app accepts a message only if `event.origin` equals the API origin **and** `data.source === 'granthan-sim-checkout'` and the three
   fields are strings; everything else is ignored.
5. It then calls `POST /billing/checkout/verify` once, with an `Idempotency-Key` that is reused if the same attempt is retried. The listener is
   removed on success, cancel or unmount. Closing the popup without paying shows "Payment not completed" and Try again.
6. With `provider: "razorpay"` the same flow runs with Razorpay's own modal (`checkout.js` is loaded once, with a timeout and an error state).
7. After verification the plan, the model list, usage and invoices are refetched, so newly unlocked models appear at once.

Test card / UPI for the simulator: card `4111 1111 1111 1111`, UPI `success@razorpay`, OTP any six digits except `000000`.

### GST state list

`src/lib/gst-states.ts` is the only copy of the GST state / union-territory codes (billing does not expose them). It is copied from
billing-service `src/billing/domain/india.py`; keep the two in step.

## Not available (by design, not simulated)

Stop generation, edit & resubmit, message feedback, memory viewing/management, message-content search, session/device
management UI. See [docs/INTEGRATION.md](docs/INTEGRATION.md).

## Verification status

See the final report in the PR/hand-off notes for what was run. In short: `tsc`, `vite build`, `eslint` and the
32 unit/integration-style tests pass; auth, CORS, refresh, conversations, branching, SSE subscription and graph reads
were checked live with curl against the running stack. The UI itself has not been exercised in a browser by an
automated end-to-end suite (Playwright is not set up).
