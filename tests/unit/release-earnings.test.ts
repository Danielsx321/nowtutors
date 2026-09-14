import { describe, it, expect } from "vitest";
import {
  runReleaseEarningsSweep,
  CorruptSplitError,
  type ReleaseEarningsPort,
} from "@/lib/earnings/release-earnings";
import type { ClaimedEarning } from "@/db/queries/release-earnings";
import type { LedgerExecutor } from "@/lib/credits/ledger";
import { InMemoryLedger } from "./helpers/in-memory-ledger";

/**
 * The money path of `release-earnings` (SPEC §7.11, §12), driven through the
 * {@link ReleaseEarningsPort} seam against the shared in-memory
 * {@link InMemoryLedger} — no Postgres, the same adapter pattern
 * `lib/credits/ledger.ts` already uses.
 *
 * **Every expected number here is pinned literally, and the fixtures are chosen
 * so they can tell the rules apart.** Phase 6 Part 3C shipped a break that
 * failed no tests because its fixtures agreed with themselves under either
 * rounding rule (docs/DECISIONS.md, "Break (e) proved nothing"). The two traps
 * that applies to here:
 *
 *  - **gross ≠ net on every fixture**, and by a margin no other number in the
 *    test equals, so "credit `gross_credits`" cannot pass;
 *  - **one fixture's stored split does not match today's `platform_fee_percent`**
 *    (100 gross / 10 fee / 90 net is a 10% split, where 25% would give 75). A
 *    sweep that recomputed the split instead of reading the row would credit 75
 *    and fail. A fixture that happened to agree with `splitEarnings` could not
 *    detect that at all.
 *
 * What is deliberately NOT covered here: the atomicity of the claim. "Exactly
 * one of two overlapping runs credits the row" is a property of how Postgres
 * re-evaluates a blocked `UPDATE`, and no in-memory fake can prove it — that is
 * `tests/integration/release-earnings.test.ts`.
 */

interface FakeRow {
  id: string;
  tutorId: string;
  bookingId: string;
  grossCredits: number;
  platformFeeCredits: number;
  netCredits: number;
  status: "held" | "available";
  /** Minutes relative to "now": negative is due, positive is not yet. */
  dueOffsetMinutes: number;
}

/**
 * A {@link ReleaseEarningsPort} over an {@link InMemoryLedger}.
 *
 * It models the two database behaviours the sweep leans on and nothing else:
 * the claim only matches a row that is still `held` AND already due, and a
 * throw from `credit` rolls the status flip back with it. The second one is the
 * whole reason the flip and the credit share a transaction, so a fake that
 * "helpfully" left the row flipped would make the corrupt-row tests below
 * assert the opposite of the shipped behaviour.
 */
class FakePort implements ReleaseEarningsPort {
  readonly ledger: InMemoryLedger;
  readonly rows = new Map<string, FakeRow>();
  /** Ids the claim should pretend another run took first. */
  stolen = new Set<string>();
  claimAttempts: string[] = [];

  constructor(rows: FakeRow[], balances: Record<string, number> = {}) {
    this.ledger = new InMemoryLedger(balances);
    for (const row of rows) this.rows.set(row.id, { ...row });
  }

  async listDueEarningIds(): Promise<string[]> {
    return [...this.rows.values()]
      .filter((r) => r.status === "held" && r.dueOffsetMinutes <= 0)
      .sort((a, b) => a.dueOffsetMinutes - b.dueOffsetMinutes)
      .map((r) => r.id);
  }

  async claimAndCreditEarning<T>(
    earningId: string,
    credit: (row: ClaimedEarning, ex: LedgerExecutor) => Promise<T>,
  ): Promise<T | null> {
    this.claimAttempts.push(earningId);
    const row = this.rows.get(earningId);
    // The claim restates both qualifiers, exactly as the shipped UPDATE does.
    if (!row || row.status !== "held" || row.dueOffsetMinutes > 0) return null;
    if (this.stolen.has(earningId)) return null;

    row.status = "available";
    try {
      return await this.ledger.transaction(() =>
        credit(
          {
            id: row.id,
            tutorId: row.tutorId,
            bookingId: row.bookingId,
            grossCredits: row.grossCredits,
            platformFeeCredits: row.platformFeeCredits,
            netCredits: row.netCredits,
          },
          this.ledger,
        ),
      );
    } catch (err) {
      row.status = "held"; // one transaction: the flip rolls back too
      throw err;
    }
  }
}

/** 50 gross, 25% floor → 12 fee, 38 net. Due an hour ago. */
const due = (over: Partial<FakeRow> = {}): FakeRow => ({
  id: "e1",
  tutorId: "tutor-a",
  bookingId: "book-1",
  grossCredits: 50,
  platformFeeCredits: 12,
  netCredits: 38,
  status: "held",
  dueOffsetMinutes: -60,
  ...over,
});

