# NowTutors — Progress (resume-from-cold)

_Read this first. Authoritative spec: `docs/SPEC.md`. Decisions log: `docs/DECISIONS.md`._

## Current state (2026-08-23)

**Phases 0–5, Phase 6 Part 1, and Phase 6 Part 2 are complete and merged to `main`.** Phase 6
Part 2 — the instant-session handshake, its billing and the expiry cron — was **merged via
PR #22 (`2d792de`)**; see "What Phase 6 Part 2 built" below. It needed **no migration**: Part 1's
`0014` already carried every column and enum value it writes. Earlier that day two pieces of
**infrastructure** Part 1 had left open were closed — a disposable test database, and the presence
sweep actually being scheduled. See "2026-08-23 — test project, tooling, and the cron going live"
below.

- **Phase 0** — foundation scaffold (PR #1, `56cc101`).
- **Phase 1** — data layer: 21 tables + 16 enums, 7 migrations, RLS, `live_tutors` /
  `public_profiles` views, seed + `db:verify-rls` (PR #2, `e9c33c4`).
- **Phase 2** — design system: all 34 §10.2 primitives, `/dev/kitchen-sink`, layouts, and the
  **ink amendment** (single `#34495E` ink surface, dual focus rings, density pass) (PR #3, `f433430`).
- **§18 resolution** — the open product questions settled as docs + seed: credits are money not
  time, flat instant pricing, no cancellation, 25% fee, five credit packages.
- **Phase 3** — auth, onboarding, browse/filter, profiles, editor, approval queue with re-review,
  favourites, storage/avatars. **Merged via PR #4.**
- **Branch protection is ACTIVE on `main`** ✅ — ruleset targeting `main` only, with **`verify`
  required**, PR required before merging, branches must be up to date, force pushes blocked and
  deletions restricted. CI is no longer advisory: the Phase 6 ungraceful-exit E2E now has something
  enforcing it. Changes to `main` go through a PR.
- **Browse restyle** — ink shell + site-wide full-bleed layout (PR #7, `0489add`). Merged.
- **Phase 4 Part 1 — availability slot computation** — the pure, DB-independent `computeSlots()`
  (`src/lib/availability/compute-slots.ts`) + 13 Vitest cases (DST both sides, cross-tz rendering,
  exception overrides, back-to-back bookings, notice/horizon cutoffs), plus the
  `platform-settings-defaults` extraction so seed and tests share one source of truth. The Phase 1
  migration already carried the `availability_rules`/`availability_exceptions` tables, so no new
  migration. SPEC §4.2 pins the slot-grid semantics. **Merged via PR #8 (`4fed575`).**
- **Phase 4 Part 2 — scheduled booking flow (credits only)** — the ledger (`lib/credits/ledger.ts`),
  the booking-creation action with server-side slot re-validation + price re-derivation + atomic
  debit, both sides' booking list/detail pages, and the availability editor. Out of scope:
  cancellation/refunds, PayPal, LessonSpace, instant sessions. **Merged via PR #9 (`03f33a5`).**
- **Phase 5 Part 1 — PayPal orders, capture, webhook, credit packages** — the PayPal client
  (`lib/paypal/client.ts`), credit-package lookup (`lib/credits/packages.ts`), and the three
  money-path endpoints (`POST /api/paypal/orders`, `POST /api/paypal/orders/[orderId]/capture`,
  `POST /api/webhooks/paypal`) built on `lib/paypal/settlement.ts`, which client capture and the
  webhook both call so a race between the two is a no-op via the ledger's `(type, reference_id)`
  unique index. **Merged via PR #10.** SPEC §7.6 and `DECISIONS.md` gained Part 1 sections in the
  same commit.
- **Phase 5 Part 2 — wallet, booking direct-pay, admin payments** — `/dashboard/wallet` (balance,
  buy credits, paginated ledger history), **booking direct-pay** (`POST /api/paypal/orders` now
  takes `{ purpose: 'booking', bookingId }` as well), and `/admin/payments` reconciliation. Plus a
  hardening fix: `PayPalConfigError` now returns **503** at the route-adapter boundary of all three
  PayPal routes instead of escaping as an uncaught 500 (observed in production 2026-08-22).
  **Direct-pay is buy-then-spend in one checkout** — a booking has no USD price of its own, so the
  order mints exactly the credits the booking costs and settlement immediately spends them
  (`purchase` + `booking_debit`, net zero), then flips the booking to `confirmed`. USD comes from
  the one `credit_packages` tier flagged `is_direct_pay_basis`; zero or two flagged **throws**
  rather than mis-charging. Migration `0013` adds `pending_payment` to `bookings_no_overlap`, and a
  `pending_payment` booking older than **20 minutes** stops blocking a slot on read (§4.2), so the
  §12 expire-unpaid cron is tidy-up rather than correctness (still not built — see "Still open"
  below). SPEC §4.2/§4.3/§4.4/§7.3 and §7.6 (now a Part 1+2 note) updated alongside the code;
  `DECISIONS.md` gained a Part 2 section. **Acceptance is sandbox only** — real-card testing is
  deferred to **Phase 10**, along with live webhook registration.
  **Same-PR fix — a captured direct-pay is always honoured.** Settlement originally minted and
  debited before confirming the booking; if the §12 sweep had already expired the
  `pending_payment` hold, the debit and mint both committed, the confirm no-opped, and the student
  was charged with no credits and no booking (the webhook still answered 200, so PayPal never
  retried — a silently lost payment). Fixed by reordering to **mint → confirm → debit**, gating the
  debit on the confirm succeeding: if the slot is gone the debit is skipped and the student keeps
  the minted credits (the only outcome needing no refund, and SPEC has none). New result status
  `booking_unavailable_credits_retained`; the replay guard now reads both ledger legs
  (`PaymentStore.settledLegs`) instead of inferring one from the other, since a committed mint can
  now legitimately stand with no debit beside it. `/admin/payments` flags this state outright.
  **Same-PR follow-up — the retained-credit label is derived at read time, not written.** An initial
  version amended the mint's ledger `description` after the confirm failed, via a narrow `UPDATE`
  (`describeTransaction`). Rejected before merge: §4.4's append-only rule is worth more as an
  absolute than any one row's wording. Replaced with `lib/credits/retained-credits.ts`, a pure
  read-time derivation (`purchase` + payment `purpose = 'booking'` + no matching `booking_debit`)
  consumed by `db/queries/wallet.ts`; `credit_transactions` reverted to INSERT-only, with the
  in-memory ledger fake now freezing rows and throwing on any attempted rewrite so the invariant
  fails loudly in tests if ever reintroduced. **Merged via PR #13 (`003b992`).**
- **Phase 6 Part 1 — presence + migration `0014`.** **Merged via PR #16 (`7b84841`).** See "What
  Phase 6 Part 1 built" below. PROGRESS was brought to true state for it in **PR #17 (`45511bd`)**.
- **Phase 6 Part 2 — session-request handshake + billing.** **Merged via PR #22 (`2d792de`).**
  See "What Phase 6 Part 2 built" below.
- **Test project + tooling + cron scheduling (2026-08-23)** — **PR #18 (`eafe863`)**,
  **PR #19 (`b50b14f`)**, **PR #20 (`4b19bd6`)**. Infrastructure only, no product code. See the
  next section.

## 2026-08-23 — test project, tooling, and the cron going live

Three merged PRs, no application code. Each closed something Phase 6 Part 1 had listed as open.

**Disposable test Supabase project — `nowtutors-test`, ref `uietkphpfqaicbndunwt` (eu-west-3).**
Scaffolded in **PR #18** (`.env.test.example` + gitignore), wired in **PR #19**. Credentials live in
`.env.test` (gitignored). This is the first database on the project that is *not* shared with
production, which is what unblocks seeding for E2E.

- **Targeting is dedicated script variants, not a flag.** Every db script has a `:test` twin —
  `db:migrate:test`, `db:generate:test`, `db:reset:test`, `db:seed:test`, `db:verify-rls:test` —
  that loads `.env.test` instead of `.env.local`. `drizzle-kit` scripts pass
  `--config=drizzle.config.test.ts`; `tsx` scripts require an explicit `--env=dev|test` argument
  supplied by the pnpm script itself, and **throw** if it is missing rather than defaulting. A plain
  `pnpm db:migrate` cannot reach the test project and a `:test` command cannot reach dev.
- **The safety guard compares against a hardcoded literal.** `TEST_PROJECT_REF` in
  `src/db/load-env.ts` holds the ref as a string constant; every `:test` script aborts before doing
  anything if the resolved connection string does not contain it. It deliberately does **not** read
  an env var — see DECISIONS, "a guard you can disable by forgetting to set a variable is not a
  guard". `tests/unit/load-env.test.ts` covers pass, mismatch, and the no-env-var-dependency case.
- **The 0000→0014 chain was proven clean on an empty database for the first time.**
  `pnpm db:migrate:test` applied all 15 migrations from nothing — **25 tables** in `public`, no
  errors (only benign `DROP TRIGGER IF EXISTS … skipping` NOTICEs where later migrations drop
  triggers that a from-scratch run has not created yet). This had never been exercised end to end:
  every prior migration ran incrementally against a database that already had history. It matters
  beyond testing — **the Phase 10 production Supabase swap runs this same chain against an empty
  project**, so this is the first evidence that it works.
- **Seeded, with counts verified by direct DB query rather than the seed script's own log.**
  11 profiles (1 admin, 8 tutors, 2 students), 8 `tutor_profiles`, 26 subjects, 9
  `platform_settings`, 2 favourites — read back out of the database, because a script reporting its
  own success proves only that it reached the end.
- **No cron on the test project, and it needs none** (RUNBOOK). It exists for seeding and E2E, which
  drive presence explicitly; the sweep is tidy-up, not correctness. A second job here would also
  POST at the production URL.

**`scripts/with-ca-certs.mjs` — the `NODE_EXTRA_CA_CERTS` prefix is now automatic (PR #19).**
Every `db:*` and `db:*:test` script runs through a wrapper that sets
`NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem` when the variable is unset and that file exists, and is a
silent no-op otherwise. It never disables TLS verification.

- *Why it cannot live in `src/db/load-env.ts`.* **`NODE_EXTRA_CA_CERTS` is read by Node once at
  process startup, before any application code runs.** Setting `process.env.NODE_EXTRA_CA_CERTS`
  from inside the running script has no effect on that process's already-initialised TLS store — it
  has to be set *before* the `tsx`/`drizzle-kit` process is spawned, which is why the fix is a
  wrapper that spawns a child rather than a line in the env loader.
- *Why it was worth automating.* Forgetting the prefix produces
  `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, which reads like a credentials or network failure. It cost a
  wrong diagnosis in this very session: the first `db:seed:test` run failed that way and was
  initially reported as possibly-missing credentials, when the credentials were fine and Node's CA
  bundle was the problem. `curl` to the same host succeeded throughout.
- The manual `export` survives in RUNBOOK only as the fallback for machines whose system CA bundle
  is at a different path; an already-set value is left untouched.

**`sweep-presence` is scheduled and verified (PR #20).** Supabase **pg_cron + pg_net** on the shared
dev/prod project `mipnoxlhurdbaahmvhhx`, `*/5 * * * *` per SPEC §12.

- **Why pg_cron and not `vercel.json`:** the deploy target is Vercel **Hobby**, whose crons fire at
  most **once a day** — useless for a 5-minute sweep. There is deliberately no `vercel.json`.
- **Verified:** job active in `cron.job` (`jobid` 1, `*/5 * * * *`); a manual `net.http_post`
  invocation returned **200** with `{"ok":true,…}`, confirming the Vault `cron_secret` and Vercel's
  `CRON_SECRET` agree. A 401 would have meant they disagree; a 503 that the deployment has no secret.
- **The job body reads both secrets from `vault.decrypted_secrets` at call time and never inlines
  them** — `cron.job.command` is readable by anyone with database access, so a literal token there
  would expose the only thing guarding a write endpoint.
- Run by hand from the Supabase SQL editor as `postgres`: `create extension` and the Vault writes
  need privileges the migration connection does not have, which is why
  `drizzle/snippets/pg_cron_sweep_presence.sql` is deliberately not a migration.

## What Phase 6 Part 2 built

**The instant-session handshake and its billing — not the room it lands in.**
`/session/[bookingId]`, the Agora client, `/api/agora/token`, end-session, `complete-sessions` and
`tutor_earnings` are Part 3. Where Part 2 navigates into that route it carries a
`TODO(Phase 6 Part 3)`; until Part 3 ships, an accepted request lands on a 404 with the booking
already created, paid for and `in_progress`.

**No migration.** `0014` (Part 1) already shipped every column, enum value, index, RLS policy and
Realtime publication entry this phase writes to.

- **Server actions** — `src/actions/session-requests.ts`: `createSessionRequest`,
  `declineSessionRequest`, `acceptSessionRequest`, plus `getIncomingRequest` (the guarded read the
  tutor's modal enriches from). Each re-checks role and identity server-side and returns a **typed
  result**; nothing throws a string. `createSessionRequest` validates tutor liveness against the
  **`live_tutors` view** (never `is_live`), `accepts_instant`, the duration against
  `session_durations`, the subject against `tutor_subjects`, one-pending-request, and balance ≥
  price — then computes `price_credits` with `sessionPriceCredits()` and **pins** it with
  `duration_minutes` on the row. `expires_at` is `now() + instant_request_ttl_seconds` computed by
  **Postgres**, not by the app server.
- **The accept transaction** — `src/lib/session-requests/accept.ts` (pure, store-agnostic, the same
  shape as `lib/paypal/settlement.ts`) with `src/db/queries/session-requests.ts` as the Drizzle
  adapter. One transaction: lock the request `FOR UPDATE` → refuse-and-expire if past `expires_at` →
  refuse if not `pending` → refuse on a colliding scheduled booking → debit the **pinned** price as a
  single `booking_debit` → insert the `instant` / `in_progress` booking with
  `agora_channel = session_{booking_id}` → mark accepted → auto-decline the tutor's other pending
  requests. The booking id is generated in application code so the channel is known before the INSERT.
- **`failed_payment` survives the rollback.** An insufficient balance rolls the whole accept back,
  then a **separate statement** — conditional on the row still being `pending` — writes
  `failed_payment`. Not `expired`, not `declined` (§4.3).
- **The collision read is a real overlap.** SPEC §7.4 stated only `scheduled_start_at < now() +
  duration_minutes`; `scheduled_end_at > now()` was added, because nothing sets `completed` until
  Part 3 and the literal reading would have blocked every tutor with any past booking, forever. SPEC
  §7.4 amended; see DECISIONS.
- **Realtime, both directions** — `src/hooks/use-session-requests.ts`. Tutor: INSERT/UPDATE where
  `tutor_id = me`, driving an incoming-request modal mounted in the `(tutor)` layout so a request
  finds the tutor on any tutor page. Student: UPDATE on their own row, with a **distinct** message
  for accepted / declined / expired / cancelled / `failed_payment`. Payloads are treated as
  notifications — display data is read back through a guarded action.
- **Student request UI** — `InstantRequestWidget` on `/tutors/[slug]`, replacing Part 1's disabled
  "Request now" button with its own "Start now" card: duration picker **with the price against each
  option**, optional subject, optional note, affordability warning, then a waiting modal with the
  60-second ring. Both rings are **cosmetic** (`src/hooks/use-countdown.ts`) — they tick a deadline
  already in hand and make no network call, so neither is the polling CLAUDE.md forbids.
- **Cron** — `GET`/`POST /api/cron/expire-requests`, bearer-guarded (**503 when `CRON_SECRET` is
  unset**), idempotent, structured counts. The guard itself moved to
  `lib/auth/api-guards.ts#cronAuthFailure` and `sweep-presence` now calls it too. `sweep-presence`'s
  `TODO(Phase 6 Part 2)` is filled in: a swept tutor's pending requests expire immediately and the
  count is returned as `pendingRequestsExpired` (no longer `null`). Snippet:
  `drizzle/snippets/pg_cron_expire_requests.sql`.
- **Tests** — `tests/unit/session-request-accept.test.ts` (16 cases: the four refusal paths, all four
  collision boundaries, the auto-decline, and the price-pinning property in both directions), and the
  request-expiry half of `tests/e2e/presence-ungraceful-exit.spec.ts` is **un-`fixme`d** — it asserts
  the wallet balance is unchanged after an unanswered request and that the dead request stops holding
  the student's one-pending slot, **with neither cron running**.
- **Docs in the same commit** — SPEC §4.3, §7.4, §7.5, §8, §12, §15; DECISIONS gained a Part 2
  section; RUNBOOK gained the expire-requests scheduling step; PROGRESS is this section.

### Phase 6 Part 2 — shipped state

- **Nothing was run against the shared project.** No migration was needed and none was applied; no
  seed, reset or verify script was run against `mipnoxlhurdbaahmvhhx` or against the test project.
- **`pnpm lint`, `pnpm typecheck` and `pnpm test` are green** — 222 tests across 19 files, 16 of
  them new. An earlier run of the same suite failed two **pre-existing** specs
  (`pending-payment-slots`, `slot-validation`) on Vitest's 5-second default timeout under parallel
  load; both pass on their own and reproduce the same way on `main`. Nothing about that is specific
  to this phase, but it does mean a green suite is machine-load-dependent — see "Still open".
- **The E2E has still never had a green run** — the same carry-forward Part 1 left, now with a
  second test in the file. Not run here (the phase prompt excluded it), and it needs the test project
  seeded and Playwright pointed at it.
- **⚠️ `CRON_SECRET` rotation is still open and now actually matters.** RUNBOOK flagged it as
  blocking Part 2 precisely because `expire-requests` sits behind the same secret. The route and the
  pg_cron snippet are written; **do not schedule the job until the secret is rotated.**

## What Phase 6 Part 1 built

**Presence and the schema cleanup only.** Session requests, Realtime, billing and the session room
were Parts 2 and 3, and were absent rather than stubbed — where Part 1 code would otherwise reach
into them it carried a `TODO(Phase 6 Part 2 / Part 3)`. The Part 2 half of those is now filled in
(above); only the `TODO(Phase 6 Part 3)` markers remain.

- **Migration `0014`** (`drizzle/0014_phase6_presence_cleanup.sql`, partly hand-written):
  `session_requests` gains `duration_minutes` + `price_credits` (both `integer NOT NULL`, **no
  default** — server-authored at insert); `session_request_status` gains `failed_payment`;
  `tutor_profiles.instant_rate_credits_per_minute` dropped; the `instant_hold` / `instant_release` /
  `instant_capture` `credit_transaction_type` values removed via the rename-create-alter-drop dance.
  `live_tutors` is dropped and recreated around the column drop (it enumerated that column) —
  identical otherwise, threshold and grants included. Two `DO`-block guards abort the migration with
  a readable message if either table turns out to hold rows the plan assumed absent. **Pre-flight
  counts against the live project were 0 and 0.**
- **Heartbeat** — `POST /api/presence/heartbeat` (`requireApiUser()` first, identity from the
  session, never the body) and `usePresence()` mounted once in `AppShell`, so every authenticated
  area heartbeats and no public page does. Fires on mount, every 30s while visible, pauses on
  `document.hidden`, fires immediately on visible. It never writes `is_live` in either direction —
  **there is no `pagehide` / `sendBeacon` handler**; one was built and removed before merge because
  `pagehide` cannot tell a reload from an exit (see DECISIONS, "Same-PR revision"). Staleness is now
  **two** defences, not three: the `live_tutors` view and the sweep.
- **Go live** — `/tutor` now exists (it 404'd before) and hosts the "Available for instant sessions"
  toggle. The action re-checks role, approval, suspension and verified email server-side, and is
  **unrestricted by the tutor's calendar** — the scheduled collision is an accept-time check, built
  in Part 2.
- **Sweep** — `GET`/`POST /api/cron/sweep-presence`, bearer-guarded (**503 when `CRON_SECRET` is
  unset**, never open), idempotent, returns structured counts. Work set derived from the
  `live_tutors` view, not from any threshold of its own. Scheduled by **Supabase pg_cron + pg_net**
  (`drizzle/snippets/pg_cron_sweep_presence.sql`, RUNBOOK) because Vercel Hobby crons are daily.
  **No `vercel.json`.**
- **Tests** — `tests/unit/presence-staleness.test.ts` (7 cases: the boundary at exactly 2 minutes
  and either side, plus an anti-drift check that parses the interval literal out of `0014`) and
  `tests/e2e/presence-ungraceful-exit.spec.ts` (§15 path 3, presence half; the request-expiry half
  was `test.fixme` here and was written in Part 2). Playwright added as a devDependency — it was
  already in SPEC §2.
- **Docs in the same commit** — SPEC §3.5, §4.1, §4.3, §4.4, §7.4, §7.5, §12, §15; DECISIONS gained
  a Part 1 section; RUNBOOK gained `CRON_SECRET` and the pg_cron setup step.

### Phase 6 Part 1 — shipped state

**Migration `0014` is APPLIED** to the shared Supabase project (`mipnoxlhurdbaahmvhhx`) — 15
migrations recorded in the `drizzle.__drizzle_migrations` journal. Both `DO`-block guards passed
silently (both tables were still empty, as the pre-flight counts predicted). Post-conditions checked
directly against the live database: `session_requests.duration_minutes`/`price_credits` exist,
`NOT NULL`, no default; `session_request_status` has `failed_payment`; `credit_transaction_type` is
down to the 8 non-instant values with no leftover `_old` type; `tutor_profiles.instant_rate_credits_per_minute`
is gone; `live_tutors` is recreated without that column and keeps its 2-minute threshold,
`approval_status` filter, and `anon`/`authenticated` grants; `credit_tx_ref_unique` survived the enum
swap; the Phase 1 `tutor_presence_guard` trigger is untouched. **Production smoke-tested green**
after the migration: `/`, `/?live=1`, `/tutors/tom-turner`, `/login` all `200`.

- **Only the deliberate toggle-off clears `is_live` immediately.** Leaving `/tutor` — by link, tab
  close, or losing the connection — stops the heartbeat and lets the `live_tutors` view age the
  tutor out within the staleness window. This is the shape after the same-PR beacon removal (see
  DECISIONS' "Same-PR revision" and SPEC §7.5, both already correct on `main`); there is no reload
  false-positive because there is no `pagehide` handler at all.

## What Phase 3 built

- **Auth** (`(auth)` group + `/auth/callback`): login, signup, forgot/reset password, Google OAuth.
  One zod schema per form, defined once and **re-parsed server-side** — the server never trusts the
  client's parse. Safe errors: neither login failure nor password reset reveals whether an email
  exists. Google-on-existing-email **links rather than duplicates**; `db:verify-rls` asserts it.
- **Onboarding** (`/onboarding`): role choice (immutable afterwards), student flow (name, avatar,
  timezone, subjects of interest → `student_subjects`), tutor flow (profile + subjects + levels +
  payout → `approval_status = 'pending'`). One transaction, keyed by the guard-authenticated user.
- **Guards** (`src/lib/auth/guards.ts`): wired into the `(student)` / `(tutor)` / `admin` layouts
  **and** re-checked as the first statement of every action and route handler (§5 Layer 2).
- **Browse** (`/`, `/tutors` redirects): filter rail + tutor grid, keyset pagination 24/page,
  anonymous works. **Credit price bands** compared directly against `hourly_rate_credits` — no USD
  conversion. Filter composition is a pure, DB-free function with **32 unit tests** exhaustive over
  every set/unset combination (§3.3). Present-but-invalid `sort` / `price` / `minRating` are
  **rejected loudly**; unknown `subject` / `lang` slugs yield an empty result set (§7.2).
- **`/tutors/[slug]`** — public profile. No ratings or reviews (dropped for v1). Only approved,
  non-suspended tutors are reachable; everything else **404s**.
- **`/tutor/profile`** — the tutor's own editor, reusing the onboarding schema via `omit`/`extend`.
  `approval_status`, `approval_note`, `slug` and `role` are not editable and are rejected
  server-side, with DB triggers as the backstop.
- **Re-review on material change** — an approved tutor's edit goes **live immediately** and
  `approval_status` is untouched; a material edit stamps `profile_changed_at` via trigger. Subjects
  are diffed, so a no-op save cannot flag.
- **`/admin/tutors`** — pending queue + edited-since-review queue, approve / reject (note required) /
  mark reviewed, every transition writing `audit_log`.
- **`/dashboard/favourites`** — the student's saved tutors, same card and derived live treatment.
- **Storage/avatars** — public `avatars` bucket with owner-folder write, `next/image`
  `remotePatterns`, initials fallback. (This was the Bubble "photos not rendering" bug.)
- **Live status derives from the `live_tutors` view, never `is_live`** (§3.1) — on the card and on
  the profile page alike.

## Still open — carry forward

- **§12 expire-unpaid cron not built — deferred to Phase 8.** Not load-bearing today: a
  `pending_payment` booking older than 20 minutes already stops blocking a slot on the **read**
  side (§4.2), and the booking transaction sweeps stale holds its slot collides with on the
  **write** side, so double-selling cannot happen without the cron. The cron is tidy-up (rows that
  sit `pending_payment` forever without a colliding booking to trigger the sweep), not correctness.
- **Refund-reverses-credits admin action NOT built — deferred, needs its own design pass.**
  `/admin/payments` (Phase 5 Part 2) is **read-only**: it shows what happened to a payment but
  cannot unwind one. `PAYMENT.CAPTURE.REFUNDED` already sets `payments.status = 'refunded'` and
  deliberately does **not** claw credits back — §18 item 4 makes reversing credits an **admin**
  action, not something a webhook does silently behind a student who may have spent them. Building
  it needs decisions this phase didn't take: partial refunds, a student whose balance is now below
  the amount to reverse (the `credit_balance >= 0` check would reject the debit), and whether a
  direct-pay refund also cancels the booking it paid for. Design it before coding it.
- **Bump the GitHub action versions to `@v5`** (`actions/checkout`, `actions/setup-node`,
  `pnpm/action-setup` are on `@v4` and warn as deprecated Node-20 runtimes).
- **~~Obsolete pricing remnants~~ — DONE in migration `0014`** (Phase 6 Part 1).
  `tutor_profiles.instant_rate_credits_per_minute` is dropped and the `instant_hold` /
  `instant_release` / `instant_capture` `credit_transaction_type` values are removed.
- **`tests/e2e/presence-ungraceful-exit.spec.ts` still needs a green run — now BOTH tests.** Part 2
  added the request-expiry half beside Part 1's presence half; neither has ever completed a run.
  **The seeding half is now unblocked** — the disposable test project (`uietkphpfqaicbndunwt`) exists
  and `pnpm db:seed:test` populates it with verified counts, so the spec no longer has to choose
  between seeding production and not running at all. What is still missing is the spec itself
  actually passing end to end: it has **never** completed a run. The only local attempt (2026-08-22)
  stopped at sign-in when Supabase Auth was unreachable over this machine's link, before reaching
  any presence assertion — and that machine's Node CA problem, since fixed for db scripts by
  `scripts/with-ca-certs.mjs`, is a plausible contributor worth re-testing first. Point Playwright
  at the test project, get one green run, then consider it as a CI gate. Two real bugs in the spec
  were found and fixed in PR #16 already: it matched the tutor by **display name** ("Tom Turner"),
  which never appears — the seeded `display_name` is `Tom` — so every assertion would have
  **silently passed as false** without ever exercising the intended path; and `signIn()` waited on
  the URL alone, so a rejected login burned the whole 5-minute timeout while reporting only
  "waiting for navigation" instead of the real cause. (`db:verify-rls` remains local-only for the
  same shared-project reason, though it too now has a `:test` variant.)
- **⚠️ `CRON_SECRET` must be ROTATED before the expire-requests job is SCHEDULED — still open.**
  Part 2's code has shipped without it, which is safe: the route is written and bearer-guarded, but
  nothing schedules it until someone runs `drizzle/snippets/pg_cron_expire_requests.sql`. **Do not
  run that snippet before rotating.** The secret is set and
  working across all three stores (Supabase Vault `cron_secret`, Vercel Production, `.env.local`),
  but the value in use was **exposed in plaintext** during setup — printed to a terminal and pasted
  between stores — so it must be treated as compromised. Rotation is: generate a fresh
  `openssl rand -hex 32`, update Vercel (**then redeploy** — Vercel only applies env changes on a
  new deployment), `.env.local`, and the Vault entry via `vault.update_secret`, then re-verify with
  a manual `net.http_post` and confirm **200**. *Why it blocks the schedule:* expire-requests sits
  behind this **same** secret, so a leaked value goes from triggering a harmless presence sweep to
  driving a job that mutates request state. Tracked in RUNBOOK's checklist as its own open item.
- **CI `verify` does not run `pnpm build` — a known gap, and `pnpm build` is where production 404s
  surface.** The required `verify` check runs lint, typecheck and tests only, so a change that
  compiles under `tsc` but breaks the Next build passes CI and fails on deploy. The fix is already
  written and sitting in **PR #6 (`fix/ci-build-step`), which is still OPEN** and unrelated to
  everything this session touched — it predates it (2026-08-21). Either merge it or close it
  deliberately; leaving it open is the worst of both, because the gap stays and the fix looks handled.
- **`tests/unit/pending-payment-slots.test.ts` and `tests/unit/slot-validation.test.ts` are slow and
  can time out on Vitest's 5-second default when the whole suite runs in one process under load.**
  Both pass on their own; both failed this way during the Phase 6 Part 2 run and reproduce the same
  way on `main`. Unrelated to any phase. Worth a `testTimeout` bump on the two files (or globally)
  — as it stands, a green suite is machine-load-dependent, which is exactly the kind of flake that
  teaches people to re-run rather than read.
- **Approval and rejection emails are `TODO(Phase 10)` hooks — nothing is sent.** The hooks are
  marked in `src/actions/admin-tutors.ts`; Resend wires in Phase 10.
- **Tutor profile diff view not built.** The admin "Edited since review" tab flags the profile and
  timestamps it (changed at / last reviewed) but does not show *what* changed — that needs a history
  table or a stored snapshot, which is a design decision rather than a cheap add. Deferred.
- **User Role option-set values** — confirm against Bubble (we assume student/tutor/admin).
- **`credit_transaction_type` value check** — the enum now reads `purchase`, `booking_debit`,
  `booking_refund`, `session_earning`, `withdrawal_hold`, `withdrawal_paid`, `withdrawal_reversed`,
  `admin_adjustment` after `0014`. Still worth confirming those eight against the live build at cutover.
- **Bubble→rebuild pricing model change needs a Phase 10 data migration and cutover comms.** Bubble
  prices every session at duration ÷ 3 credits — one flat platform rate for all tutors. The rebuild
  prices off each tutor's `hourly_rate_credits`. At cutover, every existing tutor needs a rate set and
  every existing student sees prices change from the flat rate they're used to. See DECISIONS.md
  Phase 6.

## Notes / non-bugs (do NOT re-investigate)

- **Bubble drives session length from a client-side countdown** (status = `Completed` when
  `credits_remaining <= 0`, then `endSession()`), decrementing one credit per tick on a **180-second**
  interval — the withdrawn "1 credit = 3 minutes" rule working exactly as designed, not a units bug.
  (**Correction, Phase 6 pre-build, 2026-08-22:** an earlier pass had this at 180 *milliseconds*,
  which would read as a bug ending a 60-minute session in ~4 seconds; live-app inspection confirmed
  it's 180 seconds. See `DECISIONS.md` Phase 6.) Either way, the rebuild computes elapsed time
  **server-side from `started_at`** and does not port the client countdown.
- **Theo's blank avatar circle** is expected: the seed uploads a **1×1 transparent PNG** for
  `theo-chen` purely to prove the Storage → `next/image` pipeline. Not a rendering bug.
- All other tutors show **initials** (no uploaded avatar) — also expected.
- Seeded tutors read **"Offline"** until someone actually goes live. Presence exists as of Phase 6
  Part 1, but the seed does not set `is_live` — status derives from the `live_tutors` view, so a
  tutor shows live only after toggling on `/tutor`, and only while their heartbeat stays fresh.
- **`db:verify-rls` mutates seeded rows** (it makes a material edit to `tutor1` to prove the
  re-review flag survives). Re-run `pnpm db:seed` afterwards to restore a tidy dev dataset.

## Env / toolchain gotchas

- **`NODE_EXTRA_CA_CERTS` is now automatic for `db:*` scripts** (Node's bundled CA rejects the
  Supabase chain; curl/system CA is fine). `scripts/with-ca-certs.mjs` sets it when unset — no
  prefix needed on any `db:*` / `db:*:test` command. **Other commands are not wrapped**: a
  `pnpm build` / `pnpm dev` / bare `tsx` run that hits the Supabase chain still needs
  `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem` exported manually. Symptom when it's missing:
  `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, which looks like a credentials or network failure and is
  neither.
- **Migrations + admin scripts run over the Supabase session pooler** (port 5432); the legacy
  `db.<ref>.supabase.co` direct host does not resolve. Runtime Drizzle uses `{ prepare: false }`.
- **zsh quotes special chars.** Quote args containing `#`, `(`, `)`, or globs — e.g. the
  `src/app/(public)/…` route-group paths and `grep --include='*.ts'`.
- **`pnpm db:reset` is destructive** (drops `public`) — **dev only**, and "dev" is the project that
  also serves production (below). `.env.local` holds those creds (ref `mipnoxlhurdbaahmvhhx`,
  eu-west-3). Use **`pnpm db:reset:test`** for anything disposable: it targets the test project only
  and is guarded by the hardcoded ref.
- **Production still runs on the DEV Supabase project** (`mipnoxlhurdbaahmvhhx`). There is no
  separate prod database — every deploy reads/writes the same project the local seed and
  `db:verify-rls` run against. Provisioning a real prod project is unstarted; until then, treat
  anything in that project as live data, not disposable fixtures. **The test project
  (`uietkphpfqaicbndunwt`) does not change this** — it is for seeding and E2E, not a prod stand-in,
  and nothing deploys against it.
- Seed login password for all seeded users: `Password123!` (`student1@nowtutors.dev`,
  `tutor1@nowtutors.dev`, `admin@nowtutors.dev`).
- **Run the local gates before pushing**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build &&
  pnpm db:verify-rls`. CI (`verify`) is now a required check on `main`, so a red gate blocks the
  merge rather than merely warning — but `db:verify-rls` needs dev credentials and runs locally only.
