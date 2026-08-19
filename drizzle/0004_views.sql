-- Custom migration: the two read views (Decisions #7, #8, B). Columns are
-- enumerated explicitly — never SELECT * — so neither view leaks columns.

-- live_tutors: security_invoker so it runs with the caller's RLS. tutor_profiles
-- RLS already permits public read of approved rows, so this is correct and safe.
-- The 2-minute staleness threshold is baked in here — the single source of truth
-- (Decision #8); presence_stale_seconds no longer exists in platform_settings.
CREATE VIEW public.live_tutors
WITH (security_invoker = on) AS
SELECT
  tp.id,
  tp.user_id,
  tp.slug,
  tp.headline,
  tp.about,
  tp.intro_video_url,
  tp.education,
  tp.years_experience,
  tp.languages,
  tp.hourly_rate_credits,
  tp.instant_rate_credits_per_minute,
  tp.accepts_instant,
  tp.live_mode,
  tp.rating_avg,
  tp.rating_count,
  tp.completed_sessions,
  tp.total_minutes_taught,
  tp.last_seen_at
FROM public.tutor_profiles tp
WHERE tp.is_live = true
  AND tp.approval_status = 'approved'
  AND tp.last_seen_at > now() - interval '2 minutes';
--> statement-breakpoint
GRANT SELECT ON public.live_tutors TO anon, authenticated;
--> statement-breakpoint
-- public_profiles: SECURITY DEFINER (invoker off) so it can expose the five safe
-- columns of OTHER users while profiles base RLS stays own-row-only (Decision B).
-- The explicit column list preserves the "don't leak everything" intent of #7.
CREATE VIEW public.public_profiles
WITH (security_invoker = off) AS
SELECT
  p.id,
  p.display_name,
  p.avatar_url,
  p.country,
  p.bio
FROM public.profiles p;
--> statement-breakpoint
GRANT SELECT ON public.public_profiles TO anon, authenticated;
