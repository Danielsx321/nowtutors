import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  adjustmentSchema,
  canAdjustWallet,
  MAX_ADJUSTMENT_CREDITS,
  normalizeUserSearch,
  parseUserFilter,
  promotionBlockerMessage,
  promotionBlockers,
  selfSuspensionRefused,
  type PromotionFacts,
} from "@/lib/admin/users";
import { createSubjectSchema, renameSubjectSchema, subjectSlug } from "@/lib/admin/subjects";

/**
 * Pure rules behind `/admin/users` and `/admin/subjects` (SPEC §5, §6, §7.10;
 * Phase 8 Part 5).
 */

const valid = () => ({ userId: randomUUID(), delta: 25, note: "Refund for dropped call", requestKey: randomUUID() });

function firstMessage(input: unknown): string | undefined {
  const r = adjustmentSchema.safeParse(input);
  return r.success ? undefined : r.error.issues[0]?.message;
}

describe("adjustmentSchema", () => {
  it("accepts a positive or negative whole number with a note and a request key", () => {
    expect(adjustmentSchema.safeParse(valid()).success).toBe(true);
    expect(adjustmentSchema.safeParse({ ...valid(), delta: -25 }).success).toBe(true);
  });

  it("trims the note before checking its length", () => {
    const r = adjustmentSchema.safeParse({ ...valid(), note: "  ok  " });
    expect(r.success).toBe(false);
    const ok = adjustmentSchema.parse({ ...valid(), note: "  fixed it  " });
    expect(ok.note).toBe("fixed it");
  });

  it("refuses zero, fractions and anything past the cap in either direction", () => {
    expect(firstMessage({ ...valid(), delta: 0 })).toBe("The adjustment can't be zero.");
    expect(firstMessage({ ...valid(), delta: 1.5 })).toBe("Enter a whole number of credits.");
    expect(firstMessage({ ...valid(), delta: "10" })).toBe("Enter a whole number of credits.");
    expect(adjustmentSchema.safeParse({ ...valid(), delta: MAX_ADJUSTMENT_CREDITS }).success).toBe(true);
    expect(adjustmentSchema.safeParse({ ...valid(), delta: -MAX_ADJUSTMENT_CREDITS }).success).toBe(true);
    expect(firstMessage({ ...valid(), delta: MAX_ADJUSTMENT_CREDITS + 1 })).toMatch(/at most 10,000/);
    expect(firstMessage({ ...valid(), delta: -MAX_ADJUSTMENT_CREDITS - 1 })).toMatch(/at most 10,000/);
  });

  it("refuses a missing note, a note over 500 characters and a non-uuid request key", () => {
    expect(firstMessage({ ...valid(), note: "" })).toMatch(/Add a note/);
    expect(firstMessage({ ...valid(), note: "x".repeat(501) })).toMatch(/under 500/);
    expect(adjustmentSchema.safeParse({ ...valid(), requestKey: "abc" }).success).toBe(false);
    expect(adjustmentSchema.safeParse({ ...valid(), userId: "abc" }).success).toBe(false);
  });
});

describe("who can be changed", () => {
  it("only student and tutor wallets are adjustable", () => {
    expect(canAdjustWallet("student")).toBe(true);
    expect(canAdjustWallet("tutor")).toBe(true);
    expect(canAdjustWallet("admin")).toBe(false);
    expect(canAdjustWallet(null)).toBe(false);
  });

  it("an admin can't suspend themselves", () => {
    expect(selfSuspensionRefused("a", "a")).toBe(true);
    expect(selfSuspensionRefused("a", "b")).toBe(false);
  });
});

describe("promotionBlockers", () => {
  const clean: PromotionFacts = {
    role: "student",
    isSuspended: false,
    email: "Sam@Example.com",
    walletBalance: 0,
    openBookings: 0,
    openWithdrawals: 0,
    unpaidEarnings: 0,
  };

  it("a clean account with the email typed (any case, stray spaces) can be promoted", () => {
    expect(promotionBlockers(clean, "  sam@example.COM ")).toEqual([]);
    expect(promotionBlockers({ ...clean, role: "tutor" }, "sam@example.com")).toEqual([]);
  });

  it("a missing account and an existing admin stop immediately", () => {
    expect(promotionBlockers(null, "x")).toEqual(["not_found"]);
    expect(promotionBlockers({ ...clean, role: "admin", walletBalance: 9 }, "nope")).toEqual(["already_admin"]);
  });

  it("each problem is reported, in fix-it order", () => {
    const blocked: PromotionFacts = {
      role: null,
      isSuspended: true,
      email: "sam@example.com",
      walletBalance: 3,
      openBookings: 1,
      openWithdrawals: 1,
      unpaidEarnings: 2,
    };
    expect(promotionBlockers(blocked, "someone@else.com")).toEqual([
      "not_onboarded",
      "suspended",
      "email_mismatch",
      "wallet_balance",
      "open_bookings",
      "open_withdrawal",
      "unpaid_earnings",
    ]);
  });

  it("every blocker has a message", () => {
    for (const b of promotionBlockers(
      { role: null, isSuspended: true, email: "a", walletBalance: 1, openBookings: 1, openWithdrawals: 1, unpaidEarnings: 1 },
      "b",
    )) {
      expect(promotionBlockerMessage(b)).toMatch(/\w/);
    }
    expect(promotionBlockerMessage("not_found")).toBe("User not found.");
    expect(promotionBlockerMessage("already_admin")).toMatch(/already an admin/);
  });
});

describe("search inputs", () => {
  it("normalises the search box: trimmed, lower case, capped, empty is no search", () => {
    expect(normalizeUserSearch("  Sam@EXAMPLE ")).toBe("sam@example");
    expect(normalizeUserSearch("   ")).toBeNull();
    expect(normalizeUserSearch(undefined)).toBeNull();
    expect(normalizeUserSearch("x".repeat(150))).toHaveLength(100);
    expect(normalizeUserSearch("50%_off")).toBe("50%_off");
  });

  it("accepts only known filters", () => {
    expect(parseUserFilter("tutor")).toBe("tutor");
    expect(parseUserFilter("suspended")).toBe("suspended");
    expect(parseUserFilter("unset")).toBe("unset");
    expect(parseUserFilter("root")).toBeNull();
    expect(parseUserFilter(null)).toBeNull();
  });
});

describe("subjects", () => {
  it("slugs match the seed's rules", () => {
    expect(subjectSlug("Data Science & Machine Learning")).toBe("data-science-and-machine-learning");
    expect(subjectSlug("Macro / Microeconomics")).toBe("macro-microeconomics");
    expect(subjectSlug("C++")).toBe("cplusplus");
    expect(subjectSlug("  English as a Second Language (ESL) ")).toBe("english-as-a-second-language-esl");
  });

  it("names need 2 to 80 characters and at least one letter or number", () => {
    expect(createSubjectSchema.safeParse({ name: "  Latin " }).success).toBe(true);
    expect(createSubjectSchema.parse({ name: "  Latin " }).name).toBe("Latin");
    expect(createSubjectSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(createSubjectSchema.safeParse({ name: "!!!" }).success).toBe(false);
    expect(createSubjectSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
    expect(renameSubjectSchema.safeParse({ subjectId: "nope", name: "Latin" }).success).toBe(false);
  });
});
