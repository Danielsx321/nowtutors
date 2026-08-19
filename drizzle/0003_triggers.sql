-- Custom migration: shared helper (is_admin), updated_at maintenance, the tutor
-- presence guard (SPEC §7.5), and a profiles guard that blocks privilege
-- escalation (role change / self-unsuspend) via RLS-permitted self-updates.

-- Reused by the guard trigger below and by every admin RLS policy (0005).
-- SECURITY DEFINER so admin checks do not recurse into profiles RLS.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$;
--> statement-breakpoint
-- Attach set_updated_at to every table that has an updated_at column.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'updated_at'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', r.table_name);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      r.table_name
    );
  END LOOP;
END $$;
--> statement-breakpoint
-- Never allow is_live = true with a null last_seen_at (SPEC §7.5): makes the
-- "went live before the heartbeat, last_seen blank" corruption structurally impossible.
CREATE OR REPLACE FUNCTION public.tutor_presence_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF new.is_live IS TRUE AND new.last_seen_at IS NULL THEN
    new.last_seen_at = now();
  END IF;
  RETURN new;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tutor_presence_guard ON public.tutor_profiles;
--> statement-breakpoint
CREATE TRIGGER tutor_presence_guard
  BEFORE INSERT OR UPDATE ON public.tutor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tutor_presence_guard();
--> statement-breakpoint
-- Prevent a user from escalating their own role or clearing their suspension via
-- the RLS-permitted self-update on profiles. role may be set once (NULL -> value)
-- during onboarding, or changed by an admin.
CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new.role IS DISTINCT FROM old.role
     AND old.role IS NOT NULL
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'role is immutable';
  END IF;
  IF new.is_suspended IS DISTINCT FROM old.is_suspended
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'is_suspended can only be changed by an admin';
  END IF;
  RETURN new;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS profiles_guard ON public.profiles;
--> statement-breakpoint
CREATE TRIGGER profiles_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard();
