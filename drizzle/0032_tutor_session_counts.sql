-- Tutor session counts (fix/completed-sessions-count, 2026-11-22; SPEC §4.1;
-- DECISIONS 2026-11-22 "Tutor session counts").
--
-- HAND-WRITTEN. No table or column changes: a trigger and a one-off backfill.
--
-- WHY. tutor_profiles.completed_sessions and total_minutes_taught were never
-- written by the app (0027's header: "Nothing in the app increments it yet").
-- Profiles said "No sessions yet" for tutors who had taught, and since reviews
-- v1 (0031) a tutor could show "★ 5.0 (1) · No sessions yet". Browse's
-- `most_sessions` sort and the `relevance` tiebreaker read the same column, so
-- they ranked every tutor on seed values or zero.
--
-- HOW. bookings_session_counts (AFTER INSERT, UPDATE OF status/billed_minutes/
-- tutor_id, DELETE on bookings) recounts the affected tutor(s) from their
-- completed bookings: completed_sessions = count, total_minutes_taught = the
-- sum of billed_minutes (else duration_minutes). A recount rather than +1, so
-- an admin moving a booking out of `completed` takes it back off, and a second
-- write of the same status changes nothing.
--
-- WHO WRITES. Clients cannot write bookings at all since 0021 (INSERT, UPDATE,
-- DELETE revoked from anon and authenticated), so every status change comes
-- from the trusted server connection or the service role; the recount's
-- UPDATE of tutor_profiles runs in that session, which tutor_stats_guard
-- (0027) admits. No SECURITY DEFINER needed.
--
-- BACKFILL. The last statement recounts every tutor once from real bookings.
-- This replaces seed values on dev and test with the true counts.
CREATE OR REPLACE FUNCTION public.recount_tutor_sessions(t uuid) RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.tutor_profiles tp
     SET completed_sessions = s.n,
         total_minutes_taught = s.minutes
    FROM (
      SELECT count(*)::int AS n,
             coalesce(sum(coalesce(b.billed_minutes, b.duration_minutes, 0)), 0)::int AS minutes
        FROM public.bookings b
       WHERE b.tutor_id = t AND b.status = 'completed'
    ) s
   WHERE tp.user_id = t
     AND (tp.completed_sessions IS DISTINCT FROM s.n OR tp.total_minutes_taught IS DISTINCT FROM s.minutes);
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.bookings_session_counts() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF tg_op = 'INSERT' THEN
    -- A booking is born pending or confirmed; only a completed one changes a count.
    IF new.status = 'completed' THEN
      PERFORM public.recount_tutor_sessions(new.tutor_id);
    END IF;
    RETURN NULL;
  END IF;

  PERFORM public.recount_tutor_sessions(old.tutor_id);
  IF tg_op = 'UPDATE' AND new.tutor_id IS DISTINCT FROM old.tutor_id THEN
    PERFORM public.recount_tutor_sessions(new.tutor_id);
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE TRIGGER bookings_session_counts
  AFTER INSERT OR UPDATE OF status, billed_minutes, duration_minutes, tutor_id OR DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_session_counts();--> statement-breakpoint

SELECT public.recount_tutor_sessions(user_id) FROM public.tutor_profiles;
