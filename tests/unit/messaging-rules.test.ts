import { describe, expect, it } from "vitest";
import {
  canStartConversation,
  MAX_BODY_CHARS,
  messagingRefusalMessage,
  validateBody,
  type StarterProfile,
  type TargetProfile,
} from "@/lib/messaging/rules";

/**
 * Who may start a conversation and what a message may be (SPEC §7.9; Phase 9
 * Part 1, settled 2026-09-15: only a student, only with an approved tutor who
 * isn't suspended).
 */

const student: StarterProfile = { id: "s1", role: "student", isSuspended: false };
const approvedTutor: TargetProfile = {
  id: "t1",
  role: "tutor",
  isSuspended: false,
  approvalStatus: "approved",
};

describe("canStartConversation", () => {
  it("lets a student start a thread with an approved tutor", () => {
    expect(canStartConversation(student, approvedTutor)).toEqual({ ok: true });
  });

  it("refuses a tutor starting a thread, even with another tutor", () => {
    expect(
      canStartConversation({ id: "t2", role: "tutor", isSuspended: false }, approvedTutor),
    ).toEqual({ ok: false, reason: "not_student" });
  });

  it("refuses an admin and an account with no role", () => {
    expect(
      canStartConversation({ id: "a1", role: "admin", isSuspended: false }, approvedTutor),
    ).toEqual({ ok: false, reason: "not_student" });
    expect(
      canStartConversation({ id: "x1", role: null, isSuspended: false }, approvedTutor),
    ).toEqual({ ok: false, reason: "not_student" });
  });

  it("refuses a suspended student before anything else", () => {
    expect(
      canStartConversation({ ...student, isSuspended: true }, null),
    ).toEqual({ ok: false, reason: "starter_suspended" });
  });

  it("refuses messaging yourself", () => {
    expect(
      canStartConversation(student, { ...approvedTutor, id: student.id }),
    ).toEqual({ ok: false, reason: "self" });
  });

  it.each([
    ["no such profile", null],
    ["another student", { ...approvedTutor, role: "student" as const, approvalStatus: null }],
    ["an admin", { ...approvedTutor, role: "admin" as const, approvalStatus: null }],
    ["a pending tutor", { ...approvedTutor, approvalStatus: "pending" }],
    ["a rejected tutor", { ...approvedTutor, approvalStatus: "rejected" }],
    ["a tutor with no tutor profile", { ...approvedTutor, approvalStatus: null }],
    ["a suspended tutor", { ...approvedTutor, isSuspended: true }],
  ])("refuses %s as target_unavailable", (_label, target) => {
    expect(canStartConversation(student, target)).toEqual({
      ok: false,
      reason: "target_unavailable",
    });
  });

  it("gives every unavailable target the same wording, so it can't probe accounts", () => {
    expect(messagingRefusalMessage("target_unavailable")).toBe(
      "This tutor isn't available to message.",
    );
  });
});

describe("validateBody", () => {
  it("trims the ends and keeps inner whitespace and newlines", () => {
    expect(validateBody("  hi\n\n  there  ")).toEqual({ ok: true, body: "hi\n\n  there" });
  });

  it("refuses empty and whitespace-only bodies", () => {
    expect(validateBody("")).toEqual({ ok: false, reason: "empty" });
    expect(validateBody(" \n\t ")).toEqual({ ok: false, reason: "empty" });
  });

  it("accepts exactly the maximum and refuses one character more", () => {
    expect(validateBody("a".repeat(MAX_BODY_CHARS)).ok).toBe(true);
    expect(validateBody("a".repeat(MAX_BODY_CHARS + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("measures length after trimming", () => {
    expect(validateBody(`  ${"a".repeat(MAX_BODY_CHARS)}  `).ok).toBe(true);
  });
});

describe("messagingRefusalMessage", () => {
  it("has wording for every refusal tag", () => {
    for (const tag of [
      "self",
      "not_student",
      "starter_suspended",
      "sender_suspended",
      "target_unavailable",
      "empty",
      "too_long",
      "not_found",
      "rate_limited",
    ] as const) {
      expect(messagingRefusalMessage(tag).length).toBeGreaterThan(0);
    }
  });
});
