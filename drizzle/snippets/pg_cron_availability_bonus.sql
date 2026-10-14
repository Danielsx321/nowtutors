-- Schedule the weekly availability bonus (SPEC §7.5, §7.11, §12;
-- availability-bonus, 2026-10-14) — Supabase pg_cron.
--
-- NOT A MIGRATION, for the same reasons as `pg_cron_sweep_presence.sql`: the
-- extensions need privileges the migration connection does not reliably have,
-- the job reads a per-environment secret, and it is idempotent-by-unschedule.
-- Run once per environment, by hand, from the Supabase SQL editor as `postgres`.
--
-- **Run `pg_cron_sweep_presence.sql` first.** It creates the extensions and the
-- two Vault secrets (`app_base_url`, `cron_secret`) this job reads.
--
-- WHAT DEPENDS ON IT: the weekly $40 (40 credits) tutors are promised for being
-- live 5 hours in a week. If this job stops, tutors are not paid their bonus.
-- It is safe to run by hand at any time (the admin "Run now" button does the
-- same): a week is paid once per tutor, enforced by two unique indexes, and the
-- job looks back over the last four complete weeks, so a missed Monday is paid
-- on the next run.

-- The job. Mondays at 00:20 UTC, per SPEC §12: after the last Sunday heartbeats
-- and the 00:00 presence sweep, before anyone in Qatar or Lagos is awake.
-- Unschedule first so re-running this snippet updates rather than duplicates.
select cron.unschedule('availability-bonus')
 where exists (select 1 from cron.job where jobname = 'availability-bonus');

select cron.schedule(
  'availability-bonus',
  '20 0 * * 1',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/availability-bonus',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);

-- Verify.
--    Scheduled?      select jobid, jobname, schedule, active from cron.job;
--    Ran?            select * from cron.job_run_details where command like '%availability-bonus%'
--                     order by start_time desc limit 5;
--    What it paid?   select id, status_code, content from net._http_response
--                     order by created desc limit 10;
--                    `"awarded":N,"creditsAwarded":40*N` is the answer; `"disabled":true`
--                    means the availability_bonus_enabled setting is false.
--    Who was paid?   select a.week_start, p.full_name, a.live_seconds, a.credits, a.created_at
--                     from availability_bonus_awards a join profiles p on p.id = a.tutor_id
--                     order by a.week_start desc, a.created_at desc;
--    Hours so far?   select p.full_name, t.day, t.seconds
--                     from tutor_online_time t join profiles p on p.id = t.tutor_id
--                     where t.day >= date_trunc('week', now())::date
--                     order by p.full_name, t.day;
--    A 401 here means cron_secret and Vercel's CRON_SECRET disagree.
--    A 503 means CRON_SECRET is unset on the deployment.

-- Run it now instead of waiting for Monday (same call the job makes):
--    select net.http_post(
--      url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
--             || '/api/cron/availability-bonus',
--      headers := jsonb_build_object('Content-Type', 'application/json',
--        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
--      body := '{}'::jsonb, timeout_milliseconds := 30000);

-- Teardown: select cron.unschedule('availability-bonus');
