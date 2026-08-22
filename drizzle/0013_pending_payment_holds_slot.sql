-- Phase 5 Part 2 — booking direct-pay (SPEC §7.3 step 5, §4.3).
--
-- A `pending_payment` booking must genuinely hold its slot while the buyer is in
-- PayPal, otherwise two students can both reach checkout for the same slot, both
-- pay, and the second capture has nowhere to land — money taken for a session
-- that cannot exist. §7.3 already says the overlap constraint counts
-- pending_payment as occupying; the Phase 1 constraint did not, because until now
-- nothing created a pending_payment row.
--
-- The 20-minute release (§4.2) is deliberately NOT expressed here. An exclusion
-- predicate must be IMMUTABLE, so it cannot reference now(); a time-relative
-- clause is impossible in this index. The release therefore lives in
-- computeSlots (read side) and in an expiry sweep the booking transaction runs
-- before inserting (write side), which keeps the two sides agreeing without a
-- cron being load-bearing.

ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_no_overlap";
--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "tutor_id" WITH =,
    tstzrange("scheduled_start_at", "scheduled_end_at") WITH &&
  )
  WHERE (
    "type" = 'scheduled'
    AND "status" IN ('pending_payment', 'confirmed', 'in_progress')
    AND "scheduled_start_at" IS NOT NULL
    AND "scheduled_end_at" IS NOT NULL
  );
