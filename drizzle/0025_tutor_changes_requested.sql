-- Request changes: a tutor on hold with a reason (tutor-request-changes,
-- 2026-10-13; SPEC §4.1, §6, §11).
--
-- HAND-WRITTEN, in the shape drizzle-kit would generate for the enum in
-- src/db/schema/enums.ts.
--
-- WHY. The approval queue had two buttons, Approve and Reject, and Reject is
-- final: the tutor lands on a dead-end page with no way into their own editor.
-- Noora's first real request after launch was "ask them to pick and adjust
-- their photos", which is neither. `changes_requested` is a fourth status:
-- the tutor leaves the site (every "is this tutor live" check already keys on
-- approval_status = 'approved', so nothing else changes), keeps access to
-- /tutor/profile, and comes back to the queue as "Resubmitted" when they save.
--
-- The resubmit signal reuses the two timestamps from drizzle/0011: the hold
-- stamps profile_reviewed_at (the admin's side), and a save afterwards stamps
-- profile_changed_at. The two change-flag triggers below therefore fire for
-- 'changes_requested' as well as 'approved'. A photo-only fix lives on
-- `profiles`, which these triggers cannot see, so the profile action stamps
-- profile_changed_at itself in that case (allowed for the trusted server since
-- drizzle/0012).
--
-- ADD VALUE only; nothing in this migration uses the new value, so running it
-- inside the migrator's transaction is safe.
ALTER TYPE "public"."tutor_approval_status" ADD VALUE 'changes_requested';--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.tutor_profile_change_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() AND NOT public.is_trusted_server() THEN
    new.profile_changed_at = old.profile_changed_at;
  END IF;

  IF old.approval_status IN ('approved', 'changes_requested')
     AND (new.headline            IS DISTINCT FROM old.headline
       OR new.about               IS DISTINCT FROM old.about
       OR new.hourly_rate_credits IS DISTINCT FROM old.hourly_rate_credits
       OR new.intro_video_url     IS DISTINCT FROM old.intro_video_url)
  THEN
    new.profile_changed_at = now();
  END IF;

  RETURN new;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.tutor_subjects_change_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tid uuid;
BEGIN
  tid := COALESCE(new.tutor_id, old.tutor_id);
  UPDATE public.tutor_profiles
     SET profile_changed_at = now()
   WHERE user_id = tid
     AND approval_status IN ('approved', 'changes_requested');
  RETURN COALESCE(new, old);
END;
$$;
