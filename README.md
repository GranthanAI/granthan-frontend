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
| `npm test` | Vitest + Testing Library (happy-dom) |

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

## Not available (by design, not simulated)

Stop generation, edit & resubmit, message feedback, memory viewing/management, message-content search, session/device
management UI. See [docs/INTEGRATION.md](docs/INTEGRATION.md).

## Verification status

See the final report in the PR/hand-off notes for what was run. In short: `tsc`, `vite build`, `eslint` and the
32 unit/integration-style tests pass; auth, CORS, refresh, conversations, branching, SSE subscription and graph reads
were checked live with curl against the running stack. The UI itself has not been exercised in a browser by an
automated end-to-end suite (Playwright is not set up).
