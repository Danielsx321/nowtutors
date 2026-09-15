import { randomUUID } from "node:crypto";
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
 * `/admin/users` and `/admin/subjects` against a real Postgres (SPEC §5, §6,
 * §7.10; Phase 8 Part 5). Test project only.
 *
 * These are here because the correctness is in the database: `profiles_guard`
 * accepting the trusted connection (drizzle/0016), the promoted account passing
 * `is_admin()`, the ledger's unique index turning a repeated request key into a
 * no-op under a real lock, the savepoint keeping the transaction usable after
 * that conflict, and `position()` search treating `%` literally.
 *
 * What this lane can NOT show is that a signed-in user is still refused: `SET
 * ROLE` doesn't change `session_user`, so every connection here is trusted.
 * `pnpm db:verify-rls:test` covers that through PostgREST.
 *
 * Every fixture is rolled back, except the request-key race, which commits and
 * then restores the balance with a compensating adjustment (the ledger is
 * append-only) and deletes its own audit rows.
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

const users = await import("@/db/queries/admin-users");
const subjectsQ = await import("@/db/queries/admin-subjects");

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

async function rolledBack<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
  const held = await beginTransaction(connA);
  try {
    return await withExecutor(held.tx, () => fn(held.tx));
  } finally {
    await held.rollback();
  }
}

async function one<T>(tx: Executor, query: SQL): Promise<T> {
  const [row] = Array.from(await tx.execute<T & Record<string, unknown>>(query));
  return row as T;
}

async function idOf(tx: Executor, email: string): Promise<string> {
  const row = await one<{ id: string } | undefined>(tx, sql`select id from profiles where email = ${email}`);
  if (!row) throw new Error(`test project is missing seeded ${email}`);
  return row.id;
}

/** Audit rows this transaction wrote for a target (`now()` is the transaction start). */
async function auditsFor(tx: Executor, targetId: string) {
  return Array.from(
    await tx.execute<{ action: string; actor_id: string; payload: Record<string, unknown> }>(sql`
      select action, actor_id, payload from audit_log
       where target_id = ${targetId} and created_at = now()
       order by action
    `),
  );
}

describe("applySuspension (drizzle/0016 lets the trusted connection change is_suspended)", () => {
  it("suspends a live tutor, takes them offline and audits once; a repeat writes nothing", async () => {
    await rolledBack(async (tx) => {
      const admin = await idOf(tx, "admin@nowtutors.dev");
      const tutor = await idOf(tx, "tutor3@nowtutors.dev");
      await tx.execute(sql`update tutor_profiles set is_live = true, live_mode = 'instant', last_seen_at = now() where user_id = ${tutor}`);

      expect(await users.applySuspension(tx, { userId: tutor, suspended: true, actorId: admin })).toEqual({
        ok: true,
        changed: true,
        wentOffline: true,
      });
      const state = await one<{ is_suspended: boolean; is_live: boolean; live_mode: string | null }>(
        tx,
        sql`select p.is_suspended, t.is_live, t.live_mode from profiles p join tutor_profiles t on t.user_id = p.id where p.id = ${tutor}`,
      );
      expect(state).toEqual({ is_suspended: true, is_live: false, live_mode: null });

      expect(await users.applySuspension(tx, { userId: tutor, suspended: true, actorId: admin })).toEqual({
        ok: true,
        changed: false,
        wentOffline: false,
      });
      const audits = await auditsFor(tx, tutor);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "user.suspend",
        actor_id: admin,
        payload: { from: false, to: true, went_offline: true, email: "tutor3@nowtutors.dev" },
      });
    });
  });

  it("unsuspends, and an unknown id is not found", async () => {
    await rolledBack(async (tx) => {
      const admin = await idOf(tx, "admin@nowtutors.dev");
      const tutor8 = await idOf(tx, "tutor8@nowtutors.dev");
      expect(await users.applySuspension(tx, { userId: tutor8, suspended: false, actorId: admin })).toMatchObject({
        ok: true,
        changed: true,
      });
      expect((await auditsFor(tx, tutor8))[0]?.action).toBe("user.unsuspend");
      expect(await users.applySuspension(tx, { userId: randomUUID(), suspended: true, actorId: admin })).toEqual({
        ok: false,
        reason: "not_found",
      });
    });
  });
});

