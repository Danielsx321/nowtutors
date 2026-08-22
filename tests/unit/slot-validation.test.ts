import { describe, it, expect } from "vitest";
import { isSlotOpen, SLOT_STEP_MINUTES } from "@/lib/availability/validate-slot";
import type { AvailabilityRule } from "@/lib/availability/compute-slots";
import { seededSetting } from "@/db/platform-settings-defaults";

const NOTICE_MIN = seededSetting<number>("min_booking_notice_minutes"); // 120
const MAX_DAYS = seededSetting<number>("max_booking_days_ahead"); // 7

// Tutor available Mon–Fri 09:00–17:00 in a fixed-offset zone (UTC keeps the
// arithmetic obvious; DST correctness is proven in availability.test.ts).
const RULES: AvailabilityRule[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startTime: "09:00",
  endTime: "17:00",
}));

function baseInput(over: Partial<Parameters<typeof isSlotOpen>[0]> = {}) {
  return {
    rules: RULES,
    exceptions: [],
    bookings: [],
    tutorTimeZone: "UTC",
    now: new Date("2026-08-24T00:00:00.000Z"), // Monday 2026-08-24, 00:00 UTC
    minBookingNoticeMinutes: NOTICE_MIN,
    maxBookingDaysAhead: MAX_DAYS,
    durationMinutes: 60,
    ...over,
  };
}

describe("isSlotOpen — accepts a genuinely open slot", () => {
  it("a Tuesday 10:00 slot two days out is open", () => {
    // Tue 2026-08-25 10:00 UTC — inside the rule, past 120-min notice, within 7 days.
    expect(isSlotOpen(baseInput(), new Date("2026-08-25T10:00:00.000Z"))).toBe(true);
  });

  it("aligns to the shared 30-minute grid", () => {
    expect(SLOT_STEP_MINUTES).toBe(30);
    expect(isSlotOpen(baseInput(), new Date("2026-08-25T10:30:00.000Z"))).toBe(true);
    // 10:15 is off the grid the calendar offers → not a real slot.
    expect(isSlotOpen(baseInput(), new Date("2026-08-25T10:15:00.000Z"))).toBe(false);
  });
});

describe("isSlotOpen — rejects a slot that isn't actually open", () => {
  it("outside the availability window (before 09:00)", () => {
    expect(isSlotOpen(baseInput(), new Date("2026-08-25T08:00:00.000Z"))).toBe(false);
  });

  it("blocked by a full-day exception", () => {
    const input = baseInput({
      exceptions: [{ date: "2026-08-25", isAvailable: false, startTime: null, endTime: null }],
    });
    expect(isSlotOpen(input, new Date("2026-08-25T10:00:00.000Z"))).toBe(false);
  });

  it("outside a partial-day override window", () => {
    const input = baseInput({
      exceptions: [{ date: "2026-08-25", isAvailable: true, startTime: "13:00", endTime: "15:00" }],
    });
    expect(isSlotOpen(input, new Date("2026-08-25T10:00:00.000Z"))).toBe(false); // rule window replaced
    expect(isSlotOpen(input, new Date("2026-08-25T13:00:00.000Z"))).toBe(true); // inside override
  });

  it("inside the minimum-notice cutoff", () => {
    // now = Mon 00:00; notice 120 min → earliest 02:00. A 01:00 slot is too soon.
    // Use a wider window so 01:00 is a real grid slot but fails the cutoff.
    const input = baseInput({
      rules: [{ weekday: 1, startTime: "00:00", endTime: "06:00" }],
    });
    expect(isSlotOpen(input, new Date("2026-08-24T01:00:00.000Z"))).toBe(false); // < now+120m
    expect(isSlotOpen(input, new Date("2026-08-24T02:00:00.000Z"))).toBe(true); // == now+120m
  });

  it("beyond the max-booking-days horizon", () => {
    // now = Mon 2026-08-24 00:00; rolling horizon = now + 7×24h = 2026-08-31 00:00.
    // A slot on 09-01 is well past it; even 08-31 09:00 is past (10h beyond the cutoff).
    expect(isSlotOpen(baseInput(), new Date("2026-09-01T10:00:00.000Z"))).toBe(false);
    expect(isSlotOpen(baseInput(), new Date("2026-08-31T09:00:00.000Z"))).toBe(false);
    // A Friday slot four days out is comfortably inside the horizon.
    expect(isSlotOpen(baseInput(), new Date("2026-08-28T10:00:00.000Z"))).toBe(true);
  });

  it("already taken by an existing booking (half-open, back-to-back safe)", () => {
    const input = baseInput({
      bookings: [
        { startAt: "2026-08-25T10:00:00.000Z", endAt: "2026-08-25T11:00:00.000Z" },
      ],
    });
    expect(isSlotOpen(input, new Date("2026-08-25T10:00:00.000Z"))).toBe(false); // taken
    expect(isSlotOpen(input, new Date("2026-08-25T11:00:00.000Z"))).toBe(true); // abuts the end, free
  });
});
