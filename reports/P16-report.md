# P16: granthan-frontend, the seven quick wins (F1-F7)

Not pushed.

## Built
- **F7 Think longer:** `features/think/` toggle (Brain) next to the model picker; shown when `think_longer_per_day !== 0`, enabled when the picked model (or, on Auto, any allowed model of the default group) has `think: true`; per message, session-only store; sent on send, regenerate and edit; "Thinking longer…" while pending; turn deadline 330 s; "Thought longer" label; `think.not_applied` note; plan_limit copy `limit.think_longer_per_day`. `PlanLimits.think_longer_per_day` and `MyModel.think` added; plan editor knows the new limit.
- **F2 Thumbs:** thumbs under sent answers, filled when rated, click again to remove; thumbs down opens the reason dialog (chips, 1,000-char comment, consent line, Skip); optimistic with rollback. Staff page `/admin/feedback` (filters, table, Load more, expand), in the admin nav behind the staff layout.
- **F1 Edit:** pencil on own sent messages (hidden in temporary chats, while a turn runs, on local rows); inline editor (Esc cancels, Ctrl/Cmd+Enter sends); POST `.../edit` with an idempotency key (reused only when the outcome is unknown), composer's mode/model/think/diagram settings and no `file_ids`; on 202 lists are refreshed, the app navigates to the new conversation and the answer streams through the normal turn path. "Edited · N versions" chip (fetched on hover) and the "Edited version of an earlier question" banner.
- **F3 Share:** Share in the header (hidden for temporary chats), scope radios, URL shown once with the warning; Settings > Shared links (update snapshot, delete with confirmation); public lazy `/s/:token` outside the auth guard (no Authorization header, `noindex`, muted "Earlier in this tree", branch list for hierarchy, Manim placeholder, 404 and 429 copy, Try GranthanAI).
- **F4 Temporary:** toggle on the new-chat page, `temporary: true` on create, banner with relative expiry, branch/share/edit/selection-branch hidden, leave prompt (router blocker + beforeunload, "Don't ask again" persisted).
- **F5 Follow-ups:** chips under the latest answer only, hidden while a turn runs and when the preference is off; click sends a new message with the current settings; history re-read at +1.5 s and +4 s, stopping early; Settings > AI preferences switch.
- **F6 Voice:** dictation (SpeechRecognition, interim + final text at the cursor, language from preferences with a menu on the mic, restart only while on, stops on send/unmount, blocked-mic / offline / quiet no-speech, first-use tooltip) and read aloud (Markdown to speakable text, sentences of about 200 chars, language-matched voice, one reader at a time, stop on route change); speed and voice in Settings. Strings in `src/content/quickwins.ts`; no new dependencies.

## Checks
- `tsc -b`: clean. `npm run build`: OK. ESLint is clean on every file I added or changed; the repo has 9 older lint errors elsewhere (PlanEditorPage, ReasonDialog, useCheckoutFlow, checkout-env, AuthPages, a test) that I did not touch.
- Tests: new `src/test/quickwins.test.tsx` (38 tests) passes. Full run: 759 passed, 2 failed (`admin-plans` "downloads plans.yaml", `notes` Markdown preview); both pass when run alone (timing under load).
- **The default vitest pool does not work on this machine, even on untouched code** (EPERM / "no tests"); I ran everything with `--pool=vmThreads`.

## Not done / not verified
- No manual pass in Chrome (dictation needs a microphone), and no live pass against the dev stack; everything is checked against mocked `fetch`.
- The "Not in your plan" tooltip cannot appear: the toggle is hidden when the plan's limit is 0, as specified.
- The "Edited" banner links to the parent conversation (the only original the API exposes); an edit that became a new root has no link.
- Share scope `hierarchy` from a non-root conversation shows the whole tree starting at its root.
