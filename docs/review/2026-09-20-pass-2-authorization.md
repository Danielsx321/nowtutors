# Pass 2: Authorization and RLS

Reviewed 2026-09-20 against `main` at 9775408. Read-only. Files read: `lib/auth/guards.ts`, `lib/auth/api-guards.ts`, `middleware.ts`, the guard line of every export in all 19 `src/actions/*.ts`, all 13 `route.ts` handlers, `lib/agora/session-access.ts`, `lib/broadcasts/access.ts`, `lib/lessonspace/session-access.ts`, the three `(session)` pages and layout, `actions/onboarding.ts`, `actions/messaging.ts`, and RLS in `drizzle/0003, 0005, 0007, 0010, 0012, 0015, 0016, 0018, 0019` against `db/verify-rls.ts`.

What held up (Layer 2, the app): every admin action calls `requireRole('admin')` first. Every student or tutor action takes identity from the session, never from input. Capture checks `payments.user_id` before calling PayPal. `/session`, `/classroom` and `/broadcast` pages, the token route and the LessonSpace join route all check participation and return the same 404 for "not yours" and "does not exist". Cron routes fail closed with 503 when `CRON_SECRET` is unset. Messaging checks suspension inside its core. The `next` redirect in the auth callback stays same-origin.

The serious findings are all in Layer 1. The app writes through a BYPASSRLS connection, so RLS is only ever exercised by someone calling Supabase's REST API directly with the public anon key and their own JWT. `db/verify-rls.ts` does exactly that, so the API is reachable. The project already closed this class of hole for `tutor_profiles.approval_status` (0010), `withdrawal_requests` (0015) and messages and broadcasts (0018). Two tables and one trigger path were left.

## Confirmed by reading

### A1. A newly signed-up user can make themselves admin. CRITICAL
- `drizzle/0003_triggers.sql:69-88`, re-issued in `drizzle/0016_profiles_guard_trusted_server.sql:24-44`; policy `profiles_update` at `drizzle/0005_rls.sql:70-71`.
- `profiles_guard` blocks a role change only when `old.role IS NOT NULL`. The NULL-to-value path exists for onboarding and does not restrict which value. The `profiles_update` policy checks only `id = auth.uid()`.
- The request that gets through: sign up, do not onboard (role is NULL), then
  `PATCH {SUPABASE_URL}/rest/v1/profiles?id=eq.<own uid>` with `apikey: <anon key>`, `Authorization: Bearer <own JWT>`, body `{"role":"admin","onboarding_completed_at":"2026-09-20T00:00:00Z"}`.
  `old.role` is NULL, the trigger passes, RLS passes. `requireRole('admin')` reads `profiles.role` and now lets this account into every admin action: credit adjustments up to 10,000 per call, approving and marking withdrawals paid, promoting others, editing `platform_settings` (also open to `is_admin()` over REST).
- `verify-rls.ts:129-141` only tests an account whose role is already `student`, which the guard does block. The NULL path is untested.
- Confidence: high from the trigger text. Not executed.

