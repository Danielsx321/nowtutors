import { describe, expect, it } from "vitest";
import { bucketByMonth, minutesToHours, recentMonthKeys } from "@/lib/dashboard/months";

const NOW = new Date("2026-09-18T12:00:00Z");

describe("recentMonthKeys", () => {
  it("ends with the current month, oldest first", () => {
    expect(recentMonthKeys(NOW, "UTC", 5)).toEqual([
      { key: "2026-05", label: "May" },
      { key: "2026-06", label: "Jun" },
      { key: "2026-07", label: "Jul" },
      { key: "2026-08", label: "Aug" },
      { key: "2026-09", label: "Sep" },
    ]);
  });

  it("crosses a year boundary", () => {
    expect(recentMonthKeys(new Date("2026-02-10T12:00:00Z"), "UTC", 3).map((m) => m.key)).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("uses the viewer's month, not UTC's", () => {
    // 23:30 UTC on 30 Sep is already 1 Oct in Lagos.
    const lateSep = new Date("2026-09-30T23:30:00Z");
    expect(recentMonthKeys(lateSep, "Africa/Lagos", 1)[0]!.key).toBe("2026-10");
    expect(recentMonthKeys(lateSep, "UTC", 1)[0]!.key).toBe("2026-09");
  });
});

describe("bucketByMonth", () => {
  it("sums values and counts rows per month, zero months included", () => {
    const rows = [
      { at: new Date("2026-09-02T10:00:00Z"), value: 1.5 },
      { at: new Date("2026-09-10T10:00:00Z"), value: 1 },
      { at: new Date("2026-07-20T10:00:00Z"), value: 0.5 },
    ];
    const out = bucketByMonth(rows, "UTC", NOW, 3);
    expect(out.map((b) => [b.key, b.value, b.count])).toEqual([
      ["2026-07", 0.5, 1],
      ["2026-08", 0, 0],
      ["2026-09", 2.5, 2],
    ]);
  });

  it("ignores rows outside the range and rows without a date", () => {
    const out = bucketByMonth(
      [
        { at: new Date("2025-01-01T10:00:00Z"), value: 9 },
        { at: null, value: 9 },
      ],
      "UTC",
      NOW,
      2,
    );
    expect(out.every((b) => b.value === 0 && b.count === 0)).toBe(true);
  });
});

describe("minutesToHours", () => {
  it("rounds to one decimal", () => {
    expect(minutesToHours(270)).toBe(4.5);
    expect(minutesToHours(50)).toBe(0.8);
    expect(minutesToHours(0)).toBe(0);
  });
});
