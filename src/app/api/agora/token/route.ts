import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireApiUser } from "@/lib/auth/api-guards";
import { checkSessionAccess } from "@/lib/agora/session-access";
import { agoraUid } from "@/lib/agora/uid";
import { tokenExpiresAt } from "@/lib/agora/token-request";
import {
  agoraAppId,
  AgoraConfigError,
  AgoraTokenServiceError,
  fetchRtcToken,
} from "@/lib/agora/token-service";
import {
  endElapsedInstantSession,
  getSessionBooking,
  stampSessionJoin,
} from "@/db/queries/sessions";

/**
 * `POST /api/agora/token` — the only way a browser gets an Agora token
 * (SPEC §9, CLAUDE.md). The Render service is never called from the client.
 *
 * The request carries a booking id and nothing else. **No channel, no role, no
 * uid, no identity** — every one of those is derived here:
 *
 *  - identity from `requireApiUser()`, which reads the session;
 *  - the channel from `bookings.agora_channel`, so a caller cannot name a channel
 *    they were not admitted to (this is why the body is `{ bookingId }` rather
 *    than SPEC §9's `{ channel }` with the id parsed back out of it — the safer
 *    of the two, and the id is the thing the client actually holds);
 *  - the role from `checkSessionAccess`, which has no branch that reads a
 *    request field. The live Bubble app picks the role in browser JavaScript by
 *    comparing profile ids; this route exists so we do not.
 *
 * Joining is recorded here rather than in a separate action, mirroring SPEC §7.7
 * step 4 — the sibling LessonSpace flow stamps `*_joined_at` inside its own join
 * route, at link issuance. A client cannot reach a channel without this request,
 * so the stamp cannot be skipped by simply not calling something afterwards.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Render's free tier sleeps and the first token request after idle takes 30–50s
 * (SPEC §9). The default function budget would cut that off mid-flight and turn
 * a cold start into a failed join; the warm ping in `cron/sweep-presence` is what
 * keeps it from being reached.
 */
export const maxDuration = 60;

const bodySchema = z.object({ bookingId: z.string().uuid() });

export async function POST(request: Request) {
  let user;
  try {
    user = await requireApiUser();
  } catch (err) {
    const res = authErrorResponse(err);
    if (res) return res;
    throw err;
  }

  const json: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  const { bookingId } = parsed.data;

  // Participation, state and role — one pure decision, unit-tested in
  // tests/unit/agora-session-access.test.ts. A booking that does not exist and
  // one belonging to somebody else come back identical, so the endpoint cannot
  // be used to discover booking ids.
  const access = checkSessionAccess(await getSessionBooking(bookingId), user.id);
  if (!access.ok) {
    if (access.elapsed) {
      // The booked duration ran out (§7.4). Close the booking out on the way
      // past — this is the re-entry guard, so it is the actor that catches a
      // refresh, a second tab or a reconnect after the deadline, and (once the
      // renewal pass lands) every renewal.
      //
      // **Best-effort, deliberately.** The refusal above is the enforcement and
      // it has already been decided; if this write fails the caller still gets
      // no credential, and the deadline actor or Part 3C's cron will close the
      // row later. Awaiting it before answering would let a database hiccup turn
      // a correct refusal into a 500.
      try {
        await endElapsedInstantSession(bookingId);
      } catch (err) {
        console.error("[agora/token] deadline transition failed", {
          bookingId,
          err,
        });
      }
    }
    return NextResponse.json({ error: access.message }, { status: access.status });
  }

  // First-join writes (SPEC §4.3, §7.4): stamp this participant's arrival,
  // backfill the channel if it is somehow null, and start the billing clock iff
  // this is the write that puts both parties in the room. Idempotent — a
  // refresh, a second tab or a token renewal all re-run it harmlessly.
  const stamp = await stampSessionJoin(bookingId, user.id);
  if (!stamp) {
    // The row moved between the guard and the write — ended, cancelled, or the
    // participant list changed. Same answer the guard would now give.
    return NextResponse.json({ error: "This session isn't live." }, { status: 409 });
  }
  if (!stamp.agoraChannel) {
    // Unreachable: the write coalesces a channel in. If it ever happens, the
    // room has no identity to join and that is a server fault, not a 4xx to
    // paper over with a channel invented in the browser.
    console.error("[agora/token] booking has no channel after join stamp", {
      bookingId,
    });
    return NextResponse.json(
      { error: "This session couldn't be opened." },
      { status: 500 },
    );
  }

  let token: string;
  let appId: string;
  try {
    appId = agoraAppId();
    token = await fetchRtcToken(stamp.agoraChannel, access.role);
  } catch (err) {
    if (err instanceof AgoraConfigError) {
      console.error("[agora/token] not configured", err.message);
      return NextResponse.json(
        { error: "Video isn't available right now." },
        { status: 503 },
      );
    }
    if (err instanceof AgoraTokenServiceError) {
      // A third party was slow or unhappy. 502 — ours is fine, theirs is not —
      // and the client can retry without anything having been half-done: the
      // join stamp above is idempotent.
      console.error("[agora/token] token service failed", {
        bookingId,
        status: err.status,
        detail: err.detail,
      });
      return NextResponse.json(
        { error: "Couldn't connect to video. Please try again." },
        { status: 502 },
      );
    }
    throw err;
  }

  return NextResponse.json({
    token,
    // Deterministic, so a reconnect returns as the same participant (§9 step 4).
    uid: agoraUid(user.id),
    appId,
    channel: stamp.agoraChannel,
    // Deliberately earlier than the token's real expiry, so the renewal (§9
    // steps 5–6, still a later pass) begins while this token is still valid.
    expiresAt: tokenExpiresAt(new Date()).toISOString(),
    // Server-derived, and the reason the client needs no id comparison of its
    // own: it decides which tracks to publish from this, not from who it thinks
    // it is. Both parties hold a publisher token (§9 step 2) — the asymmetry is
    // in the media, not in the grant.
    isTutor: access.isTutor,
  });
}
