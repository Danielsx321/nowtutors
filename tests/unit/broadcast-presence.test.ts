import { describe, expect, it } from "vitest";
import {
  broadcastPresenceTopic,
  countViewers,
  MAX_REPORTED_VIEWERS,
  nextPeakToReport,
} from "@/lib/broadcasts/presence";

/** The viewer count's arithmetic (SPEC §7.8, §8; Phase 9 Part 3). */

describe("countViewers", () => {
  it("counts one per key, so two tabs of one person count once", () => {
    expect(
      countViewers({
        "101": [{ role: "viewer" }, { role: "viewer" }],
        "202": [{ role: "viewer" }],
      }),
    ).toBe(2);
  });

  it("ignores keys that aren't viewers", () => {
    expect(countViewers({ host: [{ role: "host" }], x: [{}], "303": [{ role: "viewer" }] })).toBe(1);
  });

  it("is zero for an empty state", () => {
    expect(countViewers({})).toBe(0);
  });
});

describe("nextPeakToReport", () => {
  it("reports a count above the last reported peak", () => {
    expect(nextPeakToReport(3, 2)).toBe(3);
  });

  it("reports nothing for the same or a lower count", () => {
    expect(nextPeakToReport(2, 2)).toBeNull();
    expect(nextPeakToReport(1, 2)).toBeNull();
  });

  it("caps what it reports", () => {
    expect(nextPeakToReport(MAX_REPORTED_VIEWERS + 50, 10)).toBe(MAX_REPORTED_VIEWERS);
    expect(nextPeakToReport(MAX_REPORTED_VIEWERS + 50, MAX_REPORTED_VIEWERS)).toBeNull();
  });

  it("never reports a negative or fractional count", () => {
    expect(nextPeakToReport(-4, 0)).toBeNull();
    expect(nextPeakToReport(2.9, 1)).toBe(2);
  });
});

describe("broadcastPresenceTopic", () => {
  it("is scoped to one broadcast", () => {
    expect(broadcastPresenceTopic("abc")).toBe("broadcast-viewers:abc");
  });
});
