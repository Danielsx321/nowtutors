ALTER TABLE "tutor_profiles" ADD COLUMN "profile_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tutor_profiles" ADD COLUMN "profile_reviewed_at" timestamp with time zone;--> statement-breakpoint

-- Re-review on material change (SPEC §4.1 / §7.1). An approved tutor's edit goes
-- live IMMEDIATELY — they stay visible and bookable and approval_status does not
-- change. A MATERIAL edit instead stamps profile_changed_at so admins can
-- re-review after the fact. Material: headline, about, subjects,
-- hourly_rate_credits, intro_video_url. Non-material: avatar, languages,
-- education, years_experience.
--
-- The stamp lives in a TRIGGER, not in application code, for two reasons:
--   1. "a no-op save must not flag" becomes structurally true — IS DISTINCT FROM
--      compares old vs new, so re-saving identical values cannot flag.
--   2. it cannot be bypassed by writing to PostgREST directly.
-- A non-admin also cannot CLEAR the flag to dodge re-review: their new value for
-- profile_changed_at is overwritten with the old one before the change test runs.
CREATE OR REPLACE FUNCTION public.tutor_profile_change_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- profile_changed_at is trigger-managed: non-admins never set it directly
  -- (otherwise a tutor could null it out after a material edit).
  IF NOT public.is_admin() THEN
    new.profile_changed_at = old.profile_changed_at;
  END IF;

  -- Only already-approved tutors need re-review; a pending tutor is in the
  -- normal approval queue anyway.
  IF old.approval_status = 'approved'
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
DROP TRIGGER IF EXISTS tutor_profile_change_flag ON public.tutor_profiles;
--> statement-breakpoint
CREATE TRIGGER tutor_profile_change_flag
  BEFORE UPDATE ON public.tutor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tutor_profile_change_flag();
--> statement-breakpoint

-- Subjects are material but live in a child table, so changes there flag the
-- parent profile too.
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
     AND approval_status = 'approved';
  RETURN COALESCE(new, old);
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tutor_subjects_change_flag ON public.tutor_subjects;
--> statement-breakpoint
CREATE TRIGGER tutor_subjects_change_flag
  AFTER INSERT OR UPDATE OR DELETE ON public.tutor_subjects
  FOR EACH ROW EXECUTE FUNCTION public.tutor_subjects_change_flag();
--> statement-breakpoint

-- profile_reviewed_at is the ADMIN side of the pair — only an admin may set it
-- (a tutor marking their own profile reviewed would defeat the queue). Folded
-- into the existing approval guard from drizzle/0010.
CREATE OR REPLACE FUNCTION public.tutor_approval_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (new.approval_status     IS DISTINCT FROM old.approval_status
      OR new.approval_note    IS DISTINCT FROM old.approval_note
      OR new.approved_at      IS DISTINCT FROM old.approved_at
      OR new.profile_reviewed_at IS DISTINCT FROM old.profile_reviewed_at)
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'approval fields can only be changed by an admin';
  END IF;
  RETURN new;
END;
$$;
