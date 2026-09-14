import { describe, expect, it } from "vitest";
import {
  MAX_REPORTED_MISMATCHES,
  summarizeWalletDrift,
} from "@/lib/wallets/reconcile";

/**
 * Shaping of the `reconcile-wallets` finding (SPEC §12; Phase 8 Part 3). The
 * detection itself is SQL and lives in `tests/integration/reconcile-wallets.test.ts`.
 */
describe("summarizeWalletDrift", () => {
  it("reports no drift when nothing disagrees", () => {
    expect(summarizeWalletDrift(12, [])).toEqual({
      walletsChecked: 12,
      mismatches: 0,
      totalAbsoluteDrift: 0,
      mismatchDetails: [],
      truncated: false,
    });
  });

  it("signs the difference as cached minus ledger, and counts a missing wallet as 0", () => {
    const s = summarizeWalletDrift(3, [
      { userId: "over", cachedBalance: 50, ledgerSum: 45 },
      { userId: "under", cachedBalance: 10, ledgerSum: 12 },
      { userId: "no-wallet", cachedBalance: null, ledgerSum: 30 },
    ]);
    expect(s.mismatches).toBe(3);
    expect(s.totalAbsoluteDrift).toBe(5 + 2 + 30);
    // Largest drift first.
    expect(s.mismatchDetails.map((m) => [m.userId, m.difference])).toEqual([
      ["no-wallet", -30],
      ["over", 5],
      ["under", -2],
    ]);
  });

  it("never reports a row that agrees, whatever produced it", () => {
    const s = summarizeWalletDrift(2, [
      { userId: "fine", cachedBalance: 7, ledgerSum: 7 },
      { userId: "empty", cachedBalance: null, ledgerSum: 0 },
    ]);
    expect(s.mismatches).toBe(0);
    expect(s.mismatchDetails).toEqual([]);
  });

  it("bounds the listed details and says so", () => {
    const rows = Array.from({ length: MAX_REPORTED_MISMATCHES + 5 }, (_, i) => ({
      userId: `u${String(i).padStart(3, "0")}`,
      cachedBalance: i + 1,
      ledgerSum: 0,
    }));
    const s = summarizeWalletDrift(rows.length, rows);
    expect(s.mismatches).toBe(MAX_REPORTED_MISMATCHES + 5);
    expect(s.mismatchDetails).toHaveLength(MAX_REPORTED_MISMATCHES);
    expect(s.truncated).toBe(true);
    expect(s.mismatchDetails[0].difference).toBe(MAX_REPORTED_MISMATCHES + 5);
  });
});
