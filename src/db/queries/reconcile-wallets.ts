import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { WalletDriftRow } from "@/lib/wallets/reconcile";

/**
 * The one read behind `reconcile-wallets` (SPEC §12; Phase 8 Part 3).
 *
 * **A FULL OUTER JOIN, because drift has two shapes.** A wallet whose cached
 * balance disagrees with its ledger sum, and ledger rows for a user with no
 * wallet row at all. An inner join would miss the second, and a left join from
 * `wallets` would too. A missing wallet counts as a balance of 0, so a user with
 * no wallet and a ledger that nets to zero is not drift.
 *
 * One statement, so the count and the mismatches describe the same snapshot.
 * Read-only: nothing here writes, and nothing calls `lib/credits/ledger.ts`.
 */
export async function readWalletDrift(): Promise<{
  walletsChecked: number;
  rows: WalletDriftRow[];
}> {
  const result = await db.execute<{
    checked: number;
    mismatches: { userId: string; cachedBalance: number | null; ledgerSum: number | string }[];
  }>(sql`
    with ledger as (
      select user_id, sum(delta)::bigint as ledger_sum
        from credit_transactions
       group by user_id
    ),
    joined as (
      select coalesce(w.user_id, l.user_id) as user_id,
             w.credit_balance as cached_balance,
             coalesce(l.ledger_sum, 0) as ledger_sum
        from wallets w
        full outer join ledger l on l.user_id = w.user_id
    )
    select count(*)::int as checked,
           coalesce(
             json_agg(
               json_build_object(
                 'userId', user_id,
                 'cachedBalance', cached_balance,
                 'ledgerSum', ledger_sum
               ) order by user_id
             ) filter (where coalesce(cached_balance, 0) <> ledger_sum),
             '[]'::json
           ) as mismatches
      from joined
  `);

  const [row] = Array.from(result);
  return {
    walletsChecked: Number(row?.checked ?? 0),
    rows: (row?.mismatches ?? []).map((m) => ({
      userId: m.userId,
      cachedBalance: m.cachedBalance === null ? null : Number(m.cachedBalance),
      ledgerSum: Number(m.ledgerSum),
    })),
  };
}