### A2. `bookings` is writable by participants straight through the REST API. CRITICAL
- `drizzle/0005_rls.sql:10` (table-level INSERT/UPDATE/DELETE to `authenticated`), `:130-135` (`bookings_insert` checks only `student_id = auth.uid()`; `bookings_update` checks only participation). No later migration revokes or guards it; there is no trigger on `bookings`. SPEC 5 says "status transitions restricted (Section 7)" but nothing at the database layer does that, and DECISIONS line 738 records that the booking path relies on Layer 2 only.
- Requests that get through, all as an ordinary signed-in user:
  1. Skip payment: student creates a PayPal booking in the app (`pending_payment`), then `PATCH /rest/v1/bookings?id=eq.<id>` body `{"status":"confirmed"}`. Confirmed session, nothing debited, nothing captured. The join window opens as normal and `complete-sessions` later writes the tutor's earnings from `price_credits`, which the platform pays for.
  2. Free booking outright: `POST /rest/v1/bookings` with `student_id` = self, any `tutor_id`, `type: scheduled`, `status: confirmed`, times of their choosing. No slot validation, no debit. The GiST constraint is the only check.
  3. Mint money with two accounts: student inserts a row for a colluding tutor with `status: confirmed`, `scheduled_end_at` two hours ago, `started_at` set, `price_credits: 100000`. The next `complete-sessions` run classifies it `completed` (`started_at IS NOT NULL`), writes `tutor_earnings` with net 75,000, `release-earnings` credits the tutor's wallet 48 hours later, and the tutor requests a withdrawal. The ledger is internally consistent, so `reconcile-wallets` reports no drift.
  4. Tutor edits their own rows: `PATCH` a confirmed booking's `price_credits` upward before it completes, and earnings follow it.
  5. Channel hijack: the session token route trusts `bookings.agora_channel` (it validates the `broadcast_{id}` shape for broadcasts, `lib/broadcasts/access.ts`, but has no equivalent for sessions). A user inserts their own `instant` / `in_progress` booking with `agora_channel: "broadcast_<public broadcast id>"`, calls `POST /api/agora/token` with that booking id, and receives a publisher token for someone else's live broadcast.
- Confidence: high from the policies. Not executed. `verify-rls.ts` has one bookings assertion (a student only reads their own, line 110) and none on writes.

### A3. `session_requests` is writable the same way. HIGH
- `drizzle/0005_rls.sql:142-147`.
- A student can `POST /rest/v1/session_requests` with `student_id` = self, a live tutor, `duration_minutes: 120`, `price_credits: 1`, `expires_at` far in the future. The accept transaction charges the pinned `price_credits` by design (`lib/session-requests/accept.ts:196`), so the tutor accepts a two-hour session and the student is debited 1 credit. The booking's `price_credits` is 1, so the tutor earns from 1.
- Either participant can also `PATCH` a request's `status` (a student can mark a request `declined` or re-open an expired one; a tutor can set `accepted` with no booking).
- Confidence: high from the policies.

### A4. A tutor can hold themselves "live" without a heartbeat. LOW
- `drizzle/0012_admin_write_path.sql:104-115`, `drizzle/0003_triggers.sql:48-60`.
- `tutor_profiles_update` lets the owner write any column except the three approval ones. `PATCH /rest/v1/tutor_profiles?user_id=eq.<self>` body `{"is_live":true,"last_seen_at":"2099-01-01T00:00:00Z"}` keeps the tutor in `live_tutors` permanently, which is the exact stale-live bug SPEC 3.1 exists to prevent. `sweep-presence` derives its work set from the same view, so it never clears it. No money moves (requests expire unanswered), but students see a tutor who is not there.

### A5. `endSession` and `getSessionState` do not check suspension. LOW
- `src/actions/sessions.ts:89` and `:155` use `requireUser()`. Suspension is enforced by the `(session)` layout only (`layout.tsx:28`). A suspended participant calling the action directly can still end a session. The token and join routes do check it (`requireApiUser`). Small, but it is the "layout guard is the only thing protecting it" pattern.

### A6. Role assignment at onboarding is read-then-write. LOW
- `src/actions/onboarding.ts:25-31`, `:63-73`, `:131-140`. "Role is immutable" is a read of the cached profile; the UPDATE has no `WHERE role IS NULL`. Two onboarding submissions in parallel (one student, one tutor) both pass the read and the last write wins, leaving a tutor with `student_subjects` rows or the reverse. The trusted connection bypasses `profiles_guard`, so the database does not stop it. No money involved.

## Suspicions, not verified

### A7. Whether the production Supabase project exposes the `public` schema over the Data API.
- A1 to A4 all depend on it. It is the Supabase default, the anon key ships in the client bundle for auth and Realtime, the 0010 migration comment describes a self-approval "via a direct REST call" as a real attack, and `verify-rls.ts` runs through that API. If the Data API were switched off in the dashboard these findings would be unreachable, but Realtime and the verify script suggest it is on. Worth one check in the dashboard before triage.
