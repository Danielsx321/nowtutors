import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  beginTransaction,
  openConnection,
  waitUntilBlockedBy,
  withExecutor,
  type TestConnection,
} from "./helpers/test-db";

/**
 * The admin control room against a real Postgres (SPEC §4.7, §6; Phase 8
 * Part 4). Test project only.
 *
 * These live here, not in `tests/unit`, because the correctness is in SQL: the
 * stale-save check is a jsonb comparison under a row lock, the audit filter is
 * `split_part` rather than `LIKE`, and "today" is computed by Postgres in the
 * admin's timezone.
 *
 * Every fixture is written inside a transaction that is rolled back, except the
 * one race that needs a real commit, which restores the setting and deletes its
 * own audit rows in `finally`.
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

const { applySettingUpdate } = await import("@/db/queries/admin-settings");
const { listAuditFacets, listAuditLog } = await import("@/db/queries/admin-audit");
const { getAdminOverview } = await import("@/db/queries/admin-overview");

let connA: TestConnection;
let connB: TestConnection;
let watcher: TestConnection;

beforeAll(() => {
  connA = openConnection("a");
  connB = openConnection("b");
  watcher = openConnection("watcher");
});

afterAll(async () => {
  await Promise.all([connA.end(), connB.end(), watcher.end()]);
});

/** Run `fn` in a transaction that is ALWAYS rolled back. */
async function rolledBack<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
  const held = await beginTransaction(connA);
  try {
    return await withExecutor(held.tx, () => fn(held.tx));
  } finally {
    await held.rollback();
  }
}

async function profileIds(tx: Executor, n: number): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(
    sql`select id from profiles order by created_at limit ${n}`,
  );
  const ids = Array.from(rows).map((r) => r.id);
  if (ids.length < n) throw new Error(`test project needs ${n} profiles, has ${ids.length}`);
  return ids;
}

async function readSetting(tx: Executor, key: string) {
  const [row] = Array.from(
    await tx.execute<{ value: unknown }>(sql`select value from platform_settings where key = ${key}`),
  );
  return row;
}

/** Audit rows this transaction wrote for `key` (`now()` is the transaction start). */
async function settingAudits(tx: Executor, key: string) {
  return Array.from(
    await tx.execute<{ actor_id: string; payload: { key: string; from: unknown; to: unknown } }>(sql`
      select actor_id, payload from audit_log
       where action = 'setting.update' and payload->>'key' = ${key} and created_at = now()
    `),
  );
}

