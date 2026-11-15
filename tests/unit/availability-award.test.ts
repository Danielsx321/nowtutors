import { describe, expect, it } from "vitest";
import {
  FIRST_BONUS_MONTH,
  MONTHS_TO_CHECK,
  runAvailabilityBonus,
  type AvailabilityBonusPort,
  type MonthlyAwardClaim,
  type Qualifier,
} from "@/lib/availability-bonus/award";
import { InMemoryLedger } from "./helpers/in-memory-ledger";

/**
 * The monthly job's money decisions (SPEC §12, §7.5, §7.11;
 * monthly-availability-bonus, 2026-11-15), against the in-memory ledger and an
 * in-memory award table that models the two unique indexes. No Postgres.
 */

const DEC_1 = new Date("2026-12-01T00:20:00Z");
const NOV = "2026-11-01";
const TWENTY_HOURS = 20 * 3600;
const SETTINGS = { enabled: true, minHours: 20, credits: 100 };

class FakePort implements AvailabilityBonusPort {
  ledger = new InMemoryLedger();
  /** tutor -> month -> seconds */
  seconds = new Map<string, Map<string, number>>();
  /** tutor -> month -> weekly credits already paid for weeks starting in it */
  weekly = new Map<string, Map<string, number>>();
  approved = new Set<string>();
  awards = new Map<string, { awardId: string; credits: number; weeklyCreditsDeducted: number }>(); // tutor:month
  audits: Record<string, unknown>[] = [];
  private nextId = 1;

  live(tutorId: string, month: string, secs: number, approved = true) {
    if (!this.seconds.has(tutorId)) this.seconds.set(tutorId, new Map());
    this.seconds.get(tutorId)!.set(month, secs);
    if (approved) this.approved.add(tutorId);
    return this;
  }

  paidWeekly(tutorId: string, month: string, credits: number) {
    if (!this.weekly.has(tutorId)) this.weekly.set(tutorId, new Map());
    this.weekly.get(tutorId)!.set(month, credits);
    return this;
  }

  async listQualifiers(monthStart: string, minSeconds: number): Promise<Qualifier[]> {
    const out: Qualifier[] = [];
    for (const [tutorId, months] of this.seconds) {
      const secs = months.get(monthStart) ?? 0;
      if (!this.approved.has(tutorId)) continue;
      if (secs < minSeconds) continue;
      if (this.awards.has(`${tutorId}:${monthStart}`)) continue;
      out.push({
        tutorId,
        liveSeconds: secs,
        weeklyCreditsInMonth: this.weekly.get(tutorId)?.get(monthStart) ?? 0,
      });
    }
    return out;
  }

  async claimAndCredit<T>(
    award: MonthlyAwardClaim,
    credit: (awardId: string, ex: InMemoryLedger) => Promise<T>,
  ): Promise<T | null> {
    const key = `${award.tutorId}:${award.monthStart}`;
    if (this.awards.has(key)) return null;
    const awardId = `award-${this.nextId++}`;
    return this.ledger.transaction(async () => {
      this.awards.set(key, {
        awardId,
        credits: award.credits,
        weeklyCreditsDeducted: award.weeklyCreditsDeducted,
      });
      try {
        return await credit(awardId, this.ledger);
      } catch (err) {
        this.awards.delete(key);
        throw err;
      }
    });
  }

  async writeRunAudit(payload: Record<string, unknown>) {
    this.audits.push(payload);
  }
}

