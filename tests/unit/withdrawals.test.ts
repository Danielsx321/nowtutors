import { beforeEach, describe, expect, it } from "vitest";
import {
  approveWithdrawal,
  markWithdrawalPaid,
  OpenWithdrawalExistsError,
  rejectWithdrawal,
  requestWithdrawal,
  type NewWithdrawal,
  type WithdrawalAudit,
  type WithdrawalRow,
  type WithdrawalRunner,
  type WithdrawalSettings,
  type WithdrawalStatus,
  type WithdrawalStore,
} from "@/lib/withdrawals/withdrawals";
import { InMemoryLedger } from "./helpers/in-memory-ledger";

/**
 * The withdrawal money path (SPEC §7.11; Phase 8 Part 2) through the
 * {@link WithdrawalStore} seam, against the shared {@link InMemoryLedger}.
 *
 * What is NOT here: the concurrency guarantees (two requests racing, a double
 * mark-paid). Those are properties of Postgres row locks and the one-open
 * partial unique index, and live in `tests/integration/withdrawals.test.ts`.
 */

const TUTOR = "tutor-1";
const ADMIN = "admin-1";

interface FakeEarning {
  id: string;
  tutorId: string;
  status: "held" | "available" | "withdrawn";
  /** When its `session_earning` credit was written. */
  creditedAt: Date;
}

class FakeWithdrawals {
  readonly ledger: InMemoryLedger;
  requests: (WithdrawalRow & {
    processedBy?: string;
    adminNote?: string;
    externalReference?: string;
  })[] = [];
  audits: WithdrawalAudit[] = [];
  earnings: FakeEarning[] = [];
  emails = new Map<string, string>();
  /** Simulate the one-open index refusing an insert a check missed. */
  failInsertWithOpen = false;
  private clock = new Date("2026-09-14T12:00:00Z").getTime();

  constructor(balances: Record<string, number>) {
    this.ledger = new InMemoryLedger(balances);
  }

  private store(): WithdrawalStore {
    return {
      ledger: this.ledger,
      lockWalletBalance: async (id) => this.ledger.balances.get(id) ?? 0,
      getPayoutEmail: async (id) => this.emails.get(id) ?? null,
      hasOpenRequest: async (id) =>
        this.requests.some(
          (r) =>
            r.tutorId === id &&
            (r.status === "requested" || r.status === "approved"),
        ),
      insertRequest: async (row: NewWithdrawal) => {
        if (this.failInsertWithOpen) {
          throw new OpenWithdrawalExistsError(row.tutorId);
        }
        const created: WithdrawalRow = {
          ...row,
          status: "requested",
          createdAt: new Date((this.clock += 1000)),
        };
        this.requests.push({ ...created });
        return created;
      },
      lockRequest: async (id) => {
        const r = this.requests.find((x) => x.id === id);
        return r ? { ...r } : null;
      },
      setStatus: async (id, patch) => {
        const r = this.requests.find((x) => x.id === id)!;
        Object.assign(r, patch);
      },
      markEarningsWithdrawn: async (tutorId, requestedAt) => {
        const flipped: string[] = [];
        for (const e of this.earnings) {
          if (
            e.tutorId === tutorId &&
            e.status === "available" &&
            e.creditedAt.getTime() <= requestedAt.getTime()
          ) {
            e.status = "withdrawn";
            flipped.push(e.id);
          }
        }
        return flipped;
      },
      insertAudit: async (entry) => {
        this.audits.push(entry);
      },
    };
  }

  /** One transaction: the ledger's own rollback plus this fake's tables. */
  run: WithdrawalRunner = (fn) => {
    const snap = {
      requests: this.requests.map((r) => ({ ...r })),
      audits: [...this.audits],
      earnings: this.earnings.map((e) => ({ ...e })),
    };
    return this.ledger.transaction(() => fn(this.store())).catch((err) => {
      this.requests = snap.requests;
      this.audits = snap.audits;
      this.earnings = snap.earnings;
      throw err;
    });
  };

