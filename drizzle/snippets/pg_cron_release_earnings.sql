-- Schedule the earnings-release sweep (SPEC §7.11, §12) — Supabase pg_cron.
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
-- not repeated here, because `vault.create_secret` raises on a duplicate name
-- and a second copy would make this snippet fail on an environment that is
-- already correctly set up.
--
-- WHY pg_cron AND NOT vercel.json: Vercel **Hobby** crons run at most once a
-- day, which cannot honour the `0 * * * *` §12 asks for here.
--
-- WHAT DEPENDS ON IT: unlike `expire-requests`, this job is **not** tidy-up.
-- Nothing else in the codebase credits a tutor for a session — `complete-sessions`
-- writes the `held` promise and touches no wallet (Phase 6 Part 3C), and this
-- is what turns it into spendable credits. If this job never runs, tutors are
-- never paid. A late run pays the same amount, though: `available_at` is stored
-- on the row and derived from `ended_at` (§7.11), so delay costs the delay and
-- nothing else.

-- The job. Hourly, per SPEC §12.
-- Unschedule first so re-running this snippet updates rather than duplicates.
select cron.unschedule('release-earnings')
 where exists (select 1 from cron.job where jobname = 'release-earnings');

select cron.schedule(
  'release-earnings',
  '0 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/release-earnings',
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
--                    (`{"ok":true,"job":"release-earnings","released":N,
--                      "creditsReleased":N,...}`):
--                    select id, status_code, content from net._http_response
--                     order by created desc limit 10;
--    Paid what?      select * from credit_transactions
--                     where type = 'session_earning' order by created_at desc limit 10;
--    A 401 here means cron_secret and Vercel's CRON_SECRET disagree.
--    A 503 means CRON_SECRET is unset on the deployment.
--
--    A non-zero `corruptSplit` or `duplicateLedger` in the summary is a row that
--    was NOT paid and is still `held`. Neither is self-healing; both want a
--    person to look at the booking.

-- Teardown: select cron.unschedule('release-earnings');
