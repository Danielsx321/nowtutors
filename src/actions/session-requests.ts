"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { tutorSubjects } from "@/db/schema";
import {
  EmailNotVerifiedError,
  requireRole,
  requireVerifiedEmail,
} from "@/lib/auth/guards";
import { getWalletBalance } from "@/db/queries/bookings";
import {
  acceptRequestAsTutor,
  declineRequestAsTutor,
  expireStalePendingForStudent,
  getIncomingRequestDetail,
  getInstantTutorInfo,
  getPendingRequestForStudent,
  getPendingRequestsForTutor,
  insertSessionRequest,
  type IncomingRequestDetail,
} from "@/db/queries/session-requests";
import { getBookingSettings, getInstantRequestTtlSeconds } from "@/lib/settings";
import { sessionPriceCredits } from "@/lib/credits/pricing";

/**
 * The instant-session handshake's Server Actions (SPEC §7.4).
 *
 * Every one of them re-checks role and identity server-side, independently of
 * any layout guard (§5 Layer 2, CLAUDE.md: "Do not rely on the client hiding a
 * button"), and every one returns a **typed result** — no thrown strings. The
 * only exception is a guard redirect (not signed in / wrong role), which must
 * propagate rather than be flattened into an error message.
 *
 * The client is trusted for exactly three things, all of them re-validated
 * here: which tutor, which subject, and which duration off the fixed menu. It
 * is never trusted for the price, the deadline, or who is calling.
 */

export type CreateSessionRequestResult =
  | {
      ok: true;
      requestId: string;
      priceCredits: number;
      durationMinutes: number;
      /** ISO-8601; the cosmetic countdown renders from this. */
      expiresAt: string;
    }
  | { error: string };

export type RespondToRequestResult = { ok: true } | { error: string };

export type AcceptSessionRequestResult =
  | { ok: true; bookingId: string }
  | { error: string };

export type IncomingRequestResult =
  | { ok: true; request: SerializedIncomingRequest }
  | { error: string };

export type PendingIncomingRequestsResult =
  | { ok: true; requests: SerializedIncomingRequest[] }
  | { error: string };

/** {@link IncomingRequestDetail} with `Date` flattened for the client boundary. */
export interface SerializedIncomingRequest
  extends Omit<IncomingRequestDetail, "expiresAt"> {
  expiresAt: string;
}

const createSchema = z.object({
  tutorId: z.string().uuid(),
  subjectId: z.string().uuid().optional(),
  message: z.string().trim().max(1000).optional(),
  durationMinutes: z.number().int().positive(),
});

export type CreateSessionRequestInput = z.input<typeof createSchema>;

const requestIdSchema = z.string().uuid();

/**
 * Student → live tutor: "can we start now?" (SPEC §7.4, first leg).
 *
 * Server-side validation, in order — each one is a thing the client could
 * otherwise lie about or race:
 *  1. caller is a student with a verified email (identity from the guard);
 *  2. the tutor is IN the `live_tutors` view — not `is_live` (§3.1) — and
 *     `accepts_instant`;
 *  3. the duration is a member of `session_durations`;
 *  4. the tutor teaches the chosen subject, when one was chosen;
 *  5. the student has no OTHER live pending request (§7.4: at most one);
 *  6. the student's balance covers the computed price (§7.4: a balance check
 *     against the quote, not a flat floor — `min_instant_credits` is dead).
 *
 * Then `price_credits` is computed here with `sessionPriceCredits()` and pinned
 * on the row alongside `duration_minutes`, so the accept transaction charges
 * exactly what the student was quoted (§4.3). `expires_at` is `now() + TTL`,
 * computed by Postgres.
 */
export async function createSessionRequest(
  input: CreateSessionRequestInput,
): Promise<CreateSessionRequestResult> {
  let student;
  try {
    await requireRole("student");
    student = await requireVerifiedEmail();
  } catch (err) {
    if (err instanceof EmailNotVerifiedError) return { error: err.message };
    throw err; // a redirect (not signed in / wrong role) must propagate
  }

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: "Please check the request details and try again." };
  const v = parsed.data;

  if (v.tutorId === student.id) {
    return { error: "You can't request a session with yourself." };
  }

  const tutor = await getInstantTutorInfo(v.tutorId);
  if (!tutor) return { error: "This tutor isn't available for instant sessions." };
  if (!tutor.isLive) {
    return { error: "This tutor just went offline. Try someone else on Live now." };
  }
  if (!tutor.acceptsInstant) {
    return { error: "This tutor doesn't take instant sessions." };
  }

  const settings = await getBookingSettings();
  if (!settings.sessionDurations.includes(v.durationMinutes)) {
    return { error: "Pick one of the offered session lengths." };
  }

  if (v.subjectId) {
    const [teaches] = await db
      .select({ subjectId: tutorSubjects.subjectId })
      .from(tutorSubjects)
      .where(
        and(
          eq(tutorSubjects.tutorId, v.tutorId),
          eq(tutorSubjects.subjectId, v.subjectId),
        ),
      )
      .limit(1);
    if (!teaches) return { error: "This tutor doesn't teach that subject." };
  }

  // Settle any of this student's own rows the deadline has already decided,
  // then enforce "one pending request at a time" against what is left.
  await expireStalePendingForStudent(student.id);
  const existing = await getPendingRequestForStudent(student.id);
  if (existing) {
    return {
      error: "You already have a request waiting. Cancel it or wait for an answer.",
    };
  }

  // Server-authoritative price — the one formula (§7.3/§7.4), never a client value.
  const priceCredits = sessionPriceCredits(
    tutor.hourlyRateCredits,
    v.durationMinutes,
  );
  const balance = await getWalletBalance(student.id);
  if (balance < priceCredits) {
    return {
      error: `This session costs ${priceCredits} credits and your balance is ${balance}. Top up and try again.`,
    };
  }

  const ttlSeconds = await getInstantRequestTtlSeconds();
  const inserted = await insertSessionRequest({
    studentId: student.id,
    tutorId: v.tutorId,
    subjectId: v.subjectId ?? null,
    message: v.message?.trim() || null,
    durationMinutes: v.durationMinutes,
    priceCredits,
    ttlSeconds,
  });

  return {
    ok: true,
    requestId: inserted.id,
    priceCredits,
    durationMinutes: v.durationMinutes,
    expiresAt: inserted.expiresAt.toISOString(),
  };
}

