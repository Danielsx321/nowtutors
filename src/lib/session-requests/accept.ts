import {
  debitWallet,
  InsufficientCreditsError,
  type LedgerExecutor,
} from "@/lib/credits/ledger";

/**
 * The instant-session **accept transaction** (SPEC §7.4) — the single decision
 * path a tutor's "Accept" runs through.
 *
 * Pure and storage-agnostic, exactly as `lib/paypal/settlement.ts` is
 * (docs/DECISIONS.md, Phase 4 Part 2): it drives an {@link AcceptStore} rather
 * than a Drizzle transaction, so the four guards that decide whether a student
 * is charged — expired, no-longer-pending, colliding scheduled booking, and a
 * balance that moved since the quote — are unit-testable without a live
 * Postgres (which the pooler and CI don't provide). `db/queries/session-requests.ts`
 * is the production adapter.
 *
 * **The price is never re-derived here.** `price_credits` was computed with
 * `sessionPriceCredits()` and pinned on the request row at insert (§4.3); this
 * module reads that column and debits exactly it. A tutor who raises
 * `hourly_rate_credits` while a request is in flight does not change what the
 * student already saw — which is the whole reason the column exists, and why
 * nothing in this file imports the pricing formula.
 *
 * **The failed-payment write deliberately lives OUTSIDE the transaction.** If
 * the debit fails, everything the accept did must roll back — but the record
 * *that it failed* must not, or the request would look untouched and the
 * operator could not tell a payment failure from a timeout (§4.3). So the
 * rollback happens first, and the terminal `failed_payment` status is a separate
 * statement afterwards. That ordering is the reason {@link AcceptStore} owns
 * `transaction()` instead of this function being handed an open one.
 */

/** `bookings.agora_channel` for an instant session (SPEC §4.3, §7.4). */
export function sessionChannel(bookingId: string): string {
  return `session_${bookingId}`;
}

/** The `session_requests` columns the accept path reads. */
export interface SessionRequestRecord {
  id: string;
  studentId: string;
  tutorId: string;
  subjectId: string | null;
  message: string | null;
  /** Pinned at insert. Never recomputed. */
  durationMinutes: number;
  /** Pinned at insert. Never recomputed. */
  priceCredits: number;
  status: string;
  expiresAt: Date;
}

/** The `bookings` row an accepted request creates. */
export interface InstantBookingInsert {
  id: string;
  studentId: string;
  tutorId: string;
  subjectId: string | null;
  durationMinutes: number;
  priceCredits: number;
  agoraChannel: string;
  studentNotes: string | null;
}

/**
 * Everything the accept path does inside the one transaction. The production
 * adapter binds these to a Drizzle transaction handle; tests bind them to
 * in-memory state.
 */
export interface AcceptTx {
  /** The wallet writer, bound to this transaction. */
  ledger: LedgerExecutor;
  /** `SELECT … FOR UPDATE` the request, so two accepts serialize. */
  lockRequest(requestId: string): Promise<SessionRequestRecord | null>;
  /**
   * Does the tutor hold a `confirmed`/`in_progress` **scheduled** booking
   * overlapping `[now, windowEnd)`? Guarded read, not a constraint — see
   * {@link acceptSessionRequest}.
   */
  hasCollidingScheduledBooking(
    tutorId: string,
    now: Date,
    windowEnd: Date,
  ): Promise<boolean>;
  insertBooking(row: InstantBookingInsert): Promise<void>;
  /** request → `accepted`, with `booking_id` and `responded_at`. */
  markAccepted(requestId: string, bookingId: string, at: Date): Promise<void>;
  /** request → `expired` (the tutor answered after the deadline). */
  markExpired(requestId: string, at: Date): Promise<void>;
  /** Every OTHER `pending` request to this tutor → `declined`. Returns the count. */
  declineOtherPending(
    tutorId: string,
    exceptRequestId: string,
    at: Date,
  ): Promise<number>;
}

export interface AcceptStore {
  /** Run `fn` in one transaction; a throw rolls back everything it wrote. */
  transaction<T>(fn: (tx: AcceptTx) => Promise<T>): Promise<T>;
  /**
   * Move a still-`pending` request to `failed_payment`, in its **own**
   * statement outside the rolled-back transaction. Returns true iff it moved
   * the row — conditional on `pending`, so it can never stomp a state some
   * other path reached in the meantime.
   */
  markFailedPayment(requestId: string, at: Date): Promise<boolean>;
}

