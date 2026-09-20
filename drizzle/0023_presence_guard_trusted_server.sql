-- Code review 2026-09-20 (docs/review/2026-09-20-pass-2-authorization.md, A4;
-- DECISIONS, "Review mediums").
--
-- HAND-WRITTEN. drizzle-kit does not manage this project's guard triggers.
--
-- WHY. `tutor_profiles_update` (0012) lets a tutor write any column of their
-- own row except the approval ones. Proven on the test project before this file
-- existed (`pnpm db:verify-rls:test`, 2026-09-21): a tutor could
--   PATCH tutor_profiles {"is_live": true, "last_seen_at": "2099-01-01"}
-- and stay in `live_tutors` with no heartbeat, for good. That is the stale-live
-- bug SPEC §3.1 exists to make impossible, and `sweep-presence` derives its work
-- set from the same view, so it never cleared it.
--
-- Presence has exactly three writers, all on the trusted connection: the
-- heartbeat route, the go-live action and the sweep (plus start/end broadcast
-- for `live_mode`). So the presence columns become server-only, the same way
-- 0010 made the approval columns admin-only. A tutor's profile edits are
-- untouched. The original job of this trigger (never `is_live` with a NULL
-- `last_seen_at`) is kept.

CREATE OR REPLACE FUNCTION public.tutor_presence_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT public.is_trusted_server() THEN
    IF tg_op = 'INSERT' THEN
      IF new.is_live IS TRUE OR new.last_seen_at IS NOT NULL OR new.live_mode IS NOT NULL THEN
        RAISE EXCEPTION 'presence can only be set by the server';
      END IF;
    ELSIF new.is_live IS DISTINCT FROM old.is_live
       OR new.last_seen_at IS DISTINCT FROM old.last_seen_at
       OR new.live_mode IS DISTINCT FROM old.live_mode THEN
      RAISE EXCEPTION 'presence can only be set by the server';
    END IF;
  END IF;

  IF new.is_live IS TRUE AND new.last_seen_at IS NULL THEN
    new.last_seen_at = now();
  END IF;
  RETURN new;
END;
$$;