describe("applyPromotion", () => {
  it("a clean tutor becomes an admin who passes is_admin(), with an audit row", async () => {
    await rolledBack(async (tx) => {
      const admin = await idOf(tx, "admin@nowtutors.dev");
      const tutor = await idOf(tx, "tutor4@nowtutors.dev");
      const isAdmin = async () => {
        await tx.execute(sql`select set_config('request.jwt.claims', json_build_object('sub', ${tutor}::text, 'role', 'authenticated')::text, true)`);
        return (await one<{ a: boolean }>(tx, sql`select public.is_admin() as a`)).a;
      };
      expect(await isAdmin()).toBe(false);

      expect(await users.applyPromotion(tx, { userId: tutor, confirmEmail: " TUTOR4@nowtutors.dev ", actorId: admin })).toEqual({
        ok: true,
      });
      await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
      expect((await one<{ role: string }>(tx, sql`select role from profiles where id = ${tutor}`)).role).toBe("admin");
      expect(await isAdmin()).toBe(true);
      await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
      expect(await auditsFor(tx, tutor)).toMatchObject([
        { action: "user.promote_admin", actor_id: admin, payload: { from: "tutor", to: "admin" } },
      ]);
    });
  });

  it("refuses a student who still holds credits or whose email wasn't typed, and changes nothing", async () => {
    await rolledBack(async (tx) => {
      const admin = await idOf(tx, "admin@nowtutors.dev");
      const student = await idOf(tx, "student1@nowtutors.dev");
      const balance = (await one<{ b: number }>(tx, sql`select credit_balance as b from wallets where user_id = ${student}`)).b;
      expect(balance, "seeded student1 has credits").toBeGreaterThan(0);

      const res = await users.applyPromotion(tx, { userId: student, confirmEmail: "someone@else.dev", actorId: admin });
      expect(res).toEqual({ ok: false, blockers: ["email_mismatch", "wallet_balance"] });
      expect((await one<{ role: string }>(tx, sql`select role from profiles where id = ${student}`)).role).toBe("student");
      expect(await auditsFor(tx, student)).toHaveLength(0);

      expect(await users.applyPromotion(tx, { userId: admin, confirmEmail: "admin@nowtutors.dev", actorId: admin })).toEqual({
        ok: false,
        blockers: ["already_admin"],
      });
    });
  });
});

