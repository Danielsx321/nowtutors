import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginTransaction,
  openConnection,
  waitUntilBlockedBy,
  withExecutor,
  type TestConnection,
} from "./helpers/test-db";

/**
 * Live broadcasts against a real Postgres (SPEC §4.6, §7.8; Phase 9 Part 3).
 * Test project only.
 *
 * **Why these can't be unit tests.** "Two presses of Go live give one broadcast"
 * is the tutor row lock plus `broadcasts_one_live_per_tutor` (`drizzle/0020`);
 * "a stale host's broadcast is ended" is the `live_tutors` view; "a broadcasting
 * tutor can't be flipped to instant" is a WHERE clause re-evaluated under READ
 * COMMITTED. The in-memory store in `tests/unit/broadcast-service.test.ts`
 * models the rules, not those.
 *
 * The race is a genuine contest: connection A starts and holds its transaction
 * open, B starts and blocks on the tutor row, Postgres confirms the block before
 * A commits.
 *
 * Everything this file creates is removed afterwards, and the tutor's presence
 * columns are put back as they were.
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

const {
  broadcastRunner,
  endStaleBroadcasts,
  getBroadcastAccessRow,
  stampBroadcastViewer,
} = await import("@/db/queries/broadcasts");
const { endBroadcast, startBroadcast } = await import("@/lib/broadcasts/service");
const { setTutorLive } = await import("@/db/queries/presence");
const { acceptRequestAsTutor, getInstantTutorInfo } = await import("@/db/queries/session-requests");

const TITLE = "DB lane broadcast";

let alpha: TestConnection;
let beta: TestConnection;
let watcher: TestConnection;
let tutorId: string;
let studentId: string;
let saved: { is_live: boolean; live_mode: string | null; last_seen_at: string | null };
let bookingIds: string[];

beforeAll(async () => {
  alpha = openConnection("alpha");
  beta = openConnection("beta");
  watcher = openConnection("watcher");
  const [tutor] = await watcher.db.execute<{ user_id: string }>(sql`
    select tp.user_id
      from tutor_profiles tp
      join profiles p on p.id = tp.user_id
     where p.role = 'tutor' and not p.is_suspended and tp.approval_status = 'approved'
       and not exists (select 1 from bookings b where b.tutor_id = tp.user_id and b.status = 'in_progress')
       and not exists (select 1 from broadcasts b where b.tutor_id = tp.user_id and b.status = 'live')
     order by p.created_at
     limit 1
  `);
  const [student] = await watcher.db.execute<{ id: string }>(sql`
    select id from profiles where role = 'student' and not is_suspended order by created_at limit 1
  `);
  if (!tutor?.user_id || !student?.id) {
    throw new Error(
      "The test project needs an approved tutor with no live session or broadcast, and a student. Run `pnpm db:seed:test` first.",
    );
  }
  tutorId = tutor.user_id;
  studentId = student.id;
});

afterAll(async () => {
  await Promise.all([alpha.end(), beta.end(), watcher.end()]);
});

beforeEach(async () => {
  bookingIds = [];
  const [row] = await watcher.db.execute<typeof saved>(sql`
    select is_live, live_mode::text as live_mode, last_seen_at::text as last_seen_at
      from tutor_profiles where user_id = ${tutorId}
  `);
  saved = row;
});

afterEach(async () => {
  await watcher.db.execute(sql`delete from session_requests where tutor_id = ${tutorId} and message = ${TITLE}`);
  for (const id of bookingIds) await watcher.db.execute(sql`delete from bookings where id = ${id}`);
  await watcher.db.execute(sql`delete from broadcasts where tutor_id = ${tutorId} and title = ${TITLE}`);
  await watcher.db.execute(sql`
    update tutor_profiles
       set is_live = ${saved.is_live},
           live_mode = ${saved.live_mode}::tutor_live_mode,
           last_seen_at = ${saved.last_seen_at}::timestamptz
     where user_id = ${tutorId}
  `);
});

/** Start a broadcast on its own connection and commit it. */
async function startCommitted() {
  const held = await beginTransaction(alpha);
  const res = await withExecutor(held.tx, () =>
    startBroadcast(broadcastRunner, { tutorId, title: TITLE }),
  );
  await held.commit();
  if (!res.ok) throw new Error(`start refused: ${res.reason}`);
  return res;
}

async function onWatcher<T>(fn: () => Promise<T>): Promise<T> {
  const held = await beginTransaction(watcher);
  try {
    const out = await withExecutor(held.tx, fn);
    await held.commit();
    return out;
  } catch (err) {
    await held.rollback();
    throw err;
  }
}

async function liveCount(): Promise<number> {
  const [row] = await watcher.db.execute<{ n: number }>(sql`
    select count(*)::int as n from broadcasts where tutor_id = ${tutorId} and status = 'live'
  `);
  return Number(row.n);
}

async function insertPendingRequest(): Promise<string> {
  const id = randomUUID();
  await watcher.db.execute(sql`
    insert into session_requests (id, student_id, tutor_id, message, duration_minutes, price_credits, status, expires_at)
    values (${id}, ${studentId}, ${tutorId}, ${TITLE}, 30, 1, 'pending', now() + interval '60 seconds')
  `);
  return id;
}

async function requestStatus(id: string): Promise<string> {
  const [row] = await watcher.db.execute<{ status: string }>(sql`select status from session_requests where id = ${id}`);
  return row.status;
}