describe("release-earnings — what the tutor is credited", () => {
  it("credits net_credits, NOT gross_credits", async () => {
    const port = new FakePort([due()], { "tutor-a": 100 });

    const result = await runReleaseEarningsSweep(port);

    // 100 + 38 = 138. NOT 150 (gross), NOT 112 (fee).
    expect(port.ledger.balances.get("tutor-a")).toBe(138);
    expect(result.creditsReleased).toBe(38);
    expect(port.ledger.rows).toHaveLength(1);
    expect(port.ledger.rows[0].delta).toBe(38);
    expect(port.ledger.rows[0].balanceAfter).toBe(138);
  });

  it("credits the STORED net even when it disagrees with today's fee percent", async () => {
    // A 10% split: 100 gross / 10 fee / 90 net. Today's platform_fee_percent is
    // 25, which would make this 75 net. The row was priced when it completed
    // and its numbers are not up for renegotiation (§7.11).
    const port = new FakePort(
      [due({ grossCredits: 100, platformFeeCredits: 10, netCredits: 90 })],
      { "tutor-a": 0 },
    );

    const result = await runReleaseEarningsSweep(port);

    // 90 — NOT 75 (recomputed at 25%), NOT 100 (gross).
    expect(port.ledger.balances.get("tutor-a")).toBe(90);
    expect(result.creditsReleased).toBe(90);
  });

  it("writes one session_earning referencing the booking, and flips the row", async () => {
    const port = new FakePort([due()], { "tutor-a": 0 });

    const result = await runReleaseEarningsSweep(port);

    expect(port.ledger.rows).toHaveLength(1);
    expect(port.ledger.rows[0]).toMatchObject({
      userId: "tutor-a",
      delta: 38,
      type: "session_earning",
      referenceType: "booking",
      referenceId: "book-1",
    });
    expect(port.rows.get("e1")!.status).toBe("available");
    expect(result.releasedIds).toEqual(["e1"]);
  });

  it("opens a wallet for a tutor who has never had one", async () => {
    const port = new FakePort([due()]); // no wallet row at all

    await runReleaseEarningsSweep(port);

    expect(port.ledger.balances.get("tutor-a")).toBe(38);
  });

  it("sums creditsReleased across rows", async () => {
    const port = new FakePort(
      [
        due({ id: "e1", bookingId: "book-1" }), // 38
        due({
          id: "e2",
          bookingId: "book-2",
          grossCredits: 30,
          platformFeeCredits: 7,
          netCredits: 23,
        }),
        due({
          id: "e3",
          bookingId: "book-3",
          tutorId: "tutor-b",
          grossCredits: 100,
          platformFeeCredits: 25,
          netCredits: 75,
        }),
      ],
      { "tutor-a": 0, "tutor-b": 0 },
    );

    const result = await runReleaseEarningsSweep(port);

    expect(result.releasedIds).toEqual(["e1", "e2", "e3"]);
    // 38 + 23 + 75 = 136, pinned literally.
    expect(result.creditsReleased).toBe(136);
    expect(port.ledger.balances.get("tutor-a")).toBe(61); // 38 + 23
    expect(port.ledger.balances.get("tutor-b")).toBe(75);
  });
});

describe("release-earnings — a row that is not due", () => {
  it("is never claimed and never credited", async () => {
    const port = new FakePort([due({ dueOffsetMinutes: 60 })], {
      "tutor-a": 100,
    });

    const result = await runReleaseEarningsSweep(port);

    expect(result.releasedIds).toEqual([]);
    expect(result.creditsReleased).toBe(0);
    expect(port.claimAttempts).toEqual([]);
    expect(port.ledger.rows).toHaveLength(0);
    expect(port.ledger.balances.get("tutor-a")).toBe(100);
    expect(port.rows.get("e1")!.status).toBe("held");
  });

  it("is left held while a due row beside it is released", async () => {
    const port = new FakePort(
      [
        due({ id: "e1", bookingId: "book-1" }),
        due({ id: "e2", bookingId: "book-2", dueOffsetMinutes: 120 }),
      ],
      { "tutor-a": 0 },
    );

    const result = await runReleaseEarningsSweep(port);

    expect(result.releasedIds).toEqual(["e1"]);
    expect(port.rows.get("e2")!.status).toBe("held");
    expect(port.ledger.balances.get("tutor-a")).toBe(38); // not 76
  });
});

