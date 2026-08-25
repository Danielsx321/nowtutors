import "server-only";
import { and, eq, gt, inArray, lt, lte, ne, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  bookings,
  sessionRequests,
  subjects,
  tutorProfiles,
} from "@/db/schema";
import { liveTutors, publicProfiles } from "@/db/schema/views";
import { walletExecutor } from "@/lib/credits/ledger";
import {
  acceptSessionRequest,
  type AcceptResult,
  type AcceptStore,
  type AcceptTx,
  type SessionRequestRecord,
} from "@/lib/session-requests/accept";

/**
 * The `session_requests` query layer (SPEC §4.3, §7.4) — the instant-session
 * handshake's only SQL. The accept transaction's *decisions* live in the pure
 * `lib/session-requests/accept.ts`; this file is the Drizzle adapter behind it,
 * plus the reads and the two expiry sweeps.
 *
 * Every function takes an already-authorized id from the caller's session. None
 * accepts a client-supplied identity, and none is reachable without a guard
 * having run first (`actions/session-requests.ts`).
 */

/** Statuses that occupy a tutor's time, for the accept-time collision read. */
const OCCUPYING_STATUSES = ["confirmed", "in_progress"] as const;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface InstantTutorInfo {
  userId: string;
  hourlyRateCredits: number;
  acceptsInstant: boolean;
  /** Membership of the `live_tutors` view — never `tutor_profiles.is_live`. */
  isLive: boolean;
}

/**
 * What `createSessionRequest` needs about the tutor it is being sent to.
 *
 * Liveness derives from the `live_tutors` view (SPEC §3.1), which already
 * encodes approval, suspension and the staleness threshold — so this is one
 * LEFT JOIN rather than a second, driftable copy of "still live".
 */
export async function getInstantTutorInfo(
  tutorId: string,
): Promise<InstantTutorInfo | null> {
  const [row] = await db
    .select({
      userId: tutorProfiles.userId,
      hourlyRateCredits: tutorProfiles.hourlyRateCredits,
      acceptsInstant: tutorProfiles.acceptsInstant,
      liveMemberUserId: liveTutors.userId,
    })
    .from(tutorProfiles)
    .leftJoin(liveTutors, eq(liveTutors.userId, tutorProfiles.userId))
    .where(eq(tutorProfiles.userId, tutorId))
    .limit(1);

  if (!row) return null;
  return {
    userId: row.userId,
    hourlyRateCredits: row.hourlyRateCredits,
    acceptsInstant: row.acceptsInstant,
    isLive: row.liveMemberUserId != null,
  };
}

export interface PendingRequestSummary {
  id: string;
  tutorId: string;
  durationMinutes: number;
  priceCredits: number;
  expiresAt: Date;
}

/**
 * The student's live pending request, if any — the "at most one pending request
 * at a time" rule (§7.4) and what the waiting modal resumes from after a reload.
 *
 * A row past `expires_at` is NOT returned: it is expired by the only clock that
 * counts, and blocking a student on it for up to a minute until the cron tidies
 * it would make the cron load-bearing for something the deadline already
 * decided. `expireStalePendingForStudent` clears it on the write path.
 */