describe("starting a broadcast", () => {
  it("two concurrent starts give one live broadcast; the second is told which", async () => {
    const a = await beginTransaction(alpha);
    const b = await beginTransaction(beta);
    try {
      const first = await withExecutor(a.tx, () => startBroadcast(broadcastRunner, { tutorId, title: TITLE }));
      expect(first.ok).toBe(true);

      const second = withExecutor(b.tx, () => startBroadcast(broadcastRunner, { tutorId, title: TITLE }));
      await waitUntilBlockedBy(watcher, b.pid, a.pid);
      await a.commit();

      expect(await second).toEqual({
        ok: false,
        reason: "already_live",
        liveBroadcastId: first.ok ? first.broadcastId : undefined,
      });
      await b.commit();
    } catch (err) {
      await Promise.allSettled([a.rollback(), b.rollback()]);
      throw err;
    }
    expect(await liveCount()).toBe(1);
  });

  it("writes the channel as broadcast_{id} and puts the tutor in broadcast mode", async () => {
    const res = await startCommitted();
    expect(res.agoraChannel).toBe(`broadcast_${res.broadcastId}`);
    const [tp] = await watcher.db.execute<{ is_live: boolean; live_mode: string }>(sql`
      select is_live, live_mode::text as live_mode from tutor_profiles where user_id = ${tutorId}
    `);
    expect(tp).toEqual({ is_live: true, live_mode: "broadcast" });
    const access = await onWatcher(() => getBroadcastAccessRow(res.broadcastId));
    expect(access).toMatchObject({ status: "live", hostFresh: true, agoraChannel: `broadcast_${res.broadcastId}` });
  });

  it("the index refuses a second live row for a tutor, whoever writes it", async () => {
    await startCommitted();
    const id = randomUUID();
    let code: string | undefined;
    try {
      await watcher.db.execute(sql`
        insert into broadcasts (id, tutor_id, title, agora_channel, status, started_at)
        values (${id}, ${tutorId}, ${TITLE}, ${`broadcast_${id}`}, 'live', now())
      `);
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } };
      code = e.code ?? e.cause?.code;
    }
    expect(code).toBe("23505");
    expect(await liveCount()).toBe(1);
  });

  it("is refused while the tutor has an in_progress session", async () => {
    const bookingId = randomUUID();
    bookingIds.push(bookingId);
    await watcher.db.execute(sql`
      insert into bookings (id, student_id, tutor_id, type, status, duration_minutes, price_credits)
      values (${bookingId}, ${studentId}, ${tutorId}, 'instant', 'in_progress', 30, 1)
    `);
    const res = await onWatcher(() => startBroadcast(broadcastRunner, { tutorId, title: TITLE }));
    expect(res).toEqual({ ok: false, reason: "in_session" });
    expect(await liveCount()).toBe(0);
  });
});

describe("instant requests while broadcasting (Q5)", () => {
  it("starting expires waiting requests, and a broadcasting tutor can't accept a new one", async () => {
    const waiting = await insertPendingRequest();
    await startCommitted();
    expect(await requestStatus(waiting)).toBe("expired");

    const info = await onWatcher(() => getInstantTutorInfo(tutorId));
    expect(info).toMatchObject({ isLive: true, isBroadcasting: true });

    const fresh = await insertPendingRequest();
    const result = await onWatcher(() => acceptRequestAsTutor(fresh, tutorId));
    expect(result).toEqual({ status: "tutor_broadcasting" });
    expect(await requestStatus(fresh)).toBe("pending");
  });

  it("the instant toggle can't flip a broadcasting tutor either way; ending does", async () => {
    const res = await startCommitted();
    expect(await onWatcher(() => setTutorLive(tutorId, true))).toEqual({ status: "broadcasting" });
    expect(await onWatcher(() => setTutorLive(tutorId, false))).toEqual({ status: "broadcasting" });

    const ended = await onWatcher(() => endBroadcast(broadcastRunner, { tutorId, broadcastId: res.broadcastId }));
    expect(ended).toEqual({ ok: true, alreadyEnded: false });
    const [tp] = await watcher.db.execute<{ is_live: boolean; live_mode: string | null }>(sql`
      select is_live, live_mode::text as live_mode from tutor_profiles where user_id = ${tutorId}
    `);
    expect(tp).toEqual({ is_live: false, live_mode: null });
    expect(await onWatcher(() => setTutorLive(tutorId, true))).toMatchObject({ status: "ok", liveMode: "instant" });
  });
});

describe("the sweep and the viewer record", () => {
  it("ends a broadcast whose host went stale, and viewers lose access before that", async () => {
    const res = await startCommitted();
    await watcher.db.execute(sql`
      update tutor_profiles set last_seen_at = now() - interval '5 minutes' where user_id = ${tutorId}
    `);

    const before = await onWatcher(() => getBroadcastAccessRow(res.broadcastId));
    expect(before).toMatchObject({ status: "live", hostFresh: false });

    const { endedIds } = await onWatcher(() => endStaleBroadcasts());
    expect(endedIds).toContain(res.broadcastId);
    const after = await onWatcher(() => getBroadcastAccessRow(res.broadcastId));
    expect(after?.status).toBe("ended");

    // Idempotent: nothing left to end.
    expect((await onWatcher(() => endStaleBroadcasts())).endedIds).not.toContain(res.broadcastId);
  });

  it("leaves a broadcast with a fresh host alone", async () => {
    const res = await startCommitted();
    const { endedIds } = await onWatcher(() => endStaleBroadcasts());
    expect(endedIds).not.toContain(res.broadcastId);
  });

  it("records one open viewer row however many times a viewer joins", async () => {
    const res = await startCommitted();
    await onWatcher(() => stampBroadcastViewer(res.broadcastId, studentId));
    await onWatcher(() => stampBroadcastViewer(res.broadcastId, studentId));
    const [row] = await watcher.db.execute<{ n: number }>(sql`
      select count(*)::int as n from broadcast_viewers where broadcast_id = ${res.broadcastId} and user_id = ${studentId}
    `);
    expect(Number(row.n)).toBe(1);
  });
});
