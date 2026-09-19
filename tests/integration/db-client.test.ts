import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * The app's own database client (`src/db/index.ts`), exactly as shipped.
 *
 * Two regressions from 2026-09-19 that every other integration test missed,
 * because the helpers build their own single-connection client and postgres.js
 * skips its transaction safety check when `max: 1`:
 *
 * 1. `max_pipeline: 0` (PR #100) stopped postgres.js reserving a connection for
 *    `sql.begin`, so every `db.transaction` failed with UNSAFE_TRANSACTION on
 *    production.
 * 2. Before that, default pipelining through the transaction pooler stranded
 *    half-sent queries under a burst of page loads and hung the server.
 *
 * So: a transaction and a savepoint through this client, and a burst of plain
 * queries and transactions side by side that has to finish in bounded time.
 * Reads only; nothing is written.
 */
describe("the app's database client", () => {
  it("runs a transaction and a nested savepoint", async () => {
    const result = await db.transaction(async (tx) => {
      const [outer] = await tx.execute<{ n: number }>(sql`select 1 as n`);
      const inner = await tx.transaction(async (sp) => {
        const [row] = await sp.execute<{ n: number }>(sql`select 2 as n`);
        return Number(row?.n);
      });
      return Number(outer?.n) + inner;
    });
    expect(result).toBe(3);
  });

  it("finishes a burst of queries and transactions without hanging", async () => {
    const started = Date.now();
    const plain = Array.from({ length: 30 }, (_, i) =>
      db.execute<{ n: number }>(sql`select ${i}::int as n`).then((rows) => Number(rows[0]?.n)),
    );
    const transactions = Array.from({ length: 10 }, (_, i) =>
      db.transaction(async (tx) => {
        const [row] = await tx.execute<{ n: number }>(sql`select ${i}::int as n`);
        return Number(row?.n);
      }),
    );
    const results = await Promise.all([...plain, ...transactions]);
    expect(results).toEqual([...Array.from({ length: 30 }, (_, i) => i), ...Array.from({ length: 10 }, (_, i) => i)]);
    // Generous: the point is "finishes", not "fast". A stranded query hangs forever.
    expect(Date.now() - started).toBeLessThan(60_000);
  }, 90_000);
});
