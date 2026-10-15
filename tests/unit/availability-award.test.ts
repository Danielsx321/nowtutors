import { describe, expect, it } from "vitest";
import {
  runAvailabilityBonus,
  WEEKS_TO_CHECK,
  type AvailabilityBonusPort,
  type Qualifier,
} from "@/lib/availability-bonus/award";
import { InMemoryLedger } from "./helpers/in-memory-ledger";

/**
 * The Monday job's money decisions (SPEC §12, §7.5, §7.11; availability-bonus),
 * against the in-memory ledger and an in-memory award table that models the
 * two unique indexes. No Postgres.
 */

const MONDAY = new Date("2026-10-19T00:20:00Z");
const LAST_WEEK = "2026-10-12";
const FIVE_HOURS = 5 * 3600;
const SETTINGS = { enabled: true, minHours: 5, credits: 40 };

class FakePort implements AvailabilityBonusPort {
  ledger = new InMemoryLedger();
  /** tutor -> week -> seconds */
  seconds = new Map<string, Map<string, number>>();
  approved = new Set<string>();
  awards = new Map<string, { awardId: string; credits: number }>(); // key tutor:week
  audits: Record<string, unknown>[] = [];
  private nextId = 1;

  live(tutorId: string, week: string, secs: number, approved = true) {
    if (!this.seconds.has(tutorId)) this.seconds.set(tutorId, new Map());
    this.seconds.get(tutorId)!.set(week, secs);
    if (approved) this.approved.add(tutorId);
    return this;
  }

  async listQualifiers(weekStart: string, minSeconds: number): Promise<Qualifier[]> {
    const out: Qualifier[] = [];
    for (const [tutorId, weeks] of this.seconds) {
      const secs = weeks.get(weekStart) ?? 0;
      if (!this.approved.has(tutorId)) continue;
      if (secs < minSeconds) continue;
      if (this.awards.has(`${tutorId}:${weekStart}`)) continue;
      out.push({ tutorId, liveSeconds: secs });
    }
    return out;
  }