describe("applySettingUpdate", () => {
  it("writes the value and one audit row with from, to and the actor", async () => {
    await rolledBack(async (tx) => {
      const [actor] = await profileIds(tx, 1);
      const key = "min_withdrawal_usd";
      const before = await readSetting(tx, key);
      expect(before, "seeded row").toBeDefined();
      const next = Number(before.value) + 7;

      const res = await applySettingUpdate(tx, {
        key,
        value: next,
        expected: JSON.stringify(before.value),
        actorId: actor,
      });

      expect(res).toEqual({ ok: true, changed: true });
      expect((await readSetting(tx, key))?.value).toBe(next);
      const audits = await settingAudits(tx, key);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ actor_id: actor, payload: { key, from: before.value, to: next } });
    });
  });

  it("refuses a save made against an out-of-date value, and writes nothing", async () => {
    await rolledBack(async (tx) => {
      const [actor] = await profileIds(tx, 1);
      const key = "min_withdrawal_usd";
      const before = await readSetting(tx, key);

      const res = await applySettingUpdate(tx, {
        key,
        value: 12,
        expected: JSON.stringify(Number(before.value) + 1),
        actorId: actor,
      });

      expect(res).toEqual({ ok: false, reason: "stale" });
      expect((await readSetting(tx, key))?.value).toEqual(before.value);
      expect(await settingAudits(tx, key)).toHaveLength(0);
    });
  });

  it("compares as jsonb: key order and whitespace don't make a save stale, and an unchanged value audits nothing", async () => {
    await rolledBack(async (tx) => {
      const [actor] = await profileIds(tx, 1);
      const key = "credit_packages";
      const before = await readSetting(tx, key);
      const reordered = (before.value as Record<string, unknown>[]).map((p) =>
        Object.fromEntries(Object.entries(p).reverse()),
      );

      const res = await applySettingUpdate(tx, {
        key,
        value: reordered,
        expected: JSON.stringify(reordered, null, 4),
        actorId: actor,
      });

      expect(res).toEqual({ ok: true, changed: false });
      expect(await settingAudits(tx, key)).toHaveLength(0);
    });
  });

  it("a missing key is created only when the page saw it missing", async () => {
    await rolledBack(async (tx) => {
      const [actor] = await profileIds(tx, 1);
      const key = "instant_request_ttl_seconds";
      await tx.execute(sql`delete from platform_settings where key = ${key}`);

      expect(
        await applySettingUpdate(tx, { key, value: 45, expected: "60", actorId: actor }),
      ).toEqual({ ok: false, reason: "stale" });
      expect(await readSetting(tx, key)).toBeUndefined();

      expect(
        await applySettingUpdate(tx, { key, value: 45, expected: null, actorId: actor }),
      ).toEqual({ ok: true, changed: true });
      expect((await readSetting(tx, key))?.value).toBe(45);
      expect((await settingAudits(tx, key))[0]?.payload).toEqual({ key, from: null, to: 45 });
    });
  });

  it("two admins saving from the same page: the second waits on the row lock and is refused", async () => {
    const key = "min_withdrawal_usd";
    const [row] = Array.from(
      await watcher.db.execute<{ value: unknown; started: string }>(
        sql`select value, now()::text as started from platform_settings where key = ${key}`,
      ),
    );
    const original = row.value;
    const expected = JSON.stringify(original);
    const [actor] = Array.from(
      await watcher.db.execute<{ id: string }>(sql`select id from profiles order by created_at limit 1`),
    ).map((r) => r.id);

    const a = await beginTransaction(connA);
    const b = await beginTransaction(connB);
    try {
      try {
        expect(
          await applySettingUpdate(a.tx, { key, value: Number(original) + 1, expected, actorId: actor }),
        ).toEqual({ ok: true, changed: true });
        const second = applySettingUpdate(b.tx, {
          key,
          value: Number(original) + 2,
          expected,
          actorId: actor,
        });
        await waitUntilBlockedBy(watcher, b.pid, a.pid);
        await a.commit();

        expect(await second).toEqual({ ok: false, reason: "stale" });
        await b.commit();
      } catch (err) {
        await Promise.allSettled([a.rollback(), b.rollback()]);
        throw err;
      }

      const [after] = Array.from(
        await watcher.db.execute<{ value: unknown }>(sql`select value from platform_settings where key = ${key}`),
      );
      expect(after.value).toBe(Number(original) + 1);
    } finally {
      await watcher.db.execute(
        sql`update platform_settings set value = ${expected}::jsonb where key = ${key}`,
      );
      await watcher.db.execute(sql`
        delete from audit_log
         where action = 'setting.update' and payload->>'key' = ${key}
           and actor_id = ${actor} and created_at >= ${row.started}::timestamptz
      `);
    }

    const [restored] = Array.from(
      await watcher.db.execute<{ value: unknown }>(sql`select value from platform_settings where key = ${key}`),
    );
    expect(restored.value).toEqual(original);
  });
});

