-- Admin write path for approval + re-review (SPEC §5, §7.11).
--
-- The problem this resolves: drizzle/0010's tutor_approval_guard requires
-- public.is_admin() (i.e. auth.uid() is an admin), but SPEC §5 says the approval
-- columns and audit_log are "service role only" — and RLS on tutor_profiles is
-- owner-only (USING user_id = auth.uid()), so an admin's OWN PostgREST session
-- cannot update another tutor's row anyway. That left no legal path for the
-- admin queue: the session is blocked by RLS, and the trusted server-side
-- connection is blocked by the trigger.
--
-- Resolution: the guards keep blocking `authenticated` (the actual attack —
-- a tutor self-approving via PostgREST, which is what drizzle/0010 fixed) but
-- recognise the TRUSTED SERVER-SIDE connection. That connection is already fully
-- trusted: it owns the tables and bypasses RLS, and the seed already disables
-- these triggers to do the same thing. Authorization for it is SPEC §5 Layer 2 —
-- every admin action calls requireRole('admin') first and writes audit_log.
-- NOTE: must NOT use current_user. These guards are SECURITY DEFINER, so inside
-- them current_user is the function OWNER (postgres) for every caller — using it
-- would make this return true for an end user and silently disable the guard.
-- session_user survives the definer switch, and the service role is identified by
-- its JWT claim (PostgREST connects as `authenticator` for anon, authenticated
-- AND service_role alike, so the role claim is the only way to tell them apart).
CREATE OR REPLACE FUNCTION public.is_trusted_server()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT session_user IN ('postgres', 'supabase_admin')
      OR coalesce(
           nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
           ''
         ) = 'service_role';
$$;
--> statement-breakpoint

-- Approval columns + profile_reviewed_at: admin session OR trusted server only.
CREATE OR REPLACE FUNCTION public.tutor_approval_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (new.approval_status        IS DISTINCT FROM old.approval_status
      OR new.approval_note       IS DISTINCT FROM old.approval_note
      OR new.approved_at         IS DISTINCT FROM old.approved_at
      OR new.profile_reviewed_at IS DISTINCT FROM old.profile_reviewed_at)
     AND NOT public.is_admin()
     AND NOT public.is_trusted_server() THEN
    RAISE EXCEPTION 'approval fields can only be changed by an admin';
  END IF;
  RETURN new;
END;
$$;
--> statement-breakpoint

-- profile_changed_at stays trigger-managed for end users (a tutor must not be
-- able to clear it to dodge re-review) but the trusted server may set it
-- directly — the seed needs that to build an "edited since review" fixture.
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

-- A STUDENT must not be able to create a tutor_profiles row at all (SPEC §5).
-- The original policy only checked ownership (user_id = auth.uid()), so a student
-- could insert a row for themselves. It would land as approval_status='pending'
-- and never reach browse, but "students cannot write tutor_profiles" should be
-- true at the RLS layer, not merely unexploitable.
DROP POLICY IF EXISTS "tutor_profiles_insert" ON public.tutor_profiles;
--> statement-breakpoint
CREATE POLICY "tutor_profiles_insert" ON public.tutor_profiles FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND p.role = 'tutor'
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "tutor_profiles_update" ON public.tutor_profiles;
--> statement-breakpoint
CREATE POLICY "tutor_profiles_update" ON public.tutor_profiles FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND p.role = 'tutor'
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND p.role = 'tutor'
    )
  );
