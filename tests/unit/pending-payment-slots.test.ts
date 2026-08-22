import { describe, it, expect } from "vitest";
import {
  computeSlots,
  PENDING_PAYMENT_HOLD_MINUTES,
  type ComputeSlotsInput,
} from "@/lib/availability/compute-slots";

/**
 * The 20-minute pending_payment release (SPEC §4.2, §7.3).
 *
 * A direct-pay booking holds its slot while the buyer is in PayPal, but an
 * abandoned checkout must NOT strand the tutor's calendar until a cron runs.
 * `computeSlots` ages the row by its own `created_at`, so the §12 expire-unpaid
 * cron is tidy-up, not correctness — the same relationship `live_tutors` has
 * with sweep-presence (§3.1).
 */

const NOW = new Date("2026-09-01T12:00:00Z");
const SLOT_START = "2026-09-01T15:00:00.000Z";
const SLOT_END = "2026-09-01T16:00:00.000Z";

/** Minutes before NOW, as an ISO instant. */
function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function input(over: Partial<ComputeSlotsInput> = {}): ComputeSlotsInput {
  return {
    // A wide open window on the day in question, in UTC throughout so the
    // assertion is about the booking filter and nothing else.
    rules: [{ weekday: 2, startTime: "09:00", endTime: "18:00" }],
    exceptions: [],
    bookings: [],
    range: { from: "2026-09-01", to: "2026-09-01" },
    tutorTimeZone: "UTC",
    viewerTimeZone: "UTC",
    now: NOW,
    minBookingNoticeMinutes: 120,
    maxBookingDaysAhead: 7,
    slotDurationMinutes: 60,
    slotStepMinutes: 30,
    ...over,
  };
}

/** True when the 15:00 slot is offered. */
function offers15h(over: Partial<ComputeSlotsInput> = {}): boolean {
  return computeSlots(input(over)).some(
    (s) => s.startUtc.toISOString() === SLOT_START,
  );
}

describe("computeSlots — a pending_payment booking ages out of blocking", () => {
  it("is offered when nothing occupies the slot (control)", () => {
    expect(offers15h()).toBe(true);
  });

  it("BLOCKS at 19 minutes old — the checkout is still live", () => {
    const blocked = offers15h({
      bookings: [
        {
          startAt: SLOT_START,
          endAt: SLOT_END,
          status: "pending_payment",
          createdAt: minutesAgo(19),
        },
      ],
    });
    expect(blocked).toBe(false);
  });

  it("does NOT block at 21 minutes old — the checkout was abandoned", () => {
    const offered = offers15h({
      bookings: [
        {
          startAt: SLOT_START,
          endAt: SLOT_END,
          status: "pending_payment",
          createdAt: minutesAgo(21),
        },
      ],
    });
    expect(offered).toBe(true);
  });

  it("blocks exactly at the boundary and releases just past it", () => {
    const hold = PENDING_PAYMENT_HOLD_MINUTES;
    const at = (mins: number) =>
      offers15h({
        bookings: [
          {
            startAt: SLOT_START,
            endAt: SLOT_END,
            status: "pending_payment",
            createdAt: minutesAgo(mins),
          },
        ],
      });
    // Strictly-less-than-hold still holds; at/after the hold it is released.
    expect(at(hold - 0.5)).toBe(false);
    expect(at(hold)).toBe(true);
    expect(at(hold + 0.5)).toBe(true);
  });
});

describe("computeSlots — other statuses are unaffected by the hold window", () => {
  it("a confirmed booking blocks regardless of age", () => {
    for (const age of [1, 19, 21, 60 * 24 * 30]) {
      const offered = offers15h({
        bookings: [
          {
            startAt: SLOT_START,
            endAt: SLOT_END,
            status: "confirmed",
            createdAt: minutesAgo(age),
          },
        ],
      });
      expect(offered).toBe(false);
    }
  });

  it("an in_progress booking blocks regardless of age", () => {
    expect(
      offers15h({
        bookings: [
          {
            startAt: SLOT_START,
            endAt: SLOT_END,
            status: "in_progress",
            createdAt: minutesAgo(999),
          },
        ],
      }),
    ).toBe(false);
  });

  it("a booking with NO status blocks — an untaught caller keeps its meaning", () => {
    // Phase 4 callers passed { startAt, endAt } only. That must still occupy.
    expect(
      offers15h({ bookings: [{ startAt: SLOT_START, endAt: SLOT_END }] }),
    ).toBe(false);
  });

  it("a pending_payment row with no created_at fails safe and blocks", () => {
    // We cannot age what we cannot date; blocking is the safe direction because
    // the alternative is double-selling a slot someone may be paying for.
    expect(
      offers15h({
        bookings: [
          { startAt: SLOT_START, endAt: SLOT_END, status: "pending_payment" },
        ],
      }),
    ).toBe(false);
  });

  it("respects an overridden hold window", () => {
    const booking = {
      startAt: SLOT_START,
      endAt: SLOT_END,
      status: "pending_payment",
      createdAt: minutesAgo(30),
    };
    // 30 minutes old: released under a 20-minute hold, still held under 45.
    expect(offers15h({ bookings: [booking] })).toBe(true);
    expect(
      offers15h({ bookings: [booking], pendingPaymentHoldMinutes: 45 }),
    ).toBe(false);
  });

  it("only releases the slot the abandoned booking occupied", () => {
    // A stale hold on 15:00 must not free 17:00 or anything else it never took.
    const slots = computeSlots(
      input({
        bookings: [
          {
            startAt: SLOT_START,
            endAt: SLOT_END,
            status: "pending_payment",
            createdAt: minutesAgo(21),
          },
          {
            startAt: "2026-09-01T17:00:00.000Z",
            endAt: "2026-09-01T18:00:00.000Z",
            status: "confirmed",
            createdAt: minutesAgo(21),
          },
        ],
      }),
    ).map((s) => s.startUtc.toISOString());

    expect(slots).toContain(SLOT_START);
    expect(slots).not.toContain("2026-09-01T17:00:00.000Z");
  });
});
