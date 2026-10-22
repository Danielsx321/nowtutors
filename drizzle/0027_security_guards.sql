-- Code review "security checklist 2026-10-22" (findings 1, 4 and 5; DECISIONS,
-- "Security A: server-only tutor stats, profile email, avatar limits").
--
-- HAND-WRITTEN. No table or column changes; drizzle-kit does not manage this
-- project's guard triggers, auth triggers or storage buckets (0002, 0003,
-- 0007, 0010, 0012, 0016, 0021, 0023).
--
-- WHY. `tutor_profiles_update` (0012) and `profiles_update` (0005) let a
-- signed-in user write any column of their own row that no trigger guards.
-- Three holes were left:
--
--   * A TUTOR COULD FAKE THEIR OWN STATS. `PATCH tutor_profiles
--     {"rating_avg": 5, "rating_count": 900, "completed_sessions": 900}` with
--     the public key and their own JWT went through, and browse sorts and
--     filters on exactly these columns (lib/tutors/filters.ts,
--     db/queries/tutors.ts). The same PATCH could rename `slug`, breaking every
--     shared link to the profile or taking a slug another tutor gave up.
--   * A USER COULD CHANGE `profiles.email`. Every app email (receipts,
--     reminders, payout notices) goes to profiles.email (lib/email/recipient.ts),
--     so a user could point them anywhere, or make the admin users search show
--     someone else's address. `onboarding_completed_at` was writable the same way.
--   * THE PUBLIC `avatars` BUCKET (0007) TOOK ANY FILE OF ANY SIZE. A user could
--     host an .html page or a gigabyte file on our storage domain inside their
--     own {uid}/ folder.
--
-- WRITERS, checked by grep before this file was written (2026-10-22). Every one
-- is on the trusted connection, so none of them is refused:
--   rating_avg, rating_count, total_minutes_taught: no app writer at all (reviews
--     are not built). Only db/seed.ts, over the service role.
--   completed_sessions: only db/seed.ts (service role). Nothing in the app
--     increments it yet.
--   slug: actions/onboarding.ts completeTutorOnboarding INSERTs it once, on the
--     Drizzle connection (session_user postgres). actions/tutor-profile.ts never
--     writes it. db/seed.ts and db/seed-test-users.ts (service role).
--   profiles.email: public.handle_new_user() (0002, on INSERT into auth.users)
--     and db/seed.ts / db/seed-test-users.ts (service role). Nothing in the app
--     updates it; auth email changes never reached it before this file.
--   profiles.onboarding_completed_at: actions/onboarding.ts, both onboarding
--     paths, on the Drizzle connection. db/seed.ts / seed-test-users.ts. No
--     client path, so it is server-only with no NULL-to-value exception.
--   The avatar upload (components/features/onboarding/avatar-upload.tsx) sends
--     the cropped JPEG from lib/images/crop.ts: at most 1200x750 at quality
--     0.86, far under 2 MB. The seed's 1x1 fixture is a PNG.
--
-- THE EMAIL SYNC and how the guard lets it through. Supabase Auth (GoTrue)
-- writes auth.users as `supabase_auth_admin`, so inside the sync trigger
-- session_user is supabase_auth_admin and public.is_trusted_server() is FALSE.
-- Two ways to tell the guard "this is the sync" were rejected:
--   - a session-local flag (set_config('app.email_sync', 'on', true)): it works,
--     but the guard would then trust any caller that can set that GUC, and it
--     is a second secret convention to remember;
--   - pg_trigger_depth() > 1: any trigger chain that ends in an UPDATE of
--     profiles (today none, tomorrow maybe one fired by a client write) would
--     slip past the email check unnoticed.
-- Chosen instead: the guard checks the VALUE. profiles.email may change only to
-- the address auth.users holds for that same id. auth.users is not writable by
-- a client, and GoTrue only changes users.email after the confirmation link is
-- followed, so whatever reaches profiles.email is an address the user proved
-- they own. The sync trigger runs AFTER UPDATE, so the guard's lookup already
-- sees the new auth row. A user "changing" their profile email to their own
-- confirmed auth email is a harmless no-op repair. profiles_guard is SECURITY
-- DEFINER (owner postgres), which is what lets it read auth.users.
--
-- PROOF. `pnpm db:verify-rls` on dev (2026-10-22; the test project is paused,
-- so `db:verify-rls:test` waits until it is restored): a
-- tutor's PATCH of rating_avg / rating_count / completed_sessions /
-- total_minutes_taught and of slug are refused, a user's PATCH of their own
-- profiles.email and onboarding_completed_at are refused, an admin-API email
-- change on a probe account lands in profiles.email, a text/html avatar and a
-- 3 MB JPEG are refused, and a tutor's headline/about edit and a small JPEG
-- avatar still succeed.

-- 1. tutor_profiles stats + slug: trusted server or admin session only.
CREATE OR REPLACE FUNCTION public.tutor_stats_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.is_trusted_server() OR public.is_admin() THEN
    RETURN new;
  END IF;

  IF tg_op = 'INSERT' THEN
    -- tutor_profiles_insert (0012) still lets a tutor create their own row, so
    -- a fresh row must start from the column defaults.
    IF new.rating_avg <> 0
       OR new.rating_count <> 0
       OR new.completed_sessions <> 0
       OR new.total_minutes_taught <> 0 THEN
      RAISE EXCEPTION 'tutor stats can only be set by the server';
    END IF;
  ELSE
    IF new.rating_avg           IS DISTINCT FROM old.rating_avg
       OR new.rating_count         IS DISTINCT FROM old.rating_count
       OR new.completed_sessions   IS DISTINCT FROM old.completed_sessions
       OR new.total_minutes_taught IS DISTINCT FROM old.total_minutes_taught THEN
      RAISE EXCEPTION 'tutor stats can only be set by the server';
    END IF;
    -- slug is NOT NULL, so in practice a client can never change it; the NULL
    -- case is kept so the rule reads "first set only" if the column ever relaxes.
    IF new.slug IS DISTINCT FROM old.slug AND old.slug IS NOT NULL THEN
      RAISE EXCEPTION 'slug can only be changed by the server';
    END IF;
  END IF;
  RETURN new;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tutor_stats_guard ON public.tutor_profiles;
--> statement-breakpoint
CREATE TRIGGER tutor_stats_guard
  BEFORE INSERT OR UPDATE ON public.tutor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tutor_stats_guard();
--> statement-breakpoint

-- 2. profiles_guard: the 0021 role and is_suspended checks unchanged, plus
--    email (only to the confirmed auth address) and onboarding_completed_at.
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
  RETURN new;
END;
$$;
--> statement-breakpoint

-- 3. A confirmed auth email change reaches profiles.email. Same shape as
--    handle_new_user (0002). Runs as the definer (postgres), so RLS does not
--    apply to the UPDATE; profiles_guard still runs and passes on the value check.
CREATE OR REPLACE FUNCTION public.handle_user_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new.email IS NOT NULL AND new.email IS DISTINCT FROM old.email THEN
    UPDATE public.profiles
       SET email = new.email
     WHERE id = new.id
       AND email IS DISTINCT FROM new.email;
  END IF;
  RETURN new;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_email_change();
--> statement-breakpoint

-- 4. Avatars: 2 MB, JPEG / PNG / WebP only. SVG deliberately excluded (it can
--    carry script). Applies to every upload, service role included.
UPDATE storage.buckets
   SET file_size_limit = 2097152,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id = 'avatars';
