import { describe, it, expect } from "vitest";
import {
  creditWallet,
  debitWallet,
  DuplicateLedgerReferenceError,
  InsufficientCreditsError,
  pgErrorCode,
  type LedgerExecutor,
  type LedgerRow,
} from "@/lib/credits/ledger";

/**
 * In-memory {@link LedgerExecutor} for unit-testing the money invariants without
 * a live Postgres (the pooler + CI have none — docs/DECISIONS.md). It models the
 * three behaviours the production adapter delegates to the database:
 *  - `lockWallet` is a per-user async mutex (Postgres `SELECT ... FOR UPDATE`),
 *    released when the operation writes its balance;
 *  - `insertTransaction` enforces the `(type, reference_id)` unique index;
 *  - `transaction()` snapshots and restores on throw (atomic rollback), so a
 *    failed debit leaves no orphan wallet OR booking change.
 */
interface FakeBooking {
  id: string;
}

class InMemoryLedger implements LedgerExecutor {
  balances = new Map<string, number>();
  rows: LedgerRow[] = [];
  bookings: FakeBooking[] = [];
  private refs = new Set<string>();
  private tail = new Map<string, Promise<void>>();
  private release = new Map<string, () => void>();

  constructor(seed: Record<string, number> = {}) {
    for (const [k, v] of Object.entries(seed)) this.balances.set(k, v);
  }

  async lockWallet(userId: string): Promise<number | null> {
    const prev = this.tail.get(userId) ?? Promise.resolve();
    let releaseMine!: () => void;
    const mine = new Promise<void>((r) => (releaseMine = r));
    this.tail.set(userId, prev.then(() => mine));
    await prev; // wait for any earlier holder to release (serialization)
    this.release.set(userId, releaseMine);
    return this.balances.has(userId) ? this.balances.get(userId)! : null;
  }

  async createWallet(userId: string): Promise<void> {
    if (!this.balances.has(userId)) this.balances.set(userId, 0);
  }

  async insertTransaction(row: LedgerRow): Promise<void> {
    if (row.referenceId != null) {
      const key = `${row.type}:${row.referenceId}`;
      if (this.refs.has(key)) {
        throw new DuplicateLedgerReferenceError(row.type, String(row.referenceId));
      }
      this.refs.add(key);
    }
    this.rows.push({ ...row });
  }

  async setBalance(userId: string, balance: number): Promise<void> {
    this.balances.set(userId, balance);
    this.release.get(userId)?.(); // end of critical section → next locker proceeds
    this.release.delete(userId);
  }

