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

**3.2 `is_live` is a real boolean.** No `"yes"`/`"no"` text. The type system enforces it.

**3.3 Empty search constraints fail loudly.** Bubble's `ignore_empty_constraints` silently dropped filters. In SQL, a filter with a null parameter is a bug that surfaces immediately. Filters are built explicitly: a helper composes the `WHERE` clause from only the filters the user actually set, and every composed condition is unit-tested.

**3.4 Instant session requests are rows, not flags, and are pushed, not polled.**
`has_live_request` on the user record becomes a `session_requests` table. The tutor's browser holds one Supabase Realtime subscription filtered to their own pending requests. No 10-second polling loop, no duplicated workflows in a header and a page, no two-level-deep condition that won't fire.

**3.5 Scheduled work runs on Vercel Cron.** Declared in `vercel.json`, versioned, idempotent, and impossible to accidentally start twice — which removes the whole class of "self-scheduling workflow started in two environments" failure.

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
> `tutor_profiles.instant_rate_credits_per_minute` made nullable (instant price derives from
> `hourly_rate_credits / 60`). `bookings.reminder_24h_sent_at` / `reminder_1h_sent_at` added.
> `credit_transactions.type` gains `instant_hold` / `instant_release` / `instant_capture`.
> The `reviews` table is deferred (no Review type in the current build). `broadcasts` /
> `broadcast_viewers` are NET-NEW, not parity. `platform_settings.presence_stale_seconds`
> removed (threshold baked into the `live_tutors` view); `max_instant_minutes`,
> `min_instant_credits`, `credit_packages` added. Booking overlap is a scheduled-only GiST
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
| instant_rate_credits_per_minute | integer **nullable** | optional; instant price derives from `hourly_rate_credits / 60` |
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

Indexes: `(is_live, last_seen_at)`, `(approval_status)`, `(rating_avg desc)`, `(hourly_rate_credits)`, GIN on `languages`.

**`tutor_payout_details`** — sensitive payout destination, split off `tutor_profiles` (Decision A) so "anyone reads approved tutor_profiles" cannot leak it. Owner + admin RLS only.

`tutor_id uuid unique FK → profiles.id, payout_method enum('paypal') default 'paypal', paypal_email text`

**`subjects`** — `id, name, slug unique, icon, sort_order, is_active`. Seeded (Section 18 open question: the canonical list).

**`tutor_subjects`** — `tutor_id, subject_id, level enum('beginner','intermediate','advanced','all')`. PK `(tutor_id, subject_id)`.

### 4.2 Availability

**`availability_rules`** — recurring weekly availability.

`tutor_id, weekday smallint (0=Sunday), start_time time, end_time time, is_active boolean`

Stored in the **tutor's** timezone (`tutor_profiles.user_id → profiles.timezone`); converted to UTC at query time. Constraint: `end_time > start_time`.

**`availability_exceptions`** — one-off overrides.

`tutor_id, date date, is_available boolean, start_time time null, end_time time null`

`is_available = false` with null times blocks the whole day.

