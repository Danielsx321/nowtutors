import { describe, expect, it } from "vitest";
import { slotsForWeek, weekAvailability } from "@/lib/tutors/week-availability";

// Friday 18 Sep 2026, 08:00 in Lagos (UTC+1).
const NOW = new Date("2026-09-18T07:00:00Z");

describe("weekAvailability (the profile's This week strip)", () => {
  it("gives seven consecutive days from today in the viewer's timezone", () => {
    const days = weekAvailability([], "Africa/Lagos", NOW);
    expect(days.map((d) => d.weekday)).toEqual(["Fri", "Sat", "Sun", "Mon", "Tue", "Wed", "Thu"]);
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ key: "2026-09-18", weekday: "Fri", date: "18", slots: 0 });
    expect(days[6]!.key).toBe("2026-09-24");
  });

  it("counts slots on the viewer's local day, not the UTC day", () => {
    const slots = [
      "2026-09-18T09:00:00Z", // Fri 10:00 Lagos
      "2026-09-18T23:30:00Z", // Sat 00:30 Lagos, still Friday in UTC
      "2026-09-19T12:00:00Z", // Sat
    ];
    const days = weekAvailability(slots, "Africa/Lagos", NOW);
    expect(days[0]!.slots).toBe(1);
    expect(days[1]!.slots).toBe(2);
  });

  it("the same timezone shift moves a slot for a viewer on the other side", () => {
    const days = weekAvailability(["2026-09-19T02:00:00Z"], "America/New_York", NOW);
    // 22:00 on Friday in New York.
    expect(days[0]!.key).toBe("2026-09-18");
    expect(days[0]!.slots).toBe(1);
  });

  it("ignores slots outside the week and duplicate instants", () => {
    const days = weekAvailability(
      ["2026-09-30T10:00:00Z", "2026-09-20T10:00:00Z", "2026-09-20T10:00:00Z"],
      "UTC",
      NOW,
    );
    expect(days.reduce((n, d) => n + d.slots, 0)).toBe(1);
  });

  it("stays seven distinct days across a DST change", () => {
    // Europe/London leaves summer time on 25 Oct 2026.
    const days = weekAvailability([], "Europe/London", new Date("2026-10-22T12:00:00Z"));
    expect(new Set(days.map((d) => d.key)).size).toBe(7);
    expect(days.map((d) => d.key)).toEqual([
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
    ]);
  });
});

describe("slotsForWeek", () => {
  it("uses the shortest duration's list so a start time counts once", () => {
    expect(slotsForWeek({ 30: ["a", "b"], 60: ["a"] }, [60, 30])).toEqual(["a", "b"]);
  });

  it("returns nothing when there are no durations", () => {
    expect(slotsForWeek({}, [])).toEqual([]);
  });
});
