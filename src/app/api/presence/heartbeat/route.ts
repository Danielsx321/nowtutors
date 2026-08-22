import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireApiUser } from "@/lib/auth/api-guards";
import { clearTutorLiveOnExit, touchPresence } from "@/db/queries/presence";

/**
 * `POST /api/presence/heartbeat` — the presence heartbeat (SPEC §7.5).
 *
 * The caller's identity comes from `requireApiUser()`, which runs as the FIRST
 * statement and reads the session. The body carries an EVENT KIND and nothing
 * else — there is no user id in the payload to spoof, so no request can move
 * another account's presence. (This is the whole reason the route takes a body
 * at all: `navigator.sendBeacon` cannot set headers, so the exit signal has to
 * ride in the payload.)
 *
 * Two events:
 *   - `heartbeat` (default) — bump `last_seen_at`. Fired on mount and every 30s
 *     while the tab is visible.
 *   - `exit` — the `pagehide` beacon (§7.5 defence 3). Clears `is_live` for a
 *     live tutor and deliberately does NOT bump `last_seen_at`; see
 *     `clearTutorLiveOnExit`.
 *
 * A malformed or absent body is treated as a plain heartbeat rather than a 400:
 * beacons are fire-and-forget and a rejected one would silently lose presence
 * for no benefit.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  event: z.enum(["heartbeat", "exit"]).default("heartbeat"),
});

export async function POST(request: Request) {
  try {
    const profile = await requireApiUser();

    let event: "heartbeat" | "exit" = "heartbeat";
    try {
      const raw = await request.text();
      if (raw.trim()) {
        const parsed = bodySchema.safeParse(JSON.parse(raw));
        if (parsed.success) event = parsed.data.event;
      }
    } catch {
      // Unparseable beacon payload — fall through as a heartbeat.
    }

    if (event === "exit") {
      const wentOffline =
        profile.role === "tutor" ? await clearTutorLiveOnExit(profile.id) : false;
      return NextResponse.json({ ok: true, event, wentOffline });
    }

    const { tutorTouched } = await touchPresence(profile.id, profile.role);
    return NextResponse.json({ ok: true, event, tutorTouched });
  } catch (err) {
    const authError = authErrorResponse(err);
    if (authError) return authError;
    console.error("[presence/heartbeat] failed", err);
    return NextResponse.json({ error: "Presence update failed." }, { status: 500 });
  }
}