describe("runAvailabilityBonus (monthly)", () => {
  it("pays 100 credits on 1 Dec to a tutor live 20 hours in November, once", async () => {
    const port = new FakePort().live("tina", NOV, TWENTY_HOURS);
    const r = await runAvailabilityBonus(port, SETTINGS, DEC_1);

    expect(r.monthsChecked).toEqual([NOV]);
    expect(r.awarded).toHaveLength(1);
    expect(r.awarded[0]).toMatchObject({ tutorId: "tina", monthStart: NOV, credits: 100, weeklyCreditsDeducted: 0 });
    expect(r.creditsAwarded).toBe(100);
    expect(port.ledger.balances.get("tina")).toBe(100);
    expect(port.ledger.rows).toHaveLength(1);
    expect(port.ledger.rows[0]).toMatchObject({
      userId: "tina",
      delta: 100,
      type: "availability_bonus",
      referenceType: "availability_bonus",
      referenceId: "award-1",
      description: "Monthly availability bonus, November 2026",
    });
    expect(port.audits).toHaveLength(1);
    expect(port.audits[0]).toMatchObject({ awarded: 1, credits_each: 100, credits_total: 100, months: [NOV] });
  });

  it("takes weekly credits already paid in November off the award: 40 weekly means 60 now", async () => {
    const port = new FakePort().live("tina", NOV, TWENTY_HOURS).paidWeekly("tina", NOV, 40);
    const r = await runAvailabilityBonus(port, SETTINGS, DEC_1);

    expect(r.awarded[0]).toMatchObject({ credits: 60, weeklyCreditsDeducted: 40 });
    expect(r.weeklyDeducted).toBe(40);
    expect(port.ledger.balances.get("tina")).toBe(60);
    expect(port.awards.get(`tina:${NOV}`)).toMatchObject({ credits: 60, weeklyCreditsDeducted: 40 });
  });

  it("settles the month with no credit when weekly credits already cover it, and never goes negative", async () => {
    const port = new FakePort().live("tina", NOV, TWENTY_HOURS).paidWeekly("tina", NOV, 120);
    const r = await runAvailabilityBonus(port, SETTINGS, DEC_1);

    expect(r.awarded).toHaveLength(0);
    expect(r.settledZero).toBe(1);
    expect(port.ledger.rows).toHaveLength(0);
    expect(port.awards.get(`tina:${NOV}`)).toMatchObject({ credits: 0, weeklyCreditsDeducted: 100 });

    const again = await runAvailabilityBonus(port, SETTINGS, DEC_1);
    expect(again.settledZero).toBe(0);
    expect(again.awarded).toHaveLength(0);
  });

  it("a tutor under 20 hours gets nothing new and keeps any weekly credit", async () => {
    const port = new FakePort().live("sam", NOV, TWENTY_HOURS - 1).paidWeekly("sam", NOV, 40);
    port.ledger.balances.set("sam", 40);
    const r = await runAvailabilityBonus(port, SETTINGS, DEC_1);
    expect(r.awarded).toHaveLength(0);
    expect(port.ledger.balances.get("sam")).toBe(40);
  });

  it("a second run of the same month pays nobody again", async () => {
    const port = new FakePort().live("tina", NOV, TWENTY_HOURS);
    await runAvailabilityBonus(port, SETTINGS, DEC_1);
    const again = await runAvailabilityBonus(port, SETTINGS, DEC_1);

    expect(again.awarded).toHaveLength(0);
    expect(port.ledger.balances.get("tina")).toBe(100);
    expect(port.ledger.rows).toHaveLength(1);
  });

  it("never pays a month before November 2026, whatever the look-back says", async () => {
    const port = new FakePort().live("tina", "2026-10-01", 40 * 3600).live("tina", "2026-09-01", 40 * 3600);
    const r = await runAvailabilityBonus(port, SETTINGS, DEC_1);
    expect(FIRST_BONUS_MONTH).toBe(NOV);
    expect(r.monthsChecked).toEqual([NOV]);
    expect(r.awarded).toHaveLength(0);
    expect(port.ledger.rows).toHaveLength(0);
  });

  it("does not pay the month still running", async () => {
    const port = new FakePort().live("tina", NOV, TWENTY_HOURS);
    const r = await runAvailabilityBonus(port, SETTINGS, new Date("2026-11-30T23:59:59Z"));
    expect(r.monthsChecked).toEqual([]);
    expect(r.awarded).toHaveLength(0);
  });

  it("a missed 1 Dec run is paid on 1 Jan, November and December both", async () => {
    const port = new FakePort().live("tina", NOV, TWENTY_HOURS).live("tina", "2026-12-01", TWENTY_HOURS);
    const r = await runAvailabilityBonus(port, SETTINGS, new Date("2027-01-01T00:20:00Z"));
    expect(r.monthsChecked).toEqual([NOV, "2026-12-01"]);
    expect(r.awarded.map((a) => a.monthStart)).toEqual([NOV, "2026-12-01"]);
    expect(port.ledger.balances.get("tina")).toBe(200);
  });

  it("looks back at most three complete months once past the floor", async () => {
    const r = await runAvailabilityBonus(new FakePort(), SETTINGS, new Date("2027-06-01T00:20:00Z"));
    expect(r.monthsChecked).toHaveLength(MONTHS_TO_CHECK);
    expect(r.monthsChecked).toEqual(["2027-03-01", "2027-04-01", "2027-05-01"]);
  });

  it("honours the threshold and amount from settings", async () => {
    const port = new FakePort().live("sam", NOV, 2.5 * 3600);
    const r = await runAvailabilityBonus(port, { ...SETTINGS, minHours: 2.5, credits: 25 }, DEC_1);
    expect(r.awarded).toHaveLength(1);
    expect(port.ledger.balances.get("sam")).toBe(25);
  });

  it("skips an unapproved tutor however many hours they have", async () => {
    const port = new FakePort().live("pending", NOV, 50 * 3600, false);
    const r = await runAvailabilityBonus(port, SETTINGS, DEC_1);
    expect(r.awarded).toHaveLength(0);
  });

  it("does nothing when the bonus is switched off, and says so", async () => {
    const port = new FakePort().live("tina", NOV, TWENTY_HOURS);
    const r = await runAvailabilityBonus(port, { ...SETTINGS, enabled: false }, DEC_1);
    expect(r.disabled).toBe(true);
    expect(r.awarded).toHaveLength(0);
    expect(port.ledger.rows).toHaveLength(0);
    expect(port.audits).toHaveLength(0);
  });

  it("one tutor's failure does not cost the others their bonus", async () => {
    const port = new FakePort().live("bad", NOV, TWENTY_HOURS).live("tina", NOV, TWENTY_HOURS);
    const claim = port.claimAndCredit.bind(port);
    port.claimAndCredit = async (award, credit) => {
      if (award.tutorId === "bad") throw new Error("connection reset");
      return claim(award, credit);
    };
    const r = await runAvailabilityBonus(port, SETTINGS, DEC_1);

    expect(r.failed).toBe(1);
    expect(r.awarded.map((a) => a.tutorId)).toEqual(["tina"]);
    expect(port.ledger.balances.get("tina")).toBe(100);
    expect(port.ledger.balances.has("bad")).toBe(false);
  });

  it("a lost race (award row already there) is counted, not paid", async () => {
    const port = new FakePort().live("tina", NOV, TWENTY_HOURS);
    port.listQualifiers = async (monthStart) =>
      monthStart === NOV ? [{ tutorId: "tina", liveSeconds: TWENTY_HOURS, weeklyCreditsInMonth: 0 }] : [];
    port.awards.set(`tina:${NOV}`, { awardId: "award-x", credits: 100, weeklyCreditsDeducted: 0 });
    const r = await runAvailabilityBonus(port, SETTINGS, DEC_1);

    expect(r.alreadyAwarded).toBe(1);
    expect(r.awarded).toHaveLength(0);
    expect(port.ledger.rows).toHaveLength(0);
  });

  it("a ledger duplicate rolls the award back and is counted", async () => {
    const port = new FakePort().live("tina", NOV, TWENTY_HOURS);
    await port.ledger.transaction(async () => {
      await port.ledger.createWallet("tina");
      await port.ledger.lockWallet("tina");
      await port.ledger.insertTransaction({
        userId: "tina",
        delta: 100,
        balanceAfter: 100,
        type: "availability_bonus",
        referenceType: "availability_bonus",
        referenceId: "award-1",
      });
      await port.ledger.setBalance("tina", 100);
    });
    const r = await runAvailabilityBonus(port, SETTINGS, DEC_1);

    expect(r.duplicateLedger).toBe(1);
    expect(r.awarded).toHaveLength(0);
    expect(port.awards.has(`tina:${NOV}`)).toBe(false);
    expect(port.ledger.balances.get("tina")).toBe(100);
  });
});
