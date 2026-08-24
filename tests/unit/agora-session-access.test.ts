import { describe, it, expect } from "vitest";
import {
  checkSessionAccess,
  type SessionBookingRow,
} from "@/lib/agora/session-access";

/**
 * Who may hold a token for a session channel, and as what (SPEC §9 step 2, §5).
 *
 * Four guarantees, each of which is a security or billing property rather than
 * a behaviour: a non-participant gets nothing, the role is never a request field,
 * a booking that is not a live instant session yields no credential, and one
 * whose booked duration has run out yields no credential either (§7.4's hard
 * stop, the half that holds against a client ignoring its own countdown).
 */

const STUDENT = "student-1";
const TUTOR = "tutor-1";
const STRANGER = "mallory";

/** Fixed so every "elapsed" assertion below is arithmetic, not wall-clock luck. */
const NOW = new Date("2026-08-24T12:00:00.000Z");
const minutesBefore = (n: number) => new Date(NOW.getTime() - n * 60_000);

function booking(over: Partial<SessionBookingRow> = {}): SessionBookingRow {
  return {
    id: "b1",
    studentId: STUDENT,
    tutorId: TUTOR,
    status: "in_progress",
    type: "instant",
    agoraChannel: "session_b1",
    // Five minutes into a thirty-minute session, measured against the REAL
    // clock rather than NOW below: the cases that predate the hard stop call
    // `checkSessionAccess` without a `now` argument and so compare against
    // `new Date()`. Anchoring the default to a fixed instant would make them
    // fail as "elapsed" for no reason connected to what they test.
    startedAt: new Date(Date.now() - 5 * 60_000),
    durationMinutes: 30,
    ...over,
  };
}

describe("session access — participation", () => {
  it("admits the student", () => {
    expect(checkSessionAccess(booking(), STUDENT)).toEqual({
      ok: true,
      bookingId: "b1",
      isTutor: false,
      role: "publisher",
    });
  });

  it("admits the tutor", () => {
    expect(checkSessionAccess(booking(), TUTOR)).toEqual({
      ok: true,
      bookingId: "b1",
      isTutor: true,
      role: "publisher",
    });
  });

  it("refuses anyone else", () => {
    expect(checkSessionAccess(booking(), STRANGER)).toMatchObject({ ok: false });
  });

  it("gives a missing booking and someone else's booking the SAME answer", () => {
    // Otherwise the token endpoint becomes an oracle for which booking ids exist:
    // a 403 confirms the row, a 404 does not.
    const notMine = checkSessionAccess(booking(), STRANGER);
    const missing = checkSessionAccess(null, STRANGER);
    const alsoMissing = checkSessionAccess(undefined, STUDENT);

    expect(notMine).toEqual({ ok: false, status: 404, message: "Session not found." });
    expect(missing).toEqual(notMine);
    expect(alsoMissing).toEqual(notMine);
  });
});

describe("session access — role derivation", () => {
  it("gives BOTH participants a publisher token", () => {
    // SPEC §9 step 2. The student publishes microphone audio, which a subscriber
    // token forbids the moment Agora's co-host authentication is switched on —
    // a console setting nothing in this repo guards. The tutor/student asymmetry
    // is carried by `isTutor` and enforced in the media layer instead.
    const asStudent = checkSessionAccess(booking(), STUDENT);
    const asTutor = checkSessionAccess(booking(), TUTOR);

    expect(asStudent).toMatchObject({ ok: true, role: "publisher" });
    expect(asTutor).toMatchObject({ ok: true, role: "publisher" });
  });

  it("derives isTutor from the booking, not from anything a caller supplies", () => {
    // The signature is (row, userId). There is no third argument and no field on
    // the row a client controls — this test exists to keep it that way.
    const swapped = booking({ studentId: TUTOR, tutorId: STUDENT });
    expect(checkSessionAccess(swapped, STUDENT)).toMatchObject({ isTutor: true });
    expect(checkSessionAccess(swapped, TUTOR)).toMatchObject({ isTutor: false });
  });
});

