import { NextResponse } from "next/server";
import { cronAuthFailure } from "@/lib/auth/api-guards";
import { expireUnpaidBookings } from "@/db/queries/expire-unpaid";

/**
 * `GET/POST /api/cron/expire-unpaid` — abandoned direct-pay checkouts become
 * `expired` (SPEC §4.2, §12; Phase 8 Part 3).
 *
 * WHAT IT IS NOT: what releases the slot. `computeSlots` releases a stale hold on
 * read and the booking transaction expires one it collides with on write, so an
 * hour of this job failing double-sells nothing. See
 * `db/queries/expire-unpaid.ts` for the boundary and the late-capture case.
 *
 * SCHEDULING: Supabase `pg_cron` + `pg_net`, every 10 minutes (§12). Snippet:
 * `drizzle/snippets/pg_cron_expire_unpaid.sql`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = cronAuthFailure(request, "expire-unpaid");
  if (denied) return denied;

  const startedAt = Date.now();
  try {
    const { expiredIds } = await expireUnpaidBookings();
    const summary = {
      ok: true as const,
      job: "expire-unpaid",
      expired: expiredIds.length,
      expiredIds,
      durationMs: Date.now() - startedAt,
    };
    // §12: every cron handler logs a structured summary of what it changed.
    console.info("[cron/expire-unpaid]", JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[cron/expire-unpaid] failed", err);
    return NextResponse.json({ error: "Unpaid-booking expiry failed." }, { status: 500 });
  }
}

/** Same handler under POST: `pg_net`'s documented call is `net.http_post`. */
export const POST = GET;
