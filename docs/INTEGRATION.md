# Backend integration inventory

Sources of truth: `api-gateway/docs/api-examples.md`, the Pydantic schemas and routers of `auth-service`,
`conversation-service`, `graph-service`, `file-service`, `llm-service` (citation payload), and live requests
against a running stack (marked **verified live**). The browser talks **only** to the API Gateway
(`VITE_API_BASE_URL`, default `http://127.0.0.1:8080/api/v1`).

Status: **Integrated** (wired to the real contract) · **Partial** · **Unavailable** (no contract, UI says so).

| Feature | Owner | Contract used | Auth | Status |
|---|---|---|---|---|
| Register | auth | `POST /auth/register` `{email,password(12–128, upper/lower/digit/special),full_name}` | none | Integrated, verified live |
| Verify email (OTP) / resend | auth | `POST /auth/verify-email` `{email,code(6)}`, `POST /auth/resend-verification` | none | Integrated, verified live. Emails are sent by `notification-service`, which is **not implemented**; in development read the OTP with `auth-service/get_otp.py` |
| Login | auth | `POST /auth/login` → `{access_token,expires_in}` + HttpOnly `refresh_token` cookie | none | Integrated, verified live |
| Session restore / expiry | auth | `POST /auth/refresh` (cookie, rotating) | cookie | Integrated, verified live. Single-flight (rotation reuse revokes all sessions) |
| Logout | auth | `POST /auth/logout` | Bearer | Integrated |
| Profile, change password | auth | `GET /auth/me`, `PATCH /auth/profile`, `POST /auth/change-password` | Bearer | Integrated |
| Forgot / reset password | auth | `POST /auth/forgot-password`, `POST /auth/reset-password` `{token,new_password}` | none | Integrated (needs the reset email → blocked in practice by missing notification-service) |
| Session/device list & revoke | auth | `GET/DELETE /auth/sessions` | Bearer | Contract exists; **no UI built** |
| Conversation list | conversation | `GET /conversations?limit&cursor` → `{items,next_cursor,has_more}` (updated_at desc) | Bearer | Integrated, infinite scroll |
| Create / get / rename / delete | conversation | `POST /conversations`, `GET /conversations/{id}`, `PATCH …/rename`, `DELETE` | Bearer | Integrated |
| Archive | conversation | `POST …/archive` | Bearer | Contract exists; no UI |
| Branching | conversation + graph | `POST /conversations {title,parent_conversation_id}` | Bearer | Integrated. **Lineage only**: the child starts with empty history/memory (documented, verified) |
| Lineage reads | graph | `GET /graph/conversations/{id}/children|ancestors|descendants` | Bearer | Integrated (children, ancestors). Eventually consistent (Kafka) |
| Message history | conversation | `GET …/messages?limit&cursor` (newest first; assistant `status` pending/sent/failed) | Bearer | Integrated, paginated upwards |
| Send message | conversation | `POST …/messages` `{content≤8000,file_ids}` + `X-Idempotency-Key` → 202 `{message_id,response_message_id}` | Bearer | Integrated, verified live |
| Streaming | conversation via gateway | `GET /stream/{cid}` SSE; events `{message_id(assistant),content,sequence_number,is_final,status,full_content,citations}` | Bearer **header** (the gateway also accepts `?token=`; not used, to keep tokens out of URLs/logs) | Integrated; header auth + keep-alive verified live |
| Regenerate | conversation | `POST …/messages/{assistantId}/regenerate` → 202 (new `response_message_id`, old answer soft-deleted) | Bearer | Integrated |
| Delete message | conversation | `DELETE …/messages/{id}` | Bearer | Contract exists; no UI |
| Files | file | `POST /files/upload/initiate` → presigned URL → `POST /files/{id}/complete` → poll `GET /files/{id}/status` (UPLOADED→SCANNING→PROCESSING→READY\|FAILED); list/get/download/retry/delete | Bearer | Integrated. Policy mirrored client-side: PDF, text, Markdown, .doc/.docx, ≤100 MB (see `docs/BACKEND_FOR_FRONTEND.md` §9). MinIO CORS for `127.0.0.1:3000` was verified by the backend team; the browser upload itself has not been exercised by this client |
| Attach files to a message | conversation + file | `file_ids` on send; only `READY` files can be sent | Bearer | Integrated |
| Tool discovery | llm via gateway | `GET /tools` → `{tools:[{id,name,description,version,parameters,auto_runnable}], max_selected}`; the UI lists only this, nothing hardcoded | Bearer | Integrated, verified live |
| Response modes | llm via gateway → kafka | `modes` in `GET /tools`; chosen id sent as `mode`; validated and enforced over the planner; Auto = no mode | Bearer | Integrated, verified live. Regenerate does not re-apply |
| Tool selection | conversation → kafka → llm | `selected_tools` on `POST …/messages`; validated against the live registry, executed as required tools; unknown/disabled → failed turn with a clear message; malformed id → 422 | Bearer | Integrated, verified live. Regenerate does not re-apply tools |
| Document context for chat | file + retrieval + llm | `file_ids` on `POST …/messages`; retrieval returns a status (OK/NO_MATCH/ACCESS_DENIED/INDEXING/…); unusable documents fail the turn with an actionable message; READY now means indexed with ≥1 chunk | Bearer | Integrated, verified live |
| Retrieval / citations | llm → conversation stream | `citations: [{file_id,source_name,page_number,section}]` on the **final SSE event** | – | Integrated (rendered, expandable). **Not persisted** by the backend, so they vanish after reload |
| Memory | memory | none (gRPC/internal only; gateway exposes only `/memory/health`) | – | **Unavailable.** Panel explains this; nothing is simulated |
| Search | – | no search endpoint | – | **Partial**: filters titles of already-loaded conversations client-side. No message-content search exists |
| Stop generation | – | no cancel endpoint | – | **Unavailable** (no stop button). Server fails stuck turns after 120 s |
| Edit & resubmit user message | – | no endpoint | – | **Unavailable** |
| Message feedback | – | no endpoint | – | **Unavailable** |

