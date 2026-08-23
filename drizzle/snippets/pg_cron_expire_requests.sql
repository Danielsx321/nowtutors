-- Schedule the instant-request expiry sweep (SPEC §7.4, §12) — Supabase pg_cron.
--
-- NOT A MIGRATION, for the same three reasons as
-- `pg_cron_sweep_presence.sql`: `CREATE EXTENSION` needs privileges the
-- migration connection does not reliably have, the job embeds a
-- per-environment secret, and it is idempotent-by-unschedule rather than a
-- forward-only schema change. Run once per environment, by hand, from the
-- Supabase SQL editor as the `postgres` role.
--
-- **Run `pg_cron_sweep_presence.sql` first.** Steps 1 and 2 there create the
-- extensions and the two Vault secrets this job reads; they are deliberately not
-- repeated here, because `vault.create_secret` raises on a duplicate name and a
-- second copy would make this snippet fail on an environment that is already
-- correctly set up.
--
-- WHY pg_cron AND NOT vercel.json: Vercel **Hobby** crons run at most once a
-- day, which cannot honour the `* * * * *` §12 asks for here. Correctness does
-- not depend on this job — the accept transaction refuses an expired request on
-- its own, and the "one pending request at a time" read ignores rows past their
-- deadline — but without it a dead request sits `pending` in the tutor's inbox
-- and in an operator's view of what happened.

-- The job. Every minute, per SPEC §12.
-- Unschedule first so re-running this snippet updates rather than duplicates.
select cron.unschedule('expire-requests')
 where exists (select 1 from cron.job where jobname = 'expire-requests');

select cron.schedule(
  'expire-requests',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/expire-requests',
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
--    Ran?            select * from cron.job_run_details order by start_time desc limit 10;
--    What it did?    net._http_response holds the route's JSON summary
--                    (`{"ok":true,"job":"expire-requests","expired":N,...}`):
--                    select id, status_code, content from net._http_response
--                     order by created desc limit 10;
--    A 401 here means cron_secret and Vercel's CRON_SECRET disagree.
--    A 503 means CRON_SECRET is unset on the deployment.

-- Teardown: select cron.unschedule('expire-requests');