  /** Model of db.transaction(): snapshot, run, restore-on-throw. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const snapBal = new Map(this.balances);
    const snapRows = [...this.rows];
    const snapRefs = new Set(this.refs);
    const snapBookings = [...this.bookings];
    try {
      return await fn();
    } catch (err) {
      this.balances = snapBal;
      this.rows = snapRows;
      this.refs = snapRefs;
      this.bookings = snapBookings;
      throw err;
    }
  }
}

describe("debitWallet — insufficient balance", () => {
  it("rejects a debit larger than the balance and writes nothing", async () => {
    const ex = new InMemoryLedger({ alice: 30 });
    await expect(
      debitWallet(ex, {
        userId: "alice",
        amount: 50,
        type: "booking_debit",
        referenceType: "booking",
        referenceId: "b1",
      }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(ex.balances.get("alice")).toBe(30); // unchanged
    expect(ex.rows).toHaveLength(0); // no ledger row
  });

  it("allows a debit that lands exactly on zero", async () => {
    const ex = new InMemoryLedger({ alice: 40 });
    const { balanceAfter } = await debitWallet(ex, {
      userId: "alice",
      amount: 40,
      type: "booking_debit",
      referenceType: "booking",
      referenceId: "b1",
    });
    expect(balanceAfter).toBe(0);
    expect(ex.balances.get("alice")).toBe(0);
    expect(ex.rows[0]).toMatchObject({ delta: -40, balanceAfter: 0, type: "booking_debit" });
  });

  it("a debit against a non-existent wallet is insufficient, not an auto-open", async () => {
    const ex = new InMemoryLedger();
    await expect(
      debitWallet(ex, { userId: "ghost", amount: 1, type: "booking_debit", referenceId: "b1" }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(ex.balances.has("ghost")).toBe(false);
  });
});

describe("debitWallet — no orphan booking under atomic rollback", () => {
  it("insufficient funds: the whole booking transaction rolls back", async () => {
    const ex = new InMemoryLedger({ alice: 10 });
    const price = 40;
    await expect(
      ex.transaction(async () => {
        await debitWallet(ex, {
          userId: "alice",
          amount: price,
          type: "booking_debit",
          referenceType: "booking",
          referenceId: "bk1",
        });
        ex.bookings.push({ id: "bk1" }); // never reached — debit throws first
      }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(ex.bookings).toHaveLength(0); // no orphan booking
    expect(ex.balances.get("alice")).toBe(10); // balance intact
    expect(ex.rows).toHaveLength(0);
  });

  it("overlap after a successful debit: the debit is rolled back with the booking", async () => {
    const ex = new InMemoryLedger({ alice: 100 });
    const overlap = Object.assign(new Error("exclusion"), { code: "23P01" });
    await expect(
      ex.transaction(async () => {
        await debitWallet(ex, {
          userId: "alice",
          amount: 40,
          type: "booking_debit",
          referenceType: "booking",
          referenceId: "bk2",
        });
        ex.bookings.push({ id: "bk2" });
        throw overlap; // GiST exclusion fires on the booking insert
      }),
    ).rejects.toBe(overlap);
    expect(ex.balances.get("alice")).toBe(100); // debit rolled back
    expect(ex.bookings).toHaveLength(0);
    expect(ex.rows).toHaveLength(0);
  });
});

describe("ledger — idempotency on a duplicate reference", () => {
  it("a second entry for the same (type, reference_id) is rejected", async () => {
    const ex = new InMemoryLedger({ alice: 100 });
    await debitWallet(ex, {
      userId: "alice",
      amount: 10,
      type: "booking_debit",
      referenceType: "booking",
      referenceId: "dup",
    });
    await expect(
      debitWallet(ex, {
        userId: "alice",
        amount: 10,
        type: "booking_debit",
        referenceType: "booking",
        referenceId: "dup",
      }),
    ).rejects.toBeInstanceOf(DuplicateLedgerReferenceError);
    expect(ex.balances.get("alice")).toBe(90); // only the first debit applied
    expect(ex.rows).toHaveLength(1);
  });

  it("the same reference_id under a different type is allowed", async () => {
    const ex = new InMemoryLedger({ alice: 100 });
    await debitWallet(ex, { userId: "alice", amount: 10, type: "booking_debit", referenceId: "x" });
    await creditWallet(ex, { userId: "alice", delta: 10, type: "booking_refund", referenceId: "x" });
    expect(ex.balances.get("alice")).toBe(100);
    expect(ex.rows).toHaveLength(2);
  });
});

describe("debitWallet — concurrent debits under the row lock", () => {
  it("serializes two racing debits so the balance can't be double-spent", async () => {
    const ex = new InMemoryLedger({ alice: 100 });
    // Both debits are individually affordable (70 <= 100) but not together.
    const results = await Promise.allSettled([
      debitWallet(ex, { userId: "alice", amount: 70, type: "booking_debit", referenceId: "r1" }),
      debitWallet(ex, { userId: "alice", amount: 70, type: "booking_debit", referenceId: "r2" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1); // exactly one wins the lock
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientCreditsError);
    expect(ex.balances.get("alice")).toBe(30); // 100 - 70, not -40
    expect(ex.rows).toHaveLength(1);
  });
});

describe("pgErrorCode — unwraps Drizzle's wrapped driver error", () => {
  it("reads a top-level code", () => {
    expect(pgErrorCode({ code: "23505" })).toBe("23505");
  });

  it("reads the code off .cause (Drizzle wraps the driver error)", () => {
    // Shape of a DrizzleQueryError: no top-level code, real code on cause.
    const wrapped = Object.assign(new Error("Failed query"), {
      cause: Object.assign(new Error("duplicate key"), { code: "23505" }),
    });
    expect(pgErrorCode(wrapped)).toBe("23505");
  });

  it("returns undefined for a non-database error", () => {
    expect(pgErrorCode(new Error("boom"))).toBeUndefined();
    expect(pgErrorCode(null)).toBeUndefined();
  });
});

describe("creditWallet — opening a fresh wallet and signed deltas", () => {
  it("credits into a non-existent wallet by opening it at zero", async () => {
    const ex = new InMemoryLedger();
    const { balanceAfter } = await creditWallet(ex, {
      userId: "newbie",
      delta: 25,
      type: "purchase",
      referenceType: "payment",
      referenceId: "p1",
    });
    expect(balanceAfter).toBe(25);
    expect(ex.balances.get("newbie")).toBe(25);
  });

  it("rejects a negative admin adjustment that would go below zero", async () => {
    const ex = new InMemoryLedger({ alice: 5 });
    await expect(
      creditWallet(ex, { userId: "alice", delta: -10, type: "admin_adjustment", referenceId: "a1" }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(ex.balances.get("alice")).toBe(5);
  });

  it("rejects a zero delta", async () => {
    const ex = new InMemoryLedger({ alice: 5 });
    await expect(
      creditWallet(ex, { userId: "alice", delta: 0, type: "admin_adjustment", referenceId: "z" }),
    ).rejects.toThrow(/non-zero/);
  });
});
