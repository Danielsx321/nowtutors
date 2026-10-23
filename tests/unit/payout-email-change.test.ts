import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PAYOUT_EMAIL_CHANGED,
  payoutEmailAuditRow,
  payoutEmailChanged,
} from "@/lib/withdrawals/payout-email-audit";

/**
 * Security C (2026-10-22): a change of a tutor's PayPal payout email writes a
 * masked `payout_email_changed` audit row in the same transaction and emails
 * the tutor's account address. The first set at onboarding is logged with no
 * "before" and sends no "changed" email.
 */

const m = vi.hoisted(() => ({
  save: vi.fn(),
  queueEmail: vi.fn(),
  inserts: [] as Array<{ table: unknown; values: unknown }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/security/client-ip", () => ({ getClientIp: async () => "203.0.113.7" }));
vi.mock("@/lib/email", () => ({ queueEmail: (...a: unknown[]) => m.queueEmail(...a) }));
vi.mock("@/db/queries/payout-email", () => ({ savePayoutEmail: (...a: unknown[]) => m.save(...a) }));
vi.mock("@/lib/auth/guards", () => ({
  requireRole: async () => ({ user: { id: "tutor-1", email: "tina@example.com" } }),
  requireUser: async () => ({ id: "tutor-1", email: "tina@example.com" }),
  getSessionProfile: async () => ({ id: "tutor-1", role: null }),
  homeFor: { student: "/dashboard", tutor: "/tutor", admin: "/admin" },
}));
vi.mock("@/db/schema", () => ({
  profiles: { name: "profiles" },
  subjects: { name: "subjects", slug: "slug", id: "id", isActive: "isActive" },
  tutorProfiles: { name: "tutor_profiles", slug: "slug" },
  tutorSubjects: { name: "tutor_subjects" },
  tutorPayoutDetails: { name: "tutor_payout_details" },
  studentSubjects: { name: "student_subjects" },
  auditLog: { name: "audit_log" },
}));
vi.mock("@/db", () => {
  // Subject lookup returns the one slug; the slug-uniqueness lookup finds nothing taken.
  const select = (fields: Record<string, unknown>) => {
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: async () => [],
      then: (ok: (v: unknown) => unknown) => ok("id" in fields ? [{ id: "subj-1", slug: "maths" }] : []),
    };
    return chain;
  };
  const tx = {
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        m.inserts.push({ table, values });
        return { onConflictDoNothing: async () => undefined, then: (ok: (v: unknown) => unknown) => ok(undefined) };
      },
    }),
  };
  return { db: { select, transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } };
});

beforeEach(() => {
  m.save.mockReset();
  m.queueEmail.mockReset();
  m.inserts = [];
});

describe("the audit row", () => {
  it("masks both addresses, keeps the domain, and records actor, target and IP", () => {
    expect(
      payoutEmailAuditRow({ tutorId: "t-1", from: "jane.doe@gmail.com", to: "payouts@evil.com", ip: "1.2.3.4" }),
    ).toEqual({
      actorId: "t-1",
      action: "payout_email_changed",
      targetType: "tutor_payout_details",
      targetId: "t-1",
      payload: { from: "j•••e@gmail.com", to: "p•••s@evil.com", first_set: false },
      ip: "1.2.3.4",
    });
    expect(PAYOUT_EMAIL_CHANGED).toBe("payout_email_changed");
  });

  it("marks a first set with no before", () => {
    const row = payoutEmailAuditRow({ tutorId: "t-1", from: null, to: "jane@gmail.com", ip: null });
    expect(row.payload).toEqual({ from: null, to: "j•••e@gmail.com", first_set: true });
  });

  it("counts a change only when the address really differs", () => {
    expect(payoutEmailChanged("jane@gmail.com", "jane@gmail.com")).toBe(false);
    expect(payoutEmailChanged("Jane@Gmail.com ", "jane@gmail.com")).toBe(false);
    expect(payoutEmailChanged(null, "jane@gmail.com")).toBe(true);
    expect(payoutEmailChanged("jane@gmail.com", "jane@yahoo.com")).toBe(true);
  });
});

describe("updatePayoutEmail", () => {
  it("emails the tutor's account address when the address changed", async () => {
    m.save.mockResolvedValue({ changed: true, previous: "old@gmail.com" });
    const { updatePayoutEmail } = await import("@/actions/tutor-payout");
    await expect(updatePayoutEmail({ email: " New@Gmail.com " })).resolves.toEqual({ ok: true });
    expect(m.save).toHaveBeenCalledWith({ tutorId: "tutor-1", email: "new@gmail.com", ip: "203.0.113.7" });
    expect(m.queueEmail).toHaveBeenCalledTimes(1);
    expect(m.queueEmail.mock.calls[0][0]).toMatchObject({
      type: "payout-email-changed",
      to: { userId: "tutor-1" },
      props: { from: "old@gmail.com", to: "new@gmail.com" },
    });
  });

  it("sends nothing when the same address is saved again", async () => {
    m.save.mockResolvedValue({ changed: false, previous: "same@gmail.com" });
    const { updatePayoutEmail } = await import("@/actions/tutor-payout");
    await expect(updatePayoutEmail({ email: "same@gmail.com" })).resolves.toEqual({ ok: true });
    expect(m.queueEmail).not.toHaveBeenCalled();
  });

  it("sends no 'changed' notice for a first set with nothing before", async () => {
    m.save.mockResolvedValue({ changed: true, previous: null });
    const { updatePayoutEmail } = await import("@/actions/tutor-payout");
    await updatePayoutEmail({ email: "first@gmail.com" });
    expect(m.queueEmail).not.toHaveBeenCalled();
  });

  it("refuses a bad address before saving", async () => {
    const { updatePayoutEmail } = await import("@/actions/tutor-payout");
    await expect(updatePayoutEmail({ email: "nope" })).resolves.toEqual({ error: "Enter a valid PayPal email." });
    expect(m.save).not.toHaveBeenCalled();
  });
});

describe("completeTutorOnboarding", () => {
  it("logs the first payout email in the onboarding transaction and sends no 'changed' email", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
    const { completeTutorOnboarding } = await import("@/actions/onboarding");
    await expect(
      completeTutorOnboarding({
        fullName: "Tina Reyes",
        avatarUrl: "https://proj.supabase.co/storage/v1/object/public/avatars/tutor-1/avatar-1.jpg",
        headline: "Spanish tutor for all levels",
        about: "I have taught Spanish for eight years to students of every age.",
        subjects: [{ slug: "maths", level: "all" }],
        hourlyRateCredits: 30,
        languages: ["Spanish"],
        paypalEmail: "Tina.Pay@Gmail.com",
      }),
    ).rejects.toThrow("redirect:/tutor/pending-approval");

    const audit = m.inserts.filter((i) => (i.table as { name: string }).name === "audit_log");
    expect(audit).toHaveLength(1);
    expect(audit[0].values).toMatchObject({
      action: "payout_email_changed",
      actorId: "tutor-1",
      targetId: "tutor-1",
      payload: { from: null, to: "t•••y@gmail.com", first_set: true },
      ip: "203.0.113.7",
    });
    const types = m.queueEmail.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types).not.toContain("payout-email-changed");
    expect(types).toContain("tutor-welcome");
  });
});
