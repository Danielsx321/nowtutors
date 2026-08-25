import { describe, it, expect } from "vitest";
import {
  checkLessonSpaceAccess,
  withinJoinWindow,
  JOIN_WINDOW_BEFORE_MINUTES,
  JOIN_WINDOW_AFTER_MINUTES,
  type LessonSpaceBookingRow,
} from "@/lib/lessonspace/session-access";

/**
 * Who may join a scheduled booking's LessonSpace classroom, and as what
 * (SPEC §7.7 step 1, §7.3, §5).
 *
 * The same lane as `agora-session-access.test.ts` — pure, no database. Three
 * guarantees, each a security or product rule rather than a behaviour: a
 * non-participant gets nothing (and can't tell a real booking from a fake one),
 * the role is never a request field, and the join window is our own server-side
 * gate enforced at pinned instants.
 */

const STUDENT = "student-1";
const TUTOR = "tutor-1";
const STRANGER = "mallory";

/** 60-minute session, fixed so every window assertion is arithmetic. */
const START = new Date("2026-08-25T15:00:00.000Z");
const END = new Date("2026-08-25T16:00:00.000Z");

/** Derived window edges: opens 10m before START, closes 30m after END (§7.3). */
const OPENS_AT = new Date(START.getTime() - JOIN_WINDOW_BEFORE_MINUTES * 60_000); // 14:50:00Z
const CLOSES_AT = new Date(END.getTime() + JOIN_WINDOW_AFTER_MINUTES * 60_000); // 16:30:00Z

/** A `now` comfortably inside the window, for the non-window cases. */
const MID = new Date("2026-08-25T15:30:00.000Z");

function booking(over: Partial<LessonSpaceBookingRow> = {}): LessonSpaceBookingRow {
  return {
    id: "b1",
    studentId: STUDENT,
    tutorId: TUTOR,
    status: "confirmed",
    type: "scheduled",
    scheduledStartAt: START,
    scheduledEndAt: END,
    ...over,
  };
}

describe("lessonspace access — participation", () => {
  it("admits the student as student", () => {
    expect(checkLessonSpaceAccess(booking(), STUDENT, MID)).toEqual({
      ok: true,
      bookingId: "b1",
      isTutor: false,
      role: "student",
    });
  });

  it("admits the tutor as teacher (leader)", () => {
    expect(checkLessonSpaceAccess(booking(), TUTOR, MID)).toEqual({
      ok: true,
      bookingId: "b1",
      isTutor: true,
      role: "teacher",
    });
  });

  it("gives a non-participant the same 404 as a missing booking", () => {
    const stranger = checkLessonSpaceAccess(booking(), STRANGER, MID);
    const missing = checkLessonSpaceAccess(null, STUDENT, MID);
    expect(stranger).toEqual({ ok: false, status: 404, message: "Session not found." });
    expect(missing).toEqual({ ok: false, status: 404, message: "Session not found." });
  });

  it("checks participation first — a stranger never learns state, type, or timing", () => {
    // Wrong type, terminal status, and outside the window all at once: a
    // participant would see 400/409, but a stranger must still get the 404.
    const row = booking({
      type: "instant",
      status: "completed",
      scheduledStartAt: new Date("2020-01-01T00:00:00.000Z"),
      scheduledEndAt: new Date("2020-01-01T01:00:00.000Z"),
    });
    expect(checkLessonSpaceAccess(row, STRANGER, MID)).toEqual({
      ok: false,
      status: 404,
      message: "Session not found.",
    });
  });
});

