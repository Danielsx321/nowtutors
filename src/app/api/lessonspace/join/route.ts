import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireApiUser } from "@/lib/auth/api-guards";
import { checkLessonSpaceAccess } from "@/lib/lessonspace/session-access";
import {
  launchSpace,
  LessonSpaceApiError,
  LessonSpaceConfigError,
} from "@/lib/lessonspace/client";
import {
  getClassroomBooking,
  stampScheduledSessionJoin,
} from "@/db/queries/classroom";

/**
 * `POST /api/lessonspace/join` — the only way a browser gets a classroom link
 * (SPEC §7.7, §6). The LessonSpace API key never leaves this process.
 *
 * The request carries a booking id and nothing else. **No room id, no role, no
 * name, no identity** — every one of those is derived here:
 *
 *  - identity from `requireApiUser()`, which reads the session;
 *  - the role (`teacher` / `student`) and the leader flag from
 *    `checkLessonSpaceAccess`, which has no branch that reads a request field.
 *    The live Bubble app picks the leader flag in browser JavaScript by
 *    comparing profile ids; this route exists so we do not (Finding A);
 *  - the display name from the caller's profile row, not from the body — a name
 *    the client could set is a name the other participant sees.
 *
 * The five steps of §7.7 map onto this handler in order: guard (step 1),
 * create-or-get the space and persist its id (step 2), the per-user link
 * (step 3), the first-join write (step 4), return the URL (step 5 — rendering
 * it in `/classroom/[bookingId]` is Part 2).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    // Same answer as a booking that does not exist: a malformed id must not be
    // distinguishable from an unknown one.
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  const { bookingId } = parsed.data;

  // Step 1 — participant, state and join window: one pure decision, unit-tested
  // in tests/unit/lessonspace-session-access.test.ts. A booking that does not
  // exist and one belonging to somebody else come back identical, so the
  // endpoint cannot be used to discover booking ids.
  //
  // `now` is left to the function's default (the server's clock). The window is
  // ours to enforce, not LessonSpace's (§7.7 step 1), and it is checked BEFORE
  // the launch call — a request outside the window never reaches a third party.
  const row = await getClassroomBooking(bookingId);
  const access = checkLessonSpaceAccess(row, user.id);
  if (!access.ok) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }

  // Steps 2 and 3 in one round trip: `spaces/launch/` is idempotent on the
  // booking id, so the first call creates the space and every later one returns
  // that same space plus a fresh link scoped to this user and this leader flag.
  //
  // **Launched before the join is stamped, deliberately.** If the launch fails,
  // nothing has been recorded — the caller simply did not join. Stamping first
  // could start the billing clock (`started_at`, on the write that completes the
  // pair) for a session neither party can actually enter.
  let launched;
  try {
    launched = await launchSpace({
      bookingId,
      displayName: access.isTutor ? row!.tutorName : row!.studentName,
      leader: access.isTutor,
    });
  } catch (err) {
    if (err instanceof LessonSpaceConfigError) {
      console.error("[lessonspace/join] not configured", err.message);
      return NextResponse.json(
        { error: "The classroom isn't available right now." },
        { status: 503 },
      );
    }
    if (err instanceof LessonSpaceApiError) {
      // A third party was slow or unhappy. 502 — ours is fine, theirs is not —
      // and the client can retry without anything having been half-done: the
      // launch is idempotent and nothing has been written yet.
      console.error("[lessonspace/join] launch failed", {
        bookingId,
        status: err.status,
        detail: err.detail,
      });
      return NextResponse.json(
        { error: "Couldn't open the classroom. Please try again." },
        { status: 502 },
      );
    }
    throw err;
  }

  // Step 4 — the first-join write: persist the room id if it was null, stamp
  // this participant's arrival, and (only on the write that puts both parties in
  // the room) set `started_at` and move `confirmed → in_progress`. The
  // `started_at` rule is the one shared with the instant path
  // (`db/queries/join-stamp.ts`), not a second copy. Idempotent — a refresh or a
  // second tab re-runs it harmlessly.
  const stamp = await stampScheduledSessionJoin(
    bookingId,
    user.id,
    launched.roomId,
  );
  if (!stamp) {
    // The row moved between the guard and the write — completed, cancelled, or
    // the participant list changed. Same answer the guard would now give.
    return NextResponse.json(
      { error: "This session isn't ready to join." },
      { status: 409 },
    );
  }

  // Step 5. The URL is per-user and already carries the caller's role; Part 2
  // renders it in an iframe on /classroom/[bookingId].
  return NextResponse.json({
    url: launched.url,
    // Server-derived, and the reason the page needs no id comparison of its own.
    isTutor: access.isTutor,
    role: access.role,
    startedAt: stamp.startedAt?.toISOString() ?? null,
  });
}
