import { NextResponse } from "next/server";
import { authErrorResponse, requireApiUser } from "@/lib/auth/api-guards";
import { touchPresence } from "@/db/queries/presence";

/**
 * `POST /api/presence/heartbeat` — the presence heartbeat (SPEC §7.5).
 *
 * The caller's identity comes from `requireApiUser()`, which runs as the FIRST
 * statement and reads the session. **Nothing is read from the request body** —
 * there is no user id to spoof and no event kind to send, so no request can move
 * another account's presence.
 *
 * One job: bump `last_seen_at` (and `tutor_profiles.last_seen_at` for tutors).
 * It does not touch `is_live` in either direction. Going live is the explicit
 * toggle (`actions/presence.ts`); going offline is that toggle or the sweep.
 *
 * An earlier revision also accepted `{ event: 'exit' }` from a `pagehide`
 * `sendBeacon` to clear a departing tutor's `is_live`. That path is gone: see
 * `hooks/use-presence.ts` and docs/DECISIONS.md — `pagehide` cannot distinguish
 * a reload from an exit, and §3.1 means no student-facing read depended on it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const profile = await requireApiUser();
    const { tutorTouched } = await touchPresence(profile.id, profile.role);
    return NextResponse.json({ ok: true, tutorTouched });
  } catch (err) {
    const authError = authErrorResponse(err);
    if (authError) return authError;
    console.error("[presence/heartbeat] failed", err);
    return NextResponse.json({ error: "Presence update failed." }, { status: 500 });
  }
}
