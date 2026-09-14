import type { SQL } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  beginTransaction,
  createFixtureBooking,
  createFixtureEarning,
  deleteFixtureBooking,
  openConnection,
  readEarningById,
  readSessionEarningLedger,
  readWalletBalance,
  resetEarningsFixture,
  waitUntilBlockedBy,
  withExecutor,
  type FixtureBooking,
  type TestConnection,
} from "./helpers/test-db";

/**
 * `release-earnings` against a real Postgres (SPEC §12, §7.11).
 *
 * **Why this cannot be a unit test.** The claim's exactly-once property is not a
 * property of the TypeScript around it — it is a property of how Postgres
 * re-evaluates a blocked `UPDATE` under READ COMMITTED. The second writer's
 * qualifiers are re-run against the *updated* row once the lock clears, sees
 * `status = 'available'`, and matches zero rows. No fake, no in-memory store and
 * no mocked driver reproduces that, and the money consequence of getting it
 * wrong is a tutor paid twice.
 *
 * **The concurrent case is a genuine contest, not two awaited calls.**
 * Connection A claims the row and holds its transaction open; connection B
 * issues its claim against the same row and *blocks*; Postgres itself is asked
 * to confirm the block (`pg_blocking_pids`) before anything is asserted. Two
 * sequential awaits would pass against a `SELECT`-then-`UPDATE` implementation,
 * which is precisely what this file exists to rule out.
 *
 * **`@/db` is mocked to forward to the current transaction**, including
 * `transaction()` itself — the shipped `claimAndCreditEarning` opens one, and
 * forwarding it to the held transaction makes it a SAVEPOINT inside. The row
 * lock still belongs to the outer transaction and is held until it commits,
 * which is what lets B block on A. The shipped signature is not widened for the
 * test; what runs below is the shipped statement.
 *
 * Reads that verify a write go through this file's own separate connections, so
 * nothing is confirmed by the path that produced it.
 */
type Executor = import("@/db").DbTransaction;

vi.mock("@/db", async () => {
  const { currentExecutor } = await import("./helpers/test-db");
  return {
    db: {
      execute: (query: SQL) => currentExecutor().execute(query),
      select: ((...args: Parameters<Executor["select"]>) =>
        currentExecutor().select(...args)) as Executor["select"],
      update: ((table: Parameters<Executor["update"]>[0]) =>
        currentExecutor().update(table)) as Executor["update"],
      insert: ((table: Parameters<Executor["insert"]>[0]) =>
        currentExecutor().insert(table)) as Executor["insert"],
      // The claim opens its own transaction. Forwarded to the held one, it
      // becomes a savepoint — the outer transaction keeps the row lock, which
      // is the whole mechanism the concurrent test depends on.
      transaction: ((fn: Parameters<Executor["transaction"]>[0]) =>
        currentExecutor().transaction(fn)) as Executor["transaction"],
    },
  };
});

const { claimAndCreditEarning, listDueEarningIds } = await import(
  "@/db/queries/release-earnings"
);
const { runReleaseEarningsSweep, CorruptSplitError } = await import(
  "@/lib/earnings/release-earnings"
);

let alpha: TestConnection;
let beta: TestConnection;
let watcher: TestConnection;
let booking: FixtureBooking;
let previousBalance: number | null;

beforeAll(() => {
  alpha = openConnection("alpha");
  beta = openConnection("beta");
  watcher = openConnection("watcher");
});

afterAll(async () => {
  await Promise.all([alpha.end(), beta.end(), watcher.end()]);
});

beforeEach(async () => {
  booking = await createFixtureBooking(alpha, {
    startedMinutesAgo: 90,
    status: "completed",
  });
  previousBalance = await readWalletBalance(watcher, booking.tutorId);
});

afterEach(async () => {
  await resetEarningsFixture(watcher, {
    bookingId: booking.bookingId,
    tutorId: booking.tutorId,
    previousBalance,
  });
  await deleteFixtureBooking(alpha, booking.bookingId);
});

/** Run the shipped sweep bound to one connection's transaction. */
async function sweepOn(conn: TestConnection) {
  const held = await beginTransaction(conn);
  try {
    const result = await withExecutor(held.tx, () =>
      runReleaseEarningsSweep({ listDueEarningIds, claimAndCreditEarning }),
    );
    await held.commit();
    return result;
  } catch (err) {
    await held.rollback();
    throw err;
  }
}