## Gaps and findings (for the backend owners)

1. **auth-service CSRF allow-list**: `/auth/refresh` and `/auth/logout` return `403 CSRF Check Failed` for any
   `Origin` not in `ALLOWED_CORS_ORIGINS` (the local `.env` lists `localhost:3001` and `127.0.0.1:3000`).
   The dev server therefore runs on **`http://127.0.0.1:3000`**. Other origins must be added to that setting
   (and to the gateway's `CORS_ALLOW_ORIGINS`).
2. **Cookies are `SameSite=Strict`**, so page and gateway must share a site: use `127.0.0.1` for both (or
   `localhost` for both, after allow-listing).
3. **Graph Service returns `parent_conversation_id: null` for every node** (verified live). The frontend uses
   the conversation list/get for authoritative parents and derives graph relationships from endpoint semantics
   (children of X ⇒ parent X; ancestors are root-first).
4. **Assistant message timestamps have no timezone** (`2026-…T08:21:32.536000`); treated as UTC.
5. **Citations are only on the live SSE final event.** A future endpoint (or persisting them on the message)
   is needed for reloads.
6. No public Memory API; no cancel/edit/feedback/search endpoints; `notification-service` missing (no email).
7. SSE live delivery is Redis pub/sub (no replay). Conversation Service now also appends every event to a
   short-lived Redis Stream (`conversation:{id}:events`, 15 min / 2000 events) and
   `GET /stream/{cid}?message_id=<assistant id>&since=<event_id|0>` replays that turn after the cursor, then follows
   live, deduplicated by `event_id`, closing after the turn's terminal event. The client POSTs first, then connects
   with `since=0`, reconnects from the last `event_id`, and independently checks persisted history every 5 s, so a
   missed event, a dropped stream or an unavailable event log still ends with the persisted reply (≤150 s).
8. If the backend watchdog fails a turn at 120 s and the real reply lands later, the stored row is overwritten with the
   reply. The client keeps polling a recent `Generation timed out…` row, so the late reply appears without a reload.
9. NVIDIA is a reasoning model and can take 20–180 s for a greeting. LLM Service now enforces a first-visible-token
   deadline (`GENERATION_FIRST_TOKEN_TIMEOUT_MS`, default 8 s) and hands the turn to the configured fallback
   (`GENERATION_FALLBACK_PROVIDER=groq` in this checkout's `.env`).

## Development fixtures

None. The app never fabricates backend responses. Automated tests mock `fetch` at the API boundary
(`src/test`); those prove frontend protocol handling, **not** backend integration. Live behaviour was
checked manually with curl against the running stack (see README → Verification).
