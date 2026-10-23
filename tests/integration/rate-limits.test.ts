import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { deleteExpiredRateLimits } from "@/db/queries/rate-limits";

/**
 * `public.hit_rate_limit()` (drizzle/0028, Security C) on a real Postgres: it
 * crosses its limit at exactly limit + 1, and a burst of simultaneous hits
 * through the app's own client lets exactly `limit` through, because the
 * counter is one INSERT ... ON CONFLICT DO UPDATE ... RETURNING. A unit test
 * with an injected counter cannot show either.
 *
 * First run by hand on the dev project on 2026-10-22 (sequential 3 of 4, burst
 * 5 of 20); the test project was paused, so this file has not yet run there.
 */

const keys: string[] = [];
const fresh = (label: string) => {
  const k = `itest:${label}:${randomUUID()}`;
  keys.push(k);
  return k;
};
const hit = async (key: string, limit: number) => {
  const [row] = Array.from(
    await db.execute<{ ok: boolean }>(sql`select public.hit_rate_limit(${key}, ${limit}::int, 900) as ok`),
  );
  return row?.ok === true;
};

afterAll(async () => {
  if (keys.length) await db.delete(rateLimits).where(inArray(rateLimits.key, keys));
});

describe("hit_rate_limit", () => {
  it("allows `limit` hits in a window and refuses the next", async () => {
    const key = fresh("seq");
    const answers = [];
    for (let i = 0; i < 4; i++) answers.push(await hit(key, 3));
    expect(answers).toEqual([true, true, true, false]);
  });

  it("lets exactly `limit` through a simultaneous burst", async () => {
    const key = fresh("burst");
    const answers = await Promise.all(Array.from({ length: 20 }, () => hit(key, 5)));
    expect(answers.filter(Boolean)).toHaveLength(5);
  }, 60_000);

  it("refuses bad arguments instead of counting them", async () => {
    await expect(db.execute(sql`select public.hit_rate_limit('', 1, 1)`)).rejects.toThrow();
  });

  it("checkRateLimit maps a crossed key to a refusal with time left", async () => {
    const userId = randomUUID();
    keys.push(`changePassword:user:${userId}`);
    for (let i = 0; i < 5; i++) {
      expect(await checkRateLimit({ action: "changePassword", userId })).toEqual({ ok: true });
    }
    const res = await checkRateLimit({ action: "changePassword", userId });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("the daily cleanup deletes rows older than a day and keeps current ones", async () => {
    const old = fresh("old");
    const current = fresh("current");
    await db.insert(rateLimits).values([
      { key: old, windowStart: new Date(Date.now() - 2 * 24 * 3600 * 1000), count: 1 },
      { key: current, windowStart: new Date(), count: 1 },
    ]);
    expect(await deleteExpiredRateLimits()).toBeGreaterThanOrEqual(1);
    const left = await db.select({ key: rateLimits.key }).from(rateLimits).where(inArray(rateLimits.key, [old, current]));
    expect(left.map((r) => r.key)).toEqual([current]);
  });
});
