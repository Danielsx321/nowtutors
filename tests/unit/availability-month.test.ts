import { describe, expect, it } from "vitest";
import {
  daysLeftInMonth,
  formatHours,
  formatMonth,
  isMonthStart,
  monthEndUtc,
  monthStartUtc,
  nextMonthStartUtc,
  recentCompleteMonthStarts,
  utcDayOf,
} from "@/lib/availability-bonus/month";

/**
 * Bonus months are UTC calendar months (SPEC §7.5, §12; monthly-availability-bonus).
 * The boundaries are where money changes hands, so each one is pinned.
 */
describe("monthStartUtc", () => {
  it("the last second of a month still belongs to it", () => {
    expect(monthStartUtc(new Date("2026-11-30T23:59:59Z"))).toBe("2026-11-01");
  });

  it("00:00:00 UTC on the 1st starts the next month", () => {
    expect(monthStartUtc(new Date("2026-12-01T00:00:00Z"))).toBe("2026-12-01");
  });

  it("ignores the local zone: late on the 30th in Lagos is still November UTC", () => {
    // 2026-11-30 23:30 WAT is 22:30 UTC on the 30th.
    expect(monthStartUtc(new Date("2026-11-30T22:30:00Z"))).toBe("2026-11-01");
  });
});

describe("month ends", () => {
  it("crosses a year boundary", () => {
    expect(nextMonthStartUtc("2026-12-01")).toBe("2027-01-01");
    expect(monthEndUtc("2026-12-01")).toBe("2026-12-31");
  });

  it("knows February in a leap year and not", () => {
    expect(monthEndUtc("2028-02-01")).toBe("2028-02-29");
    expect(monthEndUtc("2027-02-01")).toBe("2027-02-28");
  });

  it("November has 30 days", () => {
    expect(monthEndUtc("2026-11-01")).toBe("2026-11-30");
  });
});

describe("recentCompleteMonthStarts", () => {
  it("on 1 Dec 00:20 the complete months are the three before December", () => {
    expect(recentCompleteMonthStarts(new Date("2026-12-01T00:20:00Z"), 3)).toEqual([
      "2026-09-01",
      "2026-10-01",
      "2026-11-01",
    ]);
  });

  it("drops months before the floor", () => {
    expect(recentCompleteMonthStarts(new Date("2026-12-01T00:20:00Z"), 3, "2026-11-01")).toEqual(["2026-11-01"]);
    expect(recentCompleteMonthStarts(new Date("2026-11-15T12:00:00Z"), 3, "2026-11-01")).toEqual([]);
  });

  it("crosses a year boundary", () => {
    expect(recentCompleteMonthStarts(new Date("2027-01-01T00:00:00Z"), 2)).toEqual(["2026-11-01", "2026-12-01"]);
  });
});

describe("daysLeftInMonth", () => {
  it("counts today", () => {
    expect(daysLeftInMonth(new Date("2026-11-15T09:00:00Z"))).toBe(16);
    expect(daysLeftInMonth(new Date("2026-11-30T23:00:00Z"))).toBe(1);
    expect(daysLeftInMonth(new Date("2026-11-01T00:00:00Z"))).toBe(30);
  });
});

describe("labels and validation", () => {
  it("formats the month in UTC", () => {
    expect(formatMonth("2026-11-01")).toBe("November 2026");
  });

  it("isMonthStart accepts only real 1sts", () => {
    expect(isMonthStart("2026-11-01")).toBe(true);
    expect(isMonthStart("2026-11-02")).toBe(false);
    expect(isMonthStart("2026-13-01")).toBe(false);
    expect(isMonthStart("nope")).toBe(false);
  });

  it("formatHours and utcDayOf are unchanged from the weekly helpers", () => {
    expect(formatHours(20 * 3600 + 10 * 60 + 59)).toBe("20h 10m");
    expect(formatHours(45 * 60)).toBe("45m");
    expect(formatHours(-5)).toBe("0m");
    expect(utcDayOf(new Date("2026-11-30T23:59:59Z"))).toBe("2026-11-30");
  });
});
