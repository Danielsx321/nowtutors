# NowTutors — Technical Specification (Coded Rebuild)

**Version:** 1.0
**Author:** Daniels
**Date:** 19 August 2026
**Purpose:** Single source of truth for a from-scratch coded rebuild of NowTutors, replacing the Bubble implementation at feature parity. Written to be consumed by Claude Code phase by phase.

---

## 0. How to use this document

This spec is the contract. Claude Code should never invent structure that contradicts it.

**Setup:**

1. Create the repo, then save this file as `docs/SPEC.md`.
2. Create a `CLAUDE.md` at the repo root containing the *Working agreement* below plus a pointer to `docs/SPEC.md`.
3. Work through Section 16 (Build order) **one phase at a time**. Do not let Claude Code skip ahead. Commit at the end of every phase, and verify the phase's acceptance criteria before starting the next.

**Working agreement (paste into `CLAUDE.md`):**

```
Read docs/SPEC.md before doing anything. It is authoritative.

Rules:
- Never change the database schema without updating docs/SPEC.md Section 4 in the same commit.
- Never add a dependency not listed in Section 2 without asking first.
- All money and credit mutations go through the ledger functions in Section 8. Never UPDATE a balance directly.
- All Agora tokens are issued through our own /api/agora/token route, never client-side, never by calling the Render service directly from the browser.
- Server-side authorization on every route handler. Do not rely on the client hiding a button.
- Write the migration, then the query layer, then the UI. In that order.
- If something in the spec is ambiguous, stop and ask. Do not guess and proceed.
- One phase at a time. Do not start the next phase until told.
```

**Before Phase 1, do this manual task (30 minutes, saves days):** open the Bubble editor, go to Data → Data types, and screenshot/export every data type with its full field list. Section 4 below is reconstructed from what the app does, not from the editor. Diff the two and reconcile before writing a single migration. Field-level parity is much cheaper to get right now than after data exists.

---

## 1. Product summary

NowTutors is a two-sided live tutoring marketplace. Students find tutors and take lessons; tutors set availability, teach, and get paid.

**Three session modes:**

| Mode | Booked how | Video by | Purpose |
|---|---|---|---|
| **Scheduled session** | Student books a future slot from tutor availability | LessonSpace (whiteboard classroom) | Planned 1:1 lessons |
| **Instant session** | Student requests a tutor who is online right now; tutor accepts within 60s | Agora (1:1 video) | On-demand help |
| **Live broadcast** | Tutor goes live; any number of viewers watch | Agora (host/audience) | One-to-many teaching, discovery |

**Money flow:** students buy credits with PayPal, or pay PayPal directly for a single booking. Credits debit on booking. Tutor earnings accrue per completed session, become withdrawable after a hold period, and tutors request withdrawal. An admin pays out manually from the admin panel and marks the request paid.

**Roles:** `student`, `tutor`, `admin`. One account has exactly one role (matching current behaviour).

---

## 2. Stack

Locked unless there is a specific reason to deviate.

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 15+, App Router, TypeScript strict** | Server Components by default; Client Components only where interactivity demands it |
| Hosting | **Vercel** | Cron jobs, edge config, preview deployments |
| Database | **Postgres via Supabase** | Managed, has Realtime and Row Level Security |
| ORM / migrations | **Drizzle ORM + drizzle-kit** | Migrations committed to the repo, never applied by hand in the dashboard |
| Auth | **Supabase Auth** | Email/password + Google OAuth — parity with current app, no custom crypto |
| Styling | **Tailwind CSS v4** + CSS custom properties for brand tokens | See Section 13 |
| UI primitives | **shadcn/ui** (Radix under the hood) | Copy-in components, restyled to the NowTutors palette |
| Forms | **react-hook-form + zod** | One zod schema per form, reused server-side for validation |
| Realtime | **Supabase Realtime** (Postgres changes + presence) | Replaces all `Do every 10 seconds` polling |
| Video (instant + broadcast) | **Agora Web SDK (`agora-rtc-sdk-ng`)** | Existing Render token service reused |
| Video (scheduled) | **LessonSpace API** | Server-side room creation, per-user join links |
| Payments | **PayPal Orders v2 REST API + PayPal JS SDK** | Direct, no plugin wrapper |
| Transactional email | **Resend** + **react-email** | Booking confirmations, reminders, withdrawal notices |
| File storage | **Supabase Storage** | Avatars, intro videos, message attachments |
| Error tracking | **Sentry** | Client + server |
| Testing | **Vitest** (unit), **Playwright** (E2E critical paths) | See Section 15 |
| Timezones | **date-fns + date-fns-tz** | Store UTC, render in the viewer's timezone |

