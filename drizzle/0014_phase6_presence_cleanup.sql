-- Phase 6 Part 1 — instant-session schema cleanup (SPEC §4.1, §4.3, §4.4; the
-- Phase 6 pre-build decisions in docs/DECISIONS.md).
--
-- PARTLY HAND-WRITTEN. `drizzle-kit generate` produced the four ALTERs for the
-- two new session_requests columns, the session_request_status value, and the
-- tutor_profiles column drop, but could not express:
--
--   (a) the credit_transaction_type value removal — Postgres has no
--       `ALTER TYPE ... DROP VALUE`. drizzle-kit's generated form casts the
--       column to `text`, DROPs the type and casts back, which leaves the column
--       unconstrained mid-migration and fails opaquely if any other object still
--       depends on the type. Replaced below with the rename-create-alter-drop
--       dance, which never drops the constraint from the column;
--   (b) the live_tutors dependency — the view (drizzle/0004) SELECTs
--       instant_rate_credits_per_minute by name, so the generated bare
--       `DROP COLUMN` errors with "cannot drop column ... other objects depend
--       on it". The view is dropped and recreated around the drop below;
--   (c) the two pre-flight guards, which make this migration abort with a
--       readable message instead of failing on a NOT NULL violation or a cast
--       error if it is ever applied to a database holding data the checks below
--       assume is absent.
--
-- Verified against the dev/prod project (mipnoxlhurdbaahmvhhx) before writing:
--   session_requests                                   -> 0 rows
--   credit_transactions WHERE type IN (instant_*)      -> 0 rows
-- so no backfill is needed and NO DEFAULT is shipped on either new column: both
-- are server-authored at insert (SPEC §4.3) and a default would quietly paper
-- over a caller that forgot to compute them.

-- ---------------------------------------------------------------------------
-- Guard 1: the new NOT NULL columns assume session_requests is empty. If it is
-- not, backfill first (duration from the request's booking, price via
-- sessionPriceCredits) and re-run — do not add a default.
-- ---------------------------------------------------------------------------
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.session_requests;
  IF n > 0 THEN
    RAISE EXCEPTION
      'migration 0014: session_requests holds % row(s); duration_minutes/price_credits are NOT NULL with no default. Backfill both columns, then re-run.', n;
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Guard 2: the instant_* enum values cannot be removed while rows still use
-- them. Append-only ledger (§4.4) means such rows could not be rewritten — the
-- removal would have to be abandoned, not forced.
-- ---------------------------------------------------------------------------
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.credit_transactions
   WHERE type IN ('instant_hold', 'instant_release', 'instant_capture');
  IF n > 0 THEN
    RAISE EXCEPTION
      'migration 0014: % credit_transactions row(s) still use instant_hold/instant_release/instant_capture. The ledger is append-only, so these cannot be rewritten — abandon the enum removal instead.', n;
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 1. session_requests: server-authored duration + pinned price (SPEC §4.3).
--    Pinning price at insert is what makes accept charge exactly what the
--    student was quoted, even if hourly_rate_credits moves in between.
-- ---------------------------------------------------------------------------
ALTER TABLE "session_requests" ADD COLUMN "duration_minutes" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "session_requests" ADD COLUMN "price_credits" integer NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. session_request_status gains 'failed_payment' (SPEC §4.3): an accept whose
--    credit debit failed is terminal but is NOT a refusal (declined) and NOT a
--    timeout (expired). Appended, so this is a plain ADD VALUE.
-- ---------------------------------------------------------------------------
ALTER TYPE "public"."session_request_status" ADD VALUE 'failed_payment';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. credit_transaction_type loses the three hold-model values (SPEC §4.4).
--    HAND-WRITTEN: Postgres has no DROP VALUE. Rename the old type out of the
--    way, create the new one under the real name, move the column across with an
--    explicit text round-trip, then drop the old type. The column is never
--    without an enum constraint, and the DROP at the end fails loudly if any
--    object we did not know about still depends on the old type.
--    credit_tx_ref_unique (type, reference_id) is rebuilt by the ALTER COLUMN.
-- ---------------------------------------------------------------------------
ALTER TYPE "public"."credit_transaction_type" RENAME TO "credit_transaction_type_old";--> statement-breakpoint
CREATE TYPE "public"."credit_transaction_type" AS ENUM('purchase', 'booking_debit', 'booking_refund', 'session_earning', 'withdrawal_hold', 'withdrawal_paid', 'withdrawal_reversed', 'admin_adjustment');--> statement-breakpoint
ALTER TABLE "credit_transactions"
  ALTER COLUMN "type" TYPE "public"."credit_transaction_type"
  USING "type"::text::"public"."credit_transaction_type";--> statement-breakpoint
DROP TYPE "public"."credit_transaction_type_old";--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Drop tutor_profiles.instant_rate_credits_per_minute (SPEC §4.1).
--    HAND-WRITTEN: live_tutors (drizzle/0004) enumerates this column, so the
--    view is dropped first and recreated without it. Recreated verbatim
--    otherwise — same explicit column list (never SELECT *), same
--    security_invoker, same predicate, same grants.
--
--    THE 2-MINUTE STALENESS THRESHOLD BELOW IS THE SINGLE DEFINITION OF STALE
--    (SPEC §3.1). There is no presence_stale_seconds setting; the sweep cron
--    (§7.5, §12) derives its work set from this view rather than re-deriving a
--    threshold of its own, so the two cannot drift.
-- ---------------------------------------------------------------------------
DROP VIEW public.live_tutors;--> statement-breakpoint
ALTER TABLE "tutor_profiles" DROP COLUMN "instant_rate_credits_per_minute";--> statement-breakpoint
CREATE VIEW public.live_tutors
WITH (security_invoker = on) AS
SELECT
  tp.id,
  tp.user_id,
  tp.slug,
  tp.headline,
  tp.about,
  tp.intro_video_url,
  tp.education,
  tp.years_experience,
  tp.languages,
  tp.hourly_rate_credits,
  tp.accepts_instant,
  tp.live_mode,
  tp.rating_avg,
  tp.rating_count,
  tp.completed_sessions,
  tp.total_minutes_taught,
  tp.last_seen_at
FROM public.tutor_profiles tp
WHERE tp.is_live = true
  AND tp.approval_status = 'approved'
  AND tp.last_seen_at > now() - interval '2 minutes';--> statement-breakpoint
GRANT SELECT ON public.live_tutors TO anon, authenticated;
