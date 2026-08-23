import { describe, it, expect } from "vitest";
import {
  acceptSessionRequest,
  sessionChannel,
  type AcceptStore,
  type AcceptTx,
  type InstantBookingInsert,
  type SessionRequestRecord,
} from "@/lib/session-requests/accept";
import { sessionPriceCredits } from "@/lib/credits/pricing";
import { InMemoryLedger } from "./helpers/in-memory-ledger";

/**
 * The instant-session accept transaction (SPEC §7.4), driven against in-memory
 * storage. What matters here is the four ways an accept must NOT charge a
 * student — the deadline passed, the request is no longer pending, the tutor's
 * calendar collides, or the balance moved since the quote — plus the property
 * the whole `price_credits` column exists for: a rate change between request and
 * accept cannot move the number that is charged.
 *
 * DB-free by construction: the decisions live in a store-agnostic module
 * (docs/DECISIONS.md, Phase 4 Part 2 — the same shape as `lib/paypal/settlement.ts`),
 * so none of this needs a live Postgres, which the pooler and CI do not provide.
 */

const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_REQUEST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BOOKING_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TUTOR = "tutor-1";
const STUDENT = "student-1";

const NOW = new Date("2026-08-23T12:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

interface FakeRequest extends SessionRequestRecord {
  bookingId: string | null;
  respondedAt: Date | null;
}

interface FakeScheduled {
  tutorId: string;
  type: "scheduled" | "instant";
  status: string;
  start: Date;
  end: Date;
}

function request(over: Partial<FakeRequest> = {}): FakeRequest {
  return {
    id: REQUEST_ID,
    studentId: STUDENT,
    tutorId: TUTOR,
    subjectId: null,
    message: "Stuck on question 4",
    durationMinutes: 60,
    priceCredits: 20,
    status: "pending",
    // 60s window, opened 10s ago.
    expiresAt: at(50_000),
    bookingId: null,
    respondedAt: null,
    ...over,
  };
}

/**
 * In-memory {@link AcceptStore}. `transaction()` restores the request rows and
 * the booking list on throw alongside the ledger's own rollback, so a failed
 * debit really does leave nothing behind — which is the precondition the
 * `failed_payment` write has to survive.
 */
class InMemoryAccept implements AcceptStore {
  readonly ledger: InMemoryLedger;
  requests = new Map<string, FakeRequest>();
  bookings: InstantBookingInsert[] = [];
  scheduled: FakeScheduled[] = [];
  /** Every `markFailedPayment` call — asserts it ran OUTSIDE the transaction. */
  failedPaymentWrites: string[] = [];
  collisionProbes: Array<{ now: Date; windowEnd: Date }> = [];

  constructor(rows: FakeRequest[], balances: Record<string, number> = {}) {
    this.ledger = new InMemoryLedger(balances);
    for (const r of rows) this.requests.set(r.id, { ...r });
  }

  private tx(): AcceptTx {
    return {
      ledger: this.ledger,

      lockRequest: async (requestId) => {
        const row = this.requests.get(requestId);
        return row ? { ...row } : null;
      },

      hasCollidingScheduledBooking: async (tutorId, now, windowEnd) => {
        this.collisionProbes.push({ now, windowEnd });
        return this.scheduled.some(
          (b) =>
            b.tutorId === tutorId &&
            b.type === "scheduled" &&
            (b.status === "confirmed" || b.status === "in_progress") &&
            b.start < windowEnd &&
            b.end > now,
        );
      },

      insertBooking: async (row) => {
        this.bookings.push({ ...row });
      },

      markAccepted: async (requestId, bookingId, when) => {
        const row = this.requests.get(requestId)!;
        this.requests.set(requestId, {
          ...row,
          status: "accepted",
          bookingId,
          respondedAt: when,
        });
      },

      markExpired: async (requestId, when) => {
        const row = this.requests.get(requestId)!;
        this.requests.set(requestId, {
          ...row,
          status: "expired",
          respondedAt: when,
        });
      },

      declineOtherPending: async (tutorId, exceptRequestId, when) => {
        let n = 0;
        for (const [id, row] of this.requests) {
          if (row.tutorId !== tutorId || id === exceptRequestId) continue;
          if (row.status !== "pending") continue;
          this.requests.set(id, { ...row, status: "declined", respondedAt: when });
          n++;
        }
        return n;
      },
    };
  }

  async transaction<T>(fn: (tx: AcceptTx) => Promise<T>): Promise<T> {
    const snapRequests = new Map(
      [...this.requests].map(([k, v]) => [k, { ...v }] as const),
    );
    const snapBookings = [...this.bookings];
    try {
      return await this.ledger.transaction(() => fn(this.tx()));
    } catch (err) {
      this.requests = snapRequests;
      this.bookings = snapBookings;
      throw err;
    }
  }

  async markFailedPayment(requestId: string, when: Date): Promise<boolean> {
    this.failedPaymentWrites.push(requestId);
    const row = this.requests.get(requestId);
    if (!row || row.status !== "pending") return false;
    this.requests.set(requestId, {
      ...row,
      status: "failed_payment",
      respondedAt: when,
    });
    return true;
  }
}

const accept = (store: InMemoryAccept, now: Date = NOW) =>
  acceptSessionRequest(
    store,
    { requestId: REQUEST_ID, tutorId: TUTOR, bookingId: BOOKING_ID },
    () => now,
  );

describe("acceptSessionRequest — the happy path", () => {
  it("debits the pinned price, opens the booking, and closes the request", async () => {
    const store = new InMemoryAccept([request()], { [STUDENT]: 50 });

    const result = await accept(store);

    expect(result).toMatchObject({
      status: "accepted",
      bookingId: BOOKING_ID,
      agoraChannel: `session_${BOOKING_ID}`,
      priceCredits: 20,
      balanceAfter: 30,
      autoDeclined: 0,
    });

    // Exactly one flat booking_debit — no hold, no capture (§7.4 Billing).
    expect(store.ledger.rows).toHaveLength(1);
    expect(store.ledger.rows[0]).toMatchObject({
      userId: STUDENT,
      delta: -20,
      balanceAfter: 30,
      type: "booking_debit",
      referenceType: "booking",
      referenceId: BOOKING_ID,
    });
    expect(store.ledger.balances.get(STUDENT)).toBe(30);

    expect(store.bookings).toHaveLength(1);
    expect(store.bookings[0]).toMatchObject({
      id: BOOKING_ID,
      studentId: STUDENT,
      tutorId: TUTOR,
      durationMinutes: 60,
      priceCredits: 20,
      agoraChannel: sessionChannel(BOOKING_ID),
      // The student's note carries onto the booking.
      studentNotes: "Stuck on question 4",
    });

    const row = store.requests.get(REQUEST_ID)!;
    expect(row.status).toBe("accepted");
    expect(row.bookingId).toBe(BOOKING_ID);
    expect(row.respondedAt).toEqual(NOW);
  });

  it("auto-declines the tutor's other pending requests, in the same transaction", async () => {
    const store = new InMemoryAccept(
      [
        request(),
        request({ id: OTHER_REQUEST_ID, studentId: "student-2" }),
      ],
      { [STUDENT]: 50 },
    );

    const result = await accept(store);

    expect(result).toMatchObject({ status: "accepted", autoDeclined: 1 });
    expect(store.requests.get(OTHER_REQUEST_ID)!.status).toBe("declined");
    expect(store.requests.get(OTHER_REQUEST_ID)!.respondedAt).toEqual(NOW);
  });

  it("probes the collision window as [now, now + duration)", async () => {
    const store = new InMemoryAccept([request({ durationMinutes: 90 })], {
      [STUDENT]: 100,
    });

    await accept(store);

    expect(store.collisionProbes).toHaveLength(1);
    expect(store.collisionProbes[0].now).toEqual(NOW);
    expect(store.collisionProbes[0].windowEnd).toEqual(at(90 * 60_000));
  });
});

describe("acceptSessionRequest — guards that must not charge", () => {
  it("refuses a request past expires_at, and moves it to expired", async () => {
    const store = new InMemoryAccept([request({ expiresAt: at(-1) })], {
      [STUDENT]: 50,
    });

    const result = await accept(store);

    expect(result).toEqual({ status: "expired" });
    // Expiry is terminal here, not left pending for the cron.
    expect(store.requests.get(REQUEST_ID)!.status).toBe("expired");
    expect(store.ledger.rows).toHaveLength(0);
    expect(store.ledger.balances.get(STUDENT)).toBe(50);
    expect(store.bookings).toHaveLength(0);
  });

  it("treats the deadline as exclusive — accepting AT expires_at is too late", async () => {
    const store = new InMemoryAccept([request({ expiresAt: NOW })], {
      [STUDENT]: 50,
    });

    expect(await accept(store)).toEqual({ status: "expired" });
    expect(store.ledger.rows).toHaveLength(0);
  });

  it("refuses a request that is no longer pending, without touching it", async () => {
    const store = new InMemoryAccept([request({ status: "declined" })], {
      [STUDENT]: 50,
    });

    const result = await accept(store);

    expect(result).toEqual({ status: "not_pending", requestStatus: "declined" });
    expect(store.requests.get(REQUEST_ID)!.status).toBe("declined");
    expect(store.ledger.rows).toHaveLength(0);
    expect(store.bookings).toHaveLength(0);
  });

  it("answers another tutor's request exactly as a missing one", async () => {
    const store = new InMemoryAccept([request({ tutorId: "tutor-2" })], {
      [STUDENT]: 50,
    });

    // Not "forbidden" — a tutor must not be able to probe for the existence of
    // requests that aren't theirs.
    expect(await accept(store)).toEqual({ status: "not_found" });
    expect(store.requests.get(REQUEST_ID)!.status).toBe("pending");
    expect(store.ledger.rows).toHaveLength(0);
  });

  it("refuses when a scheduled booking overlaps the session window", async () => {
    const store = new InMemoryAccept([request()], { [STUDENT]: 50 });
    store.scheduled.push({
      tutorId: TUTOR,
      type: "scheduled",
      status: "confirmed",
      start: at(30 * 60_000), // 30 min into a 60-min instant session
      end: at(90 * 60_000),
    });

    const result = await accept(store);

    expect(result).toEqual({ status: "scheduled_collision" });
    expect(store.ledger.rows).toHaveLength(0);
    expect(store.bookings).toHaveLength(0);
    expect(store.requests.get(REQUEST_ID)!.status).toBe("pending");
  });

  it("does NOT count a scheduled booking that has already ended", async () => {
    // The complete-sessions cron is Phase 6 Part 3, so yesterday's booking is
    // still `confirmed`. Reading SPEC §7.4's start-side condition alone would
    // block this tutor from every instant session, forever.
    const store = new InMemoryAccept([request()], { [STUDENT]: 50 });
    store.scheduled.push({
      tutorId: TUTOR,
      type: "scheduled",
      status: "confirmed",
      start: at(-3 * 60 * 60_000),
      end: at(-2 * 60 * 60_000),
    });

    expect(await accept(store)).toMatchObject({ status: "accepted" });
  });

  it("does NOT count a scheduled booking starting after the session ends", async () => {
    const store = new InMemoryAccept([request()], { [STUDENT]: 50 });
    store.scheduled.push({
      tutorId: TUTOR,
      type: "scheduled",
      status: "confirmed",
      start: at(60 * 60_000), // exactly when the 60-min session ends
      end: at(120 * 60_000),
    });

    // No buffer either side (Phase 6 pre-build decision) — back-to-back is fine.
    expect(await accept(store)).toMatchObject({ status: "accepted" });
  });

  it("does NOT count another tutor's booking, an instant one, or a cancelled one", async () => {
    const store = new InMemoryAccept([request()], { [STUDENT]: 50 });
    const window = { start: at(10 * 60_000), end: at(50 * 60_000) };
    store.scheduled.push(
      { tutorId: "tutor-2", type: "scheduled", status: "confirmed", ...window },
      { tutorId: TUTOR, type: "instant", status: "in_progress", ...window },
      {
        tutorId: TUTOR,
        type: "scheduled",
        status: "cancelled_by_student",
        ...window,
      },
    );

    expect(await accept(store)).toMatchObject({ status: "accepted" });
  });
});

describe("acceptSessionRequest — a balance that moved is failed_payment", () => {
  it("rolls the accept back in full and records failed_payment afterwards", async () => {
    // Quoted 20, but the student has since spent down to 5.
    const store = new InMemoryAccept([request({ priceCredits: 20 })], {
      [STUDENT]: 5,
    });

    const result = await accept(store);

    expect(result).toEqual({ status: "failed_payment", priceCredits: 20 });

    // Nothing survived the transaction.
    expect(store.ledger.rows).toHaveLength(0);
    expect(store.ledger.balances.get(STUDENT)).toBe(5);
    expect(store.bookings).toHaveLength(0);

    // ...except the record of WHY, written in its own statement afterwards.
    expect(store.failedPaymentWrites).toEqual([REQUEST_ID]);
    const row = store.requests.get(REQUEST_ID)!;
    expect(row.status).toBe("failed_payment");
    expect(row.respondedAt).toEqual(NOW);
    // Emphatically not the other two terminal states (SPEC §4.3): an operator
    // reading this table must be able to tell a payment failure from a timeout
    // and from a refusal.
    expect(row.status).not.toBe("expired");
    expect(row.status).not.toBe("declined");
  });

  it("leaves a student with no wallet at all as failed_payment, not an error", async () => {
    const store = new InMemoryAccept([request()], {});

    expect(await accept(store)).toEqual({
      status: "failed_payment",
      priceCredits: 20,
    });
    expect(store.requests.get(REQUEST_ID)!.status).toBe("failed_payment");
  });

  it("does not write failed_payment when the failure was not the money", async () => {
    const store = new InMemoryAccept([request({ expiresAt: at(-1) })], {
      [STUDENT]: 0,
    });

    await accept(store);

    expect(store.failedPaymentWrites).toEqual([]);
  });
});

describe("price pinning — a rate change cannot move what is charged", () => {
  it("debits the pinned price_credits, not the tutor's current rate", async () => {
    // Quoted at 30 credits/hr for 60 minutes.
    const quotedRate = 30;
    const pinned = sessionPriceCredits(quotedRate, 60);
    expect(pinned).toBe(30);

    const store = new InMemoryAccept([request({ priceCredits: pinned })], {
      [STUDENT]: 200,
    });

    // The tutor triples their rate between the request and the accept. Nothing
    // in the accept path can see this — it reads `price_credits` off the row,
    // and there is no rate anywhere in its inputs.
    const raisedRate = 90;
    expect(sessionPriceCredits(raisedRate, 60)).toBe(90);

    const result = await accept(store);

    expect(result).toMatchObject({ status: "accepted", priceCredits: pinned });
    expect(store.ledger.rows[0].delta).toBe(-pinned);
    expect(store.ledger.balances.get(STUDENT)).toBe(200 - pinned);
    expect(store.bookings[0].priceCredits).toBe(pinned);
  });

  it("holds for a cut rate too — the student is not silently overcharged either", async () => {
    // Pinned high, current rate now lower: the student still pays the quote.
    const store = new InMemoryAccept([request({ priceCredits: 45, durationMinutes: 90 })], {
      [STUDENT]: 100,
    });

    const result = await accept(store);

    expect(result).toMatchObject({ status: "accepted", priceCredits: 45 });
    expect(store.ledger.rows[0].delta).toBe(-45);
    // The booking carries the pinned pair, so what was quoted is what the
    // booking says it cost.
    expect(store.bookings[0]).toMatchObject({
      durationMinutes: 90,
      priceCredits: 45,
    });
  });
});
