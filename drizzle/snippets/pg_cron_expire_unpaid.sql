-- Schedule the abandoned-checkout sweep (SPEC §4.2, §12; Phase 8 Part 3) — Supabase pg_cron.
--
-- NOT A MIGRATION, for the same reasons as `pg_cron_sweep_presence.sql`. Run once
-- per environment, by hand, from the Supabase SQL editor as `postgres`, after
-- `pg_cron_sweep_presence.sql` (extensions + the `app_base_url` and
-- `cron_secret` Vault secrets).
--
-- WHAT DEPENDS ON IT: nothing correctness-critical. Stale `pending_payment`
-- holds already stop blocking slots on read (computeSlots) and are expired on
-- write by the booking transaction. This keeps the rows honest.

-- The job. Every 10 minutes, per SPEC §12.
select cron.unschedule('expire-unpaid')
 where exists (select 1 from cron.job where jobname = 'expire-unpaid');

select cron.schedule(
  'expire-unpaid',
  '*/10 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/expire-unpaid',
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
--    What it did?    select id, status_code, content from net._http_response
--                     order by created desc limit 10;
--                    (`{"ok":true,"job":"expire-unpaid","expired":N,...}`)
--    A 401 means cron_secret and Vercel's CRON_SECRET disagree; 503 means it is unset.

-- Teardown: select cron.unschedule('expire-unpaid');
