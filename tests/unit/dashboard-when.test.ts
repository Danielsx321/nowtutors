import { describe, expect, it } from "vitest";
import { calendarDaysBetween, countdownFraction, fullWhen, relativeWhen } from "@/lib/dashboard/when";

// Friday 18 Sep 2026, 14:00 in Lagos (UTC+1).
const NOW = new Date("2026-09-18T13:00:00Z");
const TZ = "Africa/Lagos";
const at = (iso: string) => new Date(iso);

describe("relativeWhen", () => {
  it("says Now for a session in progress or already due", () => {
    expect(relativeWhen(at("2026-09-18T15:00:00Z"), NOW, TZ, true)).toBe("Now");
    expect(relativeWhen(at("2026-09-18T12:59:00Z"), NOW, TZ)).toBe("Now");
  });

  it("counts minutes under an hour, hours later today", () => {
    expect(relativeWhen(at("2026-09-18T13:25:00Z"), NOW, TZ)).toBe("In 25 min");
    expect(relativeWhen(at("2026-09-18T15:00:00Z"), NOW, TZ)).toBe("In 2 hrs");
    expect(relativeWhen(at("2026-09-18T14:10:00Z"), NOW, TZ)).toBe("In 1 hr");
  });

  it("names tomorrow, then the weekday, then the date", () => {
    expect(relativeWhen(at("2026-09-19T09:00:00Z"), NOW, TZ)).toBe("Tomorrow");
    expect(relativeWhen(at("2026-09-22T09:00:00Z"), NOW, TZ)).toBe("Tue");
    expect(relativeWhen(at("2026-10-12T09:00:00Z"), NOW, TZ)).toBe("12 Oct");
  });

  it("uses the viewer's calendar: 23:30 UTC is already tomorrow in Lagos", () => {
    expect(relativeWhen(at("2026-09-18T23:30:00Z"), NOW, TZ)).toBe("Tomorrow");
    expect(relativeWhen(at("2026-09-18T23:30:00Z"), NOW, "UTC")).toBe("In 11 hrs");
  });
});

describe("fullWhen", () => {
  it("reads naturally for today, tomorrow, this week and later", () => {
    expect(fullWhen(at("2026-09-18T17:00:00Z"), NOW, TZ)).toBe("Today, 6:00 PM");
    expect(fullWhen(at("2026-09-19T08:30:00Z"), NOW, TZ)).toBe("Tomorrow, 9:30 AM");
    expect(fullWhen(at("2026-09-22T15:30:00Z"), NOW, TZ)).toBe("Tue, 4:30 PM");
    expect(fullWhen(at("2026-10-12T08:00:00Z"), NOW, TZ)).toBe("Mon 12 Oct, 9:00 AM");
  });
});

describe("calendarDaysBetween", () => {
  it("counts calendar days, not 24-hour blocks", () => {
    expect(calendarDaysBetween(NOW, at("2026-09-18T22:00:00Z"), TZ)).toBe(0);
    expect(calendarDaysBetween(NOW, at("2026-09-18T23:30:00Z"), TZ)).toBe(1);
  });
});

describe("countdownFraction", () => {
  it("fills as the start gets closer, full at the start", () => {
    expect(countdownFraction(at("2026-09-18T13:00:00Z"), NOW)).toBe(1);
    expect(countdownFraction(at("2026-09-21T13:00:00Z"), NOW)).toBeCloseTo(4 / 7, 5);
    expect(countdownFraction(at("2026-10-30T13:00:00Z"), NOW)).toBe(0.04);
  });
});