describe("session access — booking state", () => {
  it("refuses a booking that is not in progress", () => {
    for (const status of ["confirmed", "completed", "cancelled_by_tutor", "expired"]) {
      expect(checkSessionAccess(booking({ status }), STUDENT)).toEqual({
        ok: false,
        status: 409,
        message: "This session isn't live.",
      });
    }
  });

  it("refuses a scheduled booking — that room is LessonSpace (§7.7, Phase 7)", () => {
    expect(checkSessionAccess(booking({ type: "scheduled" }), STUDENT)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("checks the booking type before its status", () => {
    // A scheduled booking is the wrong room whatever state it is in; telling its
    // participant "this session isn't live" would send them back to wait.
    const row = booking({ type: "scheduled", status: "confirmed" });
    expect(checkSessionAccess(row, STUDENT)).toMatchObject({ status: 400 });
  });

  it("still refuses a stranger on a booking that IS live", () => {
    expect(checkSessionAccess(booking(), STRANGER)).toMatchObject({ status: 404 });
  });
});

describe("session access — the elapsed hard stop (§7.4)", () => {
  it("refuses a token once the booked duration has run out", () => {
    const row = booking({ startedAt: minutesBefore(30), durationMinutes: 30 });
    const access = checkSessionAccess(row, STUDENT, NOW);

    expect(access).toEqual({
      ok: false,
      status: 409,
      message: "This session has ended — the booked time is up.",
      elapsed: true,
    });
  });

  it("refuses the tutor too — the deadline belongs to the booking", () => {
    const row = booking({ startedAt: minutesBefore(31), durationMinutes: 30 });
    expect(checkSessionAccess(row, TUTOR, NOW)).toMatchObject({
      ok: false,
      elapsed: true,
    });
  });

  it("refuses while the row still says in_progress", () => {
    // The whole point: the status flips only when some actor performs the
    // transition, and this check must not wait for one. If it deferred to
    // `status`, a client could hold the room open in the window between the
    // deadline and the write.
    const row = booking({
      status: "in_progress",
      startedAt: minutesBefore(45),
      durationMinutes: 30,
    });
    expect(checkSessionAccess(row, STUDENT, NOW)).toMatchObject({ ok: false });
  });

  it("is inclusive at the boundary, matching the SQL predicate's <=", () => {
    const row = booking({ startedAt: minutesBefore(30), durationMinutes: 30 });
    expect(checkSessionAccess(row, STUDENT, NOW)).toMatchObject({ ok: false });
  });

  it("admits with one second left", () => {
    const row = booking({
      startedAt: new Date(NOW.getTime() - 30 * 60_000 + 1000),
      durationMinutes: 30,
    });
    expect(checkSessionAccess(row, STUDENT, NOW)).toMatchObject({ ok: true });
  });

  it("admits a session that has not started — the clock is not running", () => {
    // The first party to arrive must be able to get in, or `started_at` can
    // never be written and no session could ever begin.
    const row = booking({ startedAt: null });
    expect(checkSessionAccess(row, STUDENT, NOW)).toMatchObject({
      ok: true,
      role: "publisher",
    });
  });

  it("admits when duration_minutes is null rather than computing NaN", () => {
    const row = booking({ durationMinutes: null });
    expect(checkSessionAccess(row, STUDENT, NOW)).toMatchObject({ ok: true });
  });
});

describe("session access — elapsed never leaks existence", () => {
  it("gives a stranger the same 404 for an elapsed booking as for a missing one", () => {
    const elapsed = booking({ startedAt: minutesBefore(90), durationMinutes: 30 });
    const strangerOnElapsed = checkSessionAccess(elapsed, STRANGER, NOW);
    const strangerOnMissing = checkSessionAccess(null, STRANGER, NOW);

    // Byte-identical, and in particular `elapsed` is absent from both: a
    // non-participant must not be able to tell an expired real booking from an
    // id that was never real.
    expect(strangerOnElapsed).toEqual(strangerOnMissing);
    expect(strangerOnElapsed).toEqual({
      ok: false,
      status: 404,
      message: "Session not found.",
    });
  });
});