export async function getPendingRequestForStudent(
  studentId: string,
): Promise<PendingRequestSummary | null> {
  const [row] = await db
    .select({
      id: sessionRequests.id,
      tutorId: sessionRequests.tutorId,
      durationMinutes: sessionRequests.durationMinutes,
      priceCredits: sessionRequests.priceCredits,
      expiresAt: sessionRequests.expiresAt,
    })
    .from(sessionRequests)
    .where(
      and(
        eq(sessionRequests.studentId, studentId),
        eq(sessionRequests.status, "pending"),
        sql`${sessionRequests.expiresAt} > now()`,
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface IncomingRequestDetail {
  id: string;
  studentName: string | null;
  studentAvatarUrl: string | null;
  subjectName: string | null;
  message: string | null;
  durationMinutes: number;
  priceCredits: number;
  expiresAt: Date;
  status: string;
}

/**
 * One incoming request, enriched for the tutor's modal.
 *
 * The Realtime INSERT payload carries ids, not names, and the browser must not
 * be trusted to join them itself — so the tutor's client hands the id back to a
 * guarded Server Action and this read answers it, scoped to `tutor_id` so a
 * tutor can only ever read their own. Display fields come from
 * `public_profiles` (Decision B), never the base `profiles` row.
 */
export async function getIncomingRequestDetail(
  requestId: string,
  tutorId: string,
): Promise<IncomingRequestDetail | null> {
  const [row] = await db
    .select({
      id: sessionRequests.id,
      studentName: publicProfiles.displayName,
      studentAvatarUrl: publicProfiles.avatarUrl,
      subjectName: subjects.name,
      message: sessionRequests.message,
      durationMinutes: sessionRequests.durationMinutes,
      priceCredits: sessionRequests.priceCredits,
      expiresAt: sessionRequests.expiresAt,
      status: sessionRequests.status,
    })
    .from(sessionRequests)
    .leftJoin(publicProfiles, eq(publicProfiles.id, sessionRequests.studentId))
    .leftJoin(subjects, eq(subjects.id, sessionRequests.subjectId))
    .where(
      and(eq(sessionRequests.id, requestId), eq(sessionRequests.tutorId, tutorId)),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Every request still waiting on this tutor, enriched exactly as
 * {@link getIncomingRequestDetail} enriches one — the tutor side's mount-time
 * read.
 *
 * **Why this had to exist.** There was no mount-time read on the tutor side at
 * all: the modal was populated *only* by the Realtime INSERT event, so a
 * request that arrived while the subscription was down was lost for good, and
 * refreshing the page could not recover it because a refresh re-subscribed
 * without ever asking what was already pending. A subscription carries what
 * happens after it is bound and nothing else; this is the half that covers what
 * happened before.
 *
 * Scoped to `tutor_id` and filtered the same way `getPendingRequestForStudent`
 * filters — `pending` AND not past `expires_at`, because a row the deadline has
 * already decided is expired whatever the cron has got round to (§7.4). Oldest
 * first, matching the queue order the modal shows them in.
 */
export async function getPendingRequestsForTutor(
  tutorId: string,
): Promise<IncomingRequestDetail[]> {
  return db
    .select({
      id: sessionRequests.id,
      studentName: publicProfiles.displayName,
      studentAvatarUrl: publicProfiles.avatarUrl,
      subjectName: subjects.name,
      message: sessionRequests.message,
      durationMinutes: sessionRequests.durationMinutes,
      priceCredits: sessionRequests.priceCredits,
      expiresAt: sessionRequests.expiresAt,
      status: sessionRequests.status,
    })
    .from(sessionRequests)
    .leftJoin(publicProfiles, eq(publicProfiles.id, sessionRequests.studentId))
    .leftJoin(subjects, eq(subjects.id, sessionRequests.subjectId))
    .where(
      and(
        eq(sessionRequests.tutorId, tutorId),
        eq(sessionRequests.status, "pending"),
        sql`${sessionRequests.expiresAt} > now()`,
      ),
    )
    .orderBy(sessionRequests.createdAt);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateRequestRow {
  studentId: string;
  tutorId: string;
  subjectId: string | null;
  message: string | null;
  /** Server-authored: from the `session_durations` menu, validated by the action. */
  durationMinutes: number;
  /** Server-authored: `sessionPriceCredits()`, pinned here for good (§4.3). */
  priceCredits: number;
  ttlSeconds: number;
}

/**
 * Insert one pending request. `expires_at` is computed by **Postgres**
 * (`now() + interval`), not by the Node process: expiry is enforced server-side
 * against the same clock every later read and both crons compare with, so a
 * skewed app server cannot hand out a deadline the database disagrees about.
 */
export async function insertSessionRequest(
  row: CreateRequestRow,
): Promise<{ id: string; expiresAt: Date }> {
  const [inserted] = await db
    .insert(sessionRequests)
    .values({
      studentId: row.studentId,
      tutorId: row.tutorId,
      subjectId: row.subjectId,
      message: row.message,
      durationMinutes: row.durationMinutes,
      priceCredits: row.priceCredits,
      status: "pending",
      // `::int` so the bound parameter has a definite type rather than relying
      // on inference through make_interval's double-precision signature.
      expiresAt: sql`now() + make_interval(secs => ${row.ttlSeconds}::int)`,
    })
    .returning({ id: sessionRequests.id, expiresAt: sessionRequests.expiresAt });
  return inserted;
}

/**
 * Decline a request (SPEC §7.4: explicit and free). Conditional on `pending` and
 * on the caller being its tutor, both in the WHERE clause — so a decline can
 * neither race an accept nor touch another tutor's row, and no read-then-write
 * window exists between the check and the update.
 */
export async function declineRequestAsTutor(
  requestId: string,
  tutorId: string,
): Promise<boolean> {
  const moved = await db
    .update(sessionRequests)
    .set({ status: "declined", respondedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(sessionRequests.id, requestId),
        eq(sessionRequests.tutorId, tutorId),
        eq(sessionRequests.status, "pending"),
      ),
    )
    .returning({ id: sessionRequests.id });
  return moved.length > 0;
}

/**
 * Expire the student's own pending rows that are already past `expires_at`,
 * before the "one pending request at a time" check runs.
 *
 * Same shape as `createScheduledBooking` expiring the stale `pending_payment`
 * holds it collides with (§7.3 step 5): the write path settles what the deadline
 * already decided instead of waiting on a cron, which is what keeps the cron
 * tidy-up rather than correctness.
 */
export async function expireStalePendingForStudent(
  studentId: string,
): Promise<number> {
  const rows = await db
    .update(sessionRequests)
    .set({ status: "expired", updatedAt: sql`now()` })
    .where(
      and(
        eq(sessionRequests.studentId, studentId),
        eq(sessionRequests.status, "pending"),
        lte(sessionRequests.expiresAt, sql`now()`),
      ),
    )
    .returning({ id: sessionRequests.id });
  return rows.length;
}

/**
 * `GET/POST /api/cron/expire-requests` (SPEC §12) — pending rows past their
 * deadline become `expired`.
 *
 * Idempotent by construction: the predicate stops matching the rows it just
 * moved, so a double-fire returns `expired: 0`. `now()` is the database's, the
 * same clock `expires_at` was written against.
 */
export async function expirePendingRequests(): Promise<{ expiredIds: string[] }> {
  const rows = await db
    .update(sessionRequests)
    .set({ status: "expired", updatedAt: sql`now()` })
    .where(
      and(
        eq(sessionRequests.status, "pending"),
        lte(sessionRequests.expiresAt, sql`now()`),
      ),
    )
    .returning({ id: sessionRequests.id });
  return { expiredIds: rows.map((r) => r.id) };
}

/**
 * The presence sweep's second half (SPEC §7.5 defence 2, §12): when a tutor is
 * swept offline, the requests waiting on them expire **immediately**, without
 * waiting out their own 60 seconds. A tutor who is gone is not going to answer.
 *
 * Note this is NOT gated on `expires_at` — that is the point. The plain
 * expire-requests cron already handles the deadline case.
 */
export async function expirePendingRequestsForTutors(
  tutorIds: string[],
): Promise<{ expiredIds: string[] }> {
  if (tutorIds.length === 0) return { expiredIds: [] };
  const rows = await db
    .update(sessionRequests)
    .set({ status: "expired", updatedAt: sql`now()` })
    .where(
      and(
        eq(sessionRequests.status, "pending"),
        inArray(sessionRequests.tutorId, tutorIds),
      ),
    )
    .returning({ id: sessionRequests.id });
  return { expiredIds: rows.map((r) => r.id) };
}

// ---------------------------------------------------------------------------
// The accept transaction's production adapter
// ---------------------------------------------------------------------------

/** {@link AcceptTx} bound to one Drizzle transaction. */
function acceptTx(tx: DbTransaction): AcceptTx {
  return {
    ledger: walletExecutor(tx),

    async lockRequest(requestId) {
      const [row] = await tx
        .select({
          id: sessionRequests.id,
          studentId: sessionRequests.studentId,
          tutorId: sessionRequests.tutorId,
          subjectId: sessionRequests.subjectId,
          message: sessionRequests.message,
          durationMinutes: sessionRequests.durationMinutes,
          priceCredits: sessionRequests.priceCredits,
          status: sessionRequests.status,
          expiresAt: sessionRequests.expiresAt,
        })
        .from(sessionRequests)
        .where(eq(sessionRequests.id, requestId))
        .for("update")
        .limit(1);
      return (row as SessionRequestRecord) ?? null;
    },

    /**
     * The scheduled-booking collision (§7.4, Phase 6 pre-build decision).
     *
     * A `confirmed`/`in_progress` **scheduled** booking collides when its range
     * overlaps the instant session's `[now, windowEnd)`. SPEC states only the
     * start-side half of that ("starting before now() + duration_minutes"); the
     * `scheduled_end_at > now()` half is added because without it every past
     * booking still sitting `confirmed` — and none are completed yet, since the
     * complete-sessions cron is Part 3 — would block the tutor forever. See
     * docs/DECISIONS.md, Phase 6 Part 2.
     *
     * NO BUFFER: the comparison is against the booking's own boundaries, with no
     * gap either side. Bubble has no such check at all, so inventing a buffer
     * would add a rule that does not exist upstream.
     */
    async hasCollidingScheduledBooking(tutorId, now, windowEnd) {
      const [row] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.tutorId, tutorId),
            eq(bookings.type, "scheduled"),
            inArray(bookings.status, [...OCCUPYING_STATUSES]),
            lt(bookings.scheduledStartAt, windowEnd),
            gt(bookings.scheduledEndAt, now),
          ),
        )
        .limit(1);
      return row != null;
    },

    async insertBooking(row) {
      await tx.insert(bookings).values({
        // Application-generated (see `acceptRequestAsTutor`) so `agora_channel`
        // is known before the INSERT rather than needing a second statement.
        id: row.id,
        studentId: row.studentId,
        tutorId: row.tutorId,
        subjectId: row.subjectId,
        type: "instant",
        // Live the moment it is accepted — an instant session has no
        // confirmed-then-later state to pass through.
        status: "in_progress",
        durationMinutes: row.durationMinutes,
        priceCredits: row.priceCredits,
        paymentMethod: "credits",
        agoraChannel: row.agoraChannel,
        studentNotes: row.studentNotes,
        // started_at stays null: it is "the first moment both were present"
        // (§4.3). `stampSessionJoin` (db/queries/sessions.ts, Part 3A) stamps
        // student_joined_at / tutor_joined_at on arrival and sets started_at only
        // on the write that makes BOTH non-null.
        // TODO(Phase 6 Part 3C): end-session writes tutor_earnings.
      });
    },

    async markAccepted(requestId, bookingId, at) {
      await tx
        .update(sessionRequests)
        .set({
          status: "accepted",
          bookingId,
          respondedAt: at,
          updatedAt: sql`now()`,
        })
        .where(eq(sessionRequests.id, requestId));
    },

    async markExpired(requestId, at) {
      await tx
        .update(sessionRequests)
        .set({ status: "expired", respondedAt: at, updatedAt: sql`now()` })
        .where(eq(sessionRequests.id, requestId));
    },

    /**
     * "A tutor may have several incoming; accepting one auto-declines the rest"
     * (§7.4). In the same transaction as the accept, so a student can never be
     * left waiting on a request whose tutor is already in a session.
     */
    async declineOtherPending(tutorId, exceptRequestId, at) {
      const rows = await tx
        .update(sessionRequests)
        .set({ status: "declined", respondedAt: at, updatedAt: sql`now()` })
        .where(
          and(
            eq(sessionRequests.tutorId, tutorId),
            eq(sessionRequests.status, "pending"),
            ne(sessionRequests.id, exceptRequestId),
          ),
        )
        .returning({ id: sessionRequests.id });
      return rows.length;
    },
  };
}

/** Production {@link AcceptStore}. */
function acceptStore(): AcceptStore {
  return {
    transaction(fn) {
      return db.transaction((tx) => fn(acceptTx(tx)));
    },
    /**
     * Runs on `db`, NOT on the transaction handle — by the time this is called
     * that transaction has rolled back, and this write has to survive it (§4.3).
     */
    async markFailedPayment(requestId, at) {
      const rows = await db
        .update(sessionRequests)
        .set({
          status: "failed_payment",
          respondedAt: at,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(sessionRequests.id, requestId),
            eq(sessionRequests.status, "pending"),
          ),
        )
        .returning({ id: sessionRequests.id });
      return rows.length > 0;
    },
  };
}

/**
 * Accept a request as the given tutor. The booking id is generated here so the
 * `agora_channel` (`session_{booking_id}`, §4.3) can be written by the same
 * INSERT that creates the row rather than by a follow-up UPDATE.
 */
export function acceptRequestAsTutor(
  requestId: string,
  tutorId: string,
): Promise<AcceptResult> {
  return acceptSessionRequest(acceptStore(), {
    requestId,
    tutorId,
    bookingId: crypto.randomUUID(),
  });
}