  statusOf(id: string): WithdrawalStatus | undefined {
    return this.requests.find((r) => r.id === id)?.status;
  }
}

const SETTINGS: WithdrawalSettings = {
  minWithdrawalUsd: 30,
  payoutUsdPerCredit: 1,
};

let f: FakeWithdrawals;

beforeEach(() => {
  f = new FakeWithdrawals({ [TUTOR]: 40 });
  f.emails.set(TUTOR, "tutor1@paypal.dev");
});

async function requestOk(settings = SETTINGS) {
  const res = await requestWithdrawal(f.run, { tutorId: TUTOR, settings });
  if (!res.ok) throw new Error(`expected ok, got ${res.reason}`);
  return res.withdrawal;
}

describe("requestWithdrawal", () => {
  it("holds the whole balance: one debit, wallet to zero, snapshotted amounts", async () => {
    const w = await requestOk();
    expect(w.amountCredits).toBe(40);
    expect(w.amountUsd).toBe("40.00");
    expect(f.ledger.balances.get(TUTOR)).toBe(0);
    expect(f.ledger.rows).toHaveLength(1);
    expect(f.ledger.rows[0]).toMatchObject({
      userId: TUTOR,
      delta: -40,
      balanceAfter: 0,
      type: "withdrawal_hold",
      referenceType: "withdrawal_request",
      referenceId: w.id,
    });
    expect(f.requests[0]).toMatchObject({
      payoutDestination: "tutor1@paypal.dev",
      status: "requested",
    });
    expect(f.audits).toEqual([
      expect.objectContaining({
        actorId: TUTOR,
        action: "withdrawal.request",
        targetId: w.id,
        payload: expect.objectContaining({ payout_usd_per_credit: 1 }),
      }),
    ]);
  });

  it("prices through the rate, half-up to the cent", async () => {
    f = new FakeWithdrawals({ [TUTOR]: 23 });
    f.emails.set(TUTOR, "tutor1@paypal.dev");
    const w = await requestOk({ minWithdrawalUsd: 30, payoutUsdPerCredit: 1.3333 });
    expect(w.amountUsd).toBe("30.67");
    expect(w.amountCredits).toBe(23);
  });

  it("refuses below the minimum and writes nothing", async () => {
    f = new FakeWithdrawals({ [TUTOR]: 22 });
    f.emails.set(TUTOR, "tutor1@paypal.dev");
    const res = await requestWithdrawal(f.run, {
      tutorId: TUTOR,
      settings: { minWithdrawalUsd: 30, payoutUsdPerCredit: 1.3333 },
    });
    expect(res).toEqual({ ok: false, reason: "below_minimum" });
    expect(f.ledger.balances.get(TUTOR)).toBe(22);
    expect(f.ledger.rows).toHaveLength(0);
    expect(f.requests).toHaveLength(0);
  });

  it("accepts exactly the minimum", async () => {
    f = new FakeWithdrawals({ [TUTOR]: 30 });
    f.emails.set(TUTOR, "tutor1@paypal.dev");
    expect((await requestOk()).amountUsd).toBe("30.00");
  });

  it("refuses when the payout rate is unset, before touching anything", async () => {
    const res = await requestWithdrawal(f.run, {
      tutorId: TUTOR,
      settings: { minWithdrawalUsd: 30, payoutUsdPerCredit: null },
    });
    expect(res).toEqual({ ok: false, reason: "payout_rate_unset" });
    expect(f.ledger.rows).toHaveLength(0);
    expect(f.ledger.balances.get(TUTOR)).toBe(40);
  });

  it("refuses with no PayPal email, including a blank one", async () => {
    f.emails.delete(TUTOR);
    expect(
      await requestWithdrawal(f.run, { tutorId: TUTOR, settings: SETTINGS }),
    ).toEqual({ ok: false, reason: "no_payout_email" });
    f.emails.set(TUTOR, "   ");
    expect(
      await requestWithdrawal(f.run, { tutorId: TUTOR, settings: SETTINGS }),
    ).toEqual({ ok: false, reason: "no_payout_email" });
    expect(f.ledger.rows).toHaveLength(0);
  });

  it("refuses an empty wallet and a tutor with no wallet", async () => {
    f = new FakeWithdrawals({ [TUTOR]: 0 });
    f.emails.set(TUTOR, "tutor1@paypal.dev");
    expect(
      await requestWithdrawal(f.run, { tutorId: TUTOR, settings: SETTINGS }),
    ).toEqual({ ok: false, reason: "no_balance" });
    f.emails.set("nobody", "x@paypal.dev");
    expect(
      await requestWithdrawal(f.run, { tutorId: "nobody", settings: SETTINGS }),
    ).toEqual({ ok: false, reason: "no_balance" });
  });

  it("refuses a second request while one is open", async () => {
    await requestOk();
    // Credits arriving after the first request must not open a second one.
    f.ledger.balances.set(TUTOR, 50);
    expect(
      await requestWithdrawal(f.run, { tutorId: TUTOR, settings: SETTINGS }),
    ).toEqual({ ok: false, reason: "already_open" });
    expect(f.requests).toHaveLength(1);
    expect(f.ledger.rows).toHaveLength(1);
  });

  it("maps the one-open index refusal to already_open and rolls back", async () => {
    f.failInsertWithOpen = true;
    expect(
      await requestWithdrawal(f.run, { tutorId: TUTOR, settings: SETTINGS }),
    ).toEqual({ ok: false, reason: "already_open" });
    expect(f.ledger.balances.get(TUTOR)).toBe(40);
    expect(f.ledger.rows).toHaveLength(0);
    expect(f.audits).toHaveLength(0);
  });
});

