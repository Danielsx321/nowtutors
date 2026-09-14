import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  beginTransaction,
  openConnection,
  withExecutor,
  type TestConnection,
} from "./helpers/test-db";

/**
 * `reconcile-wallets` against a real Postgres (SPEC §4.4, §12; Phase 8 Part 3).
 * Test project only.
 *
 * **Every deliberate drift is written inside a transaction that is rolled
 * back.** The shipped read runs in that same transaction (so it sees the
 * drift), and the rollback leaves nothing behind. A committed fixture here would
 * be exactly the drift this alarm exists to catch, left on a shared project.
 *
 * The first test is Phase 8's acceptance half (§16): zero drift on the seeded
 * data as it stands. If it fails, that is a real finding on the test project,
 * not a flaky test.
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
      transaction: ((fn: Parameters<Executor["transaction"]>[0]) =>
        currentExecutor().transaction(fn)) as Executor["transaction"],
    },
  };
});

const { readWalletDrift } = await import("@/db/queries/reconcile-wallets");

let conn: TestConnection;

beforeAll(() => {
  conn = openConnection("reconcile");
});

afterAll(async () => {
  await conn.end();
});

/** Run `fn` in a transaction that is ALWAYS rolled back. */
async function rolledBack<T>(
  fn: (tx: Executor) => Promise<T>,
): Promise<T> {
  const held = await beginTransaction(conn);
  try {
    return await withExecutor(held.tx, () => fn(held.tx));
  } finally {
    await held.rollback();
  }
}

async function userWithWallet(tx: Executor, role: "tutor" | "student") {
  const [row] = await tx.execute<{ id: string }>(sql`
    select p.id from profiles p join wallets w on w.user_id = p.id
     where p.role = ${role} order by p.created_at limit 1
  `);
  if (!row) {
    throw new Error(`No seeded ${role} with a wallet. Run \`pnpm db:seed:test\` first.`);
  }
  return row.id;
}

describe("readWalletDrift", () => {
  it("finds zero drift on the test project's data as it stands", async () => {
    const result = await rolledBack(() => readWalletDrift());
    expect(result.walletsChecked).toBeGreaterThan(0);
    expect(result.rows).toEqual([]);
  });

  it("reports a wallet whose cached balance disagrees with its ledger", async () => {
    await rolledBack(async (tx) => {
      const userId = await userWithWallet(tx, "tutor");
      await tx.execute(sql`
        update wallets set credit_balance = credit_balance + 7 where user_id = ${userId}
      `);
      const { rows } = await readWalletDrift();
      const row = rows.find((r) => r.userId === userId);
      expect(row).toBeDefined();
      expect(row!.cachedBalance! - row!.ledgerSum).toBe(7);
      expect(rows).toHaveLength(1);
    });
  });

  it("reports ledger rows for a user with no wallet row at all", async () => {
    await rolledBack(async (tx) => {
      const userId = await userWithWallet(tx, "student");
      await tx.execute(sql`delete from wallets where user_id = ${userId}`);
      await tx.execute(sql`
        insert into credit_transactions (user_id, delta, balance_after, type, description)
        values (${userId}, 3, 3, 'admin_adjustment', 'reconcile DB lane (rolled back)')
      `);
      const { rows } = await readWalletDrift();
      const row = rows.find((r) => r.userId === userId);
      expect(row).toMatchObject({ userId, cachedBalance: null });
      expect(row!.ledgerSum).not.toBe(0);
    });
  });
});