describe("applyCreditAdjustment", () => {
  async function ledgerFor(tx: Executor, key: string) {
    return Array.from(
      await tx.execute<{ delta: number; balance_after: number; type: string; description: string; created_by: string }>(
        sql`select delta, balance_after, type, description, created_by from credit_transactions where reference_id = ${key}`,
      ),
    );
  }

  it("credits through the ledger with a generic description, audits the note, and the ledger still sums to the balance", async () => {
    await rolledBack(async (tx) => {
      const admin = await idOf(tx, "admin@nowtutors.dev");
      const student = await idOf(tx, "student1@nowtutors.dev");
      const before = (await one<{ b: number }>(tx, sql`select credit_balance as b from wallets where user_id = ${student}`)).b;
      const key = randomUUID();

      const res = await users.applyCreditAdjustment(tx, { userId: student, delta: 5, note: "Goodwill", requestKey: key, actorId: admin });
      expect(res).toEqual({ ok: true, duplicate: false, balanceAfter: before + 5 });
      expect(await ledgerFor(tx, key)).toEqual([
        { delta: 5, balance_after: before + 5, type: "admin_adjustment", description: "Adjusted by NowTutors support", created_by: admin },
      ]);
      expect(await auditsFor(tx, student)).toMatchObject([
        { action: "wallet.adjust", actor_id: admin, payload: { delta: 5, balance_after: before + 5, note: "Goodwill", request_key: key } },
      ]);
      const sums = await one<{ balance: number; ledger: number }>(
        tx,
        sql`select (select credit_balance from wallets where user_id = ${student}) as balance,
                   (select coalesce(sum(delta), 0)::int from credit_transactions where user_id = ${student}) as ledger`,
      );
      expect(sums.ledger).toBe(sums.balance);
    });
  });

  it("the same request key twice lands once, and the transaction is still usable afterwards", async () => {
    await rolledBack(async (tx) => {
      const admin = await idOf(tx, "admin@nowtutors.dev");
      const student = await idOf(tx, "student1@nowtutors.dev");
      const key = randomUUID();
      const p = { userId: student, delta: 3, note: "Double click", requestKey: key, actorId: admin };

      expect(await users.applyCreditAdjustment(tx, p)).toMatchObject({ ok: true, duplicate: false });
      expect(await users.applyCreditAdjustment(tx, p)).toEqual({ ok: true, duplicate: true });
      expect(await ledgerFor(tx, key)).toHaveLength(1);
      expect(await auditsFor(tx, student)).toHaveLength(1);
      expect((await one<{ ok: number }>(tx, sql`select 1 as ok`)).ok).toBe(1);
    });
  });

  it("a debit below zero writes nothing; admin wallets and unknown users are refused", async () => {
    await rolledBack(async (tx) => {
      const admin = await idOf(tx, "admin@nowtutors.dev");
      const student = await idOf(tx, "student1@nowtutors.dev");
      const before = (await one<{ b: number }>(tx, sql`select credit_balance as b from wallets where user_id = ${student}`)).b;
      const key = randomUUID();

      expect(
        await users.applyCreditAdjustment(tx, { userId: student, delta: -(before + 1), note: "Too much", requestKey: key, actorId: admin }),
      ).toEqual({ ok: false, reason: "insufficient", available: before });
      expect((await one<{ b: number }>(tx, sql`select credit_balance as b from wallets where user_id = ${student}`)).b).toBe(before);
      expect(await ledgerFor(tx, key)).toHaveLength(0);
      expect(await auditsFor(tx, student)).toHaveLength(0);

      expect(
        await users.applyCreditAdjustment(tx, { userId: admin, delta: 1, note: "Admin wallet", requestKey: randomUUID(), actorId: admin }),
      ).toEqual({ ok: false, reason: "role" });
      expect(
        await users.applyCreditAdjustment(tx, { userId: randomUUID(), delta: 1, note: "Nobody", requestKey: randomUUID(), actorId: admin }),
      ).toEqual({ ok: false, reason: "not_found" });
    });
  });

  it("two connections submitting the same request key: the second waits on the wallet lock and lands as a duplicate", async () => {
    const [ids] = Array.from(
      await watcher.db.execute<{ admin: string; student: string; balance: number; started: string }>(sql`
        select (select id from profiles where email = 'admin@nowtutors.dev') as admin,
               p.id as student, w.credit_balance as balance, now()::text as started
          from profiles p join wallets w on w.user_id = p.id
         where p.email = 'student2@nowtutors.dev'
      `),
    );
    const key = randomUUID();
    const undoKey = randomUUID();
    const p = { userId: ids.student, delta: 1, note: "Race fixture", requestKey: key, actorId: ids.admin };

    const a = await beginTransaction(connA);
    const b = await beginTransaction(connB);
    let committed = false;
    try {
      try {
        expect(await users.applyCreditAdjustment(a.tx, p)).toMatchObject({ ok: true, duplicate: false });
        const second = users.applyCreditAdjustment(b.tx, p);
        await waitUntilBlockedBy(watcher, b.pid, a.pid);
        await a.commit();
        committed = true;
        expect(await second).toEqual({ ok: true, duplicate: true });
        await b.commit();
      } catch (err) {
        await Promise.allSettled([a.rollback(), b.rollback()]);
        throw err;
      }

      const after = Array.from(
        await watcher.db.execute<{ n: number; balance: number }>(sql`
          select (select count(*)::int from credit_transactions where reference_id = ${key}) as n,
                 (select credit_balance from wallets where user_id = ${ids.student}) as balance
        `),
      )[0];
      expect(after).toEqual({ n: 1, balance: ids.balance + 1 });
    } finally {
      if (committed) {
        await watcher.db.transaction((tx) =>
          users.applyCreditAdjustment(tx, { ...p, delta: -1, note: "Race fixture undo", requestKey: undoKey }),
        );
      }
      await watcher.db.execute(sql`
        delete from audit_log
         where action = 'wallet.adjust' and target_id = ${ids.student}
           and payload->>'request_key' in (${key}, ${undoKey}) and created_at >= ${ids.started}::timestamptz
      `);
    }

    const restored = Array.from(
      await watcher.db.execute<{ balance: number }>(sql`select credit_balance as balance from wallets where user_id = ${ids.student}`),
    )[0];
    expect(restored.balance).toBe(ids.balance);
  });
});

