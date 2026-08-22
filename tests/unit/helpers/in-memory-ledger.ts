import {
  DuplicateLedgerReferenceError,
  type LedgerExecutor,
  type LedgerRow,
} from "@/lib/credits/ledger";

/**
 * In-memory {@link LedgerExecutor} for unit-testing the money invariants without
 * a live Postgres (the pooler + CI have none — docs/DECISIONS.md). It models the
 * four database behaviours the production adapter delegates to:
 *
 *  - `lockWallet` is a per-user async mutex (Postgres `SELECT ... FOR UPDATE`),
 *    released when the operation writes its balance;
 *  - `insertTransaction` enforces the `(type, reference_id)` unique index;
 *  - `transaction()` snapshots and restores on throw (atomic rollback), so a
 *    failed debit leaves no orphan wallet OR booking change;
 *  - a failed statement **aborts the transaction**: every later statement raises
 *    `25P02` until a `ROLLBACK TO SAVEPOINT` unwinds it. This is why the PayPal
 *    settlement path wraps its ledger append in a savepoint — without one, the
 *    duplicate-key rejection on a webhook/client race would poison the whole
 *    transaction and roll back the `payments` status update with it.
 *    `transaction()` doubles as the savepoint model: it restores the aborted
 *    flag along with the data.
 */
export interface FakeBooking {
  id: string;
}

/** Postgres SQLSTATE: statement issued inside an aborted transaction block. */
export const IN_FAILED_TRANSACTION = "25P02";

export class InMemoryLedger implements LedgerExecutor {
  balances = new Map<string, number>();
  rows: LedgerRow[] = [];
  bookings: FakeBooking[] = [];
  /** True once a statement has errored, until a rollback unwinds it. */
  aborted = false;
  private refs = new Set<string>();
  private tail = new Map<string, Promise<void>>();
  private release = new Map<string, () => void>();

  constructor(seed: Record<string, number> = {}) {
    for (const [k, v] of Object.entries(seed)) this.balances.set(k, v);
  }

  private assertUsable(): void {
    if (this.aborted) {
      throw Object.assign(
        new Error(
          "current transaction is aborted, commands ignored until end of transaction block",
        ),
        { code: IN_FAILED_TRANSACTION },
      );
    }
  }

  async lockWallet(userId: string): Promise<number | null> {
    this.assertUsable();
    const prev = this.tail.get(userId) ?? Promise.resolve();
    let releaseMine!: () => void;
    const mine = new Promise<void>((r) => (releaseMine = r));
    this.tail.set(userId, prev.then(() => mine));
    await prev; // wait for any earlier holder to release (serialization)
    this.release.set(userId, releaseMine);
    return this.balances.has(userId) ? this.balances.get(userId)! : null;
  }

  async createWallet(userId: string): Promise<void> {
    this.assertUsable();
    if (!this.balances.has(userId)) this.balances.set(userId, 0);
  }

  async insertTransaction(row: LedgerRow): Promise<void> {
    this.assertUsable();
    if (row.referenceId != null) {
      const key = `${row.type}:${row.referenceId}`;
      if (this.refs.has(key)) {
        // A real unique violation aborts the transaction before it surfaces.
        this.aborted = true;
        this.releaseAll();
        throw new DuplicateLedgerReferenceError(row.type, String(row.referenceId));
      }
      this.refs.add(key);
    }
    this.rows.push({ ...row });
  }

  async setBalance(userId: string, balance: number): Promise<void> {
    this.assertUsable();
    this.balances.set(userId, balance);
    this.release.get(userId)?.(); // end of critical section → next locker proceeds
    this.release.delete(userId);
  }

  /** Drop every held wallet lock (a rollback releases them). */
  private releaseAll(): void {
    for (const release of this.release.values()) release();
    this.release.clear();
  }

  /**
   * Model of `db.transaction()` — and, nested, of a SAVEPOINT: snapshot, run,
   * restore-on-throw, rethrow. Restoring `aborted` is what makes a savepoint
   * around a failing statement leave the outer transaction usable.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const snapBal = new Map(this.balances);
    const snapRows = [...this.rows];
    const snapRefs = new Set(this.refs);
    const snapBookings = [...this.bookings];
    const snapAborted = this.aborted;
    try {
      return await fn();
    } catch (err) {
      this.balances = snapBal;
      this.rows = snapRows;
      this.refs = snapRefs;
      this.bookings = snapBookings;
      this.aborted = snapAborted;
      this.releaseAll();
      throw err;
    }
  }
}
