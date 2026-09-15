import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Authorization and ordering for the `/admin/users` and `/admin/subjects`
 * actions (SPEC §5 Layer 2; Phase 8 Part 5). The guard must run before any
 * input is trusted or any transaction opens, and the audit actor must come from
 * the guard. The query layer is mocked; what's under test is each action's own
 * order of operations and how it reports results.
 */

const m = vi.hoisted(() => ({
  calls: [] as string[],
  requireRole: vi.fn(),
  applySuspension: vi.fn(),
  applyCreditAdjustment: vi.fn(),
  applyPromotion: vi.fn(),
  applyCreateSubject: vi.fn(),
  applyRenameSubject: vi.fn(),
  applySetSubjectActive: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({
  requireRole: (...args: unknown[]) => {
    m.calls.push("guard");
    return m.requireRole(...args);
  },
}));
vi.mock("@/db", () => ({
  db: {
    transaction: (fn: (tx: unknown) => unknown) => {
      m.calls.push("transaction");
      return fn("tx");
    },
  },
}));
const track =
  (name: keyof typeof m) =>
  (...args: unknown[]) => {
    m.calls.push(name);
    return (m[name] as ReturnType<typeof vi.fn>)(...args);
  };
vi.mock("@/db/queries/admin-users", () => ({
  applySuspension: track("applySuspension"),
  applyCreditAdjustment: track("applyCreditAdjustment"),
  applyPromotion: track("applyPromotion"),
}));
vi.mock("@/db/queries/admin-subjects", () => ({
  applyCreateSubject: track("applyCreateSubject"),
  applyRenameSubject: track("applyRenameSubject"),
  applySetSubjectActive: track("applySetSubjectActive"),
}));

const { setUserSuspended, adjustUserCredits, promoteToAdmin } = await import("@/actions/admin-users");
const { createSubject, renameSubject, setSubjectActive } = await import("@/actions/admin-subjects");

const ADMIN_ID = randomUUID();
const ADMIN = { user: { id: ADMIN_ID }, profile: { role: "admin" } };
const TARGET = randomUUID();
const redirect = () => Promise.reject(new Error("NEXT_REDIRECT"));
const adjustment = () => ({ userId: TARGET, delta: 10, note: "Goodwill credit", requestKey: randomUUID() });

beforeEach(() => {
  vi.clearAllMocks();
  m.calls.length = 0;
  m.requireRole.mockResolvedValue(ADMIN);
});

describe("guard first", () => {
  const cases: [string, () => Promise<unknown>][] = [
    ["setUserSuspended", () => setUserSuspended({ userId: TARGET, suspended: true })],
    ["adjustUserCredits", () => adjustUserCredits(adjustment())],
    ["promoteToAdmin", () => promoteToAdmin({ userId: TARGET, confirmEmail: "a@b.c" })],
    ["createSubject", () => createSubject({ name: "Latin" })],
    ["renameSubject", () => renameSubject({ subjectId: randomUUID(), name: "Latin" })],
    ["setSubjectActive", () => setSubjectActive({ subjectId: randomUUID(), active: false })],
  ];

  it.each(cases)("%s: a non-admin is refused before any transaction or write", async (_, run) => {
    m.requireRole.mockImplementation(redirect);
    await expect(run()).rejects.toThrow("NEXT_REDIRECT");
    expect(m.requireRole).toHaveBeenCalledWith("admin");
    expect(m.calls).toEqual(["guard"]);
  });

  it.each([
    ["setUserSuspended", () => setUserSuspended({ userId: "not-a-uuid", suspended: true })],
    ["adjustUserCredits", () => adjustUserCredits({ ...adjustment(), delta: 0 })],
    ["createSubject", () => createSubject({ name: "!" })],
  ] as [string, () => Promise<unknown>][])("%s: the guard runs even when the input is bad", async (_, run) => {
    m.requireRole.mockImplementation(redirect);
    await expect(run()).rejects.toThrow("NEXT_REDIRECT");
    expect(m.calls).toEqual(["guard"]);
  });
});

describe("setUserSuspended", () => {
  it("an admin can't suspend their own account, and nothing is opened", async () => {
    expect(await setUserSuspended({ userId: ADMIN_ID, suspended: true })).toEqual({
      error: "You can't suspend your own account.",
    });
    expect(m.calls).toEqual(["guard"]);
  });

  it("takes the actor from the guard, never the input", async () => {
    m.applySuspension.mockResolvedValue({ ok: true, changed: true, wentOffline: true });
    const res = await setUserSuspended({ userId: TARGET, suspended: true, actorId: "evil" } as never);
    expect(res).toEqual({ ok: true, message: "Account suspended and taken offline." });
    expect(m.applySuspension).toHaveBeenCalledWith("tx", { userId: TARGET, suspended: true, actorId: ADMIN_ID });
    expect(m.calls).toEqual(["guard", "transaction", "applySuspension"]);
  });

  it("reports a missing user and a no-op", async () => {
    m.applySuspension.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    expect(await setUserSuspended({ userId: TARGET, suspended: false })).toEqual({ error: "User not found." });
    m.applySuspension.mockResolvedValueOnce({ ok: true, changed: false, wentOffline: false });
    expect(await setUserSuspended({ userId: TARGET, suspended: false })).toEqual({ ok: true, message: "Already active." });
  });
});

describe("adjustUserCredits", () => {
  it("validates before opening a transaction and shows the first problem", async () => {
    expect(await adjustUserCredits({ ...adjustment(), note: "no" })).toEqual({
      error: "Add a note saying why (at least 5 characters).",
    });
    expect(m.calls).toEqual(["guard"]);
  });

  it("passes the trimmed note and the guard's actor to the ledger write", async () => {
    m.applyCreditAdjustment.mockResolvedValue({ ok: true, duplicate: false, balanceAfter: 40 });
    const input = { ...adjustment(), note: "  Goodwill credit  " };
    expect(await adjustUserCredits(input)).toEqual({ ok: true, message: "Done. New balance: 40 credits." });
    expect(m.applyCreditAdjustment).toHaveBeenCalledWith("tx", {
      userId: TARGET,
      delta: 10,
      note: "Goodwill credit",
      requestKey: input.requestKey,
      actorId: ADMIN_ID,
    });
  });

  it("a debit below zero comes back as a message with the current balance", async () => {
    m.applyCreditAdjustment.mockResolvedValue({ ok: false, reason: "insufficient", available: 7 });
    expect(await adjustUserCredits({ ...adjustment(), delta: -50 })).toEqual({
      error: "That would take the balance below zero. Current balance: 7 credits.",
    });
  });

  it("a repeated request key is reported as already applied, and other refusals are explained", async () => {
    m.applyCreditAdjustment.mockResolvedValueOnce({ ok: true, duplicate: true });
    expect(await adjustUserCredits(adjustment())).toEqual({ ok: true, message: "This adjustment was already applied." });
    m.applyCreditAdjustment.mockResolvedValueOnce({ ok: false, reason: "role" });
    expect(await adjustUserCredits(adjustment())).toEqual({ error: "Only student and tutor wallets can be adjusted." });
    m.applyCreditAdjustment.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    expect(await adjustUserCredits(adjustment())).toEqual({ error: "User not found." });
  });
});

describe("promoteToAdmin", () => {
  it("joins every blocker into one message", async () => {
    m.applyPromotion.mockResolvedValue({ ok: false, blockers: ["email_mismatch", "wallet_balance"] });
    const res = await promoteToAdmin({ userId: TARGET, confirmEmail: "x@y.z" });
    expect(res).toEqual({
      error:
        "The email you typed doesn't match this account. The wallet still holds credits. Bring the balance to 0 first.",
    });
    expect(m.applyPromotion).toHaveBeenCalledWith("tx", { userId: TARGET, confirmEmail: "x@y.z", actorId: ADMIN_ID });
  });

  it("promotes when nothing blocks", async () => {
    m.applyPromotion.mockResolvedValue({ ok: true });
    expect(await promoteToAdmin({ userId: TARGET, confirmEmail: "x@y.z" })).toEqual({ ok: true, message: "Promoted to admin." });
  });
});

describe("subject actions", () => {
  it("createSubject validates the name before the transaction and maps both conflicts", async () => {
    expect(await createSubject({ name: "!!" })).toEqual({ error: "Use at least one letter or number." });
    expect(m.calls).toEqual(["guard"]);

    m.applyCreateSubject.mockResolvedValueOnce({ ok: false, reason: "name_taken", slug: "latin" });
    expect(await createSubject({ name: "Latin" })).toEqual({ error: "A subject with that name already exists." });
    m.applyCreateSubject.mockResolvedValueOnce({ ok: false, reason: "slug_taken", slug: "latin" });
    expect(await createSubject({ name: "Latin!" })).toEqual({
      error: 'Another subject already uses the link "latin". Pick a different name.',
    });
    expect(m.applyCreateSubject).toHaveBeenLastCalledWith("tx", { name: "Latin!", actorId: ADMIN_ID });
  });

  it("renameSubject and setSubjectActive take the actor from the guard", async () => {
    const subjectId = randomUUID();
    m.applyRenameSubject.mockResolvedValue({ ok: true, changed: true });
    m.applySetSubjectActive.mockResolvedValue({ ok: true, changed: true });
    expect(await renameSubject({ subjectId, name: " Latin " })).toEqual({ ok: true, message: "Renamed." });
    expect(m.applyRenameSubject).toHaveBeenCalledWith("tx", { subjectId, name: "Latin", actorId: ADMIN_ID });
    expect(await setSubjectActive({ subjectId, active: false })).toEqual({ ok: true, message: "Subject hidden from pickers." });
    expect(m.applySetSubjectActive).toHaveBeenCalledWith("tx", { subjectId, active: false, actorId: ADMIN_ID });
  });
});