describe("lessonspace access — booking must be a scheduled classroom", () => {
  it("refuses an instant booking with 400 even for a participant", () => {
    const res = checkLessonSpaceAccess(booking({ type: "instant" }), STUDENT, MID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });
});

describe("lessonspace access — state guard (§7.7 step 1)", () => {
  it("admits a confirmed booking — the normal state of the first arrival", () => {
    expect(checkLessonSpaceAccess(booking({ status: "confirmed" }), STUDENT, MID).ok).toBe(true);
  });

  it("admits an in_progress booking — the second party joining", () => {
    expect(checkLessonSpaceAccess(booking({ status: "in_progress" }), TUTOR, MID).ok).toBe(true);
  });

  it.each(["pending_payment", "completed", "cancelled_by_student", "no_show_tutor", "expired"])(
    "refuses status %s with 409",
    (status) => {
      const res = checkLessonSpaceAccess(booking({ status }), STUDENT, MID);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(409);
    },
  );
});

describe("lessonspace access — join window is enforced in the decision", () => {
  it("refuses before the window opens with a 409 'not open yet'", () => {
    const res = checkLessonSpaceAccess(booking(), STUDENT, new Date(OPENS_AT.getTime() - 1_000));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(409);
      expect(res.message).toMatch(/isn't open yet/i);
    }
  });

  it("refuses after the window closes with a 409 'window closed'", () => {
    const res = checkLessonSpaceAccess(booking(), STUDENT, new Date(CLOSES_AT.getTime() + 1_000));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(409);
      expect(res.message).toMatch(/window .* closed/i);
    }
  });

  it("admits exactly at the open boundary", () => {
    expect(checkLessonSpaceAccess(booking(), STUDENT, OPENS_AT).ok).toBe(true);
  });

  it("admits exactly at the close boundary", () => {
    expect(checkLessonSpaceAccess(booking(), TUTOR, CLOSES_AT).ok).toBe(true);
  });
});

/**
 * The window as a pure predicate, at pinned instants (SPEC §7.3). Boundaries are
 * inclusive at both edges — stated here so the exactly-on-boundary case has one
 * unambiguous answer.
 */
describe("withinJoinWindow", () => {
  const timing = { scheduledStartAt: START, scheduledEndAt: END };

  it("is true exactly at the open boundary (inclusive)", () => {
    expect(withinJoinWindow(timing, OPENS_AT)).toBe(true);
  });

  it("is true just inside the open edge", () => {
    expect(withinJoinWindow(timing, new Date(OPENS_AT.getTime() + 1_000))).toBe(true);
  });

  it("is false just outside the open edge", () => {
    expect(withinJoinWindow(timing, new Date(OPENS_AT.getTime() - 1_000))).toBe(false);
  });

  it("is true exactly at the close boundary (inclusive)", () => {
    expect(withinJoinWindow(timing, CLOSES_AT)).toBe(true);
  });

  it("is true just inside the close edge", () => {
    expect(withinJoinWindow(timing, new Date(CLOSES_AT.getTime() - 1_000))).toBe(true);
  });

  it("is false just outside the close edge", () => {
    expect(withinJoinWindow(timing, new Date(CLOSES_AT.getTime() + 1_000))).toBe(false);
  });

  it("is true well inside the window", () => {
    expect(withinJoinWindow(timing, MID)).toBe(true);
  });

  it("is false when either scheduled timestamp is null", () => {
    expect(withinJoinWindow({ scheduledStartAt: null, scheduledEndAt: END }, MID)).toBe(false);
    expect(withinJoinWindow({ scheduledStartAt: START, scheduledEndAt: null }, MID)).toBe(false);
  });

  it("uses start for the open edge and end for the close edge, not one anchor", () => {
    // A point 20 min after START but only during the session is inside; the same
    // offset logic applied to END would put the open edge in the wrong place.
    // Guards against a refactor that computes both edges from a single timestamp.
    const justAfterEndPlus30 = new Date(CLOSES_AT.getTime() + 60_000);
    expect(withinJoinWindow(timing, justAfterEndPlus30)).toBe(false);
    // And a longer session stays open later than a short one with the same start.
    const longEnd = new Date(START.getTime() + 120 * 60_000);
    expect(
      withinJoinWindow(
        { scheduledStartAt: START, scheduledEndAt: longEnd },
        new Date(longEnd.getTime() + JOIN_WINDOW_AFTER_MINUTES * 60_000),
      ),
    ).toBe(true);
  });
});
