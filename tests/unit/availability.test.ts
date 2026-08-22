import { describe, it, expect } from "vitest";
import {
  computeSlots,
  wallClockInZone,
  zonedWallToUtc,
  type AvailabilityRule,
  type ComputeSlotsInput,
} from "@/lib/availability/compute-slots";
import { seededSetting } from "@/db/platform-settings-defaults";

// Cutoffs come from the real seeded platform_settings, never a hardcoded guess
// (SPEC §15). These are 120 and 7 today; the tests below follow a retune.
const NOTICE_MIN = seededSetting<number>("min_booking_notice_minutes");
const MAX_DAYS = seededSetting<number>("max_booking_days_ahead");

/** A rule on every weekday 0–6, so a test can pick any date without bookkeeping. */
function everyDay(startTime: string, endTime: string): AvailabilityRule[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime, endTime }));
}

/** Rules on the given weekdays only. */
function onDays(weekdays: number[], startTime: string, endTime: string): AvailabilityRule[] {
  return weekdays.map((weekday) => ({ weekday, startTime, endTime }));
}

/** Base input with permissive cutoffs; override per test. */
function base(over: Partial<ComputeSlotsInput> = {}): ComputeSlotsInput {
  return {
    rules: [],
    exceptions: [],
    bookings: [],
    range: { from: "2026-07-13", to: "2026-07-15" },
    tutorTimeZone: "America/New_York",
    viewerTimeZone: "UTC",
    now: "2026-01-01T00:00:00.000Z", // far in the past → cutoffs don't clip
    minBookingNoticeMinutes: 0,
    maxBookingDaysAhead: 3650,
    slotDurationMinutes: 60,
    slotStepMinutes: 60,
    ...over,
  };
}

const iso = (slots: { startUtc: Date }[]) => slots.map((s) => s.startUtc.toISOString());

describe("computeSlots — happy path & grid", () => {
  it("steps candidate starts from the window start and fits the whole duration", () => {
    // 09:00–12:00 EDT (summer), 60-min slots, 60-min step → 09:00, 10:00, 11:00.
    const slots = computeSlots(
      base({
        rules: onDays([1], "09:00", "12:00"), // Monday
        range: { from: "2026-07-13", to: "2026-07-13" }, // Mon 2026-07-13
      }),
    );
    // EDT = UTC-4, so 09/10/11 local → 13/14/15 UTC.
    expect(iso(slots)).toEqual([
      "2026-07-13T13:00:00.000Z",
      "2026-07-13T14:00:00.000Z",
      "2026-07-13T15:00:00.000Z",
    ]);
    // 12:00 would end at 13:00 > window end → not offered.
  });

  it("a 90-min duration on a 30-min grid leaves no partial tail", () => {
    const slots = computeSlots(
      base({
        rules: onDays([1], "09:00", "12:00"),
        range: { from: "2026-07-13", to: "2026-07-13" },
        slotDurationMinutes: 90,
        slotStepMinutes: 30,
      }),
    );
    // Starts every 30 min that still fit 90 min before 12:00: 09:00, 09:30, 10:00, 10:30.
    expect(iso(slots)).toEqual([
      "2026-07-13T13:00:00.000Z",
      "2026-07-13T13:30:00.000Z",
      "2026-07-13T14:00:00.000Z",
      "2026-07-13T14:30:00.000Z",
    ]);
  });

  it("inactive rules are ignored", () => {
    const slots = computeSlots(
      base({
        rules: [{ weekday: 1, startTime: "09:00", endTime: "12:00", isActive: false }],
        range: { from: "2026-07-13", to: "2026-07-13" },
      }),
    );
    expect(slots).toEqual([]);
  });
});