describe("searchAdminUsers and getAdminUserDetail", () => {
  it("matches email or name as literal text, filters, and counts", async () => {
    await rolledBack(async () => {
      const hit = await users.searchAdminUsers({ q: "student1", filter: null });
      expect(hit.users.map((u) => u.email)).toContain("student1@nowtutors.dev");
      expect(hit.total).toBe(hit.users.length);

      // No seeded email or name contains % or _, so a LIKE-style match would find everyone.
      expect((await users.searchAdminUsers({ q: "%", filter: null })).total).toBe(0);
      expect((await users.searchAdminUsers({ q: "_", filter: null })).total).toBe(0);

      const suspended = await users.searchAdminUsers({ q: null, filter: "suspended" });
      expect(suspended.users.every((u) => u.isSuspended)).toBe(true);
      expect(suspended.users.map((u) => u.email)).toContain("tutor8@nowtutors.dev");

      const admins = await users.searchAdminUsers({ q: null, filter: "admin" });
      expect(admins.total).toBeGreaterThan(0);
      expect(admins.users.every((u) => u.role === "admin")).toBe(true);
      expect((await users.searchAdminUsers({ q: null, filter: "unset" })).users.every((u) => u.role === null)).toBe(true);

      const tutors = await users.searchAdminUsers({ q: "nowtutors.dev", filter: "tutor" });
      expect(tutors.users.every((u) => u.role === "tutor" && u.email.includes("nowtutors.dev"))).toBe(true);
    });
  });

  it("the detail read carries wallet, bookings by status and tutor earnings", async () => {
    await rolledBack(async (tx) => {
      const student = await idOf(tx, "student1@nowtutors.dev");
      const tutor = await idOf(tx, "tutor1@nowtutors.dev");
      const s = await users.getAdminUserDetail(student);
      expect(s).toMatchObject({ email: "student1@nowtutors.dev", role: "student", tutor: null });
      expect(s!.walletBalance).toBe(
        (await one<{ b: number }>(tx, sql`select credit_balance as b from wallets where user_id = ${student}`)).b,
      );

      const t = await users.getAdminUserDetail(tutor);
      const unpaid = await one<{ n: number }>(
        tx,
        sql`select coalesce(sum(net_credits), 0)::int as n from tutor_earnings where tutor_id = ${tutor} and status in ('held', 'available')`,
      );
      expect(t!.tutor?.slug).toBeTruthy();
      expect(t!.earnings.held + t!.earnings.available).toBe(unpaid.n);
      expect(await users.getAdminUserDetail(randomUUID())).toBeNull();
    });
  });
});

describe("subjects", () => {
  it("creates at the end of the list, refuses a duplicate name or slug, and audits", async () => {
    await rolledBack(async (tx) => {
      const admin = await idOf(tx, "admin@nowtutors.dev");
      const maxOrder = (await one<{ m: number }>(tx, sql`select max(sort_order)::int as m from subjects`)).m;

      const res = await subjectsQ.applyCreateSubject(tx, { name: "Zz Test Subject", actorId: admin });
      expect(res).toMatchObject({ ok: true, slug: "zz-test-subject" });
      const id = (res as { id: string }).id;
      expect(
        await one(tx, sql`select name, slug, sort_order, is_active from subjects where id = ${id}`),
      ).toEqual({ name: "Zz Test Subject", slug: "zz-test-subject", sort_order: maxOrder + 1, is_active: true });
      expect(await auditsFor(tx, id)).toMatchObject([{ action: "subject.create", actor_id: admin }]);

      expect(await subjectsQ.applyCreateSubject(tx, { name: "zz TEST subject", actorId: admin })).toEqual({
        ok: false,
        reason: "name_taken",
        slug: "zz-test-subject",
      });
      expect(await subjectsQ.applyCreateSubject(tx, { name: "Algebra!", actorId: admin })).toEqual({
        ok: false,
        reason: "slug_taken",
        slug: "algebra",
      });
    });
  });

  it("renames the label but never the slug, and hides without deleting", async () => {
    await rolledBack(async (tx) => {
      const admin = await idOf(tx, "admin@nowtutors.dev");
      const { id } = await one<{ id: string }>(tx, sql`select id from subjects where slug = 'algebra'`);

      expect(await subjectsQ.applyRenameSubject(tx, { subjectId: id, name: "Algebra I", actorId: admin })).toEqual({ ok: true, changed: true });
      expect(await one(tx, sql`select name, slug from subjects where id = ${id}`)).toEqual({ name: "Algebra I", slug: "algebra" });
      expect(await subjectsQ.applyRenameSubject(tx, { subjectId: id, name: "Algebra I", actorId: admin })).toEqual({ ok: true, changed: false });
      expect(await subjectsQ.applyRenameSubject(tx, { subjectId: id, name: "geometry", actorId: admin })).toEqual({ ok: false, reason: "name_taken" });

      expect(await subjectsQ.applySetSubjectActive(tx, { subjectId: id, active: false, actorId: admin })).toEqual({ ok: true, changed: true });
      expect(await subjectsQ.applySetSubjectActive(tx, { subjectId: id, active: false, actorId: admin })).toEqual({ ok: true, changed: false });

      expect((await auditsFor(tx, id)).map((a) => a.action)).toEqual(["subject.deactivate", "subject.rename"]);

      const listed = await withExecutor(tx, () => subjectsQ.listAdminSubjects());
      const row = listed.find((s) => s.id === id)!;
      const tutorCount = (await one<{ n: number }>(tx, sql`select count(*)::int as n from tutor_subjects where subject_id = ${id}`)).n;
      expect(row).toMatchObject({ name: "Algebra I", isActive: false, tutorCount });
      expect(await subjectsQ.applySetSubjectActive(tx, { subjectId: randomUUID(), active: true, actorId: admin })).toEqual({
        ok: false,
        reason: "not_found",
      });
    });
  });
});
