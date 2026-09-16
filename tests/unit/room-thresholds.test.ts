import { describe, expect, it } from "vitest";
import { qualityLevel } from "@/components/features/session/connection-banner";
import { timeStage } from "@/components/features/session/session-timer";

/**
 * The two thresholds the room's warnings hang off (design overhaul Part 4).
 * Pure, so asserted here rather than through a rendered room.
 */
describe("qualityLevel (Agora's 0 to 6 network quality)", () => {
  it("reads unknown, excellent and good as good: no warning without evidence", () => {
    expect([0, 1, 2].map(qualityLevel)).toEqual(["good", "good", "good"]);
  });
  it("maps 3 to fair, 4 to poor, and 5 and 6 to bad", () => {
    expect([3, 4, 5, 6].map(qualityLevel)).toEqual(["fair", "poor", "bad", "bad"]);
  });
});

describe("timeStage (seconds left in a session)", () => {
  it("is normal above five minutes", () => {
    expect(timeStage(301)).toBe("normal");
  });
  it("warns at five, two and the last minute, inclusive", () => {
    expect(timeStage(300)).toBe("five");
    expect(timeStage(121)).toBe("five");
    expect(timeStage(120)).toBe("two");
    expect(timeStage(61)).toBe("two");
    expect(timeStage(60)).toBe("final");
    expect(timeStage(0)).toBe("final");
  });
});
