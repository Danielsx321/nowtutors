import { describe, expect, it } from "vitest";
import {
  formatHours,
  formatWeekRange,
  isMondayUtc,
  previousWeekStartUtc,
  recentCompleteWeekStarts,
  utcDayOf,
  weekDaysUtc,
  weekEndUtc,
  weekStartUtc,
} from "@/lib/availability-bonus/week";

/**
 * Bonus weeks are Monday to Sunday in UTC (SPEC §7.5, §12; availability-bonus).
 * The boundaries are where money changes hands, so each one is pinned.
 */
describe("weekStartUtc", () => {
  it("a Monday is its own week start", () => {
    expect(weekStartUtc(new Date("2026-10-12T00:00:00Z"))).toBe("2026-10-12");
    expect(weekStartUtc(new Date("2026-10-12T23:59:59Z"))).toBe("2026-10-12");
  });

  it("Sunday 23:59:59 UTC still belongs to the week that is ending", () => {
    expect(weekStartUtc(new Date("2026-10-18T23:59:59Z"))).toBe("2026-10-12");
  });

  it("Monday 00:00:00 UTC starts the next week", () => {
    expect(weekStartUtc(new Date("2026-10-19T00:00:00Z"))).toBe("2026-10-19");
  });

  it("ignores the local zone: a Sunday evening in Lagos is still that UTC Sunday", () => {
    // 2026-10-18 22:30 WAT is 21:30 UTC on the Sunday.
    expect(weekStartUtc(new Date("2026-10-18T21:30:00Z"))).toBe("2026-10-12");
  });

  it("crosses a year boundary", () => {
    expect(weekStartUtc(new Date("2026-01-01T12:00:00Z"))).toBe("2025-12-29");
    expect(weekDaysUtc("2025-12-29")).toEqual([
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
    expect(weekEndUtc("2025-12-29")).toBe("2026-01-04");
  });
});

describe("previousWeekStartUtc and recentCompleteWeekStarts", () => {
  it("on the Monday run at 00:20 UTC, the previous week is the Monday seven days back", () => {
    expect(previousWeekStartUtc(new Date("2026-10-19T00:20:00Z"))).toBe("2026-10-12");
  });

  it("lists the last four complete weeks oldest first, never the current one", () => {
    expect(recentCompleteWeekStarts(new Date("2026-10-19T00:20:00Z"), 4)).toEqual([
      "2026-09-21",
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
    ]);
  });

  it("midweek, the current week is still excluded", () => {
    expect(recentCompleteWeekStarts(new Date("2026-10-21T15:00:00Z"), 1)).toEqual(["2026-10-12"]);
  });
});

describe("isMondayUtc", () => {
  it("accepts a Monday and refuses everything else", () => {
    expect(isMondayUtc("2026-10-12")).toBe(true);
    expect(isMondayUtc("2026-10-13")).toBe(false);
    expect(isMondayUtc("2026-10-1")).toBe(false);
    expect(isMondayUtc("2026-02-30")).toBe(false);
    expect(isMondayUtc("")).toBe(false);
  });
});

describe("labels", () => {
  it("utcDayOf is the ISO date", () => {
    expect(utcDayOf(new Date("2026-10-18T23:59:59Z"))).toBe("2026-10-18");
  });

  it("formats a week inside one month and across two", () => {
    expect(formatWeekRange("2026-10-12")).toBe("12 to 18 Oct");
    expect(formatWeekRange("2025-12-29")).toBe("29 Dec to 4 Jan");
  });

  it("formatHours floors to whole minutes", () => {
    expect(formatHours(0)).toBe("0m");
    expect(formatHours(59)).toBe("0m");
    expect(formatHours(2700)).toBe("45m");
    expect(formatHours(12_000)).toBe("3h 20m");
    expect(formatHours(18_000)).toBe("5h 0m");
  });
});