export type AcceptResult =
  | {
      status: "accepted";
      bookingId: string;
      agoraChannel: string;
      studentId: string;
      priceCredits: number;
      balanceAfter: number;
      autoDeclined: number;
    }
  /** No such request, or it belongs to another tutor. Same answer either way. */
  | { status: "not_found" }
  /** Already accepted/declined/expired/cancelled/failed — nothing to do. */
  | { status: "not_pending"; requestStatus: string }
  /** Past `expires_at`. The row is moved to `expired` as a side effect. */
  | { status: "expired" }
  | { status: "scheduled_collision" }
  /**
   * The pinned-price debit failed. The accept rolled back in full and the
   * request is terminal as `failed_payment` (§4.3) — NOT expired, NOT declined.
   */
  | { status: "failed_payment"; priceCredits: number };

export interface AcceptParams {
  requestId: string;
  /** From the caller's session. Never from the client. */
  tutorId: string;
  /** Application-generated so `agora_channel` is known before the INSERT. */
  bookingId: string;
}

/**
 * Accept an instant-session request: charge the pinned quote, open the booking,
 * and close out the tutor's other pending requests — all or nothing.
 *
 * Order inside the transaction, and why:
 *
 *  1. **Lock the request.** Two tutors' clicks (or a click racing the expiry
 *     cron) serialize here rather than both proceeding on a stale read.
 *  2. **Expiry, then pending.** Expiry is enforced *server-side*; the client's
 *     countdown ring is cosmetic (§7.4). A tutor answering late has their
 *     request moved to `expired` right here rather than left `pending` for the
 *     cron — it is already expired by the only clock that counts, and moving it
 *     now is what lets the student's waiting modal stop waiting immediately.
 *  3. **Scheduled collision** (§7.4, Phase 6 pre-build). Application-level
 *     guarded read, deliberately **not** a database constraint:
 *     `bookings_no_overlap` (§4.3) excludes instant bookings, which have no time
 *     range to exclude against. **No buffer or gap** — Bubble has no such check
 *     at all, so inventing one would add a rule that does not exist upstream.
 *  4. **Debit the PINNED price**, one flat `booking_debit` (§7.4 Billing).
 *     Before the insert, so the common failure costs the least work.
 *  5. **Insert the booking** `instant` / `in_progress`, channel `session_{id}`.
 *  6. **Mark the request accepted**, then auto-decline the tutor's others.
 */
export async function acceptSessionRequest(
  store: AcceptStore,
  p: AcceptParams,
  now: () => Date = () => new Date(),
): Promise<AcceptResult> {
  let pinnedPrice = 0;

  try {
    return await store.transaction(async (tx) => {
      const request = await tx.lockRequest(p.requestId);
      // A request that isn't this tutor's is reported exactly as one that does
      // not exist: a tutor must not be able to probe for other tutors' requests.
      if (!request || request.tutorId !== p.tutorId) {
        return { status: "not_found" } as const;
      }
      if (request.status !== "pending") {
        return { status: "not_pending", requestStatus: request.status } as const;
      }

      const at = now();
      if (at.getTime() >= request.expiresAt.getTime()) {
        await tx.markExpired(request.id, at);
        return { status: "expired" } as const;
      }

      // The instant session would occupy [now, now + duration). A scheduled
      // booking collides when its own range overlaps that window.
      const windowEnd = new Date(at.getTime() + request.durationMinutes * 60_000);
      if (await tx.hasCollidingScheduledBooking(request.tutorId, at, windowEnd)) {
        return { status: "scheduled_collision" } as const;
      }

      pinnedPrice = request.priceCredits;
      const agoraChannel = sessionChannel(p.bookingId);

      // The pinned quote, read off the row. NOT re-derived from the tutor's
      // current hourly_rate_credits — see the module note.
      const { balanceAfter } = await debitWallet(tx.ledger, {
        userId: request.studentId,
        amount: request.priceCredits,
        type: "booking_debit",
        referenceType: "booking",
        referenceId: p.bookingId,
        description: `Instant ${request.durationMinutes}-min session`,
      });

      await tx.insertBooking({
        id: p.bookingId,
        studentId: request.studentId,
        tutorId: request.tutorId,
        subjectId: request.subjectId,
        durationMinutes: request.durationMinutes,
        priceCredits: request.priceCredits,
        agoraChannel,
        // The student's "what I want help with" note carries onto the booking.
        studentNotes: request.message,
      });

      await tx.markAccepted(request.id, p.bookingId, at);
      const autoDeclined = await tx.declineOtherPending(
        request.tutorId,
        request.id,
        at,
      );

      return {
        status: "accepted",
        bookingId: p.bookingId,
        agoraChannel,
        studentId: request.studentId,
        priceCredits: request.priceCredits,
        balanceAfter,
        autoDeclined,
      } as const;
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      // The transaction has rolled back: no debit, no booking, no status
      // change. Record WHY, in a statement of its own, so the request is
      // terminal as a payment failure rather than looking untouched (§4.3).
      await store.markFailedPayment(p.requestId, now());
      return { status: "failed_payment", priceCredits: pinnedPrice };
    }
    throw err;
  }
}
