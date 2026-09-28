import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Where the Part 1 emails are queued (SPEC §11): after the transaction, only
 * on success, with the right type and audience. The email module is mocked;
 * `queueEmails` thunks are run here so the lookups they make are asserted too.
 */

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  queueEmail: vi.fn(),
  queueEmails: vi.fn(),
  getWithdrawalById: vi.fn(),
  getPayoutEmailFor: vi.fn(),
  getRecipient: vi.fn(),
  requestCore: vi.fn(),
  markPaidCore: vi.fn(),
  rejectCore: vi.fn(),
  approveCore: vi.fn(),
  dbSelectRows: [] as unknown[],
  tx: { update: vi.fn(), insert: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ requireRole: (...a: unknown[]) => m.requireRole(...a) }));
vi.mock("@/lib/email", () => ({
  queueEmail: (...a: unknown[]) => m.queueEmail(...a),
  queueEmails: (...a: unknown[]) => m.queueEmails(...a),
}));
vi.mock("@/lib/email/recipient", () => ({ getRecipient: (...a: unknown[]) => m.getRecipient(...a) }));
vi.mock("@/lib/settings", () => ({ getWithdrawalSettings: async () => ({ minWithdrawalUsd: 30 }) }));
vi.mock("@/db/queries/withdrawals", () => ({
  withdrawalRunner: "runner",
  getWithdrawalById: (...a: unknown[]) => m.getWithdrawalById(...a),
  getPayoutEmailFor: (...a: unknown[]) => m.getPayoutEmailFor(...a),
}));
vi.mock("@/lib/withdrawals/withdrawals", () => ({
  requestWithdrawal: (...a: unknown[]) => m.requestCore(...a),
  markWithdrawalPaid: (...a: unknown[]) => m.markPaidCore(...a),
  rejectWithdrawal: (...a: unknown[]) => m.rejectCore(...a),
  approveWithdrawal: (...a: unknown[]) => m.approveCore(...a),
  withdrawalRefusalMessage: (r: string) => `refused:${r}`,
}));
vi.mock("@/lib/tutors/approval", () => ({
  approvalBlocker: () => null,
  approvalBlockerMessage: () => "blocked",
}));
// A chainable fake for the one `db.select(...).from(...).innerJoin(...).where(...).limit(1)`
// read in admin-tutors, and a transaction that just runs the callback.
vi.mock("@/db", () => {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "from", "innerJoin", "where"]) chain[k] = () => chain;
  chain.limit = async () => m.dbSelectRows;
  return {
    db: {
      select: () => chain,
      transaction: async (fn: (tx: unknown) => unknown) => {
        m.tx.update.mockReturnValue({ set: () => ({ where: async () => undefined }) });
        m.tx.insert.mockReturnValue({ values: async () => undefined });
        return fn(m.tx);
      },
    },
  };
});
vi.mock("@/db/schema", () => ({ tutorProfiles: { userId: "userId", approvalStatus: "s" }, auditLog: {}, profiles: { id: "id", avatarUrl: "a" } }));
vi.mock("drizzle-orm", () => ({ eq: () => "eq" }));

const { approveTutor, rejectTutor } = await import("@/actions/admin-tutors");
const { requestWithdrawal } = await import("@/actions/withdrawals");
const { markWithdrawalPaid, rejectWithdrawal } = await import("@/actions/admin-withdrawals");

const ADMIN = { user: { id: randomUUID() }, profile: { role: "admin" } };
const TUTOR_ID = randomUUID();
const TUTOR = { user: { id: TUTOR_ID }, profile: { role: "tutor" } };

async function runQueuedThunks() {
  const out: unknown[] = [];
  for (const call of m.queueEmails.mock.calls) {
    const thunk = call[0] as () => Promise<unknown>;
    out.push(await thunk());
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.dbSelectRows = [{ status: "pending", avatarUrl: "https://x/y.png" }];
});

describe("tutor approval emails", () => {
  it("queues tutor-approved to the tutor after approving", async () => {
    m.requireRole.mockResolvedValue(ADMIN);
    const res = await approveTutor({ tutorId: TUTOR_ID });
    expect(res).toEqual({ ok: true });
    expect(m.queueEmail).toHaveBeenCalledTimes(1);
    expect(m.queueEmail).toHaveBeenCalledWith({ type: "tutor-approved", to: { userId: TUTOR_ID }, props: {} });
  });

  it("queues tutor-rejected with the note", async () => {
    m.requireRole.mockResolvedValue(ADMIN);
    await rejectTutor({ tutorId: TUTOR_ID, note: "No sound on the intro video." });
    expect(m.queueEmail).toHaveBeenCalledWith({
      type: "tutor-rejected",
      to: { userId: TUTOR_ID },
      props: { note: "No sound on the intro video." },
    });
  });

  it("sends nothing when the tutor is not found", async () => {
    m.requireRole.mockResolvedValue(ADMIN);
    m.dbSelectRows = [];
    expect(await approveTutor({ tutorId: TUTOR_ID })).toEqual({ error: "Tutor not found." });
    expect(m.queueEmail).not.toHaveBeenCalled();
  });
});

