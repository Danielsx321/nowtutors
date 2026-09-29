import { cronHandler } from "@/lib/cron/handler";

/**
 * `GET/POST /api/cron/booking-reminders` — the session reminders (SPEC §11,
 * §12; Phase 10 Part 3).
 *
 * Every 15 minutes: every confirmed scheduled booking starting 22 to 24 hours
 * out gets the student's 24-hour reminder, and every one starting 15 to 60
 * minutes out gets the 1-hour reminder on both sides. The booking's
 * `reminder_24h_sent_at` / `reminder_1h_sent_at` is stamped in the same
 * statement that claims it, so a booking is reminded once however often this
 * runs.
 *
 * Nothing depends on it for correctness: a missed run means a missed email,
 * never a missed session or a wrong charge.
 *
 * SCHEDULING: Supabase `pg_cron` + `pg_net`, every 15 minutes, not
 * `vercel.json` (Vercel Hobby runs crons at most once a day, §12). Snippet:
 * `drizzle/snippets/pg_cron_booking_reminders.sql`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The job body lives in `lib/cron/jobs.ts`, shared with the admin "run now"
// button on `/admin/settings`.
export const GET = cronHandler("booking-reminders");

/** Same handler under POST: `pg_net`'s documented call is `net.http_post`. */
export const POST = GET;