describe("approve and mark paid", () => {
  it("approves only from requested", async () => {
    const w = await requestOk();
    expect(await approveWithdrawal(f.run, { id: w.id, adminId: ADMIN })).toEqual({
      ok: true,
    });
    expect(f.statusOf(w.id)).toBe("approved");
    expect(await approveWithdrawal(f.run, { id: w.id, adminId: ADMIN })).toEqual({
      ok: false,
      reason: "wrong_status",
      status: "approved",
    });
  });

  it("refuses to mark paid before approval", async () => {
    const w = await requestOk();
    expect(
      await markWithdrawalPaid(f.run, {
        id: w.id,
        adminId: ADMIN,
        externalReference: "PP-1",
      }),
    ).toEqual({ ok: false, reason: "wrong_status", status: "requested" });
    expect(f.statusOf(w.id)).toBe("requested");
  });

  it("requires a PayPal reference", async () => {
    const w = await requestOk();
    await approveWithdrawal(f.run, { id: w.id, adminId: ADMIN });
    expect(
      await markWithdrawalPaid(f.run, {
        id: w.id,
        adminId: ADMIN,
        externalReference: "   ",
      }),
    ).toEqual({ ok: false, reason: "reference_required" });
    expect(f.statusOf(w.id)).toBe("approved");
  });

  it("marks paid with NO ledger row, and flips only earnings inside the hold", async () => {
    const before = new Date("2026-09-14T11:00:00Z");
    const after = new Date("2026-09-14T13:00:00Z");
    f.earnings = [
      { id: "e-old", tutorId: TUTOR, status: "available", creditedAt: before },
      { id: "e-new", tutorId: TUTOR, status: "available", creditedAt: after },
      { id: "e-held", tutorId: TUTOR, status: "held", creditedAt: before },
      { id: "e-other", tutorId: "tutor-2", status: "available", creditedAt: before },
    ];
    const w = await requestOk();
    await approveWithdrawal(f.run, { id: w.id, adminId: ADMIN });
    const rowsBefore = f.ledger.rows.length;

    const res = await markWithdrawalPaid(f.run, {
      id: w.id,
      adminId: ADMIN,
      externalReference: "  PP-123  ",
    });

    expect(res).toEqual({ ok: true, earningsWithdrawn: 1 });
    expect(f.ledger.rows).toHaveLength(rowsBefore);
    expect(f.ledger.balances.get(TUTOR)).toBe(0);
    expect(f.requests[0]).toMatchObject({
      status: "paid",
      externalReference: "PP-123",
      processedBy: ADMIN,
    });
    expect(f.earnings.map((e) => [e.id, e.status])).toEqual([
      ["e-old", "withdrawn"],
      ["e-new", "available"],
      ["e-held", "held"],
      ["e-other", "available"],
    ]);
    expect(f.audits.at(-1)).toMatchObject({
      action: "withdrawal.mark_paid",
      payload: expect.objectContaining({ external_reference: "PP-123" }),
    });
    // Paid is terminal.
    expect(
      await markWithdrawalPaid(f.run, {
        id: w.id,
        adminId: ADMIN,
        externalReference: "PP-123",
      }),
    ).toEqual({ ok: false, reason: "wrong_status", status: "paid" });
  });

  it("reports an unknown id", async () => {
    expect(await approveWithdrawal(f.run, { id: "nope", adminId: ADMIN })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("rejectWithdrawal", () => {
  it("returns the credits exactly once, from requested", async () => {
    const w = await requestOk();
    expect(
      await rejectWithdrawal(f.run, { id: w.id, adminId: ADMIN, note: "Wrong email" }),
    ).toEqual({ ok: true });
    expect(f.ledger.balances.get(TUTOR)).toBe(40);
    expect(f.ledger.rows.at(-1)).toMatchObject({
      delta: 40,
      type: "withdrawal_reversed",
      referenceId: w.id,
      createdBy: ADMIN,
    });
    expect(f.requests[0]).toMatchObject({ status: "rejected", adminNote: "Wrong email" });

    expect(
      await rejectWithdrawal(f.run, { id: w.id, adminId: ADMIN, note: "Again please" }),
    ).toEqual({ ok: false, reason: "wrong_status", status: "rejected" });
    expect(f.ledger.balances.get(TUTOR)).toBe(40);
    expect(f.ledger.rows.filter((r) => r.type === "withdrawal_reversed")).toHaveLength(1);
  });

  it("also rejects from approved, but never after paid", async () => {
    const w = await requestOk();
    await approveWithdrawal(f.run, { id: w.id, adminId: ADMIN });
    expect(
      await rejectWithdrawal(f.run, { id: w.id, adminId: ADMIN, note: "PayPal bounced" }),
    ).toEqual({ ok: true });

    f.ledger.balances.set(TUTOR, 40);
    const paid = await requestOk();
    await approveWithdrawal(f.run, { id: paid.id, adminId: ADMIN });
    await markWithdrawalPaid(f.run, {
      id: paid.id,
      adminId: ADMIN,
      externalReference: "PP-9",
    });
    expect(
      await rejectWithdrawal(f.run, { id: paid.id, adminId: ADMIN, note: "Too late now" }),
    ).toEqual({ ok: false, reason: "wrong_status", status: "paid" });
  });

  it("requires a note", async () => {
    const w = await requestOk();
    expect(
      await rejectWithdrawal(f.run, { id: w.id, adminId: ADMIN, note: " no " }),
    ).toEqual({ ok: false, reason: "note_required" });
    expect(f.statusOf(w.id)).toBe("requested");
  });

  it("refuses a second reversal even if the status was somehow reopened", async () => {
    const w = await requestOk();
    await rejectWithdrawal(f.run, { id: w.id, adminId: ADMIN, note: "First reject" });
    // A row and ledger that disagree: status open again, reversal already there.
    f.requests[0].status = "requested";
    const balance = f.ledger.balances.get(TUTOR);

    expect(
      await rejectWithdrawal(f.run, { id: w.id, adminId: ADMIN, note: "Second reject" }),
    ).toEqual({ ok: false, reason: "already_reversed" });
    expect(f.ledger.balances.get(TUTOR)).toBe(balance);
    expect(f.statusOf(w.id)).toBe("requested");
  });
});