describe("computeSlots — DST boundaries (tutor observes DST, viewer does not)", () => {
  // Tutor America/New_York; viewer Africa/Lagos (+1, no DST). The tutor's fixed
  // 9am wall clock must land on the correct UTC instant either side of the
  // transition, and render at a shifted wall clock in the non-DST viewer zone.
  it("spring forward — 2026-03-08, 9am jumps from -05:00 to -04:00", () => {
    const slots = computeSlots(
      base({
        rules: everyDay("09:00", "10:00"),
        range: { from: "2026-03-07", to: "2026-03-09" },
        viewerTimeZone: "Africa/Lagos",
      }),
    );
    // 03-07 EST(-5) → 14:00Z; 03-08 & 03-09 EDT(-4) → 13:00Z.
    expect(iso(slots)).toEqual([
      "2026-03-07T14:00:00.000Z",
      "2026-03-08T13:00:00.000Z",
      "2026-03-09T13:00:00.000Z",
    ]);
    // Rendered in Lagos (+1): the same 9am NY reads 15:00 before, 14:00 after.
    const lagos = slots.map((s) => {
      const w = wallClockInZone(s.startUtc, "Africa/Lagos");
      return `${w.hour}:${String(w.minute).padStart(2, "0")}`;
    });
    expect(lagos).toEqual(["15:00", "14:00", "14:00"]);
  });

  it("fall back — 2026-11-01, 9am shifts from -04:00 to -05:00", () => {
    const slots = computeSlots(
      base({
        rules: everyDay("09:00", "10:00"),
        range: { from: "2026-10-31", to: "2026-11-02" },
        viewerTimeZone: "Africa/Lagos",
      }),
    );
    // 10-31 EDT(-4) → 13:00Z; 11-01 & 11-02 EST(-5) → 14:00Z.
    expect(iso(slots)).toEqual([
      "2026-10-31T13:00:00.000Z",
      "2026-11-01T14:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
    ]);
  });
});

describe("computeSlots — cross-timezone rendering", () => {
  it("a slot computed in the tutor's zone renders correctly in the viewer's zone", () => {
    // Tutor NY (EDT -4 in July); viewer Kolkata (+5:30, no DST).
    const slots = computeSlots(
      base({
        rules: onDays([3], "09:00", "10:00"), // Wednesday
        range: { from: "2026-07-15", to: "2026-07-15" }, // Wed
        viewerTimeZone: "Asia/Kolkata",
      }),
    );
    expect(iso(slots)).toEqual(["2026-07-15T13:00:00.000Z"]);
    // 13:00Z rendered in Kolkata (+5:30) is 18:30 the same day.
    const w = wallClockInZone(slots[0].startUtc, "Asia/Kolkata");
    expect([w.year, w.month, w.day, w.hour, w.minute]).toEqual([2026, 7, 15, 18, 30]);
  });
});

describe("computeSlots — exception overrides against a day with an active rule", () => {
  const rules = onDays([1, 2, 3, 4, 5], "09:00", "17:00"); // Mon–Fri 9–5

  it("full-day block: is_available=false with null times zeroes that day only", () => {
    const slots = computeSlots(
      base({
        rules,
        range: { from: "2026-07-13", to: "2026-07-15" }, // Mon–Wed
        exceptions: [
          { date: "2026-07-14", isAvailable: false, startTime: null, endTime: null }, // Tue blocked
        ],
      }),
    );
    const days = new Set(slots.map((s) => s.startUtc.toISOString().slice(0, 10)));
    expect(days.has("2026-07-13")).toBe(true); // Mon has slots
    expect(days.has("2026-07-14")).toBe(false); // Tue fully blocked
    expect(days.has("2026-07-15")).toBe(true); // Wed has slots
  });

  it("partial-day override: available window replaces the rule for that day", () => {
    const slots = computeSlots(
      base({
        rules,
        range: { from: "2026-07-14", to: "2026-07-14" }, // Tue only
        exceptions: [
          { date: "2026-07-14", isAvailable: true, startTime: "13:00", endTime: "15:00" },
        ],
      }),
    );
    // Only 13:00 & 14:00 EDT (17:00Z, 18:00Z), not the full 9–5 the rule would give.
    expect(iso(slots)).toEqual([
      "2026-07-14T17:00:00.000Z",
      "2026-07-14T18:00:00.000Z",
    ]);
  });
});