**Not in the stack, deliberately:** Stripe (no cross-border payout support for tutors' region — already ruled out), Prisma (Drizzle is lighter and the SQL stays legible), any headless CMS, any state management library beyond React state and server components.

### 2.1 Environment variables

```
# App
NEXT_PUBLIC_APP_URL=
NODE_ENV=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # server only, never imported into a Client Component
DATABASE_URL=                      # pooled, for Drizzle
DIRECT_URL=                        # direct, for migrations

# Agora
NEXT_PUBLIC_AGORA_APP_ID=cd013255335c46d2bd94ad7a8e354ecd
AGORA_TOKEN_SERVICE_URL=https://agora-token-service-3irp.onrender.com

# LessonSpace
LESSONSPACE_API_KEY=
LESSONSPACE_ORG_ID=

# PayPal
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
PAYPAL_ENV=sandbox|live
NEXT_PUBLIC_PAYPAL_CLIENT_ID=

# Email
RESEND_API_KEY=
EMAIL_FROM="NowTutors <noreply@nowtutors.com>"

# Ops
CRON_SECRET=
SENTRY_DSN=
```

`.env.example` is committed with every key present and every value blank.

---

## 3. Architectural decisions worth stating

These are the places where the coded rebuild should deliberately *not* copy the Bubble approach. Each one corresponds to a known problem.

**3.1 Live status is derived, not stored-and-trusted.**
The stale-LIVE-tutor bug exists because `Is-Live` was a stored flag that ungraceful exits never cleared. In the rebuild there are two fields — `is_live boolean` and `last_seen_at timestamptz` — and **no student-facing query ever reads `is_live` alone.** Every read goes through a database view:

```sql
CREATE VIEW live_tutors AS
SELECT * FROM tutor_profiles
WHERE is_live = true
  AND last_seen_at > now() - interval '2 minutes';
```

A cron sweep also exists (Section 12) to tidy the underlying rows, but correctness does not depend on it running. If the sweep fails for an hour, students still see the right thing. This is the single most important design decision in the document.

> **Confirmed against the live app (Bubble live-app investigation, 2026-08-24).** Bubble has the
> exact `is_live` / `online_status` divergence this section forbids. Loading the tutor dashboard
> sets `online_status` only; a stale-tutor sweep clears both after 10 minutes of inactivity; no
> confirmed write of `is_live = true` exists anywhere in the app. Tutor cards read
> `online_status`, the dashboard indicator reads `is_live`, and the two can disagree — which is
> exactly the failure mode this rule exists to make structurally impossible in the rebuild. This
> confirms the existing rule; it does not change it. See DECISIONS, Decision 5.

**3.2 `is_live` is a real boolean.** No `"yes"`/`"no"` text. The type system enforces it.

**3.3 Empty search constraints fail loudly.** Bubble's `ignore_empty_constraints` silently dropped filters. In SQL, a filter with a null parameter is a bug that surfaces immediately. Filters are built explicitly: a helper composes the `WHERE` clause from only the filters the user actually set, and every composed condition is unit-tested.

**3.4 Instant session requests are rows, not flags, and are pushed, not polled.**
`has_live_request` on the user record becomes a `session_requests` table. The tutor's browser holds one Supabase Realtime subscription filtered to their own pending requests. No 10-second polling loop, no duplicated workflows in a header and a page, no two-level-deep condition that won't fire.

**3.5 Scheduled work runs on one external scheduler, never on a self-scheduling workflow.** Versioned, idempotent, and impossible to accidentally start twice — which removes the whole class of "self-scheduling workflow started in two environments" failure. **Amended in Phase 6 Part 1:** the scheduler is **Supabase `pg_cron` + `pg_net`**, not Vercel Cron. The deploy target is Vercel **Hobby**, whose crons fire at most **once a day** — useless for a 5-minute presence sweep. There is deliberately no `vercel.json`; see §12.

**3.6 Credits are an append-only ledger.** Balance is never edited in place. Every change is a row. This makes the reconciliation problems that plagued the current build tractable: any balance can be explained by replaying its transactions.

**3.7 Agora tokens are authorized.** The Render token service is reused as-is, but the browser never calls it. `/api/agora/token` checks that the signed-in user is actually a participant in that booking (or that the broadcast is public) before requesting a token, and issues `subscriber` rather than `publisher` where appropriate. Currently any client that knows a channel name can publish to it.

---

## 4. Data model

Postgres. All tables have `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`, and `updated_at timestamptz not null default now()` unless stated. All timestamps are `timestamptz` stored in UTC. Money in USD is `numeric(10,2)`; credits are `integer`.

> Reconcile against the Bubble editor export before implementing. Fields marked **[verify]** are inferred from behaviour rather than confirmed.
>
> **Phase 1 amendments (reconciled with the Bubble export; see `docs/DECISIONS.md`):**
> `profiles.phone` dropped; `profiles.notification_preferences jsonb` added; `profiles.role`
> nullable. `tutor_profiles.paypal_email` moved to a new `tutor_payout_details` table;
> `tutor_profiles.instant_rate_credits_per_minute` made nullable (and unused — instant price uses
> the same formula as scheduled: `hourly_rate_credits × duration_minutes / 60`, rounded up, §7.4).
> `bookings.reminder_24h_sent_at` / `reminder_1h_sent_at`
> added. `credit_transactions.type` gains `instant_hold` / `instant_release` / `instant_capture`
> (now **unused** — §18 made instant billing a single flat `booking_debit`; enum values retained).
> The `reviews` table is deferred (no Review type in the current build). `broadcasts` /
> `broadcast_viewers` are NET-NEW, not parity. `platform_settings.presence_stale_seconds`
> removed (threshold baked into the `live_tutors` view); `credit_packages` added
> (`max_instant_minutes` / `min_instant_credits` later removed by §18). Booking overlap is a scheduled-only GiST
> exclusion (`bookings_no_overlap`).

### 4.1 Identity

**`profiles`** — one row per auth user, `id` references `auth.users(id)` on delete cascade.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | = auth.users.id |
| role | enum `student` \| `tutor` \| `admin` **nullable** | null until onboarding sets it; immutable after except by admin (Decision #5) |
| email | text not null | mirrored from auth for querying |
| full_name | text |  |
| display_name | text |  |
| avatar_url | text | Supabase Storage path |
| country | text (ISO 3166-1 alpha-2) |  |
| timezone | text (IANA, e.g. `Asia/Shanghai`) | default from browser at signup |
| bio | text |  |
| onboarding_completed_at | timestamptz | null until onboarding done |
| is_suspended | boolean default false | admin action |
| last_seen_at | timestamptz | general presence, all roles |
| notification_preferences | jsonb not null default `'{}'` | opt-out model; missing key = on (§11) |

**`tutor_profiles`** — one row per tutor, created at tutor onboarding.

| Column | Type | Notes |
|---|---|---|
| user_id | uuid unique FK → profiles.id |  |
| slug | text unique | for `/tutors/[slug]` |
| headline | text | one line, shown on cards |
| about | text | long form |
| intro_video_url | text | optional |
| education | text |  |
| years_experience | integer |  |
| languages | text[] |  |
| hourly_rate_credits | integer not null | price for a 60-minute scheduled session |
| accepts_instant | boolean default true |  |
| approval_status | enum `pending` \| `approved` \| `rejected` | default `pending` |
| approval_note | text | admin-visible reason |
| approved_at | timestamptz |  |
| is_live | boolean default false | broadcasting or available for instant |
| live_mode | enum `instant` \| `broadcast` \| null | what "live" currently means |
| last_seen_at | timestamptz | heartbeat target |
| rating_avg | numeric(3,2) default 0 | denormalized, recomputed on new review |
| rating_count | integer default 0 |  |
| completed_sessions | integer default 0 | denormalized |
| total_minutes_taught | integer default 0 |  |
| profile_changed_at | timestamptz null | stamped when an **approved** tutor changes a MATERIAL field (§7.1 re-review) |
| profile_reviewed_at | timestamptz null | stamped by an admin's "Mark reviewed" action |

Indexes: `(is_live, last_seen_at)`, `(approval_status)`, `(rating_avg desc)`, `(hourly_rate_credits)`, GIN on `languages`.

> **`instant_rate_credits_per_minute` DROPPED (migration `0014`, Phase 6 Part 1).** There is no
> per-minute instant rate: instant and scheduled price off the same `hourly_rate_credits` formula
> (§7.4), and no such rate exists in the live Bubble app. The `live_tutors` view enumerated this
> column, so `0014` drops and recreates the view around the column drop.

> **Re-review on material change (added Phase 3, `drizzle/0011`).** When an already-approved tutor edits their profile the edit goes **live immediately** — they stay visible and bookable, and `approval_status` does **not** change. If the edit touches a **material** field the profile is flagged for admin re-review instead. **Material:** `headline`, `about`, subjects (`tutor_subjects`), `hourly_rate_credits`, `intro_video_url`. **Non-material:** avatar, `languages`, `education`, `years_experience`.
>
> **Needs re-review** = `profile_changed_at is not null AND (profile_reviewed_at is null OR profile_reviewed_at < profile_changed_at)`.
>
> This is deliberately **not** a new `approval_status` value: approval state and change state are orthogonal, and conflating them would make an approved-but-edited tutor indistinguishable from an unapproved one — which would drop them out of search and break earnings/withdrawal assumptions in Phase 8. Both columns are **trigger/admin managed**: `tutor_profile_change_flag` (plus `tutor_subjects_change_flag` for the child table) stamps `profile_changed_at` only when a material value actually *changed*, so a no-op save cannot flag and a tutor cannot clear the flag to dodge review; `profile_reviewed_at` is folded into the admin-only `tutor_approval_guard`.

**`tutor_payout_details`** — sensitive payout destination, split off `tutor_profiles` (Decision A) so "anyone reads approved tutor_profiles" cannot leak it. Owner + admin RLS only.

`tutor_id uuid unique FK → profiles.id, payout_method enum('paypal') default 'paypal', paypal_email text`

**`subjects`** — `id, name, slug unique, icon, sort_order, is_active`. Seeded (Section 18 open question: the canonical list).

**`tutor_subjects`** — `tutor_id, subject_id, level enum('beginner','intermediate','advanced','all')`. PK `(tutor_id, subject_id)`.

**`student_subjects`** — a student's **subjects of interest**, collected at onboarding (§7.1). `student_id uuid FK → profiles.id, subject_id uuid FK → subjects.id`, PK `(student_id, subject_id)`, index on `(student_id)`. **No `level`** (levels are a tutor concept). References `subjects.id` by FK — deliberately not a slug array — so an admin subject rename can never orphan a stored interest (see DECISIONS). RLS: the owning student reads and writes only their own rows; **no public read** (unlike `tutor_subjects`). Migration `drizzle/0009_student_subjects.sql`.

### 4.2 Availability

**`availability_rules`** — recurring weekly availability.

`tutor_id, weekday smallint (0=Sunday), start_time time, end_time time, is_active boolean`

Stored in the **tutor's** timezone (`tutor_profiles.user_id → profiles.timezone`); converted to UTC at query time. Constraint: `end_time > start_time`.

**`availability_exceptions`** — one-off overrides.

`tutor_id, date date, is_available boolean, start_time time null, end_time time null`

`is_available = false` with null times blocks the whole day.

Bookable slots are computed, not stored: expand rules for the requested date range, subtract exceptions, subtract existing bookings, subtract slots starting less than `min_booking_notice_minutes` from now.

**Slot computation semantics (Phase 4 Part 1 — pinned in `docs/DECISIONS.md`).** The pure function is `src/lib/availability/compute-slots.ts`; it takes plain data (rules, exceptions, bookings, a date range, tutor + viewer time zones, `now`, and the two cutoffs) and returns bookable slots as UTC instants. No DB access, so it is unit-testable per §15.

- **Slot = a discrete candidate start on a fixed grid.** A slot is bookable iff `[start, start + slot_duration)` fits entirely inside one of that tutor-local day's availability windows. Candidate starts step from each window's own start by `slot_step` (defaults: duration 60 min, step 30 min); the booking flow (Part 2) calls the function once per offered duration (30/60/90/120). Duration and step are function parameters, not columns.
- **Date range is read in the *viewer's* time zone** (the student browses their own calendar, §7.3); rules/exceptions are expanded per *tutor-local* calendar date and converted to UTC, so a DST transition in the tutor's zone moves the UTC instant of a fixed wall-clock slot without moving the wall clock the tutor set.
- **Exceptions:** `is_available = false` blocks the whole tutor-local day (any times ignored) and overrides all rules; `is_available = true` **with both times set** is a partial-day override window that *replaces* that day's rules (multiple such rows union); `is_available = true` with null times is a no-op (rules still apply).
- **Existing-booking overlap is half-open** `[start, end)`: back-to-back bookings do not self-conflict, and a slot that begins exactly when a booking ends is bookable (no off-by-one).
- **A `pending_payment` booking blocks for 20 minutes only, measured from its own `created_at`** (Phase 5 Part 2). A direct-pay checkout genuinely holds its slot while the buyer is in PayPal (§7.3 step 5), but past that window it is an abandoned checkout and `computeSlots` stops treating it as occupying — **on read**, without waiting for anything to rewrite the row. The §12 expire-unpaid cron is therefore **tidy-up, not correctness**: exactly the relationship `live_tutors` has with sweep-presence (§3.1), where the view derives liveness from a timestamp and the sweep merely tidies the flag. The window is `PENDING_PAYMENT_HOLD_MINUTES` (a parameter, defaulting to 20). A row with no status blocks unconditionally, and a `pending_payment` row with no `created_at` fails safe and blocks — the alternative is double-selling a slot someone may be paying for.
- **Cutoffs, both inclusive:** a slot starting exactly `min_booking_notice_minutes` from `now` is bookable; the horizon is a rolling `now + max_booking_days_ahead × 24h`, and a slot starting exactly at the horizon is bookable.
- Time-zone conversion uses the runtime IANA/ICU database via `Intl` (DST-correct, no added dependency). Nonexistent spring-forward wall times resolve forward; ambiguous fall-back times resolve to the first (pre-transition) occurrence.

### 4.3 Bookings

**`bookings`**

| Column | Type | Notes |
|---|---|---|
| student_id | uuid FK → profiles.id |  |
| tutor_id | uuid FK → profiles.id |  |
| subject_id | uuid FK → subjects.id | nullable for instant |
| type | enum `scheduled` \| `instant` |  |
| status | enum — see below |  |
| scheduled_start_at | timestamptz | null for instant |
| scheduled_end_at | timestamptz | null for instant |
| duration_minutes | integer | planned duration |
| price_credits | integer | 0 for instant until billed |
| price_usd | numeric(10,2) | null when paid in credits |
| payment_method | enum `credits` \| `paypal` |  |
| payment_id | uuid FK → payments.id | null when paid in credits |
| lessonspace_room_id | text | scheduled only, created lazily |
| agora_channel | text | instant only, `session_{booking_id}` |
| student_joined_at | timestamptz |  |
| tutor_joined_at | timestamptz |  |
| started_at | timestamptz | first moment both were present |
| ended_at | timestamptz |  |
| billed_minutes | integer | **instant: the booked duration** (see below); scheduled: planned |
| cancelled_by | uuid FK → profiles.id |  |
| cancellation_reason | text |  |
| student_notes | text | "what I want help with" |
| reminder_24h_sent_at | timestamptz | idempotency stamp for the 24h reminder cron (Decision #2) |
| reminder_1h_sent_at | timestamptz | idempotency stamp for the 1h reminder cron |

`status` enum: `pending_payment`, `confirmed`, `in_progress`, `completed`, `cancelled_by_student`, `cancelled_by_tutor`, `no_show_student`, `no_show_tutor`, `expired`.

**`billed_minutes` for an instant booking is `duration_minutes`, not elapsed time
(corrected in Phase 6 Part 3B).** This line previously read "instant: actual",
which is a survivor of the metering/hold model migration `0014` dismantled — it
predates §7.4's flat upfront billing and contradicts it. Under flat billing there
is no meter, no proration and no refund, so the minutes *billed* are the minutes
*booked*, in every case: a student who leaves after five minutes of a paid
sixty-minute session was billed sixty. Writing elapsed time into a column named
"billed" would record a number nothing charges by, and would lose the only number
this column can carry that is not recoverable elsewhere — actual elapsed time is
always `ended_at - started_at`. This resolved a genuine **SPEC-vs-SPEC conflict**
(§4.3's old wording against §7.4's billing rule) rather than an implementation
preference, and it is written down here so it is not re-opened from the old
wording. See DECISIONS, Phase 6 Part 3B.

**`ended_at` is capped at the hard-stop deadline.** When a session ends because
its booked duration ran out, `ended_at` is `started_at + duration_minutes` — not
the moment some actor noticed. An early exit records the actual moment. §7.11
derives `tutor_earnings.available_at` from `ended_at`, so this is what keeps a
late sweep from moving a tutor's withdrawal date. See DECISIONS, Phase 6 Part 3B,
"`ended_at` is capped at the deadline".

Indexes: `(student_id, status)`, `(tutor_id, scheduled_start_at)`, `(status, scheduled_start_at)` for cron. Overlap prevention is a scheduled-only GiST exclusion constraint `bookings_no_overlap` (`tutor_id =`, `tstzrange(scheduled_start_at, scheduled_end_at) &&`) `where type='scheduled' and status in ('pending_payment','confirmed','in_progress')` — requires `btree_gist` (Decision #6).

`pending_payment` was added to that predicate in Phase 5 Part 2 (migration `0013`), so a direct-pay booking really does hold its slot (§7.3 step 5) and two students cannot both reach checkout for it. The **20-minute release** (§4.2) is deliberately *not* in the predicate: an exclusion predicate must be `IMMUTABLE` and so cannot reference `now()`. The release therefore lives in `computeSlots` on the read side, and in an expiry sweep the booking transaction runs before inserting on the write side — which is what keeps the two sides agreeing without the cron being load-bearing.

**`session_requests`** — the instant-session handshake. Replaces `has_live_request`.

| Column | Type | Notes |
|---|---|---|
| student_id | uuid FK |  |
| tutor_id | uuid FK |  |
| subject_id | uuid FK | nullable |
| message | text | optional note from student |
| duration_minutes | integer not null | student-chosen, from `session_durations` (Phase 6 pre-build) |
| price_credits | integer not null | server-computed via `sessionPriceCredits()` at insert; pinned so accept charges exactly what was quoted (Phase 6 pre-build) |
| status | enum `pending` \| `accepted` \| `declined` \| `expired` \| `cancelled` \| `failed_payment` | `failed_payment` added Phase 6 pre-build — see below |
| booking_id | uuid FK → bookings.id | set on accept |
| expires_at | timestamptz not null | `now() + 60 seconds` |
| responded_at | timestamptz |  |

Index `(tutor_id, status)`, `(status, expires_at)`. Realtime enabled on this table.

**`duration_minutes` / `price_credits` (shipped in migration `0014`, Phase 6 Part 1).** The student
picks a duration when sending an instant request; the server computes the price at insert via
`sessionPriceCredits()` and pins both columns on the request row. Both are integer, `not null`, and
**server-authored** — never taken from the client — so the accept transaction charges exactly what
the student was quoted, even if `hourly_rate_credits` or settings change between request and accept.
`0014` ships **no default** on either column: the table was empty, and a default would quietly cover
for a caller that forgot to compute them.

**`failed_payment` status (shipped in migration `0014`, Phase 6 Part 1; written by Part 2).** The
credit debit runs inside the tutor's accept transaction. If the student's balance moved between
request and accept (e.g. spent elsewhere) such that the debit would fail, the whole accept rolls back
and the request goes terminal as `failed_payment` — not `expired`, not `declined` — so an operator
reading this table can tell a refusal from a payment failure. **The status write is therefore a
separate statement, issued after the rollback** and conditional on the row still being `pending`: a
write inside the transaction would be rolled back with everything else, leaving the request looking
untouched (§7.4).

**`reviews`** — **DEFERRED (not built in Phase 1).** No Review type exists in the current Bubble build (Decision C). Ratings are denormalized scalars on `tutor_profiles` (`rating_avg`, `rating_count`) with nothing writing them yet. If reviews become a feature: `booking_id uuid unique FK, student_id, tutor_id, rating smallint check (rating between 1 and 5), comment text, is_published boolean default true`.

### 4.4 Money

**`wallets`** — `user_id uuid unique FK, credit_balance integer not null default 0 check (credit_balance >= 0)`. Cache only; authoritative value is the ledger sum. A nightly job asserts they agree and alerts on drift.

**`credit_transactions`** — append-only. Never updated, never deleted. **The rule constrains
application code paths**: every route, Server Action, and background job reaches this table through
`INSERT` and `SELECT` only, and `LedgerExecutor` (`lib/credits/ledger.ts`) deliberately exposes no
method that could become an UPDATE — not even to correct a `description`. Anything a row should have
said but doesn't is **derived at read time** instead (see §7.6, retained credits). The rule earns its
keep by admitting no exception **in application code**: one narrow UPDATE path there and every later
reader has to ask which rows were rewritten, which is exactly the question an audit trail exists to
foreclose.

**Carve-out: development fixture resets.** `src/db/seed.ts` may `DELETE` seeded `credit_transactions`
rows scoped to seeded user ids, on a non-production database, so repeated seeding stays idempotent.
This is a carve-out for a fixture-reset script outside the request path, not a loosening of the rule
— no application code path may `UPDATE` or `DELETE` this table, ever, and `LedgerExecutor` continues
to expose no update-shaped method by design. If a seed script ever needs this on a database that
could be production, that is the bug, not the carve-out.

| Column | Type | Notes |
|---|---|---|
| user_id | uuid FK |  |
| delta | integer not null | signed; `check (delta <> 0)` |
| balance_after | integer not null |  |
| type | enum | `purchase`, `booking_debit`, `booking_refund`, `session_earning`, `withdrawal_hold`, `withdrawal_paid`, `withdrawal_reversed`, `admin_adjustment`. The old instant-session hold's `instant_hold` / `instant_release` / `instant_capture` (Decision #3) were **removed in migration `0014`** — §18 made instant billing a single flat `booking_debit` (§7.4) and no hold model exists in the live Bubble app. Postgres has no `ALTER TYPE ... DROP VALUE`, so `0014` does the rename-create-alter-drop dance by hand, guarded by a check that no row still uses the three values (none did — the ledger is append-only, so rows of a dropped type could not have been rewritten). |
| reference_type | text | `booking`, `payment`, `withdrawal_request` |
| reference_id | uuid |  |
| description | text | human readable, shown in wallet history |
| created_by | uuid FK | admin id for manual adjustments |

Index `(user_id, created_at desc)`. Unique index on `(type, reference_id)` where `reference_id is not null` — this is the idempotency guard that prevents double-crediting a retried webhook.

**`payments`** — PayPal record.

| Column | Type | Notes |
|---|---|---|
| user_id | uuid FK |  |
| provider | enum `paypal` | room for more later |
| provider_order_id | text unique not null |  |
| provider_capture_id | text |  |
| amount_usd | numeric(10,2) not null |  |
| currency | text default 'USD' |  |
| credits_granted | integer | two meanings by `purpose` (Phase 5 Part 2): for `credit_purchase`, credits added to the wallet and kept; for `booking` (direct-pay), credits minted and debited in the same settlement transaction — net wallet effect zero, so this is **not** a balance the user holds |
| purpose | enum `credit_purchase` \| `booking` |  |
| booking_id | uuid FK | when purpose = booking |
| status | enum `created` \| `approved` \| `captured` \| `failed` \| `refunded` |  |
| raw_payload | jsonb | full capture response, for disputes |
| captured_at | timestamptz |  |

**`tutor_earnings`** — one row per completed session.

`tutor_id, booking_id unique FK, gross_credits, platform_fee_credits, net_credits, status enum('held','available','withdrawn'), available_at timestamptz`

`available_at = booking.ended_at + earnings_hold_hours` (§18: **48 hours**). Platform fee is `platform_fee_percent` = **25%** (tutor keeps 75%).

**`withdrawal_requests`**

| Column | Type | Notes |
|---|---|---|
| tutor_id | uuid FK |  |
| amount_credits | integer not null |  |
| amount_usd | numeric(10,2) not null | snapshot at request time |
| payout_method | enum `paypal` | extensible |
| payout_destination | text not null | snapshot of paypal_email |
| status | enum `requested` \| `approved` \| `paid` \| `rejected` \| `cancelled` |  |
| admin_note | text |  |
| external_reference | text | PayPal transaction id, entered by admin |
| processed_by | uuid FK | admin |
| processed_at | timestamptz |  |

### 4.5 Communication

**`conversations`** — `participant_a uuid, participant_b uuid, last_message_at timestamptz`. Unique index on `(least(participant_a, participant_b), greatest(participant_a, participant_b))` so a pair can only have one thread.

**`messages`** — `conversation_id FK, sender_id FK, body text, attachment_url text, read_at timestamptz`. Index `(conversation_id, created_at desc)`. Realtime enabled.

**`notifications`** — `user_id FK, type text, title text, body text, link text, read_at timestamptz`. Realtime enabled.

### 4.6 Broadcasts

> **NET-NEW, not Bubble parity** (Decision C) — new one-to-many teaching functionality beyond the current build.

**`broadcasts`** — `tutor_id FK, title, description, subject_id FK, agora_channel text unique, status enum('live','ended'), started_at, ended_at, peak_viewers integer default 0`

**`broadcast_viewers`** — `broadcast_id FK, user_id FK nullable (anonymous allowed?**[verify]**), joined_at, left_at`

### 4.7 Platform

**`platform_settings`** — `key text PK, value jsonb, description text`. Editable in admin. Keys:

```
platform_fee_percent         # 25 — tutor keeps 75%
earnings_hold_hours          # 48
instant_request_ttl_seconds  # default 60 (instant-request accept window)
min_withdrawal_usd           # 30 — enforced server-side, not just the button
min_booking_notice_minutes   # 120 (existing default, kept)
max_booking_days_ahead       # 7
session_durations            # [30, 60, 90, 120] — fixed menu, not tutor-configurable
cancellation_enabled         # false — no user cancel path (§7.3)
credit_packages              # jsonb array of buyable packages: credits + USD price, no minutes column
                             #   one entry carries is_direct_pay_basis: true — the direct-pay
                             #   pricing basis (§7.6). Exactly one, or ordering throws.
```

> **§18 resolution (2026-08-20)** removed the keys tied to now-deleted models:
> `credit_usd_rate` (pricing is per-package, not a flat rate), `min_withdrawal_credits`
> (→ `min_withdrawal_usd`), `cancellation_window_hours` (→ `cancellation_enabled = false`),
> and `max_instant_minutes` / `min_instant_credits` (the instant hold model is gone — §7.4).
> Added: `session_durations`, `cancellation_enabled`.
>
> **Credits-are-money amendment (2026-08-20, supersedes §18 item 7)** further removed
> `credit_minutes_ratio`: a credit is a **purchased currency, not a unit of time**, so there is no
> credit-to-minutes ratio at all. Session price is `hourly_rate_credits × duration_minutes / 60`,
> rounded up (§7.3, §7.4), for both scheduled and instant. See DECISIONS.

> `presence_stale_seconds` intentionally removed (Decision #8): the 2-minute staleness
> threshold is baked into the `live_tutors` view so the view and the presence-cleanup cron
> share one source of truth.

**`audit_log`** — `actor_id, action text, target_type text, target_id uuid, payload jsonb, ip text`. Every admin mutation writes here.

### 4.8 Favourites

> **PARITY — added in Phase 3.** Backed by Bubble's `Favourite_Tutors` list; the original
> spec omitted it (see `docs/DECISIONS.md`). Migration `drizzle/0008_favourites.sql`.

**`favourites`** — a student's saved tutors.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| student_id | uuid FK → profiles.id (cascade) | the student who favourited |
| tutor_id | uuid FK → profiles.id (cascade) | the tutor's profile id |
| created_at | timestamptz not null default now() | |

`unique (student_id, tutor_id)`. Indexes: `(student_id)`, `(tutor_id)`. RLS: a student reads and
writes **only their own** rows (`student_id = auth.uid()` for select/insert/delete; no update).

---

## 5. Authorization

Two layers, both required.

**Layer 1 — Postgres Row Level Security.** RLS is enabled on every table. This is the equivalent of the Bubble privacy rules, but enforced by the database rather than by the query builder.

Policy summary:

| Table | Read | Write |
|---|---|---|
| profiles | own row fully; other users see only `display_name, avatar_url, country, bio` via a `public_profiles` view | own row only |
| tutor_profiles | anyone may read where `approval_status = 'approved'`; owner reads own always | owner; `approval_status` and `approval_note` writable only by service role |
| bookings | participants only (`student_id = auth.uid() or tutor_id = auth.uid()`) | participants, status transitions restricted (Section 7) |
| session_requests | participants only | student inserts; tutor updates status |
| wallets, credit_transactions | owner only | **service role only** — no client writes, ever |
| payments | owner only | service role only |
| tutor_earnings | owning tutor | service role only |
| withdrawal_requests | owning tutor; all for admin | tutor inserts; only admin transitions status |
| messages | conversation participants | sender inserts own |
| broadcasts | anyone reads live/ended | owning tutor |
| platform_settings | anyone reads (needed for pricing display) | admin only |
| audit_log | admin only | service role only |
| favourites | owning student only | owning student inserts/deletes own (no update) |
| student_subjects | owning student only (no public read) | owning student inserts/deletes own (no update) |

> **`tutor_profiles.approval_status` immutability is enforced by a trigger, not a column grant.** The column-level `REVOKE UPDATE (approval_status, approval_note, approved_at)` in `drizzle/0005` is **ineffective** — the same migration grants table-level `UPDATE` to `authenticated`, and in PostgreSQL a table-level privilege overrides a column REVOKE, so a tutor could self-approve via a direct REST call (found by `db:verify-rls`). The `tutor_approval_guard` trigger (`drizzle/0010`, mirroring `profiles_guard`) blocks any non-admin change to the approval columns. Admins change them through their authenticated session (`is_admin()`); system/service writes disable the trigger, as the seed does for `profiles_guard`.

> **The admin write path (`drizzle/0012`).** RLS on `tutor_profiles` is owner-only, so an admin's *own* session cannot update another tutor's row, and `audit_log` is service-role write — meaning the approval queue had no legal path: the session is blocked by RLS, the server-side connection was blocked by the approval trigger. The guards now block `authenticated` (the real attack — a tutor self-approving via PostgREST) while recognising the **trusted server-side connection** via `public.is_trusted_server()`. Authorization for that path is Layer 2: every admin action calls `requireRole('admin')` first and writes `audit_log`.
>
> `is_trusted_server()` deliberately checks **`session_user`** (plus the `service_role` JWT claim), **never `current_user`** — the guards are `SECURITY DEFINER`, so inside them `current_user` is the function owner for *every* caller, and using it would silently disable the guard for end users. This was caught by `db:verify-rls`.
>
> The same migration tightens `tutor_profiles` INSERT/UPDATE to require `profiles.role = 'tutor'`. Previously the policies only checked ownership, so a **student** could create a `tutor_profiles` row for themselves. It would land as `approval_status = 'pending'` and never reach browse, but "students cannot write `tutor_profiles`" should hold at the RLS layer, not merely be unexploitable.

**Layer 2 — route handlers.** Every Server Action and API route independently re-checks the caller's identity and role. `requireUser()`, `requireRole('tutor')`, `requireBookingParticipant(bookingId)` helpers live in `lib/auth/guards.ts` and are the first line of every handler. Never trust a client-supplied `userId`.

Admin access is by `profiles.role = 'admin'` only. There is no admin signup route; the first admin is set by SQL, subsequent ones promoted in the admin panel with an audit entry.

---

## 6. Routes

```
PUBLIC
/                                  Landing: hero, live-now tutors strip, subject grid, how it works
/tutors                            Browse + filter (Section 7.2)
/tutors/[slug]                     Tutor profile: about, subjects, rate, reviews, availability calendar,
                                   "Book a session" and "Request now" (if live)
/live                              Currently live broadcasts
/live/[broadcastId]                Viewer page (Agora audience)
/how-it-works, /pricing, /faq
/legal/terms, /legal/privacy
/login, /signup, /forgot-password, /reset-password
/auth/callback                     Supabase OAuth handler
/onboarding                        Role choice → role-specific onboarding

STUDENT  (layout guards role = student)
/dashboard                         Stat cards, next session, recent tutors, wallet balance
/dashboard/bookings                Upcoming | Past | Cancelled tabs
/dashboard/bookings/[id]           Detail, join button, cancel, reschedule request
/dashboard/wallet                  Balance, buy credits, transaction history
/dashboard/messages[/[conversationId]]
/dashboard/settings                Profile, password, timezone, notifications, delete account

TUTOR  (layout guards role = tutor + approval_status = approved)
/tutor                             Earnings summary, today's schedule, go-live control, pending requests
/tutor/bookings[/[id]]
/tutor/availability                Weekly rules editor + date exceptions
/tutor/profile                     Public profile editor, subjects, rates, intro video
/tutor/earnings                    Held / available / withdrawn breakdown
/tutor/withdrawals                 Request + history
/tutor/broadcasts                  Start broadcast, past broadcasts
/tutor/messages[/[conversationId]]
/tutor/settings                    Includes PayPal payout email
/tutor/pending-approval            Shown instead of /tutor when approval_status != approved

SESSION  (participants only)
/session/[bookingId]               Instant session — Agora 1:1
/classroom/[bookingId]             Scheduled session — LessonSpace embed
/broadcast/[broadcastId]           Tutor's own broadcast host view

ADMIN  (role = admin)
/admin                             Overview: users, bookings today, revenue, pending withdrawals
/admin/users[/[id]]                Search, suspend, adjust credits (audited)
/admin/tutors                      Approval queue
/admin/bookings                    All bookings, filters, force-complete/cancel
/admin/payments                    PayPal records, reconciliation view
/admin/withdrawals                 Queue: approve → pay → mark paid with reference
/admin/subjects                    CRUD
/admin/settings                    platform_settings editor
/admin/audit                       Audit log

API
POST /api/presence/heartbeat
POST /api/agora/token
POST /api/lessonspace/join
POST /api/paypal/orders
POST /api/paypal/orders/[orderId]/capture
POST /api/webhooks/paypal
GET  /api/cron/*                   (Section 12, CRON_SECRET protected)
```

Prefer Server Actions over API routes for mutations initiated by our own UI. API routes exist for third-party callbacks, cron, and anything the Agora/PayPal SDKs need to hit directly.

---

## 7. Core flows

### 7.1 Auth & onboarding

1. `/signup` — email/password or Google. Supabase creates the auth user; a Postgres trigger inserts a matching `profiles` row with `role` null.
2. Redirect to `/onboarding`. Step 1: "I want to learn" / "I want to teach" → sets `role`. Role is not changeable afterwards by the user.
3. **Student onboarding:** name, avatar (optional), timezone (prefilled from `Intl.DateTimeFormat().resolvedOptions().timeZone`), subjects of interest. → `/dashboard`.
4. **Tutor onboarding:** name, avatar, headline, about, subjects + levels, hourly rate, languages, education, experience, PayPal email. **No separate instant rate** — instant and scheduled both price off `hourly_rate_credits` (credits-are-money amendment, §7.4). Sets `approval_status = 'pending'`, creates `tutor_profiles`. → `/tutor/pending-approval`.
5. Email verification required before booking or going live. Unverified users may browse.
6. Admin approves in `/admin/tutors` → email to tutor → tutor can now appear in search and go live.

Google OAuth users skip password but still complete onboarding. Handle the case where a Google email matches an existing password account: link, don't duplicate.

### 7.2 Browse and filter tutors

`/tutors` server-renders results from search params so filters are shareable and back-button-safe.

Filters: subject (multi), price range (**credit bands in credits/hour**, compared directly against `hourly_rate_credits` — no USD conversion: Under 50 · 50–100 · 100–200 · 200–400 · 400+), language, minimum rating, availability window, `live_now` toggle, sort (`relevance | price_asc | price_desc | most_sessions`).

> **Unknown `subject` / `lang` slugs return an empty result set; they do NOT throw.** This is deliberate, and the asymmetry with `sort` / `price` / `minRating` (which reject — §3.3) is a decision, not an inconsistency. Those three are **closed enumerations**: an unrecognised value can only be a typo or a stale link, and silently coercing or dropping it would show results that do not match the URL. Subject and language slugs are **open, admin-editable data** — a subject can be renamed or deactivated, so a previously valid slug in a shared link becomes unknown through no fault of the user. Both behaviours fail safe: the enums fail loudly, and an unknown slug yields a visibly empty grid ("no tutors match your filters") rather than silently widening the query — never Bubble's `ignore_empty_constraints` failure, where the filter disappears and unrelated results look correct.

> **No `rating` sort** — reviews are dropped for v1 (§18), so there is no rating data to sort by; the code has never had one. The **`minRating` filter stays** in both spec and code (parsed, composed, and unit-tested) but is dormant and unsurfaced until reviews exist. An unrecognised `sort` value is rejected, not silently coerced (§3.3).

Base query: `tutor_profiles` where `approval_status = 'approved'` and owning profile not suspended. When `live_now` is on, query the `live_tutors` view instead (Section 3.1) — **this is the fix for the stale LIVE badge, and it must be a view join, not a boolean check.**

Card contents: avatar, display name, headline, rating + count, subjects (max 3 + overflow), rate, LIVE pill when in `live_tutors`, "Request now" when live and `accepts_instant`.

Avatar rendering: `next/image` with `remotePatterns` configured for the Supabase Storage domain, plus a generated initials fallback. (The current "LIVE tutor card photos not rendering" bug is an image-host configuration issue in Bubble; in Next it's the `remotePatterns` allowlist. Get this right in Phase 3 and it never recurs.)

Pagination: cursor-based, 24 per page.

### 7.3 Scheduled booking

**Student side:**

1. On `/tutors/[slug]`, a calendar shows the next 30 days. Available slots computed server-side (Section 4.2) and rendered **in the student's timezone**, with the tutor's timezone shown as a secondary label.
2. Student picks slot + duration (30/60/90/120) + subject + optional note.
3. Price = `hourly_rate_credits × duration_minutes / 60`, rounded up. This is the single pricing formula — the **same** formula prices instant sessions (§7.4). Credits are a purchased currency, not a unit of time; the tutor's `hourly_rate_credits` is authoritative for price.
4. Payment choice:
   - **Credits** — if `wallet.credit_balance >= price`: create booking `confirmed`, debit ledger, done in one transaction.
   - **PayPal** — create booking `pending_payment` with a 20-minute expiry, then the PayPal flow (7.6). On successful capture → `confirmed`.
5. Slot is held for the duration of `pending_payment` (the overlap constraint counts `pending_payment` as occupying, §4.3). The hold **lapses after 20 minutes**, measured from the booking's `created_at`: past that an abandoned checkout stops blocking the slot on read (§4.2), and the booking transaction expires any such stale hold it collides with before inserting. A student who walks away from PayPal does not strand the tutor's calendar until a cron runs.
6. On confirm: email both parties, in-app notification to tutor, calendar `.ics` attachment.

> **Part 2 implementation (Phase 4, `phase-4-part2-booking-flow`).** The credits path is built by
> `createScheduledBooking` (`src/actions/bookings.ts`); PayPal (step 4b) is Phase 5. The action
> trusts the client for **nothing** (SPEC §5): it re-derives the price with `sessionPriceCredits`,
> re-validates the requested slot server-side via the same pure `computeSlots` the calendar used
> (`isSlotOpen`, shared 30-min grid `SLOT_STEP_MINUTES`), and confirms the tutor is approved and
> teaches the subject. It inserts the booking **then** debits in **one** transaction, so an
> insufficient balance rolls back the booking and a debit can't outlive a rejected insert; the
> `bookings_no_overlap` GiST exclusion (§4.3) is the last-writer backstop for a slot won between
> re-validation and insert, surfaced as a clean "just booked" error. **Email/notification/.ics
> (step 6) are deferred to Phase 10** — the booking is created and debited, but nothing is emailed
> yet. See `docs/DECISIONS.md`.

**Joining:** the join button on `/dashboard/bookings/[id]` becomes active 10 minutes before `scheduled_start_at` and stays active until 30 minutes after `scheduled_end_at`. It calls `/api/lessonspace/join` (7.7) and navigates to `/classroom/[bookingId]`.

**Cancellation:** there is **no cancellation path for either party** — neither student nor tutor can cancel a booking, and there are **no refunds** on the normal path (`cancellation_enabled = false`, §18). The **only** unwind is an **admin force-cancel with refund** in `/admin/bookings` (full credit refund via the ledger). The booking-status values `cancelled_by_student` / `cancelled_by_tutor` / `no_show_student` / `no_show_tutor` are **retained in the enum but are admin- or cron-set only, never user-set**.

**Completion:** when both parties have left and `scheduled_end_at` has passed, or by cron 30 minutes after `scheduled_end_at`, status → `completed`, `tutor_earnings` row created `held`.

### 7.4 Instant session

This flow replaces the entire `has_live_request` polling mechanism.

> **No Bubble counterpart (Bubble live-app investigation, 2026-08-24).** The request/accept
> handshake below — a `session_requests` row, a 60-second accept window, explicit decline — does
> not exist in the live app at all. Bubble creates the booking immediately on payment, with no
> request type, no accept step, no expiry, and no timeout; the tutor is pulled into the room by a
> `has_live_request` boolean on the `User` record, polled every 10 seconds on the index page. The
> rule that Bubble is ground truth for UX behaviour does not apply to this flow, because there is
> no Bubble behaviour to match — the handshake is this rebuild's own design. See DECISIONS, Finding
> B.

```
Student                          Server                           Tutor
   |                                |                                |
   | POST createSessionRequest      |                                |
   | (chosen duration_minutes)      |                                |
   |------------------------------->|                                |
   |                                | validate: tutor in live_tutors,|
   |                                | accepts_instant, student's     |
   |                                | balance >= price_credits for   |
   |                                | the chosen duration,           |
   |                                | no existing pending request    |
   |                                | price_credits =                |
   |                                |   sessionPriceCredits()         |
   |                                | INSERT session_requests        |
   |                                | (duration_minutes, price_credits|
   |                                |  pinned; expires_at = now+60s) |
   |                                |--- Realtime INSERT event ----->|
   | <-- waiting modal, 60s ------- |                                | incoming request modal
   |     countdown                  |                                | (name, subject, note, 60s ring)
   |                                |                                |
   |                                | <---- accept / decline --------|
   |                                | on accept, in one transaction: |
   |                                |   debit price_credits (the     |
   |                                |     PINNED quote, never        |
   |                                |     re-derived) — on failure,  |
   |                                |     rollback, status =         |
   |                                |     failed_payment             |
   |                                |   status = accepted            |
   |                                |   INSERT bookings (instant,    |
   |                                |     in_progress, channel =     |
   |                                |     session_{booking_id})      |
   |                                |--- Realtime UPDATE ----------->|
   | <-- Realtime UPDATE -----------|                                |
   | navigate /session/{id}         |                                | navigate /session/{id}
```

Rules:

- **Expiry is enforced server-side.** The client countdown is cosmetic. Accepting an expired request fails with a clear error — and moves the row to `expired` there and then, so the student's waiting modal stops waiting immediately rather than at the next cron pass. A cron pass (`/api/cron/expire-requests`, §12, built in Part 2) also sweeps `pending` rows past `expires_at` to `expired` every minute so dashboards stay clean; nothing about correctness waits on it.
- A student may have at most one `pending` request at a time. A tutor may have several incoming; accepting one auto-declines the rest.
- Declining is explicit and free; the student sees "Tutor is unavailable right now" and a list of other live tutors.
- If the tutor's presence goes stale while a request is pending, the request expires immediately.
- **Duration and price are decided at request time, not accept time (Phase 6 pre-build decision; shipped in migration `0014`).** The student picks a duration from `session_durations` (now **30 / 60 / 90 / 120**, §18 item 1) when sending the request; the server computes `price_credits` via `sessionPriceCredits()` and pins both `duration_minutes` and `price_credits` on the `session_requests` row (§4.3). The accept transaction charges exactly that pinned price — it never re-derives price from the tutor's current `hourly_rate_credits`, so a mid-flight rate change can't move the number the student already saw.
- **Validation is a balance check against the quoted price, not a flat floor.** The old `min_instant_credits` check ("student has >= min_instant_credits") is gone — that setting and `max_instant_minutes` are artifacts of the abandoned hold model and don't exist in the live Bubble app (§4.7). The request-time check is simply: student's balance >= `price_credits` for the chosen duration.
- **A mid-flight balance failure is a distinct terminal state.** The debit runs inside the tutor's accept transaction, atomic with the booking insert. If the student's balance moved between request and accept such that the pinned-price debit would fail, the whole accept rolls back and the request goes terminal as `failed_payment` (§4.3) — not `expired`, not `declined` — so an operator reading `session_requests` can tell a refusal from a payment failure.

**Billing (instant):** flat and charged **upfront at booking creation**, debited via the ledger in the same transaction that inserts the booking. `price_credits = hourly_rate_credits × duration_minutes / 60`, rounded up — the **same formula as a scheduled booking** (§7.3). There is **no metering, no authorization hold, no partial refund, and no remainder release.** Session length is enforced **server-side from `bookings.started_at`**: when the booked duration has elapsed, the session ends — elapsed time is always computed server-side, never from a client interval. Instant price uses the tutor's `hourly_rate_credits`, not a per-minute rate: `tutor_profiles.instant_rate_credits_per_minute` was **dropped in migration `0014`** (§4.1). The charge is a single `booking_debit` credit transaction; the earlier hold model's `instant_hold` / `instant_release` / `instant_capture` enum values were likewise **removed in `0014`** (§4.4). See DECISIONS ("bug not ported, intended behaviour built": the Bubble countdown decrements a `credits_remaining` field on a **180-second** client interval, one credit per tick — the withdrawn "1 credit = 3 minutes" rule working exactly as designed, not a units bug; not ported regardless, since elapsed time is computed server-side).

> **Confirmed against the live app, and the flat bracket is a live pricing defect (Bubble live-app
> investigation, 2026-08-24).** Live inspection confirms the countdown described above is still the
> mechanism that ends a Bubble session today, and adds a second problem this SPEC's model was
> already avoiding: Bubble sets a booking's `credits_remaining` to a **flat bracket by duration**
> (10/20/30/40 credits for 30/60/90/120 minutes), which ignores the tutor's hourly rate entirely —
> every tutor costs the same in credits. That bracket is a pricing defect in the live app, not a
> model worth preserving, and this rebuild's `sessionPriceCredits()` formula (`hourly_rate_credits ×
> duration_minutes / 60`, charged once at booking) was never going to reproduce it regardless.
> Separately: because Bubble's metering runs in the browser, closing the tab stops the meter while
> the session room stays open — the student keeps being tutored without being charged. This is a
> live revenue leak, recorded as an observed property of the live app. This rebuild's server-side
> hard stop from `bookings.started_at` (above) removes it by construction, not by patching the
> symptom. See DECISIONS, Decisions 1 and 2.

**Ending a session is unchanged from Bubble (Phase 6 pre-build decision).** Credits are charged upfront and **nothing is refunded on early exit by either party** — a student who leaves after 5 minutes of a paid 60-minute session, or a tutor who ends it early, gets no partial credit back. The session **hard-stops when the booked duration elapses**, with **no grace period**. Bubble's mid-session "buy more credits" top-up popup is **not ported**: under flat upfront billing there is nothing to run out of mid-session, so the popup has no equivalent state to attach to.

**Scheduled-booking collision at accept, no buffer (Phase 6 pre-build decision; end-side condition added in Part 2).** The accept transaction additionally rejects if the tutor has a `confirmed` or `in_progress` **scheduled** booking whose range overlaps the instant session's `[now(), now() + duration_minutes)` — i.e. `scheduled_start_at < now() + duration_minutes` **AND** `scheduled_end_at > now()`. This is an application-level guarded read inside the accept transaction, **not a database constraint** — `bookings_no_overlap` (§4.3) deliberately excludes instant bookings, which have no time range to exclude against. There is **no buffer or gap** around the scheduled booking: the live Bubble app has no such check at all, so inventing a buffer would be adding a rule that doesn't exist upstream — back-to-back is allowed, and a booking starting exactly when the instant session ends does not collide. The go-live toggle (§7.5) stays unrestricted by this check — a tutor can go live with a scheduled booking on the calendar; the collision is only enforced at accept.

> This line previously stated only the start-side half. Taken literally that blocks on **every** past booking still sitting `confirmed` — and none are `completed` yet, because the complete-sessions cron is Phase 6 Part 3 — which would leave a tutor permanently unable to accept an instant session. The `scheduled_end_at > now()` half is what the rule always meant; it is written down here because the half that was written down was the one that could be implemented wrongly. See `docs/DECISIONS.md`, Phase 6 Part 2.

> **Part 2 implementation (Phase 6, `phase-6-part2-session-requests`).** The handshake above is
> built end to end **except the room it lands in**: `/session/[bookingId]`, the Agora client,
> `/api/agora/token`, end-session, `complete-sessions` and `tutor_earnings` are Part 3, and the
> navigations below deliberately point at a route that does not exist yet (`TODO(Phase 6 Part 3)`
> at each site).
>
> - **Three Server Actions** in `src/actions/session-requests.ts`, each re-checking role and
>   identity server-side and each returning a **typed result** rather than throwing:
>   `createSessionRequest`, `declineSessionRequest`, `acceptSessionRequest`.
> - **`createSessionRequest`** validates, in order: caller is a student with a verified email; the
>   tutor is **in the `live_tutors` view** (§3.1 — never `is_live`) and `accepts_instant`; the
>   duration is a member of `session_durations`; the tutor teaches the chosen subject, when one was
>   chosen; the student holds no other live pending request; and the balance covers the price. It
>   then computes `price_credits` with `sessionPriceCredits()` and pins it with `duration_minutes`
>   on the row. The client sends a tutor, an optional subject, an optional note and a duration —
>   never a price, a deadline, or an identity.
> - **`expires_at` is computed by Postgres** (`now() + make_interval(...)`), not by the app server,
>   so the deadline is written against the same clock every later read and both crons compare it
>   with. The window is `instant_request_ttl_seconds` from `platform_settings` (seeded **60**),
>   coerced to a positive integer and defaulted rather than trusted.
> - **A student's own stale `pending` row never blocks them.** The "one pending request at a time"
>   read ignores rows past `expires_at`, and the write path expires them before the check — the same
>   shape as §7.3 step 5's stale-hold sweep, and the reason the expiry cron is tidy-up rather than
>   correctness.
> - **The accept transaction's decisions live in a store-agnostic module**
>   (`src/lib/session-requests/accept.ts`, the same shape as `lib/paypal/settlement.ts`), so all
>   four refusal paths — expired, no-longer-pending, scheduled collision, and a balance that moved —
>   are unit-tested without a live Postgres. `db/queries/session-requests.ts` is the Drizzle adapter.
> - **The booking id is generated in application code** so `agora_channel = session_{booking_id}`
>   can be written by the same INSERT that creates the row, rather than by a follow-up UPDATE.
> - **The `failed_payment` write runs OUTSIDE the rolled-back transaction**, in its own statement
>   conditional on the row still being `pending`. That ordering is the whole point: everything the
>   accept did must roll back, and the record of *why* must not.
> - **Realtime, both directions** (§8): the tutor's incoming-request modal is mounted in the tutor
>   layout and subscribes to INSERT/UPDATE where `tutor_id = me`; the student's waiting modal
>   subscribes to UPDATE on its own row and shows a **distinct** message for each of accepted,
>   declined, expired, cancelled and `failed_payment`. Realtime payloads are treated as
>   notifications, not as data — anything displayed is read back through a guarded Server Action.
> - **The 60-second ring is cosmetic on both sides** and is the only `setInterval` added: it ticks a
>   deadline already in hand and makes no network call, so it is not the polling CLAUDE.md forbids.

> **Part 3B implementation — the server-side end and the hard stop
> (`feat/phase6-part3b-end-session`).** The §9 control-bar toggles (mic, camera,
> screen share), text chat, credits consumed/earned and the 80%-TTL token renewal
> are **not** in this pass and remain absent rather than stubbed.
>
> - **The transition is one conditional `UPDATE`**, no CTE and no read-then-write
>   (`endInstantSessionByParticipant` / `endElapsedInstantSession` in
>   `db/queries/sessions.ts`). `status = 'in_progress'` in the WHERE is the
>   entire exactly-once guarantee: a second writer blocks on the row lock,
>   re-evaluates under READ COMMITTED against the updated row, and matches zero
>   rows. Both concurrent ends and an end racing the deadline are covered in
>   `tests/integration/session-end-concurrency.test.ts`, and the suite was proved
>   capable of failing against five deliberate breaks.
> - **Four server-side actors enforce the deadline**, in the order they fire:
>   `getSessionState` (the actor *at* the deadline, with people still in the
>   room), `POST /api/agora/token` (the re-entry guard — refresh, second tab,
>   reconnect, and every renewal once that pass lands), the end-session action
>   (early exit), and the room's server read, which **refuses to open an elapsed
>   room but deliberately performs no write** (a render is reachable by prefetch
>   and by React's dev double-render; a GET that mutates is not worth the few
>   minutes of dashboard freshness).
> - **A booking whose duration elapses with both parties offline stays
>   `in_progress` until Part 3C's cron, and that is correct.** No money moves at
>   the transition — credits were charged at accept — and the harm the hard stop
>   prevents (a room held open while tutoring continues unbilled) requires
>   somebody to be present, which is exactly when the actors above fire. A
>   lingering `in_progress` instant booking blocks nothing: the accept-time
>   collision check reads `type = 'scheduled'` only.
> - **The deadline is a deliberate pair**: `lib/sessions/deadline.ts` (pure,
>   for display and for deciding whether to *attempt*) and `sessionElapsedSql`
>   (authoritative, inside the statement). They cannot be collapsed — one must be
>   SQL and one must run in a browser — so an integration test pins them to the
>   same answer at `t - 1s`, `t` and `t + 1s`, both inclusive at the boundary.
> - **The countdown is cosmetic** and makes no network call, exactly like the
>   60-second request ring. The client asks the server what is true at three
>   *events* — mount, the other party arriving, and the countdown reaching zero —
>   never on an interval. A browser clock running fast is corrected, not obeyed:
>   the comparison that authorizes the transition is Postgres's `now()`.
> - **The other party is told by the Agora SDK's own `user-left`**, not by
>   Realtime: `bookings` is not in the `supabase_realtime` publication
>   (`drizzle/0006`) and adding it would be a migration. The media event is the
>   notification; a guarded read is the data.
> - **A session that never started cannot reach `completed`** (`started_at IS NOT
>   NULL` in the WHERE). Otherwise a student whose tutor never arrived could end
>   it, and Part 3C would pay a tutor who was never in the room while §7.4 forbids
>   refunding the student. Those bookings are Part 3C's `no_show_*` case.
> - **Nothing in this pass touches the ledger, computes a refund, writes
>   `tutor_earnings`, clears `is_live`, or needs a migration.** `ended_at` and
>   `billed_minutes` have existed since `0000`.

**In-session UI (`/session/[bookingId]`):** local + remote video, mute mic, mute camera, elapsed timer, credits consumed so far (student) / earned so far (tutor), text chat panel, screen share, end session (both sides), connection quality indicator, reconnect handling. On `beforeunload` and on Agora `connection-state-change` to disconnected, fire a `leaveSession` action — but never depend on it for correctness (that dependency is what caused the original bug).

### 7.5 Presence and going live

**Heartbeat.** A `usePresence()` hook mounted in the authenticated layout `POST`s to `/api/presence/heartbeat` every 30 seconds while the tab is visible, and once immediately on mount. The route sets `profiles.last_seen_at = now()`, and for tutors also `tutor_profiles.last_seen_at = now()`. Pause on `document.hidden`, resume and fire immediately on visible.

**Going live.** Tutor toggles "Available for instant sessions" on `/tutor`. Sets `is_live = true`, `live_mode = 'instant'`, `last_seen_at = now()`. **Toggling off sets `is_live = false` immediately, and is the only thing that does.** Amended in Phase 6 Part 1: this line previously also promised "or navigating away cleanly". Nothing now clears presence on navigation — see the staleness note below for why the `pagehide` beacon that would have implemented it was removed. Leaving the page simply stops the heartbeat, and the tutor ages out of the view within the staleness window like any other departure.

**Ending a session does NOT clear `is_live` (explicit non-behaviour, Phase 6 pre-build decision).** A tutor who finishes an instant session is usually still available for another one; clearing `is_live` on session end would silently drop them off the live list. Presence is owned exclusively by the heartbeat and the staleness sweep cron below — never by session lifecycle. This is called out because a later reader implementing end-session will otherwise assume it's a missing step.

**Staleness — two independent defences** (three until Phase 6 Part 1; see below)**:**

1. **The `live_tutors` view** filters on `last_seen_at` at read time. Students are protected even if everything else fails.
2. **Cron sweep** every 5 minutes sets `is_live = false`, `live_mode = null` for every row still flagged `is_live` that the **`live_tutors` view does not return** — and expires their pending session requests. The sweep does **not** carry a threshold of its own: the view already defines what "still live" means (§3.1), so deriving the work set from it is what keeps "the view is the single definition of stale" literally true rather than merely intended. There is no `presence_stale_seconds` setting to disagree with the view — it was deleted in Phase 1 (§4.7, Decision #8), and an earlier draft of this line still described the sweep in terms of it. Because the view also requires `approval_status = 'approved'`, a tutor whose approval is revoked mid-session is swept offline too, which is the correct outcome. Built in Phase 6 Part 1 (`GET /api/cron/sweep-presence`); the request-expiry half landed in Part 2 — a swept tutor's `pending` requests are expired **immediately**, without waiting out their own 60 seconds, because a tutor who is gone is not going to answer. That statement is deliberately not in the same transaction as the sweep: if it failed, every one of those requests would still be expired by `expire-requests` within a minute of its own deadline, so the two sweeps are independently self-healing rather than jointly atomic.

**A third defence — `navigator.sendBeacon` on `pagehide`, clearing `is_live` on the way out — was built in Phase 6 Part 1 and then removed before merge. Do not restore it.** `pagehide` cannot distinguish a page reload from a real exit, so it silently dropped a tutor offline every time they refreshed `/tutor`, while their own toggle still read "live" — a false positive with no upside, because §3.1 guarantees no student-facing read depends on that signal in the first place. The view already answers an ungraceful exit correctly at read time, and it cannot mistake a refresh for a departure. Removing the beacon costs no correctness; the only thing it changes is that a departed tutor's underlying row now waits for the staleness window or the sweep, which is exactly what §3.1 says the design must tolerate.

**Never write `is_live = true` without also writing `last_seen_at`.** Enforce with a database trigger: on insert or update where `is_live` is true and `last_seen_at` is null, set `last_seen_at = now()`. This makes the "tutor went live before the heartbeat confirmed, `last_active` is blank" data-corruption case structurally impossible rather than something to clean up manually.

### 7.6 PayPal

Two purposes: buying credits, and paying for a single booking directly.

```
Client                              Our server                    PayPal
  | select package / booking          |                              |
  | POST /api/paypal/orders --------->|                              |
  |                                   | compute amount server-side   |
  |                                   | (NEVER trust client amount)  |
  |                                   | INSERT payments (created)    |
  |                                   | POST /v2/checkout/orders --->|
  |<-- { orderId } -------------------|<---------------------------- |
  | PayPal JS SDK approval UI  <------------------------------------->|
  | POST .../[orderId]/capture ------>|                              |
  |                                   | POST /v2/.../capture ------->|
  |                                   |<----------------------------|
  |                                   | in one transaction:          |
  |                                   |   payments.status = captured |
  |                                   |   mint credits (unique on    |
  |                                   |     reference_id)            |
  |                                   |   booking → confirmed?       |
  |                                   |   if yes: debit them back    |
  |                                   |   if no:  student keeps them |
  |<-- success -----------------------|                              |
```

Also implement `POST /api/webhooks/paypal` handling `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`. **Verify the webhook signature** against `PAYPAL_WEBHOOK_ID`. The webhook is a backstop for users who close the tab mid-capture — it must be idempotent, which the unique `(type, reference_id)` ledger index provides for free.

Amounts are always computed server-side from `platform_settings` and the tutor's rate. The client sends an intent (`{ purpose: 'credit_purchase', packageId }`), never a price.

Sandbox and live are switched by `PAYPAL_ENV`. Uninstalling the old Copilot plugin is a Bubble chore that disappears entirely here — there is one PayPal integration, in `lib/paypal/`.

> **Part 1 + Part 2 implementation (Phase 5, `phase-5-part1-paypal`, `phase-5-part2`).** The whole
> flow is built: `lib/paypal/client.ts` (token cache + base URL switched by `PAYPAL_ENV` — neither
> host appears at a call site), `POST /api/paypal/orders`, `POST /api/paypal/orders/[orderId]/capture`,
> and `POST /api/webhooks/paypal` (Part 1), plus **booking direct-pay**, `/dashboard/wallet` and
> `/admin/payments` (Part 2). The orders route now takes `{ purpose: 'credit_purchase', packageId }`
> or `{ purpose: 'booking', bookingId }` as a discriminated union; any other purpose 400s rather than
> being half-supported.
>
> **Direct-pay is buy-then-spend in one checkout.** A booking has **no USD price of its own** —
> credits are the unit of account and USD exists only where credits are sold. The order mints exactly
> the credits the booking costs and immediately spends them: settlement writes a `purchase` credit
> (`reference_id = payments.id`) *and* a `booking_debit` (`reference_id = bookings.id`), then flips
> the booking `pending_payment → confirmed`. Net wallet effect is zero, which is correct — the
> student never held these credits — and `reconcile-wallets` still balances because both legs are
> real ledger rows. Both are covered by the existing `(type, reference_id)` unique index, so the
> client/webhook race is a no-op on each leg independently; there is no new idempotency machinery.
>
> **Direct-pay pricing basis.** `price_credits = sessionPriceCredits(tutor's current rate, duration)`
> as ever; `price_usd = price_credits × (basis package price_usd ÷ basis package credits)`, **rounded
> up to the cent, never down**. The basis is the one `credit_packages` entry flagged
> `is_direct_pay_basis` — resolved from that flag, never by array index and never by picking the
> median at runtime — so retuning direct-pay is a **settings edit (which package carries the flag)
> and never a code change, and never a new rate**. `credit_usd_rate` stays removed (§18): this is a
> real published package price used for one purpose, not a general credit→USD conversion. The flag
> sits on the middle tier, so **direct-pay is deliberately priced above the largest package's
> per-credit price** and buying credits keeps its volume incentive. If zero or more than one package
> is flagged, ordering **throws** — a mispriced direct-pay charge must surface as an error, never as
> a wrong amount (§3.3, no silent failures).
>
> The order route takes `{ purpose, packageId }` and resolves credits **and** price from
> `platform_settings.credit_packages` server-side (`lib/credits/packages.ts`); no client amount is
> read, so there is nothing to tamper with. `payments.provider_order_id` is `NOT NULL UNIQUE` and
> PayPal's id doesn't exist until after the call, so the row is inserted first with a
> `pending:<payment id>` placeholder and stamped with the real id on return — the payment row always
> predates anything the buyer can approve, so a capture or webhook always has a row to attribute
> money to.
>
> **A captured payment is always honoured (Phase 5 Part 2 fix).** Direct-pay settlement runs
> **mint → confirm → debit**, in that order, in one transaction, and the debit is **gated on the
> confirm**. If the booking cannot be confirmed — the §12 sweep released the `pending_payment` hold
> while the buyer was still on PayPal's approval screen — the debit is **skipped entirely** and the
> student keeps the minted credits. They lost the slot, not the money, and can rebook immediately
> with credits they already hold. **This is the only outcome that requires no refund**, which is
> precisely why it is the right one: SPEC has no refund path (§18 item 4). The previous order (mint,
> debit, confirm) committed both ledger legs and *then* discovered the booking was gone, leaving the
> student charged, holding no credits and no booking, with the webhook returning 200 so PayPal never
> retried — a silently lost payment. Settlement returns
> **`booking_unavailable_credits_retained`** for this case, distinct from `booking_already_confirmed`
> (which means an idempotent replay of a settlement that *did* confirm). The webhook still answers
> 200: a retry cannot conjure the slot back, and the money is already accounted for.
>
> **The replay guard reads the ledger; it does not infer from ordering.** Because the debit is now
> gated, a committed `purchase` mint may legitimately stand with **no** `booking_debit` beside it, so
> "the mint duplicated, therefore the whole settlement ran" is no longer sound. A replay reads *both*
> legs — `purchase`/`payments.id` and `booking_debit`/`bookings.id` — before writing anything. Both
> shapes replay as a no-op: mint+confirm+debit reports `booking_already_confirmed`; mint-only reports
> `booking_unavailable_credits_retained`. A retained mint is **never** debited retroactively, even if
> the booking has somehow become confirmable since — the money question was settled when the capture
> was honoured. The unique index remains the guard of record: a stale read (the real shape of a
> client/webhook race, where the other settlement is a separate transaction) is absorbed by the
> duplicate rejection, re-read, and reported identically.
>
> **The retained mint is labelled at READ time, never rewritten.** That row appears on
> `/dashboard/wallet` carrying a **positive** balance the student really holds, so it must not read
> as a session they paid for: the wallet shows it as credits kept, naming the slot as unavailable and
> the credits as theirs to spend. The stored `description` is the ordinary purchase wording and stays
> that way forever. A ledger row is a retained-credit mint iff **all** of: `type = 'purchase'`; the
> `payments` row it references has `purpose = 'booking'`; and **no** `booking_debit` exists for that
> payment's `booking_id`. `lib/credits/retained-credits.ts` holds the derivation (pure, unit-tested);
> `db/queries/wallet.ts` supplies the two page-scoped reads. *An earlier implementation amended the
> mint's `description` after the confirm failed, through a narrow UPDATE on `credit_transactions`.
> That was **rejected**: §4.4's append-only rule is worth more as an absolute than any single row's
> wording, and deriving the label costs two keyed reads per page of history.*
>
> **`/admin/payments` flags this state outright.** A captured direct-pay whose `purchase` mint has no
> `booking_debit` beside it is shown as *credits retained*, derived from the ledger rather than
> inferred from a captured payment sitting next to an unconfirmed booking or from mismatched
> timestamps.
>
> **Client capture and the webhook are the same code path**, `settleCapture` in
> `lib/paypal/settlement.ts`, keyed on the same `reference_id` (our `payments.id`). Whichever
> arrives first credits; the second returns `already_credited` off the `(type, reference_id)` unique
> index (§4.4) — a race is a no-op, not a special case. The ledger append runs in a SAVEPOINT so the
> duplicate-key rejection unwinds only the append and not the `payments` status update. `DENIED` →
> `failed` and `REFUNDED` → `refunded`, neither touching the wallet (reversing credits is an admin
> action, §18 item 4). An event whose signature PayPal will not vouch for is **400ed before any
> lookup or write**; a missing `PAYPAL_WEBHOOK_ID` is a 503 so the delivery is retried rather than
> discarded. See `docs/DECISIONS.md`.

> **Known constraint:** real-card testing can't be completed from Port Harcourt due to PayPal availability. Plan for a supervised live test with a real end user, and build an admin "reconcile payment" view (`/admin/payments`) that lets an admin look up a PayPal order id and see exactly what the system did with it. That view is how you'll debug the one transaction you can't run yourself.

### 7.7 LessonSpace

Server-side only; the API key never reaches the browser.

`POST /api/lessonspace/join` with `{ bookingId }`:

1. Guard: caller is a participant, booking is `confirmed` or `in_progress`, current time within the join window.
2. If `booking.lessonspace_room_id` is null, create the space via the LessonSpace API and persist the id.
3. Request a per-user join link with the caller's name, a stable user id, and `role = teacher` for the tutor / `student` otherwise.
4. Stamp `student_joined_at` or `tutor_joined_at`; if both set, `status = in_progress`, `started_at = now()`.
5. Return the URL; the page renders it in an iframe with `allow="camera; microphone; display-capture; fullscreen"`.

**Waiting room** is a LessonSpace dashboard setting, not code — note it in the runbook (Section 17) as a deployment checklist item.

> **Confirmed against the live app (Bubble live-app investigation, 2026-08-24).** Bubble's own
> `POST /v2/spaces/launch/` call passes only booking id, display name, and a leader boolean — no
> duration, expiry, or time limit. This section's join-window enforcement (step 1, and §7.3's
> "10 minutes before to 30 minutes after") is entirely our own server-side gate; LessonSpace itself
> was never asked to enforce a time box in the live app either, so there is nothing to reconcile
> here. See DECISIONS, Finding A.

Tutor-only controls (whiteboard admin, recording, end-for-all) come from the `teacher` role in the launch payload rather than from conditionally hiding elements on the page — which is why the current "tutor-facing element visibility on live_classroom" problem doesn't carry over.

### 7.8 Live broadcast

Tutor: `/tutor/broadcasts` → title, description, subject → creates `broadcasts` row, `agora_channel = broadcast_{id}`, sets `is_live = true, live_mode = 'broadcast'` → `/broadcast/[id]` as Agora host (`publisher` token).

Viewer: `/live` lists live broadcasts; `/live/[id]` joins as `subscriber`. Live chat via `messages`-style broadcast chat table or Agora RTM — **[open question: does the current build have broadcast chat?]** Viewer count from Agora's presence, `peak_viewers` updated periodically.

End broadcast: status `ended`, `ended_at`, `is_live = false`. Cron sweep also ends broadcasts whose host has gone stale.

### 7.9 Messaging

Conversation list + thread view, shared component for both roles. Send text and optional attachment. Realtime subscription on `messages` filtered by `conversation_id` for the open thread, plus a lighter subscription on `conversations` for unread badges. Mark read when the thread is visible. Unread count in the header. Email notification only if the recipient has been offline for more than 5 minutes.

### 7.10 Wallet and credits

`/dashboard/wallet`: balance, credit packages (from `platform_settings`), full transaction history from `credit_transactions` with type-specific icons and descriptions, and running balance.

All mutations go through two functions in `lib/credits/ledger.ts`:

```ts
async function creditWallet(tx, { userId, delta, type, referenceType, referenceId, description, createdBy? })
async function debitWallet(tx, { userId, amount, type, referenceType, referenceId, description })
```

Both run inside a transaction, take a row lock (`SELECT ... FOR UPDATE`) on the wallet, reject debits that would go negative, insert the ledger row, and update the cached balance. **Nothing else in the codebase touches `wallets.credit_balance`.** Enforce with a lint rule or a code-review note in `CLAUDE.md`.

### 7.11 Earnings and withdrawals

> **Held-on-completion is a deliberate correction, not a divergence to reconcile (Bubble live-app
> investigation, 2026-08-24).** Live inspection confirms Bubble increments the tutor's
> `total_earnings` at booking creation — unconditionally, on all three booking paths, **before the
> session happens** — with no escrow, no completion trigger, no refund logic, no cancellation
> workflow, and no no-show handling anywhere in the app. The held/available/withdrawn model below
> is this rebuild's intentional design, chosen *because* of that gap, not something that drifted
> from Bubble and needs aligning back to it. A future session must not "align to Bubble" here. See
> DECISIONS, Decision 3.
>
> **`total_withdrawn` is a live financial defect, not reproduced here (same investigation).** On
> Bubble's `UserProfile`, `total_withdrawn` is **read** by the withdrawal gate
> (`earnings × 0.75 − withdrawn ≥ $30`) but **no workflow anywhere writes it** — a tutor can submit
> repeated withdrawal requests against the same balance, and the displayed "available to withdraw"
> never decreases after a request is submitted. This rebuild has no `total_withdrawn` counter to
> forget to write: `withdrawal_requests` plus the `withdrawal_hold` / `withdrawal_paid` ledger
> entries below derive "available" from the ledger itself, which structurally cannot go stale the
> way an unwritten counter can. No fix is needed because the defect has no equivalent to reproduce;
> it is recorded here only so a future session does not port a `total_withdrawn`-shaped field. See
> DECISIONS, Decision 4.

- Session completes → `tutor_earnings` row, `status = held`, `available_at = ended_at + earnings_hold_hours`.
- **Fee split (authoritative).** `platform_fee_credits = floor(gross_credits × platform_fee_percent / 100)`, `net_credits = gross_credits − platform_fee_credits`. The fee **rounds down; the remainder goes to the tutor.** Rounding against the payee would accumulate in the platform's favour across many small sessions, so the split rounds down instead. This is implemented once in `src/lib/credits/fees.ts` (`splitEarnings`) and called by both the seed and the earnings pipeline so they cannot diverge. (`platform_fee_percent = 25` → tutor keeps ≥75%.)
- Cron flips `held` → `available` when due.
- `/tutor/withdrawals`: available balance, minimum from settings, PayPal email shown with an edit link. Request creates `withdrawal_requests` (`requested`) and a `withdrawal_hold` ledger entry so the credits can't be double-spent.
- `/admin/withdrawals`: queue with tutor, amount, USD equivalent, destination email, request date. Actions: **Approve** (`approved`), **Mark paid** (requires an `external_reference`; writes `withdrawal_paid` ledger entry, flips earnings to `withdrawn`, emails the tutor), **Reject** (requires a note; reverses the hold, emails the tutor).
- Every transition writes to `audit_log`.

`payout_method` is an enum with one value today. Adding Wise, Payoneer, Alipay, or WeChat Pay later means adding enum values and a destination-field schema per method — **not in scope for v1** (Section 14).

---

## 8. Realtime

One Supabase Realtime client, subscriptions declared in hooks and cleaned up on unmount.

| Subscription | Where | Filter |
|---|---|---|
| Incoming session requests | Tutor authenticated layout | `session_requests` INSERT/UPDATE where `tutor_id = me` |
| Outgoing request status | Student waiting modal | `session_requests` UPDATE where `id = requestId` |
| Notifications | All authenticated layouts | `notifications` INSERT where `user_id = me` |
| Unread messages | All authenticated layouts | `conversations` UPDATE where I'm a participant |
| Open thread | Messages page | `messages` INSERT where `conversation_id = current` |
| Live tutors strip | Landing page (optional) | `tutor_profiles` UPDATE where `is_live` changed |

The first two rows are built in Phase 6 Part 2 (`src/hooks/use-session-requests.ts`). Both subscribe through the browser Supabase client, so the socket carries the viewer's JWT and the `session_requests` RLS SELECT policy (participants only, `drizzle/0005`) decides what can reach them — the `filter` is a narrowing convenience, **not** the authorization. Payloads are treated as notifications: anything displayed to a person is read back through a guarded Server Action.

**No `setInterval` polling anywhere in the codebase except the presence heartbeat.** That single exception is deliberate and documented. The instant-request countdown ring (§7.4) also ticks on a timer, and is **not** an exception to this: it renders a deadline already in hand and makes no network call, so nothing about it is polling.

---

## 9. Agora integration

Reuse the deployed token service at `AGORA_TOKEN_SERVICE_URL`. Do not redeploy or modify it.

`POST /api/agora/token` with `{ bookingId }` for a session, or `{ broadcastId }` for a broadcast:

1. `requireApiUser()` — the API-route guard (§5 Layer 2), not the redirect-based page guard.
2. For a session: load the booking by id, confirm the caller is its `student_id` or `tutor_id`, and confirm `status = 'in_progress'`. Role → `publisher`, for **both** participants. The channel comes from `bookings.agora_channel`, never from the request.
3. For `broadcast`: parse the broadcast id. If caller is the host → `publisher`; otherwise, if the broadcast is `live` → `subscriber`.
4. Derive a numeric `uid` deterministically from the user id (hash to a 32-bit int) so reconnects keep identity. The token itself is minted at the service's wildcard `uid/0`, which authorizes the *channel* for any uid; the client then joins under its own derived uid.
5. Fetch from the Render service, return `{ token, uid, appId, channel, expiresAt }` with a TTL shorter than the token's.
6. Client renews at 80% of TTL via Agora's `token-privilege-will-expire` event.

**The request carries an id, not a channel** (amended in Phase 6 Part 3A; this line previously specified `{ channel, purpose }` with the booking id parsed back out of the channel string). Taking the id and reading the channel off the row is the safer direction — a caller cannot name a channel they were not admitted to — and the id is what the client actually holds after the §7.4 handshake. The `purpose` discriminator is deferred until broadcasts exist (Phase 9); until then the two shapes are distinguished by which id is present.

Client wrapper in `lib/agora/client.ts`: dynamic-import the SDK (it does not tolerate SSR), expose `join`, `leave`, `toggleMic`, `toggleCamera`, `startScreenShare`, and handle `user-published`, `user-unpublished`, `user-left`, `connection-state-change`, `network-quality`.

**Cold-start note:** the Render free tier sleeps. First token request after idle can take 30–50 seconds. Either move to a paid instance or ping the service from the presence cron to keep it warm. Recommend the latter for now — one line in the cron handler.

> **Confirmed against the live app (Bubble live-app investigation, 2026-08-24).** The Phase
> 6/Phase 7 split — Agora for the instant session room, LessonSpace for scheduled sessions — is
> correct and is not an inference; the live app's `live_session_room` element (content type
> `Booking`) runs the Agora Web SDK in `rtc` mode two-way: the tutor publishes video + audio, the
> student publishes audio only, and both subscribe to the other. Tokens come from the same
> `AGORA_TOKEN_SERVICE_URL` at `/rtc/{channel}/{role}/uid/0/?expiry=3600`. **Bubble derives the
> token role in browser JavaScript**, comparing the current user's profile id to the booking's
> tutor profile id and requesting `publisher` for the tutor, `subscriber` for the student — and
> the student then publishes microphone audio on that subscriber token anyway, which works only
> because Agora's co-host authentication is switched off for the project. **This rebuild does
> neither.** Step 2 above stands unchanged: the role is derived server-side in
> `/api/agora/token` from the booking row, and **both participants receive a `publisher` token**,
> because a subscriber token forbids the audio the student is required to send the moment that
> console setting is ever turned on. The tutor/student asymmetry is real but it is a *media*
> decision — the client wrapper publishes camera + microphone for the tutor and microphone only
> for the student — not a token-role decision. An earlier revision of this note described
> Bubble's client-side split as "the same publisher/subscriber split this section already
> specifies"; that was wrong on both halves (§9 step 2 specifies an unconditional `publisher`,
> and a client-chosen role is precisely what this section exists to prevent) and is corrected
> here. See DECISIONS, Phase 6 Part 3A. Bubble's channel naming
> (`"channel_" + tutor profile id`, one channel per tutor rather than per booking) is **not**
> reproduced here; `agora_channel = session_{booking_id}` (§4.3) is a deliberate, safer departure,
> not an oversight. An earlier reading of the live app as "Agora is broadcast-only" was
> investigated directly and found wrong — recorded so it is not re-derived. Separately,
> `live_classroom` hosts an unrelated, subscriber-only Agora element previewing the tutor's
> broadcast (channel keyed to the tutor's profile id, shown only while the tutor is live) — a
> broadcast preview widget, not a session, and not evidence that §4.6's broadcasts are anything
> other than net-new. See DECISIONS, Finding A.

> **Part 3A implementation (Phase 6, `feat/phase6-part3a-session-room`).** The room shell and the
> join path are built; the controls are not.
>
> - **`POST /api/agora/token`** takes `{ bookingId }` and returns
>   `{ token, uid, appId, channel, expiresAt, isTutor }`. Participation, booking state and role are
>   one pure decision in `lib/agora/session-access.ts`, unit-tested without a database. A booking
>   that does not exist and one the caller is not part of return the **same 404**, so the endpoint
>   cannot be used to discover booking ids.
> - **`isTutor` is the only asymmetry that reaches the client**, and it is server-derived. The
>   wrapper publishes camera + microphone for the tutor and microphone only for the student; both
>   hold a `publisher` token (step 2).
> - **First-join writes happen in the token route**, mirroring §7.7 step 4 — the sibling LessonSpace
>   flow stamps `*_joined_at` inside its own join route. One idempotent `UPDATE`
>   (`db/queries/sessions.ts`) backfills `agora_channel` if null, stamps the arriving party's
>   `*_joined_at`, and sets `started_at` **only on the write that makes both non-null** (§4.3: "first
>   moment both were present"). It is a single statement referencing the target row — not a CTE —
>   so that under READ COMMITTED a concurrent join re-evaluates against the locked row instead of
>   writing back a stale null. Status is untouched: instant bookings are already `in_progress` from
>   the accept transaction (§7.4).
> - **Route placement:** `/session/[bookingId]` lives in a new `(session)` route group, because it is
>   the one authenticated area both roles enter — a `requireRole` in either existing group's layout
>   would redirect half the room away from its own session. The layout guards signed-in + onboarded
>   + not suspended; participation is checked by the page, and again by the token route.
> - **A `scheduled` booking reaching `/session/` renders an honest Phase 7 placeholder.** Its real
>   home is `/classroom/[bookingId]` (§6, §7.7). Nothing is stubbed and no join is faked.
> - **Deferred to Part 3B:** the elapsed timer, credits consumed/earned, mute and camera toggles,
>   screen share, chat, end-session, `network-quality`, and the 80%-TTL renewal in step 6. The
>   `toggleMic` / `toggleCamera` / `startScreenShare` surface named above is therefore not yet on
>   `lib/agora/client.ts`, which exposes `join` and `leave` only.
> - **The warm ping is live** in `cron/sweep-presence`, hitting the service's `/ping` endpoint. It
>   never throws and cannot fail the sweep.

> **Part 3B amendment (`feat/phase6-part3b-end-session`).** Step 2's checks gain
> one more: a booking whose booked duration has elapsed is refused a token even
> while its row still reads `in_progress`. The status flips only when some actor
> performs the transition, and this check must not wait for one — otherwise a
> client could hold the room open in the window between the deadline and the
> write. `checkSessionAccess` therefore takes `now` and returns an `elapsed` flag
> on the 409; the route acts on it by closing the booking out **best-effort**,
> because the refusal is the enforcement and must not depend on a write
> succeeding. Participation is still checked first, so an elapsed booking
> belonging to somebody else returns the same 404 as one that does not exist.
>
> Today this route fires on join only, so for a 30- or 60-minute session it runs
> once, *before* the deadline — it is the **re-entry** guard (refresh, second tab,
> reconnect), and the actor at the deadline is the `getSessionState` Server
> Action. It becomes the continuous guard for free when step 6's renewal lands.
> **The hard stop must not be allowed to rest on the token's own one-hour
> expiry**, which would accidentally half-work for a 120-minute session and not at
> all for a 30-minute one.
>
> Still deferred after Part 3B: the §9 `toggleMic` / `toggleCamera` /
> `startScreenShare` surface, `network-quality`, chat, and the step 6 renewal.

---

## 10. Design system

The brand is established and carries over exactly. This section exists so Claude Code produces the current visual identity rather than inventing one.

### 10.1 Tokens

```css
@theme {
  /* Brand */
  --color-purple-500: #8434A8;   /* primary on LIGHT surfaces; FILL-ONLY on ink */
  --color-purple-700: #6B2A8A;   /* hover */
  --color-purple-100: #F3E8F8;   /* tints, selected backgrounds */

  /* Ink — ONE surface, hue-210 ramp (sampled from the Bubble shell). ink-900 is
     the only ink surface; ink-800 is an INTERACTION state, never a surface. */
  --color-ink-950:    #263544;   /* active nav item, modal scrim */
  --color-ink-900:    #34495E;   /* THE ink surface: shell, topbar, cards */
  --color-ink-800:    #3E566E;   /* hover / pressed on ink — NOT a surface */
  --color-ink-700:    #4A6076;   /* borders, dividers on ink */
  --color-ink-300:    #ACBAC8;   /* muted / secondary text on ink (4.69:1) */

  --color-gold-400:   #FEE401;   /* CTA + focus ring on ink — high contrast */
  --color-live-500:   #44C96F;   /* live indicators only — dots, pulses (non-text) */
  --color-live-400:   #4FD179;   /* LIVE badge fill — carries ink-900 text (4.75:1) */
  --color-ink-1000:   #1C2733;   /* near-black — public footer surface ONLY, darker than ink-950 (Bubble parity) */

  /* Neutrals */
  --color-white: #FFFFFF;
  --color-gray-50: #FAFAFB;
  --color-gray-200: #E7E5EA;
  --color-gray-500: #6E6880;
  --color-gray-700: #453D57;

  /* Semantic */
  --color-success: #44C96F;
  --color-warning: #F5A524;
  --color-danger:  #E5484D;

  /* Type */
  --font-sans: "DM Sans", ui-sans-serif, system-ui, sans-serif;

  /* Radii */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-full: 9999px;

  /* Focus rings — one per surface (§10.3) */
  --focus-ring:         var(--color-purple-500);  /* light surfaces */
  --focus-ring-on-ink:  var(--color-gold-400);    /* ink surfaces */
}
```

Type scale (DM Sans throughout, weights 400/500/700): display 40/44, h1 32/38, h2 24/30, h3 20/26, body-lg 17/26, body 15/24, small 13/20, caption 12/16.

Spacing on a 4px grid. **Pages are full-bleed by default** (`feat/browse-page-ink-theme`, superseding the earlier "boxed at 1200px" default below): a page's outer wrapper spans the full viewport width with a small edge gutter, `px-4` mobile / `px-6` desktop (16px/24px), matching the gutter already used by `PublicHeader`/`PublicFooter`/the browse body. This is a page-*wrapper* rule only — an individual component (a settings form, an auth card) can still choose its own narrower natural width (e.g. `mx-auto max-w-2xl` on `/tutor/profile`, `mx-auto w-full max-w-xl` on `/onboarding`); the fix is that the page shell no longer forces a 1200px box around everything inside it.

~~Container max-width 1200px, page gutter 20px mobile / 24px desktop (desktop gutter tightened from 32px in the density pass).~~ **Superseded.** The `container-page` `@utility` (1200px max-width, defined in `globals.css`) still exists and is still valid CSS, but it is **no longer applied as the page-level default** anywhere — it was pulled from `PublicHeader`, `PublicFooter`, `AppShell`'s content panel, the `(auth)` layout header, `/tutors/[slug]`, and `/dev/kitchen-sink` in the same change that made `/` full-bleed (that earlier change said the browse page was a one-off exception; it wasn't — full-bleed is now the intended layout everywhere). `container-page` remains available for the rare page that wants a boxed reading-width; today only `/suspended` still uses it.

**The ink surface (parity with the Bubble build).** The authenticated app is an **ink shell** (sidebar + topbar) wrapping a **white content panel**, with **ink cards** inside that panel — ink shell → white panel → ink cards. There is exactly **one** ink surface (`ink-900`, `#34495E`, sampled from the live build; sidebar and cards are the same value). Elevation-by-lightness is unavailable: an ink card, a dropdown over the ink topbar, or the drawer contents cannot separate from their background by being lighter — they separate by an `ink-700` border or a shadow. `ink-800` is an **interaction state** (hover/pressed), never a surface; `ink-950` is the darker recess (active nav item, modal scrim) — **not** a card sub-panel. **A card is one `ink-900` fill throughout:** the `TutorCard` media/avatar band is the *same* `ink-900` as its content and separates only by an `ink-700` bottom border (an earlier build tinted that band `ink-950`; corrected — a card must not carry two tones). Verified contrast on `ink-900`: white body 9.29:1, `ink-300` secondary 4.69:1, `live-400` badge fill 4.75:1 (its `ink-900` text 4.75:1), gold focus ring 7.22:1 — all pass.

**Rules:** gold is for primary CTAs only, never for body text or borders. Live green appears only on live status — never as a generic success colour in the same view as a LIVE badge. **Purple on ink is fill-only, carrying white text** (white on `purple-500` = 6.91:1): at **1.34:1** purple fails not just the 4.5:1 text floor but the 3:1 non-text UI floor, so it is never text, a border, a focus ring, or an active-indicator bar on ink — gold does that job. On ink, body/headings/names use white freely, secondary text uses `ink-300` (4.69:1). Purple remains the primary on light surfaces, unchanged.

**Public shell (browse page, added `feat/browse-page-ink-theme`).** The public `PublicHeader` and the `/` (browse) filters rail now render on `ink-900`, mirroring the Bubble shell — parity with the authenticated ink shell, extended to the public browse experience. Wordmark and nav links are white, the active nav item and the wordmark accent are gold (7.22:1). **Neither the header CTAs nor the filters rail use a purple fill on ink** — the "Sign up" button and checked checkboxes/switch use `bg-gold-400` + `text-ink-900` (7.22:1) instead, and "Log in" / "Clear all" use a white-text ghost treatment (new `Button` variants `ink` / `ink-ghost`) — purple-on-ink is avoided here entirely rather than relied upon as fill-only, to keep the public shell visually distinct from the purple-primary marketing surfaces. Measured: white body 9.29:1, gold-on-ink 7.22:1, `ink-300` hover/secondary 4.69:1, white on the `ink-800` hover state 7.61:1 — all pass.

`PublicFooter` renders on the new `ink-1000` (near-black, see token above), one step darker than the header's `ink-900`, matching the Bubble footer. All footer text is white (15.14:1); the gold hover/accent measures 11.76:1. `ink-1000` is scoped to the public footer only — it is not part of the authenticated ink shell (§10.1 "ONE ink surface" still holds for the app shell/cards; `ink-1000` is an additional, footer-specific surface, not a replacement).

`TutorFilters` (the shared filter form used by both the desktop rail and the mobile drawer) takes a `surface: "light" | "ink"` prop (default `"light"`) so the mobile drawer — a separate, light-surface container — is unaffected; only the desktop `/` sidebar passes `surface="ink"`. Unchecked checkbox borders on ink use `ink-300` (4.69:1, clears the 3:1 non-text floor); the `Sort` select gets its own on-ink treatment (`ink-800` fill, `ink-700` border, white value text) so it doesn't inherit the shared component's light-surface white background.

### 10.2 Component inventory

Port the 27 NT- global styles into these components. Building this list in Phase 2 before any page work means no page ever needs a one-off inline style — which is what caused the "named colour variables only partially wired" problem.

`Button` (primary/secondary/ghost/danger × sm/md/lg, loading, icon), `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch`, `DatePicker`, `TimePicker`, `Label`, `FieldError`, `Card`, `StatCard`, `Badge`, `LivePill`, `Avatar` (with initials fallback), `RatingStars`, `SubjectChip`, `Tabs`, `Modal`, `Drawer`, `Toast`, `Tooltip`, `DropdownMenu`, `Pagination`, `EmptyState`, `Skeleton`, `Spinner`, `ProgressRing` (the 60-second request countdown), `PriceTag`, `CreditBalance`, `Table`, `Breadcrumb`, `Alert`.

Composed: `TutorCard`, `BookingCard`, `SlotPicker`, `AvailabilityGrid`, `MessageBubble`, `ConversationListItem`, `TransactionRow`, `VideoTile`, `SessionControlBar`, `IncomingRequestModal`, `WaitingForTutorModal`.

**Surface variants.** `Card`/`StatCard` carry an explicit `surface="ink"` variant (ink-900 fill, ink-700 border, white text). `PriceTag` and `RatingStars` take a `surface="ink"` prop — because they compose onto the ink `TutorCard`: `PriceTag` numerals go white (unit/USD → ink-300); `RatingStars` keeps gold fill (7.22:1 on ink) with empty stars in ink-700 and the value label white/ink-300. `LivePill` and fill-based `Badge`s are surface-agnostic. `Breadcrumb` and `Pagination` stay **light-surface only** with no ink variant — they render on the white content panel (breadcrumbs in the topbar region were the reason the topbar could not go ink under the old model; under the ink-shell model breadcrumbs live in the white panel, not the ink topbar).

### 10.3 Quality floor

Responsive from 360px. Visible keyboard focus rings, 2px width / 2px offset, **surface-specific**: `--focus-ring` (purple-500) on light surfaces, `--focus-ring-on-ink` (gold-400) on ink — a purple ring on ink is invisible (1.34:1), so this is an accessibility requirement, not a preference. `prefers-reduced-motion` respected. All interactive elements at least 44×44px on touch. Real `<button>`/`<a>` elements, labelled inputs, `aria-live` on toasts and the session timer. Loading and empty states designed, not afterthoughts — an empty bookings list invites the student to browse tutors.

---

## 11. Email

React Email templates in `emails/`, sent via Resend. Every send is best-effort and never blocks a transaction.

Student: verify email, password reset, booking confirmed (with `.ics`), reminder 24h, reminder 1h, booking cancelled by tutor, refund issued, credits purchased, session summary.
Tutor: welcome, application approved, application rejected, new booking, booking cancelled, reminder 1h, withdrawal requested (receipt), withdrawal paid, withdrawal rejected.
Admin: new tutor application, new withdrawal request, payment capture failure.

All emails carry an unsubscribe link for non-transactional types, and honour a `notification_preferences` jsonb on `profiles`.

---

## 12. Scheduled jobs

**Scheduled by Supabase `pg_cron` + `pg_net`, not `vercel.json` (amended Phase 6 Part 1).** Vercel
**Hobby** — the deploy target — runs cron jobs at most **once a day**, so a `vercel.json` schedule
could not honour any of the intervals below. `pg_cron` runs inside the same Postgres project as the
data and calls each route over `pg_net` with the bearer header, so the routes stay ordinary HTTP
handlers and nothing about them is Vercel-specific. Setup SQL:
`drizzle/snippets/pg_cron_sweep_presence.sql` and `drizzle/snippets/pg_cron_expire_requests.sql`
(the second assumes the first has run — it reuses the same extensions and the same two Vault
secrets, and `vault.create_secret` raises on a duplicate name); per-environment steps in
`docs/RUNBOOK.md`.

| Route | Schedule | Status |
|---|---|---|
| `/api/cron/sweep-presence` | `*/5 * * * *` | **built** (Phase 6 Part 1) |
| `/api/cron/expire-requests` | `* * * * *` | **built** (Phase 6 Part 2) |
| `/api/cron/expire-unpaid` | `*/10 * * * *` | deferred (Phase 8 — not load-bearing, §4.2) |
| `/api/cron/complete-sessions` | `*/15 * * * *` | Phase 6 Part 3C |
| `/api/cron/release-earnings` | `0 * * * *` | Phase 8 |
| `/api/cron/booking-reminders` | `*/15 * * * *` | Phase 10 |
| `/api/cron/reconcile-wallets` | `0 3 * * *` | Phase 8 |

Every handler: verify `Authorization: Bearer ${CRON_SECRET}` — and **fail closed with 503 when the
variable is unset**, so a missing secret can never degrade into "no auth required" — be idempotent,
log a structured summary of what it changed, and return counts. Each is also individually invocable
from `/admin/settings` with a "run now" button for debugging.

- **sweep-presence** — stale tutors offline, stale broadcasts ended, their pending requests expired; also pings the Agora token service to keep it warm. **The work set is derived from the `live_tutors` view** (`is_live = true` AND not in the view), never from a threshold of its own — see §7.5. Phase 6 Part 1 built the tutors-offline half and Part 2 added the request expiry (returned as `pendingRequestsExpired`); stale broadcasts and the Agora warm-ping remain `TODO(Phase 6 Part 3)` in the handler.
- **expire-requests** — `session_requests` `pending` past `expires_at` → `expired`. Built in Phase 6 Part 2; returns `{ ok, job, expired, expiredIds, durationMs }`. **Tidy-up, not enforcement**: the accept transaction refuses (and terminally expires) a request past its deadline on its own, and the "one pending request at a time" read ignores rows past theirs, so an hour of this job failing strands nobody — it keeps the table honest for the inbox, the waiting modal, and an operator reading what happened.
- **expire-unpaid** — `bookings` in `pending_payment` past 20 minutes → `expired`, releasing the slot.
- **complete-sessions** — two predicates, because the two booking types have
  different clocks. **Scheduled:** past `scheduled_end_at + 30m` still
  `confirmed`/`in_progress` → `completed` (or `no_show_*` if one party never
  joined). **Instant:** `scheduled_end_at` is NULL for every instant booking
  (§4.3), so the scheduled predicate matches none of them — the instant clock is
  `started_at + duration_minutes <= now()`, and the cron **must call the shared
  fragment `sessionElapsedSql` in `db/queries/sessions.ts` rather than restate
  it** (authored in Part 3B, which enforces the same deadline at the token route,
  the room read and the end-session action). A restated copy is how a second,
  subtly different notion of "elapsed" gets into the codebase on the one column
  that decides what a student is billed. An instant booking with `started_at`
  NULL never elapses and is the cron's `no_show_*` case, classified from
  `student_joined_at` / `tutor_joined_at`. Both predicates then create
  `tutor_earnings` (§7.11) from the `completed` row's `price_credits` and
  `ended_at`. This line previously described only the scheduled half; that half
  was written down and the instant half was not, which is the half that could
  have been implemented wrongly. Amended in Phase 6 Part 3B.
- **release-earnings** — `held` → `available` where `available_at <= now()`.
- **booking-reminders** — 24h and 1h emails, marked sent so they don't repeat.
- **reconcile-wallets** — assert `wallets.credit_balance = sum(credit_transactions.delta)` per user; log and alert on any mismatch. This is the drift alarm.

---

## 13. Repository structure

```
nowtutors/
├── CLAUDE.md
├── docs/
│   ├── SPEC.md                    ← this file
│   ├── RUNBOOK.md                 ← deploy + third-party config checklist
│   └── DECISIONS.md               ← append-only log of choices made mid-build
├── drizzle/                       ← generated migrations, committed
├── emails/
├── public/
├── src/
│   ├── app/
│   │   ├── (public)/
│   │   ├── (auth)/
│   │   ├── (student)/dashboard/
│   │   ├── (tutor)/tutor/
│   │   ├── (session)/
│   │   ├── admin/
│   │   └── api/
│   ├── components/
│   │   ├── ui/                    ← Section 10.2 primitives
│   │   └── features/              ← composed, by domain
│   ├── db/
│   │   ├── schema/                ← one file per domain: identity, booking, money, messaging
│   │   ├── queries/               ← read functions, typed returns
│   │   └── index.ts
│   ├── lib/
│   │   ├── auth/                  ← guards, session helpers
│   │   ├── credits/ledger.ts      ← the only writer to wallets
│   │   ├── agora/
│   │   ├── lessonspace/
│   │   ├── paypal/
│   │   ├── availability/          ← slot computation, heavily unit-tested
│   │   ├── email/
│   │   └── settings.ts            ← cached platform_settings accessor
│   ├── actions/                   ← Server Actions, one file per domain
│   └── hooks/
└── tests/
    ├── unit/
    └── e2e/
```

---

## 14. Explicitly out of scope for v1

Stated so scope stays where it is. Each of these is a separate conversation, and — consistent with how Agora, PayPal, the credit system, and LessonSpace were handled — a separate line item.

- Alternative payout methods (Wise, Payoneer, Alipay, WeChat Pay). The schema is extensible; the integrations are not built. **The prerequisite is still Noora confirming what tutors actually use.**
- Data migration from Bubble (confirmed clean start).
- Group sessions / multi-student classrooms.
- Session recording and playback.
- Native mobile apps.
- Tutor packages, bundles, or subscriptions.
- Coupons and referrals.
- Multi-currency display.
- Internationalization beyond English.
- Analytics dashboards beyond the admin overview counts.
- SEO content pages and blog.

---

## 15. Testing

**Unit (Vitest), non-negotiable coverage:**
- Availability slot computation — DST boundaries, cross-timezone, exception overrides, back-to-back bookings.
- Ledger — insufficient balance, concurrent debit under lock, idempotent credit on duplicate reference.
- Pricing — the `hourly_rate_credits × duration_minutes / 60` formula (scheduled and instant), round-up behaviour, platform fee.
- Presence staleness — the `live_tutors` boundary at exactly the threshold.
- Filter composition — every combination of set/unset filters produces the intended SQL.

**DB-backed integration (Vitest against the test Supabase project), non-negotiable coverage:**

A rule enforced *in SQL* cannot be unit-tested — the unit suite above runs without a database by
design, and no fake reproduces how Postgres re-evaluates a blocked `UPDATE` under READ COMMITTED.
Anything whose correctness is a concurrency property of the statement itself belongs here instead.

- **`stampSessionJoin` — the `started_at` write (§4.3, §7.4).** Four properties, driven on **two
  separate connections in two separate transactions** so the second genuinely blocks on the first's
  row lock and re-evaluates on release: (1) sequential both-party join records the **second**
  arrival's moment, not the first's; (2) a concurrent join writes `started_at` **exactly once** and
  leaves **neither** `student_joined_at` nor `tutor_joined_at` null; (3) a lone participant never
  starts the clock; (4) re-stamping either party afterwards — a refresh, or token renewal — moves
  nothing. Awaiting one call and then the other does not satisfy this and must not be written that
  way: it passes against a known-broken implementation.

**Run with `pnpm test:db:test`; it targets the disposable test project only, guarded by the
hardcoded `TEST_PROJECT_REF` (RUNBOOK, "Test Supabase project"). It is deliberately NOT part of the
CI `verify` job** — the runner has no Postgres and no `.env.test`, so including it would fail the
required check for missing infrastructure rather than for a broken assertion. It is a local gate,
run before changing a column whose semantics are enforced in SQL.

**E2E (Playwright), the paths that lose money or trust:**
1. Student signs up → buys credits (PayPal sandbox) → books a scheduled session → joins the classroom.
2. Tutor goes live → student requests → tutor accepts → both land in the session → session ends → earnings appear.
3. Tutor goes live → student requests → **tutor closes the browser** → assert the tutor disappears from the Live-now list (`/tutors?live=1` — the browse filter's actual parameter) within the staleness window **without the sweep running**, and the request expires. *This is the regression test for the original bug.* The presence half is built in Phase 6 Part 1 (`tests/e2e/presence-ungraceful-exit.spec.ts`); the request-expiry half was un-stubbed in Part 2 as a second test in the same file, asserting that an unanswered request charges **nothing** (wallet balance read before and after, not just the modal's wording) and that it stops holding the student's one-pending-request slot — **with neither cron running**, so both are properties of the request path rather than of a job. **Not yet in CI, but no longer blocked on infrastructure** — a disposable test Supabase project now exists (ref `uietkphpfqaicbndunwt`, wired via the `db:*:test` scripts; RUNBOOK "Test Supabase project"), so the spec can be seeded against a project that is not production. What remains is a green run of the spec itself (PROGRESS.md).
4. Tutor requests withdrawal → admin marks paid → balances reconcile.
5. Student cancels inside and outside the free window → correct refund in both cases.

**Manual, documented in `RUNBOOK.md`:** one real PayPal card transaction with a real end user (cannot be run from Port Harcourt), LessonSpace waiting-room behaviour, Agora quality on a poor connection, email rendering in Gmail/Outlook/Apple Mail.

---

## 16. Build order

Each phase ends in a working, deployable app. Do not begin a phase before the previous one's acceptance criteria pass.

**Phase 0 — Foundation.** Next.js + TS + Tailwind scaffold, Supabase project (dev + prod), Drizzle wired, `.env.example`, Sentry, CI running lint + typecheck + unit tests, deployed to Vercel.
*Accept:* an empty styled page is live at a preview URL; `pnpm db:migrate` works against dev.

**Phase 1 — Data layer.** Every table from Section 4 as migrations. RLS policies from Section 5. `live_tutors` view. The `is_live`/`last_seen_at` trigger. Seed script: subjects, `platform_settings`, one admin, three tutors, two students, sample bookings.
*Accept:* migrations run clean on an empty database; RLS verified by attempting cross-user reads with the anon key and being denied.

**Phase 2 — Design system.** Tokens, every primitive in Section 10.2, a `/dev/kitchen-sink` page rendering all of them in all states. Layouts: public header/footer, authenticated shell with sidebar.
*Accept:* kitchen sink renders correctly at 360px and 1440px; no hardcoded hex anywhere outside the token file.

**Phase 3 — Auth, onboarding, profiles, browse.** Signup/login/Google/reset, onboarding for both roles, tutor profile editor, `/tutors` with all filters, `/tutors/[slug]`, avatar upload and rendering, admin tutor approval queue.
*Accept:* a tutor can register, be approved, and be found by a student using every filter; avatars render.

**Phase 4 — Availability and scheduled bookings (credits only).** Availability editor, slot computation, booking flow paying with credits, both booking lists and detail pages, cancellation with refund, admin credit adjustment so wallets can be funded for testing.
*Accept:* end-to-end scheduled booking and cancellation with correct ledger entries, verified across two timezones.

**Phase 5 — Payments.** PayPal orders, capture, webhook, credit packages, wallet page and history, direct booking payment, `/admin/payments` reconciliation view.
*Accept:* sandbox purchase credits correctly; replaying the webhook does not double-credit.

**Phase 6 — Presence and instant sessions.** Heartbeat, go-live toggle, `session_requests` with Realtime both directions, `/session/[bookingId]` with Agora, `/api/agora/token` with authorization, instant billing (flat, upfront, at the `hourly_rate_credits × duration_minutes / 60` formula — §7.4), sweep-presence cron.
*Accept:* E2E test 3 (ungraceful tutor exit) passes.

**Phase 7 — LessonSpace.** Join route, room creation, role-based launch, `/classroom/[bookingId]`, join-window logic.
*Accept:* both parties join the same room with correct roles and the session status transitions properly.

**Phase 8 — Earnings, withdrawals, admin.** Earnings accrual and release, withdrawal request flow, full admin panel, audit log, remaining cron jobs.
*Accept:* E2E test 4 passes; `reconcile-wallets` reports zero drift on seeded data.

**Phase 9 — Messaging and broadcasts.** Conversations, threads, Realtime, unread badges; broadcast create/host/view, `/live`.
*Accept:* two browsers exchange messages in real time; a broadcast is watchable by two viewers.

**Phase 10 — Email, polish, launch prep.** All templates, reminder cron, empty/loading/error states everywhere, accessibility pass, Lighthouse pass, `RUNBOOK.md` complete, production env configured, LessonSpace waiting room set, PayPal live credentials, one supervised real-card test.
*Accept:* the runbook checklist is fully ticked.

Phases 0–2 are fast. Phases 4, 6, and 8 carry the real risk. Phase 9 is the most deferrable if timelines compress.

---

## 17. Runbook (create in Phase 0, complete through the build)

`docs/RUNBOOK.md` covers: Supabase project creation and RLS verification steps; Vercel env var setup per environment; Google OAuth consent screen and redirect URIs; PayPal app creation, sandbox vs live credentials, webhook registration and the webhook id; **LessonSpace waiting room setting (dashboard, not code)**; Agora project settings and token service health check; Resend domain verification and DNS records; DNS cutover for nowtutors.com; first-admin promotion SQL; rollback procedure.

---

## 18. Resolved decisions (formerly open questions)

These were the open questions gating later phases. They are now **settled (2026-08-20)**. Each
value lives in `platform_settings` unless noted, so a change is a settings edit, not a rebuild. The
SPEC sections each answer affects were updated in the **same commit** as this resolution, per the
CLAUDE.md standing rule. Original numbering is kept so existing cross-references still resolve.

**Phase 1 (data model):**
1. **Session durations** — fixed menu of **30 / 60 / 90 / 120 minutes**, not tutor-configurable
   (`session_durations = [30, 60, 90, 120]`). **Amended (Phase 6 pre-build, 2026-08-22):** the live
   Bubble app offers all four durations on both the instant and scheduled booking popups; the
   three-value menu would have silently dropped the 120-minute option at cutover. See DECISIONS
   Phase 6.
2. **Reviews** — **dropped for v1** (no Review type in the current Bubble build; recorded in the
   Phase 1 DECISIONS). No `reviews` table; rating stays a denormalized scalar on `tutor_profiles`.
3. **Broadcast chat** — broadcasts are **net-new** functionality beyond current parity (Phase 1
   decision), so live broadcast chat is **deferred to the broadcast phase** and is not a v1-parity
   question. (Not covered by the resolution batch that settled the rest — see DECISIONS.)

**Phase 4 (bookings):**
4. **Cancellation & refunds** — **no cancellation path for either party, and no refunds** on the
   normal path. The only unwind is an **admin force-cancel + refund** in `/admin/bookings`
   (`cancellation_enabled = false`). See §7.3.
5. **Booking window** — students may book at most **7 days ahead** (`max_booking_days_ahead = 7`);
   **minimum notice keeps the existing default** (`min_booking_notice_minutes = 120`).
6. **Rescheduling** — **not supported**, and there is no cancel-and-rebook either (no cancel path);
   admin force-cancel is the only change mechanism.

**Phase 5 (payments):**
7. **Credit rate & packages** — **⚠️ superseded (2026-08-20) by the credits-are-money amendment:**
   a credit is a **purchased currency, not a unit of time**. The `credit_minutes_ratio = 3` /
   "1 credit = 3 minutes" rule is **withdrawn entirely**; there is no credit-to-minutes ratio.
   Session price is `hourly_rate_credits × duration_minutes / 60`, rounded up (§7.3, §7.4). Five
   package tiers (§4.7 / seed) stand on their own — Starter 5cr/$9.99, Standard 15cr/$24.99,
   Popular 30cr/$39.99, Pro 60cr/$67.99, Premium 100cr/$97.99 — with **no** credit-to-USD rate and
   **no** credit-to-minutes ratio stated on the purchase page. (Bubble's per-package "minutes"
   labels are inconsistent marketing copy and are **not** seeded; see DECISIONS.)
8. **Platform fee** — **25%** (`platform_fee_percent = 25`); tutor keeps 75%. **Confirmed as a live
   commercial term (Bubble live-app investigation, 2026-08-24):** Bubble's withdrawal maths pays out
   `gross × 0.75`, matching this figure exactly — see DECISIONS, Decision 6.

**Phase 6 (instant sessions):**
9. **Instant pricing** — **flat, charged upfront** at booking creation, priced by the **same formula
   as scheduled**: `hourly_rate_credits × duration_minutes / 60`, rounded up (**superseded** the old
   `duration_minutes / 3` rule, 2026-08-20 credits-are-money amendment). Debited via the ledger in
   the same transaction. No metering, no hold, no per-minute rate. Session length is enforced
   server-side from `bookings.started_at`. See §7.4.

**Phase 8 (withdrawals):**
10. **Earnings hold & minimum withdrawal** — hold **48 hours** (`earnings_hold_hours = 48`);
    minimum withdrawal **$30** (`min_withdrawal_usd = 30`), **enforced server-side** in the
    withdrawal action, not only by a disabled button (see DECISIONS).

**Cross-cutting:**
11. **Canonical subject list** — resolved to the 26-subject Bubble export. That list currently lives
    only on `phase-3-auth-onboarding-browse` (`cf4e5b8`); `main`'s seed intentionally keeps its 8
    placeholders to avoid a `seed.ts` rebase conflict. Two name corrections are queued on the
    deferred-for-rebase list (see DECISIONS).
12. **Tutor approval** — stays **manual**.
13. **Dual role** — **no**. One account, one role (matches current single-role behaviour).

---

## 19. Note on scope and framing

Worth putting in writing before this starts: this is a **new build**, not maintenance on the existing one. It reproduces roughly eighteen months of accumulated functionality on a different foundation, and it carries its own timeline, its own cost, and its own testing burden — the current Bubble app also has to keep running until cutover.

The technical case for it is real: the classes of bug that have consumed the most time recently (stale live status, silently dropped search constraints, conditions that won't fire on nested fields, workflows that duplicate themselves across environments, credit reconciliation) are Bubble-specific failure modes that mostly cease to exist in code. That's a genuine argument. But it's an argument to make deliberately, with a number attached, rather than something to start and then have to justify halfway through.

Recommend agreeing three things with Noora in writing before Phase 0: the fixed scope (this document, Section 14 included), the price, and what happens to the Bubble app during and after the transition.