describe("withdrawal emails", () => {
  it("queues the receipt and the admin alert with the looked-up name and destination", async () => {
    m.requireRole.mockResolvedValue(TUTOR);
    m.requestCore.mockResolvedValue({ ok: true, withdrawal: { id: randomUUID(), amountCredits: 23, amountUsd: "30.66" } });
    m.getRecipient.mockResolvedValue({ id: TUTOR_ID, email: "t@x.test", fullName: "Tina Reyes", displayName: null });
    m.getPayoutEmailFor.mockResolvedValue("tina.reyes@example.com");

    const res = await requestWithdrawal();
    expect(res).toEqual({ ok: true, amountCredits: 23, amountUsd: "30.66" });
    expect(m.queueEmails).toHaveBeenCalledTimes(1);
    const [built] = await runQueuedThunks();
    expect(built).toEqual([
      {
        type: "withdrawal-requested",
        to: { userId: TUTOR_ID },
        props: { amountCredits: 23, amountUsd: "30.66", destination: "tina.reyes@example.com" },
      },
      {
        type: "admin-new-withdrawal",
        to: { admins: true },
        props: { tutorName: "Tina Reyes", amountCredits: 23, amountUsd: "30.66" },
      },
    ]);
    expect(m.getRecipient).toHaveBeenCalledWith(TUTOR_ID);
  });

  it("queues nothing when the request is refused", async () => {
    m.requireRole.mockResolvedValue(TUTOR);
    m.requestCore.mockResolvedValue({ ok: false, reason: "below_minimum" });
    expect(await requestWithdrawal()).toEqual({ error: "refused:below_minimum" });
    expect(m.queueEmails).not.toHaveBeenCalled();
  });

  it("queues withdrawal-paid from the re-read row, only on a real transition", async () => {
    m.requireRole.mockResolvedValue(ADMIN);
    const id = randomUUID();
    m.markPaidCore.mockResolvedValue({ ok: true, earningsWithdrawn: 2 });
    m.getWithdrawalById.mockResolvedValue({
      id,
      tutorId: TUTOR_ID,
      amountCredits: 23,
      amountUsd: "30.66",
      payoutDestination: "tina.reyes@example.com",
      status: "paid",
    });
    await markWithdrawalPaid({ id, externalReference: "5PP1" });
    const [built] = await runQueuedThunks();
    expect(built).toEqual({
      type: "withdrawal-paid",
      to: { userId: TUTOR_ID },
      props: { amountCredits: 23, amountUsd: "30.66", destination: "tina.reyes@example.com", externalReference: "5PP1" },
    });

    vi.clearAllMocks();
    m.requireRole.mockResolvedValue(ADMIN);
    m.markPaidCore.mockResolvedValue({ ok: false, reason: "already_paid", status: "paid" });
    await markWithdrawalPaid({ id, externalReference: "5PP1" });
    expect(m.queueEmails).not.toHaveBeenCalled();
  });

  it("queues withdrawal-rejected with the note, and nothing when the row is gone", async () => {
    m.requireRole.mockResolvedValue(ADMIN);
    const id = randomUUID();
    m.rejectCore.mockResolvedValue({ ok: true });
    m.getWithdrawalById.mockResolvedValue({ id, tutorId: TUTOR_ID, amountCredits: 23, amountUsd: "30.66", payoutDestination: "x@y", status: "rejected" });
    await rejectWithdrawal({ id, note: "PayPal address bounced." });
    const [built] = await runQueuedThunks();
    expect(built).toEqual({
      type: "withdrawal-rejected",
      to: { userId: TUTOR_ID },
      props: { amountCredits: 23, amountUsd: "30.66", note: "PayPal address bounced." },
    });

    vi.clearAllMocks();
    m.requireRole.mockResolvedValue(ADMIN);
    m.rejectCore.mockResolvedValue({ ok: true });
    m.getWithdrawalById.mockResolvedValue(null);
    await rejectWithdrawal({ id, note: "PayPal address bounced." });
    const [builtAgain] = await runQueuedThunks();
    expect(builtAgain).toBeNull();
  });
});
