-- Schedule the presence sweep (SPEC §7.5 defence 2, §12) — Supabase pg_cron.
--
-- NOT A MIGRATION. This is run once per environment, by hand, from the Supabase
-- SQL editor as the `postgres` role. It is kept out of drizzle/NNNN_*.sql on
-- purpose:
--   * `CREATE EXTENSION pg_cron` needs privileges the migration connection does
--     not reliably have, so a failure here would block every later migration;
--   * it embeds a per-environment secret and base URL, which must not be
--     committed;
--   * it is idempotent-by-unschedule, not a forward-only schema change.
--
-- WHY pg_cron AND NOT vercel.json: the deploy target is Vercel **Hobby**, whose
-- cron jobs run at most ONCE A DAY. A daily presence sweep is worthless for a
-- 2-minute staleness window. Correctness never depended on the sweep (the
-- live_tutors view protects students at read time — §3.1), but a once-daily
-- tidy-up would leave `is_live` wrong on the base table for hours at a stretch.
-- Supabase pg_cron runs in the same project as the data and honours */5.
-- There is deliberately no vercel.json in this repo.

-- 1. Extensions. pg_cron must live in pg_catalog on Supabase; pg_net in extensions.
create extension if not exists pg_cron  with schema pg_catalog;
create extension if not exists pg_net   with schema extensions;

-- 2. Secrets go in Vault, never inline in the cron command — cron.job.command is
--    readable by anyone who can read the catalog, and CRON_SECRET is the only
--    thing standing in front of a write endpoint.
--    Run ONCE per environment; re-running raises on the duplicate name.
--    `app_base_url` has NO trailing slash. `cron_secret` must equal the
--    CRON_SECRET set in the Vercel project for the SAME environment.
select vault.create_secret('https://nowtutors-brown.vercel.app', 'app_base_url',
                           'Base URL the pg_cron jobs POST to');
select vault.create_secret('REPLACE_WITH_CRON_SECRET', 'cron_secret',
                           'Bearer token for /api/cron/* — must match Vercel CRON_SECRET');

-- 3. The job. Every 5 minutes, per SPEC §12.
--    Unschedule first so re-running this snippet updates rather than duplicates.
select cron.unschedule('sweep-presence')
 where exists (select 1 from cron.job where jobname = 'sweep-presence');

select cron.schedule(
  'sweep-presence',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/sweep-presence',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $job$
);

-- 4. Verify.
--    Scheduled?      select jobid, jobname, schedule, active from cron.job;
--    Ran?            select * from cron.job_run_details order by start_time desc limit 10;
--    What it did?    net._http_response holds the route's JSON summary
--                    (`{"ok":true,"job":"sweep-presence","swept":N,...}`):
--                    select id, status_code, content from net._http_response
--                     order by created desc limit 10;
--    A 401 here means cron_secret and Vercel's CRON_SECRET disagree.
--    A 503 means CRON_SECRET is unset on the deployment.

-- Teardown: select cron.unschedule('sweep-presence');
