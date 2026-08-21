-- SECURITY FIX. The column-level REVOKE UPDATE(approval_status, approval_note,
-- approved_at) in drizzle/0005 is INEFFECTIVE: 0005 also runs
--   GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
-- and in PostgreSQL a table-level UPDATE privilege overrides a column-level
-- REVOKE, so any authenticated tutor could self-approve via a direct REST call
-- (verified). Enforce approval immutability with a trigger instead, mirroring
-- profiles_guard (drizzle/0003): only an admin may change the approval_* columns.
-- Service-role/system writes disable the trigger the same way the seed does for
-- profiles_guard. SPEC §5: approval_status is writable by admin/service only.
CREATE OR REPLACE FUNCTION public.tutor_approval_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (new.approval_status IS DISTINCT FROM old.approval_status
      OR new.approval_note   IS DISTINCT FROM old.approval_note
      OR new.approved_at     IS DISTINCT FROM old.approved_at)
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'approval fields can only be changed by an admin';
  END IF;
  RETURN new;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tutor_approval_guard ON public.tutor_profiles;
--> statement-breakpoint
CREATE TRIGGER tutor_approval_guard
  BEFORE UPDATE ON public.tutor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tutor_approval_guard();
