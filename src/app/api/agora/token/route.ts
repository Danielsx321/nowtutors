import { NextResponse } from "next/server";
import { authErrorResponse, requireApiUser } from "@/lib/auth/api-guards";
import { checkSessionAccess, type AgoraRole } from "@/lib/agora/session-access";
import { parseTokenBody } from "@/lib/agora/token-body";
import { agoraUid } from "@/lib/agora/uid";
import { tokenExpiresAt } from "@/lib/agora/token-request";
import {
  agoraAppId,
  AgoraConfigError,
  AgoraTokenServiceError,
  fetchRtcToken,
} from "@/lib/agora/token-service";
import { checkBroadcastAccess } from "@/lib/broadcasts/access";
import {
  getBroadcastAccessRow,
  stampBroadcastViewer,
} from "@/db/queries/broadcasts";
import {
  endElapsedInstantSession,
  getSessionBooking,
  stampSessionJoin,
} from "@/db/queries/sessions";

/**
 * `POST /api/agora/token` — the only way a browser gets an Agora token
 * (SPEC §9, CLAUDE.md). The Render service is never called from the client.
 *
 * The request carries **one id and nothing else**: `{ bookingId }` for an instant
 * session, or `{ broadcastId }` for a live broadcast (Phase 9 Part 3). Both body
 * shapes are strict (`lib/agora/token-body.ts`), so a body with both ids, or with
 * a channel, role or uid in it, is refused. **No channel, no role, no uid, no
 * identity** is read from the request — every one of those is derived here:
 *
 *  - identity from `requireApiUser()`, which reads the session;
 *  - the channel from `bookings.agora_channel` or `broadcasts.agora_channel`, so a
 *    caller cannot name a channel they were not admitted to (this is why the body
 *    is an id rather than SPEC §9's `{ channel }` with the id parsed back out of
 *    it — the safer of the two, and the id is the thing the client actually
 *    holds);
 *  - the role from `checkSessionAccess` / `checkBroadcastAccess`, neither of which
 *    has a branch that reads a request field. The live Bubble app picks the role
 *    in browser JavaScript by comparing profile ids; this route exists so we do
 *    not.
 *
 * Joining a session is recorded here rather than in a separate action, mirroring
 * SPEC §7.7 step 4 — the sibling LessonSpace flow stamps `*_joined_at` inside its
 * own join route, at link issuance. A client cannot reach a channel without this
 * request, so the stamp cannot be skipped by simply not calling something
 * afterwards. A broadcast viewer's join is recorded the same way, best-effort.
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
  const body = parseTokenBody(json);
  if (!body) {
    // Unchanged from before broadcasts existed: a body that isn't exactly one
    // valid id gets the session route's original answer.
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  if (body.kind === "broadcast") {
    return broadcastToken(body.broadcastId, user.id);
  }
  const { bookingId } = body;

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

  // The client can retry a failure here without anything having been
  // half-done: the join stamp above is idempotent.
  const minted = await mintToken(stamp.agoraChannel, access.role, { bookingId });
  if (!minted.ok) return minted.response;

  return NextResponse.json({
    token: minted.token,
    // Deterministic, so a reconnect returns as the same participant (§9 step 4).
    uid: agoraUid(user.id),
    appId: minted.appId,
    channel: stamp.agoraChannel,
    // Deliberately earlier than the token's real expiry, so the renewal (§9
    // step 6) begins while this token is still valid.
    expiresAt: tokenExpiresAt(new Date()).toISOString(),
    // Server-derived, and the reason the client needs no id comparison of its
    // own: it decides which tracks to publish from this, not from who it thinks
    // it is. Both parties hold a publisher token (§9 step 2) — the asymmetry is
    // in the media, not in the grant.
    isTutor: access.isTutor,
  });
}

/**
 * The broadcast branch (SPEC §9 step 3; Phase 9 Part 3).
 *
 * The host of a live broadcast gets `publisher`; a signed-in viewer gets
 * `subscriber` only while the host is fresh in `live_tutors` in broadcast mode.
 * Missing, ended and stale-host broadcasts are the same 404. The channel comes
 * off the row, and `checkBroadcastAccess` refuses a row whose channel isn't
 * `broadcast_{id}`, so no row can point this at a private session channel.
 */
async function broadcastToken(broadcastId: string, userId: string): Promise<NextResponse> {
  const access = checkBroadcastAccess(await getBroadcastAccessRow(broadcastId), userId);
  if (!access.ok) {
    if (access.status >= 500) {
      console.error("[agora/token] broadcast channel is not broadcast_{id}", { broadcastId });
    }
    return NextResponse.json({ error: access.message }, { status: access.status });
  }

  if (!access.isHost) {
    // A record of who watched. Best-effort: the access decision above is the
    // enforcement, and a failed insert must not stop someone watching.
    try {
      await stampBroadcastViewer(broadcastId, userId);
    } catch (err) {
      console.error("[agora/token] broadcast viewer stamp failed", { broadcastId, err });
    }
  }

  const minted = await mintToken(access.channel, access.role, { broadcastId });
  if (!minted.ok) return minted.response;

  return NextResponse.json({
    token: minted.token,
    uid: agoraUid(userId),
    appId: minted.appId,
    channel: access.channel,
    expiresAt: tokenExpiresAt(new Date()).toISOString(),
    // Server-derived: the host publishes camera and microphone, a viewer joins
    // as audience and publishes nothing.
    isHost: access.isHost,
  });
}

type Minted =
  | { ok: true; token: string; appId: string }
  | { ok: false; response: NextResponse };

/** Fetch a token for an already-authorized channel and role, mapping failures to responses. */
async function mintToken(
  channel: string,
  role: AgoraRole,
  context: Record<string, string>,
): Promise<Minted> {
  try {
    const appId = agoraAppId();
    const token = await fetchRtcToken(channel, role);
    return { ok: true, token, appId };
  } catch (err) {
    if (err instanceof AgoraConfigError) {
      console.error("[agora/token] not configured", err.message);
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Video isn't available right now." },
          { status: 503 },
        ),
      };
    }
    if (err instanceof AgoraTokenServiceError) {
      // A third party was slow or unhappy. 502 — ours is fine, theirs is not.
      console.error("[agora/token] token service failed", {
        ...context,
        status: err.status,
        detail: err.detail,
      });
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Couldn't connect to video. Please try again." },
          { status: 502 },
        ),
      };
    }
    throw err;
  }
}