describe("the claim is atomic — two overlapping runs, one credit", () => {
  it("the second claim blocks, then matches zero rows and credits nothing", async () => {
    // 50 gross / 12 fee / 38 net, due an hour ago. 38 is pinned literally
    // everywhere below: it is neither the gross nor the fee, so a sweep
    // crediting the wrong column cannot produce it.
    const earningId = await createFixtureEarning(alpha, {
      bookingId: booking.bookingId,
      tutorId: booking.tutorId,
      grossCredits: 50,
      platformFeeCredits: 12,
      netCredits: 38,
      availableMinutesAgo: 60,
    });

    const a = await beginTransaction(alpha);
    const b = await beginTransaction(beta);

    // A claims and credits, and holds the transaction open.
    const claimedByA = await withExecutor(a.tx, () =>
      claimAndCreditEarning(earningId, async (row) => row.netCredits),
    );
    expect(claimedByA).toBe(38);

    // B issues the same claim. It must BLOCK on A's row lock — not return.
    let bSettled = false;
    const claimedByB = withExecutor(b.tx, () =>
      claimAndCreditEarning(earningId, async (row) => row.netCredits),
    ).then((value) => {
      bSettled = true;
      return value;
    });

    await waitUntilBlockedBy(watcher, b.pid, a.pid);
    expect(bSettled).toBe(false);

    await a.commit();

    // Lock released: B's UPDATE re-evaluates against the committed row, sees
    // `status = 'available'`, and matches nothing.
    expect(await claimedByB).toBeNull();
    await b.commit();

    const row = await readEarningById(watcher, earningId);
    expect(row!.status).toBe("available");
  });

  it("credits the tutor exactly once across the contest", async () => {
    const earningId = await createFixtureEarning(alpha, {
      bookingId: booking.bookingId,
      tutorId: booking.tutorId,
      grossCredits: 50,
      platformFeeCredits: 12,
      netCredits: 38,
      availableMinutesAgo: 60,
    });
    const startingBalance = previousBalance ?? 0;

    const a = await beginTransaction(alpha);
    const b = await beginTransaction(beta);

    const sweepA = withExecutor(a.tx, () =>
      runReleaseEarningsSweep({ listDueEarningIds, claimAndCreditEarning }),
    );
    const resultA = await sweepA;

    const sweepB = withExecutor(b.tx, () =>
      runReleaseEarningsSweep({ listDueEarningIds, claimAndCreditEarning }),
    );
    await waitUntilBlockedBy(watcher, b.pid, a.pid);
    await a.commit();
    const resultB = await sweepB;
    await b.commit();

    expect(resultA.releasedIds).toContain(earningId);
    expect(resultB.releasedIds).not.toContain(earningId);
    expect(resultB.notClaimedIds).toContain(earningId);

    // ONE ledger row, and the balance moved by 38 exactly once.
    const ledger = await readSessionEarningLedger(watcher, booking.bookingId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].delta).toBe(38);
    expect(ledger[0].referenceType).toBe("booking");
    expect(await readWalletBalance(watcher, booking.tutorId)).toBe(
      startingBalance + 38,
    );
  });
});

describe("the claim's own predicate", () => {
  it("refuses a row that is not yet due, on the UPDATE and not only the listing", async () => {
    // Claimed BY ID, bypassing `listDueEarningIds` entirely. If the
    // `available_at <= now()` qualifier lived only in the listing read, this
    // would pay a tutor before the hold expired and no listing-level test could
    // see it.
    const earningId = await createFixtureEarning(alpha, {
      bookingId: booking.bookingId,
      tutorId: booking.tutorId,
      availableMinutesAgo: -120, // due in two hours
    });

    const held = await beginTransaction(alpha);
    const claimed = await withExecutor(held.tx, () =>
      claimAndCreditEarning(earningId, async (row) => row.netCredits),
    );
    await held.commit();

    expect(claimed).toBeNull();
    expect((await readEarningById(watcher, earningId))!.status).toBe("held");
    expect(await readSessionEarningLedger(watcher, booking.bookingId)).toHaveLength(0);
  });

  it("refuses a row with a NULL available_at", async () => {
    // `NULL <= now()` is NULL, not true. A row with no release date must never
    // release — the fail-safe direction.
    const earningId = await createFixtureEarning(alpha, {
      bookingId: booking.bookingId,
      tutorId: booking.tutorId,
      availableMinutesAgo: null,
    });

    const held = await beginTransaction(alpha);
    const claimed = await withExecutor(held.tx, () =>
      claimAndCreditEarning(earningId, async (row) => row.netCredits),
    );
    await held.commit();

    expect(claimed).toBeNull();
    expect((await readEarningById(watcher, earningId))!.status).toBe("held");
  });

  it("refuses a row that is already available", async () => {
    const earningId = await createFixtureEarning(alpha, {
      bookingId: booking.bookingId,
      tutorId: booking.tutorId,
      status: "available",
    });

    const held = await beginTransaction(alpha);
    const claimed = await withExecutor(held.tx, () =>
      claimAndCreditEarning(earningId, async (row) => row.netCredits),
    );
    await held.commit();

    expect(claimed).toBeNull();
    expect(await readSessionEarningLedger(watcher, booking.bookingId)).toHaveLength(0);
  });

  it("does not list a row that is not yet due", async () => {
    const earningId = await createFixtureEarning(alpha, {
      bookingId: booking.bookingId,
      tutorId: booking.tutorId,
      availableMinutesAgo: -120,
    });

    const held = await beginTransaction(alpha);
    const ids = await withExecutor(held.tx, () => listDueEarningIds());
    await held.commit();

    expect(ids).not.toContain(earningId);
  });
});