  async claimAndCredit<T>(
    award: { tutorId: string; weekStart: string; liveSeconds: number; credits: number },
    credit: (awardId: string, ex: InMemoryLedger) => Promise<T>,
  ): Promise<T | null> {
    const key = `${award.tutorId}:${award.weekStart}`;
    if (this.awards.has(key)) return null;
    const awardId = `award-${this.nextId++}`;
    return this.ledger.transaction(async () => {
      this.awards.set(key, { awardId, credits: award.credits });
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

describe("runAvailabilityBonus", () => {
  it("pays 40 credits to a tutor who was live 5 hours last week, once", async () => {
    const port = new FakePort().live("tina", LAST_WEEK, FIVE_HOURS);
    const r = await runAvailabilityBonus(port, SETTINGS, MONDAY);

    expect(r.awarded).toHaveLength(1);
    expect(r.awarded[0]).toMatchObject({ tutorId: "tina", weekStart: LAST_WEEK, credits: 40 });
    expect(r.creditsAwarded).toBe(40);
    expect(port.ledger.balances.get("tina")).toBe(40);
    expect(port.ledger.rows).toHaveLength(1);
    expect(port.ledger.rows[0]).toMatchObject({
      userId: "tina",
      delta: 40,
      type: "availability_bonus",
      referenceType: "availability_bonus",
      referenceId: "award-1",
    });
    expect(port.audits).toHaveLength(1);
    expect(port.audits[0]).toMatchObject({ awarded: 1, credits_each: 40, credits_total: 40 });
  });

  it("a second run of the same week pays nobody again", async () => {
    const port = new FakePort().live("tina", LAST_WEEK, FIVE_HOURS);
    await runAvailabilityBonus(port, SETTINGS, MONDAY);
    const again = await runAvailabilityBonus(port, SETTINGS, MONDAY);

    expect(again.awarded).toHaveLength(0);
    expect(again.creditsAwarded).toBe(0);
    expect(port.ledger.balances.get("tina")).toBe(40);
    expect(port.ledger.rows).toHaveLength(1);
  });

  it("skips a tutor under the threshold by one second", async () => {
    const port = new FakePort().live("sam", LAST_WEEK, FIVE_HOURS - 1);
    const r = await runAvailabilityBonus(port, SETTINGS, MONDAY);
    expect(r.awarded).toHaveLength(0);
    expect(port.ledger.balances.has("sam")).toBe(false);
  });

  it("honours a fractional threshold from settings", async () => {
    const port = new FakePort().live("sam", LAST_WEEK, 2.5 * 3600);
    const r = await runAvailabilityBonus(port, { ...SETTINGS, minHours: 2.5 }, MONDAY);
    expect(r.awarded).toHaveLength(1);
  });

  it("pays the configured amount, not a constant", async () => {
    const port = new FakePort().live("tina", LAST_WEEK, FIVE_HOURS);
    await runAvailabilityBonus(port, { ...SETTINGS, credits: 25 }, MONDAY);
    expect(port.ledger.balances.get("tina")).toBe(25);
  });

  it("skips an unapproved tutor however many hours they have", async () => {
    const port = new FakePort().live("pending", LAST_WEEK, 10 * 3600, false);
    const r = await runAvailabilityBonus(port, SETTINGS, MONDAY);
    expect(r.awarded).toHaveLength(0);
  });

  it("does nothing when the bonus is switched off, and says so", async () => {
    const port = new FakePort().live("tina", LAST_WEEK, FIVE_HOURS);
    const r = await runAvailabilityBonus(port, { ...SETTINGS, enabled: false }, MONDAY);
    expect(r.disabled).toBe(true);
    expect(r.awarded).toHaveLength(0);
    expect(port.ledger.rows).toHaveLength(0);
    expect(port.audits).toHaveLength(0);
  });

  it("pays a missed earlier week on a later run, but never the current week", async () => {
    const port = new FakePort()
      .live("tina", "2026-09-28", FIVE_HOURS) // three weeks back, never paid
      .live("tina", LAST_WEEK, FIVE_HOURS)
      .live("tina", "2026-10-19", 20 * 3600); // the week the run is in
    const r = await runAvailabilityBonus(port, SETTINGS, MONDAY);

    expect(r.weeksChecked).toHaveLength(WEEKS_TO_CHECK);
    expect(r.awarded.map((a) => a.weekStart)).toEqual(["2026-09-28", LAST_WEEK]);
    expect(port.ledger.balances.get("tina")).toBe(80);
  });

  it("a week older than the window is left alone", async () => {
    const port = new FakePort().live("tina", "2026-09-14", FIVE_HOURS); // five weeks back
    const r = await runAvailabilityBonus(port, SETTINGS, MONDAY);
    expect(r.awarded).toHaveLength(0);
  });

  it("one tutor's failure does not cost the others their bonus", async () => {
    const port = new FakePort().live("bad", LAST_WEEK, FIVE_HOURS).live("tina", LAST_WEEK, FIVE_HOURS);
    const claim = port.claimAndCredit.bind(port);
    port.claimAndCredit = async (award, credit) => {
      if (award.tutorId === "bad") throw new Error("connection reset");
      return claim(award, credit);
    };
    const r = await runAvailabilityBonus(port, SETTINGS, MONDAY);

    expect(r.failed).toBe(1);
    expect(r.awarded.map((a) => a.tutorId)).toEqual(["tina"]);
    expect(port.ledger.balances.get("tina")).toBe(40);
    expect(port.ledger.balances.has("bad")).toBe(false);
  });

  it("a lost race (award row already there) is counted, not paid", async () => {
    const port = new FakePort().live("tina", LAST_WEEK, FIVE_HOURS);
    // The listing said yes, but by the time we claim, someone else has the week.
    port.listQualifiers = async (weekStart) =>
      weekStart === LAST_WEEK ? [{ tutorId: "tina", liveSeconds: FIVE_HOURS }] : [];
    port.awards.set(`tina:${LAST_WEEK}`, { awardId: "award-x", credits: 40 });
    const r = await runAvailabilityBonus(port, SETTINGS, MONDAY);

    expect(r.alreadyAwarded).toBe(1);
    expect(r.awarded).toHaveLength(0);
    expect(port.ledger.rows).toHaveLength(0);
  });

  it("a ledger duplicate rolls the award back and is counted", async () => {
    const port = new FakePort().live("tina", LAST_WEEK, FIVE_HOURS);
    // Pretend a ledger row for award-1 already exists.
    await port.ledger.transaction(async () => {
      await port.ledger.createWallet("tina");
      await port.ledger.lockWallet("tina");
      await port.ledger.insertTransaction({
        userId: "tina",
        delta: 40,
        balanceAfter: 40,
        type: "availability_bonus",
        referenceType: "availability_bonus",
        referenceId: "award-1",
      });
      await port.ledger.setBalance("tina", 40);
    });
    const r = await runAvailabilityBonus(port, SETTINGS, MONDAY);

    expect(r.duplicateLedger).toBe(1);
    expect(r.awarded).toHaveLength(0);
    expect(port.awards.has(`tina:${LAST_WEEK}`)).toBe(false);
    expect(port.ledger.balances.get("tina")).toBe(40);
  });
});
