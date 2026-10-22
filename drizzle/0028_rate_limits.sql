-- Code review "security checklist 2026-10-22" (finding 7; DECISIONS,
-- "Security C: rate limits, link checks, redirect fix, suspended users,
-- payout change log").
--
-- HAND-WRITTEN, in the shape drizzle-kit would generate for the table in
-- src/db/schema/security.ts, plus the counter function and the privileges it
-- cannot know about (the same split as 0022 and 0026).
--
-- WHY. Nothing in the app counted attempts. Supabase Auth has its own limits,
-- but every call reaches it from Vercel's IP, not the visitor's, so they are
-- one shared bucket for the whole site rather than a per-person limit. A bot
-- could try passwords against one address, or sign up in a loop, as fast as
-- the server answered. Upstash was rejected (a new dependency and a new paid
-- service); a fixed-window counter in Postgres needs neither.
--
-- rate_limits: one row per key per window. The key is built in
--   lib/security/rate-limit.ts as `<action>:<ip|email|user>:<value>`;
--   window_start is the start of the fixed window the hit falls in. Server-only:
--   RLS on with no policies, and no privilege for anon or authenticated, so
--   PostgREST cannot read or write it. The trusted Drizzle connection owns it.
--   Rows older than a day are deleted by the daily reconcile-wallets job (§12).
--
-- hit_rate_limit(key, limit, window_seconds): counts one hit and answers
--   whether the caller is still within the limit. One INSERT ... ON CONFLICT
--   DO UPDATE ... RETURNING, so two hits at the same moment cannot both read
--   the same count: the second waits on the first's row lock and sees its
--   increment. The window is aligned to the epoch (floor(now / window) *
--   window), on the database clock, so every server instance agrees on it.
--   SECURITY INVOKER: it only ever runs on the trusted connection, and anon /
--   authenticated have no EXECUTE.

CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE INDEX "rate_limits_window_start_idx" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint

-- Server-only. Supabase's default privileges grant new public tables to anon
-- and authenticated, so take them back explicitly; RLS with no policy is the
-- second lock on the same door.
REVOKE ALL ON public.rate_limits FROM anon, authenticated;--> statement-breakpoint
GRANT ALL ON public.rate_limits TO service_role;--> statement-breakpoint
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.hit_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_window timestamptz;
  v_count integer;
BEGIN
  IF p_key IS NULL OR p_key = '' OR p_limit IS NULL OR p_limit < 1
     OR p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'hit_rate_limit: bad arguments (key %, limit %, window %)', p_key, p_limit, p_window_seconds;
  END IF;

  v_window := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO public.rate_limits AS r ("key", "window_start", "count")
  VALUES (p_key, v_window, 1)
  ON CONFLICT ("key", "window_start")
  -- Capped so a flood can never overflow the integer; anything past the limit
  -- is refused the same way.
  DO UPDATE SET "count" = LEAST(r."count", 2147483646) + 1
  RETURNING r."count" INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.hit_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hit_rate_limit(text, integer, integer) TO service_role;