describe("what the sweep writes", () => {
  it("flips to available and credits net_credits in one pass", async () => {
    const earningId = await createFixtureEarning(alpha, {
      bookingId: booking.bookingId,
      tutorId: booking.tutorId,
      grossCredits: 50,
      platformFeeCredits: 12,
      netCredits: 38,
    });
    const startingBalance = previousBalance ?? 0;

    const result = await sweepOn(alpha);

    expect(result.releasedIds).toContain(earningId);
    expect((await readEarningById(watcher, earningId))!.status).toBe("available");

    const ledger = await readSessionEarningLedger(watcher, booking.bookingId);
    expect(ledger).toHaveLength(1);
    // 38 — NOT 50 (gross), NOT 12 (fee).
    expect(ledger[0].delta).toBe(38);
    expect(ledger[0].userId).toBe(booking.tutorId);
    expect(ledger[0].balanceAfter).toBe(startingBalance + 38);
    expect(await readWalletBalance(watcher, booking.tutorId)).toBe(
      startingBalance + 38,
    );
  });

  it("credits the stored net even when it disagrees with today's fee percent", async () => {
    // A 10% split: 100 / 10 / 90, where `platform_fee_percent = 25` would give
    // 75. The row was priced at completion and is not re-priced here (§7.11).
    const earningId = await createFixtureEarning(alpha, {
      bookingId: booking.bookingId,
      tutorId: booking.tutorId,
      grossCredits: 100,
      platformFeeCredits: 10,
      netCredits: 90,
    });
    const startingBalance = previousBalance ?? 0;

    await sweepOn(alpha);

    const ledger = await readSessionEarningLedger(watcher, booking.bookingId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].delta).toBe(90); // not 75, not 100
    expect(await readWalletBalance(watcher, booking.tutorId)).toBe(
      startingBalance + 90,
    );
    expect((await readEarningById(watcher, earningId))!.status).toBe("available");
  });

  it("a second run over the same row releases and credits nothing", async () => {
    const earningId = await createFixtureEarning(alpha, {
      bookingId: booking.bookingId,
      tutorId: booking.tutorId,
    });
    const startingBalance = previousBalance ?? 0;

    const first = await sweepOn(alpha);
    const second = await sweepOn(alpha);

    expect(first.releasedIds).toContain(earningId);
    expect(second.releasedIds).not.toContain(earningId);
    expect(await readSessionEarningLedger(watcher, booking.bookingId)).toHaveLength(1);
    expect(await readWalletBalance(watcher, booking.tutorId)).toBe(
      startingBalance + 38,
    );
  });
});

describe("a corrupt split", () => {
  it("rolls the flip back with the refusal — still held, nothing paid", async () => {
    // 100 gross / 10 fee / 80 net → 90 != 100. Not repairable from here.
    const earningId = await createFixtureEarning(alpha, {
      bookingId: booking.bookingId,
      tutorId: booking.tutorId,
      grossCredits: 100,
      platformFeeCredits: 10,
      netCredits: 80,
    });
    const startingBalance = previousBalance ?? 0;

    const result = await sweepOn(alpha);

    expect(result.corruptSplitIds).toContain(earningId);
    expect(result.releasedIds).not.toContain(earningId);
    // The status flip and the refusal share a transaction, so the row is still
    // claimable by a later run once a person has fixed the numbers.
    expect((await readEarningById(watcher, earningId))!.status).toBe("held");
    expect(await readSessionEarningLedger(watcher, booking.bookingId)).toHaveLength(0);
    expect(await readWalletBalance(watcher, booking.tutorId)).toBe(
      previousBalance === null ? null : startingBalance,
    );
  });

  it("is a CorruptSplitError, not a generic failure", async () => {
    const earningId = await createFixtureEarning(alpha, {
      bookingId: booking.bookingId,
      tutorId: booking.tutorId,
      grossCredits: 100,
      platformFeeCredits: 10,
      netCredits: 80,
    });

    const held = await beginTransaction(alpha);
    await expect(
      withExecutor(held.tx, () =>
        claimAndCreditEarning(earningId, async (row) => {
          if (row.netCredits + row.platformFeeCredits !== row.grossCredits) {
            throw new CorruptSplitError(row);
          }
          return row.netCredits;
        }),
      ),
    ).rejects.toBeInstanceOf(CorruptSplitError);
    await held.rollback();
  });
});