Bookable slots are computed, not stored: expand rules for the requested date range, subtract exceptions, subtract existing bookings, subtract slots starting less than `min_booking_notice_minutes` from now.

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
| billed_minutes | integer | instant: actual; scheduled: planned |
| cancelled_by | uuid FK → profiles.id |  |
| cancellation_reason | text |  |
| student_notes | text | "what I want help with" |
| reminder_24h_sent_at | timestamptz | idempotency stamp for the 24h reminder cron (Decision #2) |
| reminder_1h_sent_at | timestamptz | idempotency stamp for the 1h reminder cron |

`status` enum: `pending_payment`, `confirmed`, `in_progress`, `completed`, `cancelled_by_student`, `cancelled_by_tutor`, `no_show_student`, `no_show_tutor`, `expired`.

Indexes: `(student_id, status)`, `(tutor_id, scheduled_start_at)`, `(status, scheduled_start_at)` for cron. Overlap prevention is a scheduled-only GiST exclusion constraint `bookings_no_overlap` (`tutor_id =`, `tstzrange(scheduled_start_at, scheduled_end_at) &&`) `where type='scheduled' and status in ('confirmed','in_progress')` — requires `btree_gist` (Decision #6).

**`session_requests`** — the instant-session handshake. Replaces `has_live_request`.

| Column | Type | Notes |
|---|---|---|
| student_id | uuid FK |  |
| tutor_id | uuid FK |  |
| subject_id | uuid FK | nullable |
| message | text | optional note from student |
| status | enum `pending` \| `accepted` \| `declined` \| `expired` \| `cancelled` |  |
| booking_id | uuid FK → bookings.id | set on accept |
| expires_at | timestamptz not null | `now() + 60 seconds` |
| responded_at | timestamptz |  |

Index `(tutor_id, status)`, `(status, expires_at)`. Realtime enabled on this table.

**`reviews`** — **DEFERRED (not built in Phase 1).** No Review type exists in the current Bubble build (Decision C). Ratings are denormalized scalars on `tutor_profiles` (`rating_avg`, `rating_count`) with nothing writing them yet. If reviews become a feature: `booking_id uuid unique FK, student_id, tutor_id, rating smallint check (rating between 1 and 5), comment text, is_published boolean default true`.

### 4.4 Money

**`wallets`** — `user_id uuid unique FK, credit_balance integer not null default 0 check (credit_balance >= 0)`. Cache only; authoritative value is the ledger sum. A nightly job asserts they agree and alerts on drift.

**`credit_transactions`** — append-only. Never updated, never deleted.

| Column | Type | Notes |
|---|---|---|
| user_id | uuid FK |  |
| delta | integer not null | signed; `check (delta <> 0)` |
| balance_after | integer not null |  |
| type | enum | `purchase`, `booking_debit`, `booking_refund`, `session_earning`, `withdrawal_hold`, `withdrawal_paid`, `withdrawal_reversed`, `admin_adjustment`, `instant_hold`, `instant_release`, `instant_capture` (last three: instant-session hold, Decision #3) |
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
| credits_granted | integer | for credit purchases |
| purpose | enum `credit_purchase` \| `booking` |  |
| booking_id | uuid FK | when purpose = booking |
| status | enum `created` \| `approved` \| `captured` \| `failed` \| `refunded` |  |
| raw_payload | jsonb | full capture response, for disputes |
| captured_at | timestamptz |  |

**`tutor_earnings`** — one row per completed session.

`tutor_id, booking_id unique FK, gross_credits, platform_fee_credits, net_credits, status enum('held','available','withdrawn'), available_at timestamptz`

`available_at = booking.ended_at + earnings_hold_hours` (Section 18 open question).

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
credit_usd_rate              # USD per 1 credit
platform_fee_percent
earnings_hold_hours
instant_request_ttl_seconds  # default 60
min_withdrawal_credits
min_booking_notice_minutes
max_booking_days_ahead
cancellation_window_hours    # free cancellation cutoff
max_instant_minutes          # default 60 (Decision #4)
min_instant_credits          # default 5, provisional (Decision #4)
credit_packages              # jsonb array of buyable packages (seeded 1 credit = 1 minute)
```

> `presence_stale_seconds` intentionally removed (Decision #8): the 2-minute staleness
> threshold is baked into the `live_tutors` view so the view and the presence-cleanup cron
> share one source of truth.

**`audit_log`** — `actor_id, action text, target_type text, target_id uuid, payload jsonb, ip text`. Every admin mutation writes here.

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
4. **Tutor onboarding:** name, avatar, headline, about, subjects + levels, hourly rate, instant rate, languages, education, experience, PayPal email. Sets `approval_status = 'pending'`, creates `tutor_profiles`. → `/tutor/pending-approval`.
5. Email verification required before booking or going live. Unverified users may browse.
6. Admin approves in `/admin/tutors` → email to tutor → tutor can now appear in search and go live.

Google OAuth users skip password but still complete onboarding. Handle the case where a Google email matches an existing password account: link, don't duplicate.

### 7.2 Browse and filter tutors

`/tutors` server-renders results from search params so filters are shareable and back-button-safe.

Filters: subject (multi), price range (credits/hour), language, minimum rating, availability window, `live_now` toggle, sort (`relevance | rating | price_asc | price_desc | most_sessions`).

Base query: `tutor_profiles` where `approval_status = 'approved'` and owning profile not suspended. When `live_now` is on, query the `live_tutors` view instead (Section 3.1) — **this is the fix for the stale LIVE badge, and it must be a view join, not a boolean check.**

Card contents: avatar, display name, headline, rating + count, subjects (max 3 + overflow), rate, LIVE pill when in `live_tutors`, "Request now" when live and `accepts_instant`.

Avatar rendering: `next/image` with `remotePatterns` configured for the Supabase Storage domain, plus a generated initials fallback. (The current "LIVE tutor card photos not rendering" bug is an image-host configuration issue in Bubble; in Next it's the `remotePatterns` allowlist. Get this right in Phase 3 and it never recurs.)

Pagination: cursor-based, 24 per page.

### 7.3 Scheduled booking

**Student side:**

1. On `/tutors/[slug]`, a calendar shows the next 30 days. Available slots computed server-side (Section 4.2) and rendered **in the student's timezone**, with the tutor's timezone shown as a secondary label.
2. Student picks slot + duration (30/60/90 — **[verify offered durations]**) + subject + optional note.
3. Price = `hourly_rate_credits × duration/60`, rounded up.
4. Payment choice:
   - **Credits** — if `wallet.credit_balance >= price`: create booking `confirmed`, debit ledger, done in one transaction.
   - **PayPal** — create booking `pending_payment` with a 20-minute expiry, then the PayPal flow (7.6). On successful capture → `confirmed`.
5. Slot is held for the duration of `pending_payment` (the overlap constraint counts `pending_payment` as occupying).
6. On confirm: email both parties, in-app notification to tutor, calendar `.ics` attachment.

**Joining:** the join button on `/dashboard/bookings/[id]` becomes active 10 minutes before `scheduled_start_at` and stays active until 30 minutes after `scheduled_end_at`. It calls `/api/lessonspace/join` (7.7) and navigates to `/classroom/[bookingId]`.

**Cancellation:** free if more than `cancellation_window_hours` before start → full credit refund via ledger. Inside the window → **[open question: refund policy]**. Tutor cancellation always fully refunds and notifies.

**Completion:** when both parties have left and `scheduled_end_at` has passed, or by cron 30 minutes after `scheduled_end_at`, status → `completed`, `tutor_earnings` row created `held`.

### 7.4 Instant session

This flow replaces the entire `has_live_request` polling mechanism.

```
Student                          Server                           Tutor
   |                                |                                |
   | POST createSessionRequest      |                                |
   |------------------------------->|                                |
   |                                | validate: tutor in live_tutors,|
   |                                | accepts_instant, student has   |
   |                                | >= min_instant_credits,        |
   |                                | no existing pending request    |
   |                                | INSERT session_requests        |
   |                                | (expires_at = now + 60s)       |
   |                                |--- Realtime INSERT event ----->|
   | <-- waiting modal, 60s ------- |                                | incoming request modal
   |     countdown                  |                                | (name, subject, note, 60s ring)
   |                                |                                |
   |                                | <---- accept / decline --------|
   |                                | on accept, in one transaction: |
   |                                |   status = accepted            |
   |                                |   INSERT bookings (instant,    |
   |                                |     in_progress, channel =     |
   |                                |     session_{booking_id})      |
   |                                |--- Realtime UPDATE ----------->|
   | <-- Realtime UPDATE -----------|                                |
   | navigate /session/{id}         |                                | navigate /session/{id}
```

Rules:

- **Expiry is enforced server-side.** The client countdown is cosmetic. Accepting an expired request fails with a clear error. A cron pass also sweeps `pending` rows past `expires_at` to `expired` every minute so dashboards stay clean.
- A student may have at most one `pending` request at a time. A tutor may have several incoming; accepting one auto-declines the rest.
- Declining is explicit and free; the student sees "Tutor is unavailable right now" and a list of other live tutors.
- If the tutor's presence goes stale while a request is pending, the request expires immediately.

**Billing (instant):** charge per minute against credits. On session start, place an authorization hold equal to `instant_rate_credits_per_minute × max_instant_minutes`; on end, debit `billed_minutes × rate` and release the remainder. `billed_minutes = ceil(actual_seconds / 60)`, minimum 1. **[Open question: confirm the current build's instant pricing — per-minute vs flat.]**

**In-session UI (`/session/[bookingId]`):** local + remote video, mute mic, mute camera, elapsed timer, credits consumed so far (student) / earned so far (tutor), text chat panel, screen share, end session (both sides), connection quality indicator, reconnect handling. On `beforeunload` and on Agora `connection-state-change` to disconnected, fire a `leaveSession` action — but never depend on it for correctness (that dependency is what caused the original bug).

### 7.5 Presence and going live

**Heartbeat.** A `usePresence()` hook mounted in the authenticated layout `POST`s to `/api/presence/heartbeat` every 30 seconds while the tab is visible, and once immediately on mount. The route sets `profiles.last_seen_at = now()`, and for tutors also `tutor_profiles.last_seen_at = now()`. Pause on `document.hidden`, resume and fire immediately on visible.

**Going live.** Tutor toggles "Available for instant sessions" on `/tutor`. Sets `is_live = true`, `live_mode = 'instant'`, `last_seen_at = now()`. Toggling off, or navigating away cleanly, sets `is_live = false`.

**Staleness — three independent defences:**

1. **The `live_tutors` view** filters on `last_seen_at` at read time. Students are protected even if everything else fails.
2. **Cron sweep** every 5 minutes sets `is_live = false`, `live_mode = null` for rows with `last_seen_at < now() - presence_stale_seconds`, and expires their pending session requests.
3. **`navigator.sendBeacon`** on `pagehide` for the best-effort clean exit.

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
  |                                   |   credit_transactions insert |
  |                                   |     (unique on reference_id) |
  |                                   |   booking → confirmed        |
  |<-- success -----------------------|                              |
```

Also implement `POST /api/webhooks/paypal` handling `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`. **Verify the webhook signature** against `PAYPAL_WEBHOOK_ID`. The webhook is a backstop for users who close the tab mid-capture — it must be idempotent, which the unique `(type, reference_id)` ledger index provides for free.

Amounts are always computed server-side from `platform_settings` and the tutor's rate. The client sends an intent (`{ purpose: 'credit_purchase', packageId }`), never a price.

Sandbox and live are switched by `PAYPAL_ENV`. Uninstalling the old Copilot plugin is a Bubble chore that disappears entirely here — there is one PayPal integration, in `lib/paypal/`.

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

- Session completes → `tutor_earnings` row, `status = held`, `available_at = ended_at + earnings_hold_hours`.
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

**No `setInterval` polling anywhere in the codebase except the presence heartbeat.** That single exception is deliberate and documented.

---

## 9. Agora integration

Reuse the deployed token service at `AGORA_TOKEN_SERVICE_URL`. Do not redeploy or modify it.

`POST /api/agora/token` with `{ channel, purpose: 'session' | 'broadcast' }`:

1. `requireUser()`.
2. For `session`: parse the booking id from the channel, confirm the caller is a participant and the booking is `in_progress`. Role → `publisher`.
3. For `broadcast`: parse the broadcast id. If caller is the host → `publisher`; otherwise, if the broadcast is `live` → `subscriber`.
4. Derive a numeric `uid` deterministically from the user id (hash to a 32-bit int) so reconnects keep identity.
5. Fetch from the Render service, return `{ token, uid, appId, channel, expiresAt }` with a TTL shorter than the token's.
6. Client renews at 80% of TTL via Agora's `token-privilege-will-expire` event.

Client wrapper in `lib/agora/client.ts`: dynamic-import the SDK (it does not tolerate SSR), expose `join`, `leave`, `toggleMic`, `toggleCamera`, `startScreenShare`, and handle `user-published`, `user-unpublished`, `user-left`, `connection-state-change`, `network-quality`.

**Cold-start note:** the Render free tier sleeps. First token request after idle can take 30–50 seconds. Either move to a paid instance or ping the service from the presence cron to keep it warm. Recommend the latter for now — one line in the cron handler.

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

Spacing on a 4px grid. Container max-width 1200px, page gutter 20px mobile / 24px desktop (desktop gutter tightened from 32px in the density pass).

**The ink surface (parity with the Bubble build).** The authenticated app is an **ink shell** (sidebar + topbar) wrapping a **white content panel**, with **ink cards** inside that panel — ink shell → white panel → ink cards. There is exactly **one** ink surface (`ink-900`, `#34495E`, sampled from the live build; sidebar and cards are the same value). Elevation-by-lightness is unavailable: an ink card, a dropdown over the ink topbar, or the drawer contents cannot separate from their background by being lighter — they separate by an `ink-700` border or a shadow. `ink-800` is an **interaction state** (hover/pressed), never a surface; `ink-950` is the darker recess (active nav item, modal scrim).

**Rules:** gold is for primary CTAs only, never for body text or borders. Live green appears only on live status — never as a generic success colour in the same view as a LIVE badge. **Purple on ink is fill-only, carrying white text** (white on `purple-500` = 6.91:1): at **1.34:1** purple fails not just the 4.5:1 text floor but the 3:1 non-text UI floor, so it is never text, a border, a focus ring, or an active-indicator bar on ink — gold does that job. On ink, body/headings/names use white freely, secondary text uses `ink-300` (4.69:1). Purple remains the primary on light surfaces, unchanged.

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

`vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/sweep-presence",      "schedule": "*/5 * * * *" },
    { "path": "/api/cron/expire-requests",     "schedule": "* * * * *" },
    { "path": "/api/cron/expire-unpaid",       "schedule": "*/10 * * * *" },
    { "path": "/api/cron/complete-sessions",   "schedule": "*/15 * * * *" },
    { "path": "/api/cron/release-earnings",    "schedule": "0 * * * *" },
    { "path": "/api/cron/booking-reminders",   "schedule": "*/15 * * * *" },
    { "path": "/api/cron/reconcile-wallets",   "schedule": "0 3 * * *" }
  ]
}
```

Every handler: verify `Authorization: Bearer ${CRON_SECRET}`, be idempotent, log a structured summary of what it changed, and return counts. Each is also individually invocable from `/admin/settings` with a "run now" button for debugging.

- **sweep-presence** — stale tutors offline, stale broadcasts ended, their pending requests expired; also pings the Agora token service to keep it warm.
- **expire-requests** — `session_requests` past `expires_at`.
- **expire-unpaid** — `bookings` in `pending_payment` past 20 minutes → `expired`, releasing the slot.
- **complete-sessions** — bookings past `scheduled_end_at + 30m` still `confirmed`/`in_progress` → `completed` (or `no_show_*` if one party never joined), create `tutor_earnings`.
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
- Pricing — durations, rounding, instant per-minute billing, platform fee.
- Presence staleness — the `live_tutors` boundary at exactly the threshold.
- Filter composition — every combination of set/unset filters produces the intended SQL.

**E2E (Playwright), the paths that lose money or trust:**
1. Student signs up → buys credits (PayPal sandbox) → books a scheduled session → joins the classroom.
2. Tutor goes live → student requests → tutor accepts → both land in the session → session ends → earnings appear.
3. Tutor goes live → student requests → **tutor closes the browser** → assert the tutor disappears from `/tutors?live_now=true` within the staleness window and the request expires. *This is the regression test for the original bug. It runs in CI.*
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

**Phase 6 — Presence and instant sessions.** Heartbeat, go-live toggle, `session_requests` with Realtime both directions, `/session/[bookingId]` with Agora, `/api/agora/token` with authorization, per-minute billing, sweep-presence cron.
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

## 18. Open questions

These need answers before the phases that depend on them. Most are for Noora; a few you can decide yourself.

**Blocking Phase 1 (data model):**
1. **Session durations offered** — 30/60/90? Fixed or tutor-configurable?
2. **Reviews** — does the current build have student reviews of tutors? If not, is v1 parity or do we add them?
3. **Broadcast chat** — does the current build have live chat during broadcasts? Anonymous viewers allowed, or sign-in required?

**Blocking Phase 4 (bookings):**
4. **Cancellation and refund policy** — what's the free-cancellation window, and what happens inside it (partial refund, no refund, credit-only)?
5. **Minimum booking notice** and **how far ahead** students can book.
6. **Rescheduling** — supported in the current build, or cancel-and-rebook only?

**Blocking Phase 5 (payments):**
7. **Credit-to-USD rate** and the **credit package tiers**.
8. **Platform fee percentage** on tutor earnings.

**Blocking Phase 6 (instant sessions):**
9. **Instant session pricing** — per-minute or flat rate? Minimum charge? Maximum session length?

**Blocking Phase 8 (withdrawals):**
10. **Earnings hold period** and **minimum withdrawal amount**.

**Not blocking, but decide early:**
11. Canonical **subject list**.
12. Whether tutor approval stays **manual** (recommend yes).
13. Whether an existing tutor can also be a student (recommend no — matches current single-role behaviour).

Everything above has a sensible default I can propose if Noora is slow to respond, and every one of them lives in `platform_settings` rather than in code, so a wrong initial guess is a settings change and not a rebuild. Say the word and I'll fill the whole list with recommended defaults so the build isn't gated on her replies.

---

## 19. Note on scope and framing

Worth putting in writing before this starts: this is a **new build**, not maintenance on the existing one. It reproduces roughly eighteen months of accumulated functionality on a different foundation, and it carries its own timeline, its own cost, and its own testing burden — the current Bubble app also has to keep running until cutover.

The technical case for it is real: the classes of bug that have consumed the most time recently (stale live status, silently dropped search constraints, conditions that won't fire on nested fields, workflows that duplicate themselves across environments, credit reconciliation) are Bubble-specific failure modes that mostly cease to exist in code. That's a genuine argument. But it's an argument to make deliberately, with a number attached, rather than something to start and then have to justify halfway through.

Recommend agreeing three things with Noora in writing before Phase 0: the fixed scope (this document, Section 14 included), the price, and what happens to the Bubble app during and after the transition.
