-- Phase 8 Part 5 — admin users write path (SPEC §5; DECISIONS, "Phase 8 Part 5").
--
-- HAND-WRITTEN. No table or column changes; drizzle-kit does not manage this
-- project's triggers (0003, 0010, 0012).
--
-- WHY. drizzle/0003's profiles_guard only lets public.is_admin() change `role`
-- (after onboarding) or `is_suspended`. is_admin() reads auth.uid(), which is
-- null on the trusted server-side connection the admin actions use, so
-- "suspend user" and "promote to admin" were refused by the trigger even for a
-- real admin (verified on the test project 2026-09-15: session_user = postgres,
-- is_trusted_server() = true, both updates raised). drizzle/0012 fixed the same
-- problem for tutor_approval_guard; this is the same fix for profiles_guard.
--
-- The guard keeps blocking `authenticated`, which is the real attack: a user
-- escalating their own role or clearing their own suspension through the
-- RLS-permitted self-update. Authorization for the trusted path is SPEC §5
-- Layer 2: every admin action calls requireRole('admin') first and writes
-- audit_log. is_trusted_server() checks session_user, never current_user (see
-- 0012 for why).
--
-- Side effect worth knowing: the Supabase SQL editor connects as postgres, so the
-- RUNBOOK first-admin statement no longer needs the trigger disabled. Disabling it
-- still works.
CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new.role IS DISTINCT FROM old.role
     AND old.role IS NOT NULL
     AND NOT public.is_admin()
     AND NOT public.is_trusted_server() THEN
    RAISE EXCEPTION 'role is immutable';
  END IF;
  IF new.is_suspended IS DISTINCT FROM old.is_suspended
     AND NOT public.is_admin()
     AND NOT public.is_trusted_server() THEN
    RAISE EXCEPTION 'is_suspended can only be changed by an admin';
  END IF;
  RETURN new;
END;
$$;
