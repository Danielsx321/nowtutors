-- Code review 2026-09-20 (docs/review/2026-09-20-pass-3-races.md, R1;
-- DECISIONS, "Review mediums").
--
-- HAND-WRITTEN, in the shape drizzle-kit would generate for the index in
-- src/db/schema/booking.ts, with the two settling statements it cannot know
-- about in front of it.
--
-- WHY. "A student may have at most one pending request at a time" (SPEC §7.4)
-- was a read followed by an insert in `createSessionRequest`. Two requests sent
-- at the same moment (two tabs, a double submit) both passed the read, both
-- inserted, and two tutors could each accept: two `booking_debit` rows, a
-- student in two paid rooms at once, and §7.4 refunds nothing. Proven on the
-- test project before this file existed
-- (tests/integration/session-requests-one-pending.test.ts, 2026-09-21).
-- `withdrawal_requests_one_open_per_tutor` (0015) and
-- `broadcasts_one_live_per_tutor` (0020) closed the same shape the same way.
--
-- An index predicate must be IMMUTABLE, so it cannot say "and not yet expired".
-- That is fine: `createSessionRequest` already expires the student's own stale
-- `pending` rows before it checks (§7.4), and the expire-requests cron sweeps
-- the rest every minute.

-- 1. Rows the deadline has already decided. The cron would do this within a
--    minute; doing it here means the index never trips over one.
UPDATE "session_requests"
   SET "status" = 'expired', "updated_at" = now()
 WHERE "status" = 'pending' AND "expires_at" <= now();
--> statement-breakpoint

-- 2. If a student somehow holds more than one LIVE pending row right now, keep
--    the newest and expire the others, or the index below could not be built.
UPDATE "session_requests" r
   SET "status" = 'expired', "updated_at" = now()
 WHERE r."status" = 'pending'
   AND EXISTS (
     SELECT 1 FROM "session_requests" newer
      WHERE newer."student_id" = r."student_id"
        AND newer."status" = 'pending'
        AND (newer."created_at", newer."id") > (r."created_at", r."id")
   );
--> statement-breakpoint

CREATE UNIQUE INDEX "session_requests_one_pending_per_student" ON "session_requests" USING btree ("student_id") WHERE status = 'pending';
