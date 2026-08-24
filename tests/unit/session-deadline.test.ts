import { describe, it, expect } from "vitest";
import {
  hasElapsed,
  msRemaining,
  sessionDeadline,
  type SessionTiming,
} from "@/lib/sessions/deadline";

/**
 * The TypeScript half of the deadline pair (SPEC §7.4, §4.3).
 *
 * This lane cannot prove the *authoritative* rule — that lives in the `UPDATE`'s
 * predicate and needs a real Postgres, which is why
 * `tests/integration/session-end-concurrency.test.ts` exists. What it proves is
 * the arithmetic and the boundary, and above all that null inputs produce "no
 * deadline" rather than `NaN` arithmetic on a billing clock.
 *
 * The boundary case is the one that matters most for drift: SQL's
 * `started_at + interval <= now()` is inclusive, so `hasElapsed` is `>=`. The
 * integration lane pins the two together against a live database; this file
 * pins this side on its own so a change here fails fast without a database.
 */

const NOW = new Date("2026-08-24T12:00:00.000Z");
const minutesBefore = (n: number) => new Date(NOW.getTime() - n * 60_000);

const timing = (over: Partial<SessionTiming> = {}): SessionTiming => ({
  startedAt: minutesBefore(10),
  durationMinutes: 60,
  ...over,
});

describe("sessionDeadline", () => {
  it("is started_at plus the booked duration", () => {
    const t = timing({ startedAt: new Date("2026-08-24T11:00:00.000Z"), durationMinutes: 60 });
    expect(sessionDeadline(t)).toEqual(new Date("2026-08-24T12:00:00.000Z"));
  });

  it("handles each duration on the §18 menu", () => {
    const startedAt = new Date("2026-08-24T10:00:00.000Z");
    const at = (iso: string) => new Date(iso);
    expect(sessionDeadline({ startedAt, durationMinutes: 30 })).toEqual(at("2026-08-24T10:30:00.000Z"));
    expect(sessionDeadline({ startedAt, durationMinutes: 60 })).toEqual(at("2026-08-24T11:00:00.000Z"));
    expect(sessionDeadline({ startedAt, durationMinutes: 90 })).toEqual(at("2026-08-24T11:30:00.000Z"));
    expect(sessionDeadline({ startedAt, durationMinutes: 120 })).toEqual(at("2026-08-24T12:00:00.000Z"));
  });

  it("crosses a UTC day boundary without drifting", () => {
    // Not a DST test — `timestamptz` is an absolute instant and the arithmetic
    // is in milliseconds. This exists so nobody "fixes" it into local time.
    const t = timing({ startedAt: new Date("2026-08-24T23:30:00.000Z"), durationMinutes: 90 });
    expect(sessionDeadline(t)).toEqual(new Date("2026-08-25T01:00:00.000Z"));
  });

  it("is null when the session has not started", () => {
    expect(sessionDeadline(timing({ startedAt: null }))).toBeNull();
  });

  it("is null when duration_minutes is null", () => {
    expect(sessionDeadline(timing({ durationMinutes: null }))).toBeNull();
  });

  it("is null rather than NaN for a nonsense duration", () => {
    // A NaN deadline would compare false everywhere and silently mean "never
    // ends" — the exact failure this hard stop exists to prevent.
    expect(sessionDeadline(timing({ durationMinutes: Number.NaN }))).toBeNull();
    expect(sessionDeadline(timing({ durationMinutes: Number.POSITIVE_INFINITY }))).toBeNull();
    expect(sessionDeadline(timing({ durationMinutes: 0 }))).toBeNull();
    expect(sessionDeadline(timing({ durationMinutes: -30 }))).toBeNull();
  });

  it("is null for an invalid Date rather than propagating NaN", () => {
    expect(sessionDeadline(timing({ startedAt: new Date("nonsense") }))).toBeNull();
  });
});

describe("hasElapsed", () => {
  it("is false mid-session", () => {
    expect(hasElapsed(timing({ startedAt: minutesBefore(10), durationMinutes: 60 }), NOW)).toBe(false);
  });

  it("is true past the deadline", () => {
    expect(hasElapsed(timing({ startedAt: minutesBefore(61), durationMinutes: 60 }), NOW)).toBe(true);
  });

  it("is INCLUSIVE at the boundary, matching SQL's <=", () => {
    // The single most drift-prone line in the pair. SQL says
    // `started_at + interval <= now()`; if this were `>` the two halves would
    // disagree for exactly one millisecond, which is the kind of difference
    // that only ever shows up in production.
    expect(hasElapsed(timing({ startedAt: minutesBefore(60), durationMinutes: 60 }), NOW)).toBe(true);
  });

  it("is false one millisecond before the boundary", () => {
    const startedAt = new Date(NOW.getTime() - 60 * 60_000 + 1);
    expect(hasElapsed({ startedAt, durationMinutes: 60 }, NOW)).toBe(false);
  });

  it("is false when the session has not started, however long ago it was booked", () => {
    // No `started_at` means no clock. A booking sitting unjoined for a day has
    // not elapsed — it never started, and Part 3C classifies it as a no-show.
    expect(hasElapsed(timing({ startedAt: null }), NOW)).toBe(false);
  });

  it("is false when duration_minutes is null", () => {
    expect(hasElapsed(timing({ durationMinutes: null }), NOW)).toBe(false);
  });
});

describe("msRemaining", () => {
  it("counts down in milliseconds", () => {
    expect(msRemaining(timing({ startedAt: minutesBefore(10), durationMinutes: 60 }), NOW)).toBe(50 * 60_000);
  });

  it("floors at zero rather than going negative", () => {
    // A negative number would render as a counting-up timer on a dead session.
    expect(msRemaining(timing({ startedAt: minutesBefore(200), durationMinutes: 60 }), NOW)).toBe(0);
  });

  it("is exactly zero at the boundary", () => {
    expect(msRemaining(timing({ startedAt: minutesBefore(60), durationMinutes: 60 }), NOW)).toBe(0);
  });

  it("is null when nothing is running", () => {
    expect(msRemaining(timing({ startedAt: null }), NOW)).toBeNull();
  });
});
