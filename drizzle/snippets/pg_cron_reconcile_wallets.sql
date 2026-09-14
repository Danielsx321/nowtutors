-- Schedule the wallet drift alarm (SPEC §4.4, §12; Phase 8 Part 3) — Supabase pg_cron.
--
-- NOT A MIGRATION, for the same reasons as `pg_cron_sweep_presence.sql`: the
-- extensions need privileges the migration connection does not reliably have,
-- the job reads a per-environment secret, and it is idempotent-by-unschedule.
-- Run once per environment, by hand, from the Supabase SQL editor as `postgres`.
--
-- **Run `pg_cron_sweep_presence.sql` first.** It creates the extensions and the
-- two Vault secrets (`app_base_url`, `cron_secret`) this job reads.
--
-- WHAT DEPENDS ON IT: nothing is paid or blocked by this job. It is the check
-- that every wallet's cached balance equals its ledger sum. If it stops
-- running, drift goes unnoticed rather than unfixed.

-- The job. Daily at 03:00 UTC, per SPEC §12.
-- Unschedule first so re-running this snippet updates rather than duplicates.
select cron.unschedule('reconcile-wallets')
 where exists (select 1 from cron.job where jobname = 'reconcile-wallets');

select cron.schedule(
  'reconcile-wallets',
  '0 3 * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/reconcile-wallets',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $job$
);

-- Verify.
--    Scheduled?      select jobid, jobname, schedule, active from cron.job;
--    Ran?            select * from cron.job_run_details where command like '%reconcile-wallets%'
--                     order by start_time desc limit 5;
--    What it found?  select id, status_code, content from net._http_response
--                     order by created desc limit 10;
--                    `"drift":false,"mismatches":0` is the healthy answer.
--    A 401 here means cron_secret and Vercel's CRON_SECRET disagree.
--    A 503 means CRON_SECRET is unset on the deployment.
--
--    `"drift":true` is a FINDING. Do not "fix" balances by hand: find out which
--    write bypassed lib/credits/ledger.ts first. The ledger is append-only.
--
-- Run it now instead of waiting for 03:00 (same call the job makes):
--    select net.http_post(
--      url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
--             || '/api/cron/reconcile-wallets',
--      headers := jsonb_build_object('Content-Type', 'application/json',
--        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
--      body := '{}'::jsonb, timeout_milliseconds := 10000);

-- Teardown: select cron.unschedule('reconcile-wallets');
