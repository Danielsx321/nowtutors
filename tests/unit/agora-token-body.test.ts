import { describe, expect, it } from "vitest";
import { parseTokenBody } from "@/lib/agora/token-body";

/**
 * The `/api/agora/token` body (SPEC §9; Phase 9 Part 3): exactly one id, nothing
 * else. A body that names a channel, a role or both ids must not be read as
 * whichever half happens to parse.
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("token request body", () => {
  it("accepts a booking id alone", () => {
    expect(parseTokenBody({ bookingId: A })).toEqual({ kind: "booking", bookingId: A });
  });

  it("accepts a broadcast id alone", () => {
    expect(parseTokenBody({ broadcastId: A })).toEqual({ kind: "broadcast", broadcastId: A });
  });

  it("refuses both ids together", () => {
    expect(parseTokenBody({ bookingId: A, broadcastId: B })).toBeNull();
  });

  it("refuses neither", () => {
    expect(parseTokenBody({})).toBeNull();
  });

  it("refuses an extra field such as a channel or a role", () => {
    expect(parseTokenBody({ broadcastId: A, channel: `session_${B}` })).toBeNull();
    expect(parseTokenBody({ bookingId: A, role: "publisher" })).toBeNull();
  });

  it("refuses an id that isn't a uuid", () => {
    expect(parseTokenBody({ broadcastId: "broadcast_1" })).toBeNull();
    expect(parseTokenBody({ bookingId: 42 })).toBeNull();
  });

  it("refuses a body that isn't an object", () => {
    for (const v of [null, undefined, "x", 1, [A]]) expect(parseTokenBody(v)).toBeNull();
  });
});