/**
 * Tutor → "not right now" (SPEC §7.4: declining is explicit and free).
 *
 * Both the ownership and the `pending` check are in the UPDATE's WHERE clause,
 * so there is no read-then-write window an accept could slip through, and a
 * request belonging to another tutor is indistinguishable from one that never
 * existed.
 */
export async function declineSessionRequest(
  requestId: string,
): Promise<RespondToRequestResult> {
  const { user } = await requireRole("tutor");

  const parsed = requestIdSchema.safeParse(requestId);
  if (!parsed.success) return { error: "That request no longer exists." };

  const moved = await declineRequestAsTutor(parsed.data, user.id);
  if (!moved) return { error: "That request is no longer waiting for an answer." };

  revalidatePath("/tutor");
  return { ok: true };
}

/**
 * Tutor → "yes, now" (SPEC §7.4, the accept transaction).
 *
 * All the decisions live in `lib/session-requests/accept.ts` and run in ONE
 * transaction; this action's job is the guard, the id, and turning the typed
 * outcome into something a person can read. Note `failed_payment` gets its own
 * message: it is neither a timeout nor a refusal, and telling the tutor "expired"
 * would be a lie about a student whose balance simply moved.
 */
export async function acceptSessionRequest(
  requestId: string,
): Promise<AcceptSessionRequestResult> {
  const { user } = await requireRole("tutor");

  const parsed = requestIdSchema.safeParse(requestId);
  if (!parsed.success) return { error: "That request no longer exists." };

  const result = await acceptRequestAsTutor(parsed.data, user.id);

  switch (result.status) {
    case "accepted":
      revalidatePath("/tutor");
      revalidatePath("/tutor/bookings");
      revalidatePath("/dashboard/bookings");
      return { ok: true, bookingId: result.bookingId };
    case "expired":
      return { error: "That request timed out before you answered." };
    case "not_pending":
      return { error: "That request is no longer waiting for an answer." };
    case "not_found":
      return { error: "That request no longer exists." };
    case "scheduled_collision":
      return {
        error:
          "You have a scheduled booking starting within that session's length. Finish or reschedule it first.",
      };
    case "failed_payment":
      return {
        error: `The student no longer has the ${result.priceCredits} credits this session was quoted at, so nothing was charged.`,
      };
  }
}

/**
 * Enrich one incoming request for the tutor's modal.
 *
 * The Realtime INSERT payload carries ids, not display names, and a browser must
 * not be trusted to join them for itself — so this is the guarded read behind
 * it, scoped to the calling tutor.
 *
 * **`requireApproval: false`, deliberately, and it is a fix.** This action is
 * called from `IncomingRequests`, which is mounted in the `(tutor)` LAYOUT —
 * and that layout guards with `requireApproval: false` so
 * `/tutor/pending-approval` does not redirect-loop. With approval enforced here
 * the two guards disagreed: an unapproved tutor could legitimately be sitting
 * under the layout, and every read this component made threw `NEXT_REDIRECT`
 * inside a fire-and-forget — an unhandled rejection, not a redirect, because
 * there is no navigation to perform from a promise nobody awaits. Approval is
 * not what authorizes this read; **ownership is**, and
 * `getIncomingRequestDetail` is scoped to `tutor_id = me`. An unapproved tutor
 * is not in the `live_tutors` view (§3.1), so no request can be addressed to
 * them in the first place and this returns nothing for them anyway.
 *
 * `acceptSessionRequest` / `declineSessionRequest` keep approval enforced —
 * those create a booking and charge a student, and neither runs unawaited.
 */
export async function getIncomingRequest(
  requestId: string,
): Promise<IncomingRequestResult> {
  const { user } = await requireRole("tutor", { requireApproval: false });

  const parsed = requestIdSchema.safeParse(requestId);
  if (!parsed.success) return { error: "That request no longer exists." };

  const request = await getIncomingRequestDetail(parsed.data, user.id);
  if (!request) return { error: "That request no longer exists." };

  return {
    ok: true,
    request: { ...request, expiresAt: request.expiresAt.toISOString() },
  };
}

/**
 * Every request still waiting on the calling tutor — the mount-time read.
 *
 * The tutor side had no such read: the queue was filled by the Realtime INSERT
 * event and by nothing else, so a request that arrived while the subscription
 * was not established was gone, and a refresh could not bring it back. This is
 * what makes a missed event self-healing — `IncomingRequests` calls it on mount
 * and again after every successful (re)subscribe, and deduplicates the result
 * against what the queue already holds.
 *
 * Same relaxed approval guard, for the same reason, as `getIncomingRequest`
 * above: it is called from the same component under the same layout, and it is
 * scoped to `tutor_id = me`.
 */
export async function listPendingIncomingRequests(): Promise<PendingIncomingRequestsResult> {
  const { user } = await requireRole("tutor", { requireApproval: false });

  const rows = await getPendingRequestsForTutor(user.id);
  return {
    ok: true,
    requests: rows.map((r) => ({ ...r, expiresAt: r.expiresAt.toISOString() })),
  };
}