describe("listAuditLog", () => {
  it("filters by exact action prefix and by actor, and pages", async () => {
    await rolledBack(async (tx) => {
      const [actor1, actor2] = await profileIds(tx, 2);
      const tag = `zt${Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 8)}`;
      const insert = async (action: string, actor: string) => {
        const [r] = Array.from(
          await tx.execute<{ id: string }>(sql`
            insert into audit_log (actor_id, action, target_type, payload)
            values (${actor}, ${action}, 'lane_fixture', '{"fixture": true}'::jsonb)
            returning id
          `),
        );
        return r.id;
      };
      const mine = [
        await insert(`${tag}.one`, actor1),
        await insert(`${tag}.two`, actor1),
        await insert(`${tag}.three`, actor2),
      ];
      // A different prefix that LIKE '<tag>_x%' would match.
      await insert(`${tag}ax.one`, actor1);

      const all = await listAuditLog({ actionPrefix: tag });
      expect(all.total).toBe(3);
      expect(all.entries.map((e) => e.id).sort()).toEqual([...mine].sort());
      expect(all.entries[0]).toMatchObject({ targetType: "lane_fixture", payload: { fixture: true } });

      const byActor = await listAuditLog({ actionPrefix: tag, actorId: actor2 });
      expect(byActor.total).toBe(1);
      expect(byActor.entries[0]).toMatchObject({ action: `${tag}.three`, actorId: actor2 });
      expect(byActor.entries[0].actorEmail).toBeTruthy();

      expect(await listAuditLog({ actionPrefix: `${tag}_x` })).toMatchObject({ total: 0, entries: [] });
      expect(await listAuditLog({ actionPrefix: tag, page: 2 })).toMatchObject({
        total: 3,
        entries: [],
        pageCount: 1,
      });

      const facets = await listAuditFacets();
      expect(facets.prefixes).toEqual(
        expect.arrayContaining([
          { prefix: tag, count: 3 },
          { prefix: `${tag}ax`, count: 1 },
        ]),
      );
    });
  });
});

describe("getAdminOverview", () => {
  it("counts captured revenue by the admin's calendar day and month, excluding refunds", async () => {
    await rolledBack(async (tx) => {
      const [user] = await profileIds(tx, 1);
      const tz = "Africa/Lagos"; // UTC+1, no DST
      const now = new Date("2031-03-15T12:00:00Z");
      const before = await getAdminOverview(tz, now);

      const pay = (usd: string, status: string, capturedAt: string) =>
        tx.execute(sql`
          insert into payments (user_id, provider_order_id, amount_usd, purpose, status, captured_at)
          values (${user}, ${`LANE-${Math.random().toString(36).slice(2)}`}, ${usd}::numeric,
                  'credit_purchase', ${status}, ${capturedAt}::timestamptz)
        `);
      await pay("10.50", "captured", "2031-03-15T10:00:00Z"); // today
      await pay("20.00", "captured", "2031-03-14T23:30:00Z"); // 00:30 on the 15th in Lagos: today
      await pay("5.00", "captured", "2031-03-14T22:59:00Z"); // 23:59 on the 14th in Lagos: month only
      await pay("3.00", "captured", "2031-02-28T23:30:00Z"); // 00:30 on 1 March in Lagos: month only
      await pay("7.00", "captured", "2031-03-31T23:30:00Z"); // 00:30 on 1 April in Lagos: neither
      await pay("99.00", "refunded", "2031-03-15T11:00:00Z"); // refunded: neither

      const after = await getAdminOverview(tz, now);
      expect(Number(after.capturedTodayUsd) - Number(before.capturedTodayUsd)).toBeCloseTo(30.5, 2);
      expect(after.capturedTodayCount - before.capturedTodayCount).toBe(2);
      expect(Number(after.capturedMonthUsd) - Number(before.capturedMonthUsd)).toBeCloseTo(38.5, 2);
    });
  });

  it("falls back to UTC for a timezone Postgres doesn't know", async () => {
    await rolledBack(async () => {
      const res = await getAdminOverview("Not/A_Zone", new Date("2031-03-15T12:00:00Z"));
      expect(typeof res.students).toBe("number");
    });
  });
});
