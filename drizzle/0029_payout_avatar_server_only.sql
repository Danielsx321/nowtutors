-- Code review "security checklist 2026-10-22" (Security C follow-up; DECISIONS,
-- "Security C", item 12).
--
-- HAND-WRITTEN. No table or column changes (same split as 0021 and 0027).
--
-- WHY. Security C put a masked audit row and a notice email on every change of
-- a tutor's PayPal payout email, and pinned avatar links to the caller's own
-- folder, both in the app. Two PostgREST paths skipped the app entirely:
--
--   * A TUTOR COULD REPOINT PAYOUTS UNSEEN. `payout_insert` / `payout_update`
--     (0005) let `PATCH tutor_payout_details {"paypal_email": ...}` with the
--     public key and the tutor's own JWT go through: no audit row, no notice
--     email. That is exactly the session-takeover change the log exists to
--     catch. (Each withdrawal snapshots its destination, so earlier payouts
--     were never at risk; the next one was.)
--   * A USER COULD SET ANY AVATAR LINK. `profiles_update` (0005) allowed
--     `PATCH profiles {"avatar_url": "https://evil.example/x"}`, and every card,
--     header and email renders it.
--
-- WRITERS, checked by grep before this file was written (2026-10-22). Every one
-- is on the trusted connection, so none is refused:
--   tutor_payout_details: db/queries/payout-email.ts savePayoutEmail (settings)
--     and actions/onboarding.ts completeTutorOnboarding, both Drizzle. Admin and
--     withdrawal code only read it. db/seed.ts upserts over the service role.
--     No client component writes it.
--   profiles.avatar_url: actions/onboarding.ts (both paths) and
--     actions/tutor-profile.ts, both Drizzle. admin-tutors only reads it.
--     avatar-upload.tsx uploads to Storage and hands the URL to the form; the
--     action writes the column. handle_new_user (0002) INSERTs the row, and the
--     guard is BEFORE UPDATE only. db/seed.ts over the service role.
--
-- So: no client writes at all on tutor_payout_details (as 0015, 0018 and 0021
-- did for their tables), and avatar_url server-only in profiles_guard. Reads
-- (`payout_select`, `profiles_select`) are unchanged.

-- 1. tutor_payout_details: no client writes.
DROP POLICY IF EXISTS "payout_insert" ON public.tutor_payout_details;--> statement-breakpoint
DROP POLICY IF EXISTS "payout_update" ON public.tutor_payout_details;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON public.tutor_payout_details FROM anon, authenticated;--> statement-breakpoint

-- 2. profiles_guard: the 0027 version exactly, plus avatar_url (server-only).
CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new.role IS DISTINCT FROM old.role
     AND NOT public.is_admin()
     AND NOT public.is_trusted_server() THEN
    RAISE EXCEPTION 'role can only be set by the server';
  END IF;
  IF new.is_suspended IS DISTINCT FROM old.is_suspended
     AND NOT public.is_admin()
     AND NOT public.is_trusted_server() THEN
    RAISE EXCEPTION 'is_suspended can only be changed by an admin';
  END IF;
  IF new.email IS DISTINCT FROM old.email
     AND NOT public.is_trusted_server()
     AND NOT EXISTS (
       SELECT 1 FROM auth.users u
        WHERE u.id = new.id AND u.email = new.email
     ) THEN
    RAISE EXCEPTION 'email can only be changed through Supabase Auth';
  END IF;
  IF new.onboarding_completed_at IS DISTINCT FROM old.onboarding_completed_at
     AND NOT public.is_trusted_server() THEN
    RAISE EXCEPTION 'onboarding_completed_at can only be set by the server';
  END IF;
  IF new.avatar_url IS DISTINCT FROM old.avatar_url
     AND NOT public.is_trusted_server() THEN
    RAISE EXCEPTION 'avatar_url can only be set by the server';
  END IF;
  RETURN new;
END;
$$;
