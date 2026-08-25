import { describe, it, expect } from "vitest";
import { EARNING_STATUSES, statusEarnsPayout } from "@/lib/sessions/completion";
import { bookingStatus } from "@/db/schema/enums";

/**
 * Which completion outcomes write a `tutor_earnings` row (SPEC §7.11, Part 3C).
 *
 * The rule is small enough to read, which is exactly why it is worth pinning:
 * `no_show_student` paying in full and `no_show_tutor` paying nothing is an
 * asymmetry that looks like an oversight to anyone who meets it without the
 * reasoning, and "tidying" it in either direction moves real money.
 */
describe("statusEarnsPayout — no_show_student pays, no_show_tutor does not", () => {
  it("a completed session pays", () => {
    expect(statusEarnsPayout("completed")).toBe(true);
  });

  it("no_show_student pays in full, identically to completed", () => {
    // The tutor held the slot and was in the room; the student's credits were
    // taken at booking and §7.4 refunds nothing. Not paying here would make a
    // session that never happened the platform's most profitable outcome.
    expect(statusEarnsPayout("no_show_student")).toBe(true);
  });

  it("no_show_tutor pays nothing", () => {
    // Paying an absent tutor while the student cannot be refunded is a double
    // loss with no recovery path.
    expect(statusEarnsPayout("no_show_tutor")).toBe(false);
  });

  it("no other booking status pays", () => {
    // Asserted against the shipped enum rather than a hand-written list, so a
    // new status added later defaults to NOT paying until someone decides.
    for (const status of bookingStatus.enumValues) {
      if ((EARNING_STATUSES as readonly string[]).includes(status)) continue;
      expect(statusEarnsPayout(status)).toBe(false);
    }
    expect(statusEarnsPayout("")).toBe(false);
    expect(statusEarnsPayout("COMPLETED")).toBe(false);
  });
});
