import { describe, it, expect } from "vitest";
import {
  checkSessionAccess,
  type SessionBookingRow,
} from "@/lib/agora/session-access";

/**
 * Who may hold a token for a session channel, and as what (SPEC §9 step 2, §5).
 *
 * Three guarantees, each of which is a security or billing property rather than
 * a behaviour: a non-participant gets nothing, the role is never a request field,
 * and a booking that is not a live instant session yields no credential.
 */

const STUDENT = "student-1";
const TUTOR = "tutor-1";
const STRANGER = "mallory";

function booking(over: Partial<SessionBookingRow> = {}): SessionBookingRow {
  return {
    id: "b1",
    studentId: STUDENT,
    tutorId: TUTOR,
    status: "in_progress",
    type: "instant",
    agoraChannel: "session_b1",
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
