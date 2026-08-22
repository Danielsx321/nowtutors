# NowTutors — Progress (resume-from-cold)

_Read this first. Authoritative spec: `docs/SPEC.md`. Decisions log: `docs/DECISIONS.md`._

## Current state (2026-08-22)

**Phases 0–5 and Phase 6 Part 1 are complete and merged to `main`.**

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
  Phase 6 Part 1 built" below.

## What Phase 6 Part 1 built

**Presence and the schema cleanup only.** Session requests, Realtime, billing and the session room
are Parts 2 and 3, and are absent rather than stubbed — where Part 1 code would otherwise reach into
them it carries a `TODO(Phase 6 Part 2 / Part 3)`.

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
  **unrestricted by the tutor's calendar** — the scheduled collision is a Part 2 accept-time check.
- **Sweep** — `GET`/`POST /api/cron/sweep-presence`, bearer-guarded (**503 when `CRON_SECRET` is
  unset**, never open), idempotent, returns structured counts. Work set derived from the
  `live_tutors` view, not from any threshold of its own. Scheduled by **Supabase pg_cron + pg_net**
  (`drizzle/snippets/pg_cron_sweep_presence.sql`, RUNBOOK) because Vercel Hobby crons are daily.
  **No `vercel.json`.**
- **Tests** — `tests/unit/presence-staleness.test.ts` (7 cases: the boundary at exactly 2 minutes
  and either side, plus an anti-drift check that parses the interval literal out of `0014`) and
  `tests/e2e/presence-ungraceful-exit.spec.ts` (§15 path 3, presence half; the request-expiry half
  is `test.fixme` for Part 2). Playwright added as a devDependency — it was already in SPEC §2.
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
- **Phase 6 Part 1's E2E (`tests/e2e/presence-ungraceful-exit.spec.ts`) needs a disposable seeded
  database before it can be trusted as a CI gate.** `pnpm db:seed` writes to the project that also
  serves production, so the spec cannot be run green locally as things stand — the only local
  attempt (2026-08-22) stopped at sign-in when Supabase Auth was unreachable over this machine's
  link, before reaching any presence assertion. Two real bugs in the spec were found and fixed in
  PR #16 anyway: it matched the tutor by **display name** ("Tom Turner"), which never appears — the
  seeded `display_name` is `Tom` — so every assertion would have **silently passed as false**
  without ever exercising the intended path; and `signIn()` waited on the URL alone, so a rejected
  login burned the whole 5-minute timeout before reporting only "waiting for navigation" instead of
  the real cause. This is now the **second** item blocked on the shared-project problem (the first
  is `db:verify-rls`, which already runs locally only for the same reason).
- **`CRON_SECRET` is unset in Vercel, so `/api/cron/sweep-presence` fail-closes with `503`.** Not
  urgent — the sweep is tidy-up, not correctness; the `live_tutors` view is what protects students
  at read time (§3.1) whether or not the sweep ever runs. Two steps close it: set `CRON_SECRET` in
  **both** Vercel and local `.env.local` (two independent stores, per the PayPal precedent in
  RUNBOOK), then run `drizzle/snippets/pg_cron_sweep_presence.sql` once with the **same** value in
  the `cron_secret` Vault entry.
- **`tests/unit/pending-payment-slots.test.ts` is slow (~10s) and can time out on the 5-second
  default when the whole suite runs in one process under load.** Unrelated to Phase 6. Worth a
  `testTimeout` bump on that file.
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

- **Export `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem`** for any pnpm/tsx/build/db command (Node's
  bundled CA rejects the Supabase chain; curl/system CA is fine). Every gate/seed/dev run needs it.
- **Migrations + admin scripts run over the Supabase session pooler** (port 5432); the legacy
  `db.<ref>.supabase.co` direct host does not resolve. Runtime Drizzle uses `{ prepare: false }`.
- **zsh quotes special chars.** Quote args containing `#`, `(`, `)`, or globs — e.g. the
  `src/app/(public)/…` route-group paths and `grep --include='*.ts'`.
- **`pnpm db:reset` is destructive** (drops `public`) — **dev only**. `.env.local` holds dev creds
  (ref `mipnoxlhurdbaahmvhhx`, eu-west-3); no prod project yet.
- **Production still runs on the DEV Supabase project** (`mipnoxlhurdbaahmvhhx`). There is no
  separate prod database — every deploy reads/writes the same project the local seed and
  `db:verify-rls` run against. Provisioning a real prod project is unstarted; until then, treat
  anything in that project as live data, not disposable fixtures.
- Seed login password for all seeded users: `Password123!` (`student1@nowtutors.dev`,
  `tutor1@nowtutors.dev`, `admin@nowtutors.dev`).
- **Run the local gates before pushing**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build &&
  pnpm db:verify-rls`. CI (`verify`) is now a required check on `main`, so a red gate blocks the
  merge rather than merely warning — but `db:verify-rls` needs dev credentials and runs locally only.