describe("computeSlots — back-to-back existing bookings", () => {
  it("adjacent bookings exclude exactly their slots; the abutting slot leaks through", () => {
    // Window 09:00–12:00 EDT → candidate starts 09:00/10:00/11:00 = 13/14/15 UTC.
    // Two back-to-back bookings 13:00–14:00 and 14:00–15:00 (no gap).
    const slots = computeSlots(
      base({
        rules: onDays([1], "09:00", "12:00"),
        range: { from: "2026-07-13", to: "2026-07-13" },
        bookings: [
          { startAt: "2026-07-13T13:00:00.000Z", endAt: "2026-07-13T14:00:00.000Z" },
          { startAt: "2026-07-13T14:00:00.000Z", endAt: "2026-07-13T15:00:00.000Z" },
        ],
      }),
    );
    // 09:00 overlaps booking #1, 10:00 overlaps booking #2 (its start), 11:00 is
    // free — it begins exactly when booking #2 ends (half-open, no off-by-one).
    expect(iso(slots)).toEqual(["2026-07-13T15:00:00.000Z"]);
  });
});

describe("computeSlots — hard cutoffs from seeded platform_settings", () => {
  it("min_booking_notice_minutes is an inclusive lower bound", () => {
    // Tutor & viewer in UTC to isolate the cutoff. Hourly slots 00:00–06:00.
    const now = "2026-06-10T02:00:00.000Z";
    const slots = computeSlots(
      base({
        tutorTimeZone: "UTC",
        rules: everyDay("00:00", "06:00"),
        range: { from: "2026-06-10", to: "2026-06-10" },
        now,
        minBookingNoticeMinutes: NOTICE_MIN, // 120 → earliest bookable start 04:00Z
        maxBookingDaysAhead: 3650,
      }),
    );
    const starts = iso(slots);
    // 03:00 (< now+120m) excluded; 04:00 (== now+120m) included.
    expect(starts).not.toContain("2026-06-10T03:00:00.000Z");
    expect(starts[0]).toBe("2026-06-10T04:00:00.000Z");
    expect(starts).toEqual([
      "2026-06-10T04:00:00.000Z",
      "2026-06-10T05:00:00.000Z",
    ]);
  });

  it("max_booking_days_ahead caps the horizon", () => {
    const now = "2026-06-10T00:00:00.000Z"; // horizon = now + 7d = 2026-06-17T00:00Z
    const slots = computeSlots(
      base({
        tutorTimeZone: "UTC",
        rules: everyDay("12:00", "13:00"), // one slot/day at 12:00Z
        range: { from: "2026-06-10", to: "2026-06-25" },
        now,
        minBookingNoticeMinutes: 0,
        maxBookingDaysAhead: MAX_DAYS, // 7
      }),
    );
    const dates = slots.map((s) => s.startUtc.toISOString().slice(0, 10));
    // 12:00 on 06-16 is within 7 days; 12:00 on 06-17 is past now+7d → excluded.
    expect(dates).toContain("2026-06-16");
    expect(dates).not.toContain("2026-06-17");
    expect(dates[dates.length - 1]).toBe("2026-06-16");
  });
});

describe("timezone helpers", () => {
  it("zonedWallToUtc resolves a normal wall clock", () => {
    // 09:00 in NY on a summer day (EDT -4) → 13:00Z.
    expect(zonedWallToUtc(2026, 7, 15, 9, 0, "America/New_York").toISOString()).toBe(
      "2026-07-15T13:00:00.000Z",
    );
  });

  it("wallClockInZone round-trips through zonedWallToUtc", () => {
    const utc = zonedWallToUtc(2026, 3, 8, 9, 0, "America/New_York");
    const w = wallClockInZone(utc, "America/New_York");
    expect([w.hour, w.minute]).toEqual([9, 0]);
  });
});
