-- Code review 2026-09-20 (docs/review/2026-09-20-pass-2-authorization.md: A1,
-- A2, A3; DECISIONS, "Direct REST writes closed").
--
-- HAND-WRITTEN. drizzle-kit does not manage this project's RLS, grants or
-- guard triggers (0005, 0010, 0012, 0015, 0016, 0018).
--
-- WHY. The app writes through the trusted server connection after its own
-- checks (SPEC §5 Layer 2). A signed-in user calling PostgREST with the public
-- key and their own JWT skips all of them, so the database has to refuse on its
-- own. 0010, 0015 and 0018 closed this for tutor approval, withdrawals,
-- messages and broadcasts. Three paths were left open, each proven on the test
-- project before this file existed (`pnpm db:verify-rls:test`, 2026-09-20):
--
--   * A NEW ACCOUNT COULD MAKE ITSELF ADMIN. `profiles_guard` (0003, 0016) only
--     refused a role change when the old role was NOT NULL, to leave room for
--     onboarding. Onboarding has never used that room: it writes through the
--     trusted connection. So the one case the guard let through was a fresh
--     signup sending `PATCH profiles {"role":"admin"}`, after which every
--     `requireRole('admin')` passed.
--   * A STUDENT COULD WRITE `bookings`. `bookings_insert` checked only
--     `student_id = auth.uid()` and `bookings_update` only participation. A
--     student could flip their own `pending_payment` booking to `confirmed` and
--     skip PayPal, insert a confirmed booking with no debit and no slot check,
--     or (with a second account as the tutor) insert a finished booking with a
--     made-up `price_credits` that `complete-sessions` and `release-earnings`
--     then paid out. A forged row's `agora_channel` also fed the session token
--     route, which mints for whatever channel the row names.
--   * A STUDENT COULD WRITE `session_requests`, including `price_credits`. The
--     accept transaction charges the pinned price by design (§7.4), so a
--     120-minute request inserted at 1 credit was charged 1 credit.
--
-- Every one of these writes needs rules RLS cannot express (price, slot,
-- balance, status transitions), so every client write is removed, the same
-- decision 0015 and 0018 made. Reads are unchanged: participants still SELECT
-- their own rows, and Realtime on `session_requests` relies on that SELECT
-- policy and keeps working. The only writers are the server actions, cron jobs
-- and PayPal settlement on the trusted connection.

-- 1. A role can only be set by an admin session or the trusted server.
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
  RETURN new;
END;
$$;
--> statement-breakpoint

-- 2. bookings: no client writes.
DROP POLICY IF EXISTS "bookings_insert" ON public.bookings;
--> statement-breakpoint
DROP POLICY IF EXISTS "bookings_update" ON public.bookings;
--> statement-breakpoint

-- 3. session_requests: no client writes.
DROP POLICY IF EXISTS "session_requests_insert" ON public.session_requests;
--> statement-breakpoint
DROP POLICY IF EXISTS "session_requests_update" ON public.session_requests;
--> statement-breakpoint

-- Policies alone would already deny these (RLS is enabled and no write policy
-- remains), but the privileges go too, so re-adding a permissive policy later
-- is not enough to reopen the hole by accident. SELECT grants are untouched.
REVOKE INSERT, UPDATE, DELETE ON public.bookings FROM anon, authenticated;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON public.session_requests FROM anon, authenticated;
