-- Schedule the booking-reminder sweep (SPEC §11, §12; Phase 10 Part 3) — Supabase pg_cron.
--
-- NOT A MIGRATION, for the same three reasons as `pg_cron_sweep_presence.sql`:
-- `CREATE EXTENSION` needs privileges the migration connection does not
-- reliably have, the job embeds a per-environment secret, and it is
-- idempotent-by-unschedule rather than a forward-only schema change. Run once
-- per environment, by hand, from the Supabase SQL editor as the `postgres`
-- role.
--
-- **Run `pg_cron_sweep_presence.sql` first.** Steps 1 and 2 there create the
-- extensions and the two Vault secrets this job reads; they are deliberately
-- not repeated here.
--
-- WHY pg_cron AND NOT vercel.json: Vercel **Hobby** crons run at most once a
-- day, which cannot honour the `*/15 * * * *` §12 asks for here.
--
-- WHAT DEPENDS ON IT: only the reminder emails. A missed run means a missed
-- reminder, never a missed session or a wrong charge; the claim stamps on
-- `bookings` make an extra run harmless.

-- The job. Every 15 minutes, per SPEC §12.
-- Unschedule first so re-running this snippet updates rather than duplicates.
select cron.unschedule('booking-reminders')
 where exists (select 1 from cron.job where jobname = 'booking-reminders');

select cron.schedule(
  'booking-reminders',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/booking-reminders',
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
--                    (`{"ok":true,"job":"booking-reminders","claimed24h":N,
--                      "claimed1h":N,"sent":N,"failed":N,...}`):
--                    select id, status_code, content from net._http_response
--                     order by created desc limit 10;
--    Stamped what?   select id, scheduled_start_at, reminder_24h_sent_at, reminder_1h_sent_at
--                      from bookings where reminder_24h_sent_at is not null
--                         or reminder_1h_sent_at is not null
--                     order by scheduled_start_at desc limit 10;
--    A 401 here means cron_secret and Vercel's CRON_SECRET disagree.
--    A 503 means CRON_SECRET is unset on the deployment.