describe("release-earnings — a corrupt split is skipped, never repaired", () => {
  // 100 gross, 10 fee, 80 net → 90 != 100. Neither number can be trusted.
  const corrupt = () =>
    due({ grossCredits: 100, platformFeeCredits: 10, netCredits: 80 });

  it("pays nothing and leaves the row held", async () => {
    const port = new FakePort([corrupt()], { "tutor-a": 100 });

    const result = await runReleaseEarningsSweep(port);

    expect(result.corruptSplitIds).toEqual(["e1"]);
    expect(result.releasedIds).toEqual([]);
    expect(result.creditsReleased).toBe(0);
    // Nothing was paid on any of the three numbers: not 80, not 90, not 100.
    expect(port.ledger.balances.get("tutor-a")).toBe(100);
    expect(port.ledger.rows).toHaveLength(0);
    // Still held — the flip rolled back with the refusal, so the row stays
    // visible and recoverable rather than being marked paid with no money.
    expect(port.rows.get("e1")!.status).toBe("held");
  });

  it("does not stop the batch — every other tutor is still paid", async () => {
    const port = new FakePort(
      [
        due({ id: "e1", bookingId: "book-1" }),
        {
          ...corrupt(),
          id: "e2",
          bookingId: "book-2",
          tutorId: "tutor-b",
          dueOffsetMinutes: -50,
        },
        due({ id: "e3", bookingId: "book-3", tutorId: "tutor-c", dueOffsetMinutes: -40 }),
      ],
      { "tutor-a": 0, "tutor-b": 0, "tutor-c": 0 },
    );

    const result = await runReleaseEarningsSweep(port);

    expect(result.releasedIds).toEqual(["e1", "e3"]);
    expect(result.corruptSplitIds).toEqual(["e2"]);
    expect(result.creditsReleased).toBe(76); // 38 + 38, not 156
    expect(port.ledger.balances.get("tutor-a")).toBe(38);
    expect(port.ledger.balances.get("tutor-b")).toBe(0);
    expect(port.ledger.balances.get("tutor-c")).toBe(38);
  });

  it("throws CorruptSplitError naming all three numbers", async () => {
    const err = new CorruptSplitError({
      id: "e9",
      tutorId: "t",
      bookingId: "b",
      grossCredits: 100,
      platformFeeCredits: 10,
      netCredits: 80,
    });
    expect(err.code).toBe("corrupt_split");
    expect(err.message).toContain("net 80");
    expect(err.message).toContain("fee 10");
    expect(err.message).toContain("gross 100");
  });
});

describe("release-earnings — idempotency", () => {
  it("a second run releases nothing and credits nothing", async () => {
    const port = new FakePort([due()], { "tutor-a": 0 });

    const first = await runReleaseEarningsSweep(port);
    const second = await runReleaseEarningsSweep(port);

    expect(first.creditsReleased).toBe(38);
    expect(second.releasedIds).toEqual([]);
    expect(second.creditsReleased).toBe(0);
    // The balance moved exactly once.
    expect(port.ledger.balances.get("tutor-a")).toBe(38);
    expect(port.ledger.rows).toHaveLength(1);
  });

  it("a claim another run won is counted, not credited", async () => {
    const port = new FakePort([due()], { "tutor-a": 100 });
    port.stolen.add("e1");

    const result = await runReleaseEarningsSweep(port);

    expect(result.notClaimedIds).toEqual(["e1"]);
    expect(result.releasedIds).toEqual([]);
    expect(result.creditsReleased).toBe(0);
    expect(port.ledger.balances.get("tutor-a")).toBe(100);
    expect(port.ledger.rows).toHaveLength(0);
  });

  it("a booking already carrying a session_earning is refused and left held", async () => {
    const port = new FakePort([due()], { "tutor-a": 100 });
    // The ledger already holds a session_earning for this booking — the state a
    // half-completed earlier attempt would leave behind.
    await port.ledger.insertTransaction({
      userId: "tutor-a",
      delta: 38,
      balanceAfter: 138,
      type: "session_earning",
      referenceType: "booking",
      referenceId: "book-1",
    });

    const result = await runReleaseEarningsSweep(port);

    expect(result.duplicateLedgerIds).toEqual(["e1"]);
    expect(result.releasedIds).toEqual([]);
    expect(result.creditsReleased).toBe(0);
    // Not paid twice: still one ledger row, balance untouched by this run.
    expect(port.ledger.rows).toHaveLength(1);
    expect(port.ledger.balances.get("tutor-a")).toBe(100);
    expect(port.rows.get("e1")!.status).toBe("held");
  });
});

describe("release-earnings — an unexpected failure", () => {
  it("is counted and the batch continues", async () => {
    const port = new FakePort(
      [
        due({ id: "e1", bookingId: "book-1" }),
        due({ id: "e2", bookingId: "book-2", dueOffsetMinutes: -50 }),
      ],
      { "tutor-a": 0 },
    );
    const claim = port.claimAndCreditEarning.bind(port);
    port.claimAndCreditEarning = async (id, credit) => {
      if (id === "e1") throw new Error("connection reset");
      return claim(id, credit);
    };

    const result = await runReleaseEarningsSweep(port);

    expect(result.failedIds).toEqual(["e1"]);
    expect(result.releasedIds).toEqual(["e2"]);
    expect(result.creditsReleased).toBe(38);
    expect(port.ledger.balances.get("tutor-a")).toBe(38);
  });
});
