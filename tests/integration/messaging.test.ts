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
 * Messaging against a real Postgres (SPEC §4.5, §7.9; Phase 9 Part 1). Test
 * project only.
 *
 * **Why these can't be unit tests.** "Two students pressing Message at once get
 * one thread" is a property of the `conversations_pair_unique` index, and "a
 * double-submitted send lands once" is a property of the conversation row lock
 * plus the `messages_conv_client_key_unique` index (`drizzle/0018`). The fake in
 * `tests/unit/messaging-service.test.ts` models the rules, not those.
 *
 * **Each race is a genuine contest**, as in `withdrawals.test.ts`: connection A
 * runs the shipped function and holds its transaction open; B runs the same
 * function and blocks; Postgres confirms the block (`pg_blocking_pids`) before A
 * commits. Two sequential awaits would pass with no index and no lock.
 *
 * Every conversation this file creates is deleted afterwards (messages cascade).
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
  getConversationHeaderFor,
  getMessageFor,
  getThreadPageFor,
  listConversationsFor,
  messagingRunner,
} = await import("@/db/queries/messaging");
const { markConversationRead, sendMessage, startConversation } = await import(
  "@/lib/messaging/service"
);

let alpha: TestConnection;
let beta: TestConnection;
let watcher: TestConnection;
let studentId: string;
let tutorId: string;
let outsiderId: string;
let createdConversationIds: string[];

beforeAll(async () => {
  alpha = openConnection("alpha");
  beta = openConnection("beta");
  watcher = openConnection("watcher");
  // A student and an approved tutor with no thread between them yet, so the
  // start race begins from nothing.
  const [row] = await watcher.db.execute<{ student_id: string; tutor_id: string }>(sql`
    select s.id as student_id, t.id as tutor_id
      from profiles s
      cross join profiles t
      join tutor_profiles tp on tp.user_id = t.id and tp.approval_status = 'approved'
     where s.role = 'student' and not s.is_suspended
       and t.role = 'tutor' and not t.is_suspended
       and not exists (
         select 1 from conversations c
          where least(c.participant_a, c.participant_b) = least(s.id, t.id)
            and greatest(c.participant_a, c.participant_b) = greatest(s.id, t.id)
       )
     order by s.created_at, t.created_at
     limit 1
  `);
  if (!row?.student_id || !row?.tutor_id) {
    throw new Error(
      "The test project needs a seeded student and an approved tutor without a " +
        "conversation between them. Run `pnpm db:seed:test` first.",
    );
  }
  studentId = row.student_id;
  tutorId = row.tutor_id;
  const [outsider] = await watcher.db.execute<{ id: string }>(sql`
    select id from profiles
     where role = 'student' and id <> ${studentId}
     order by created_at limit 1
  `);
  if (!outsider?.id) {
    throw new Error("The test project needs a second seeded student. Run `pnpm db:seed:test` first.");
  }
  outsiderId = outsider.id;
});

afterAll(async () => {
  await Promise.all([alpha.end(), beta.end(), watcher.end()]);
});

beforeEach(() => {
  createdConversationIds = [];
});

afterEach(async () => {
  await watcher.db.execute(sql`
    delete from conversations
     where least(participant_a, participant_b) = least(${studentId}::uuid, ${tutorId}::uuid)
       and greatest(participant_a, participant_b) = greatest(${studentId}::uuid, ${tutorId}::uuid)
  `);
  for (const id of createdConversationIds) {
    await watcher.db.execute(sql`delete from conversations where id = ${id}`);
  }
});

/** Open the thread outside any race, committed. */
async function openThread(): Promise<string> {
  const held = await beginTransaction(alpha);
  const res = await withExecutor(held.tx, () =>
    startConversation(messagingRunner, { starterId: studentId, targetId: tutorId }),
  );
  await held.commit();
  if (!res.ok) throw new Error(`could not open thread: ${res.reason}`);
  createdConversationIds.push(res.conversationId);
  return res.conversationId;
}

describe("startConversation", () => {
  it("gives two concurrent starts for one pair the same single thread", async () => {
    const a = await beginTransaction(alpha);
    const b = await beginTransaction(beta);

    const first = await withExecutor(a.tx, () =>
      startConversation(messagingRunner, { starterId: studentId, targetId: tutorId }),
    );
    // B's insert conflicts on the pair index with A's uncommitted row and waits.
    const second = withExecutor(b.tx, () =>
      startConversation(messagingRunner, { starterId: studentId, targetId: tutorId }),
    );
    await waitUntilBlockedBy(watcher, b.pid, a.pid);
    await a.commit();
    const secondRes = await second;
    await b.commit();

    expect(first.ok && secondRes.ok).toBe(true);
    if (!first.ok || !secondRes.ok) return;
    expect(secondRes.conversationId).toBe(first.conversationId);

    const [count] = await watcher.db.execute<{ n: number }>(sql`
      select count(*)::int as n from conversations
       where least(participant_a, participant_b) = least(${studentId}::uuid, ${tutorId}::uuid)
         and greatest(participant_a, participant_b) = greatest(${studentId}::uuid, ${tutorId}::uuid)
    `);
    expect(Number(count.n)).toBe(1);
  });
});

describe("sendMessage", () => {
  it("lands a double-submitted send once, with both calls returning the same message", async () => {
    const conversationId = await openThread();
    const clientKey = crypto.randomUUID();
    const input = { senderId: studentId, conversationId, body: "Only once", clientKey };

    const a = await beginTransaction(alpha);
    const b = await beginTransaction(beta);
    const first = await withExecutor(a.tx, () => sendMessage(messagingRunner, input));
    // B waits on the conversation row lock A holds, then finds A's row by key.
    const second = withExecutor(b.tx, () => sendMessage(messagingRunner, input));
    await waitUntilBlockedBy(watcher, b.pid, a.pid);
    await a.commit();
    const secondRes = await second;
    await b.commit();

    expect(first.ok && secondRes.ok).toBe(true);
    if (!first.ok || !secondRes.ok) return;
    expect(secondRes.message.id).toBe(first.message.id);

    const [count] = await watcher.db.execute<{ n: number }>(sql`
      select count(*)::int as n from messages
       where conversation_id = ${conversationId} and client_key = ${clientKey}
    `);
    expect(Number(count.n)).toBe(1);
  });

  it("sets last_message_at to the message's created_at exactly, in the same transaction", async () => {
    const conversationId = await openThread();
    const held = await beginTransaction(alpha);
    const res = await withExecutor(held.tx, () =>
      sendMessage(messagingRunner, {
        senderId: tutorId,
        conversationId,
        body: "Timestamp check",
        clientKey: crypto.randomUUID(),
      }),
    );

    // Before commit, another connection sees neither the message nor the bump.
    const [before] = await watcher.db.execute<{ last: string | null }>(sql`
      select last_message_at::text as last from conversations where id = ${conversationId}
    `);
    expect(before.last).toBeNull();
    await held.commit();

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [row] = await watcher.db.execute<{ same: boolean }>(sql`
      select c.last_message_at = m.created_at as same
        from conversations c join messages m on m.conversation_id = c.id
       where c.id = ${conversationId} and m.id = ${res.message.id}
    `);
    expect(row.same).toBe(true);
  });
});

describe("participant-scoped reads", () => {
  it("shows a thread to its participants and nothing of it to anyone else", async () => {
    // The trusted connection bypasses RLS, so these reads' own participant
    // check is the only thing keeping one person's messages from another.
    const conversationId = await openThread();
    const held = await beginTransaction(alpha);
    const sent = await withExecutor(held.tx, () =>
      sendMessage(messagingRunner, {
        senderId: tutorId,
        conversationId,
        body: "Private to this thread",
        clientKey: crypto.randomUUID(),
      }),
    );
    await held.commit();
    if (!sent.ok) throw new Error(`send failed: ${sent.reason}`);

    const reads = await beginTransaction(alpha);
    const result = await withExecutor(reads.tx, async () => ({
      outsiderHeader: await getConversationHeaderFor(conversationId, outsiderId),
      outsiderPage: await getThreadPageFor(conversationId, outsiderId),
      outsiderMessage: await getMessageFor(sent.message.id, outsiderId),
      outsiderInbox: await listConversationsFor(outsiderId),
      studentHeader: await getConversationHeaderFor(conversationId, studentId),
      studentPage: await getThreadPageFor(conversationId, studentId),
      studentMessage: await getMessageFor(sent.message.id, studentId),
      studentInbox: await listConversationsFor(studentId),
    }));
    await reads.rollback();

    expect(result.outsiderHeader).toBeNull();
    expect(result.outsiderPage.messages).toEqual([]);
    expect(result.outsiderMessage).toBeNull();
    expect(result.outsiderInbox.some((c) => c.id === conversationId)).toBe(false);

    expect(result.studentHeader?.otherPartyId).toBe(tutorId);
    expect(result.studentPage.messages.map((m) => m.body)).toEqual(["Private to this thread"]);
    expect(result.studentMessage?.body).toBe("Private to this thread");
    const inboxRow = result.studentInbox.find((c) => c.id === conversationId);
    expect(inboxRow?.unreadCount).toBe(1);
  });
});

describe("markConversationRead", () => {
  it("marks only the other party's unread messages", async () => {
    const conversationId = await openThread();
    const send = async (senderId: string, body: string) => {
      const held = await beginTransaction(alpha);
      const res = await withExecutor(held.tx, () =>
        sendMessage(messagingRunner, { senderId, conversationId, body, clientKey: crypto.randomUUID() }),
      );
      await held.commit();
      if (!res.ok) throw new Error(`send failed: ${res.reason}`);
    };
    await send(studentId, "Question");
    await send(tutorId, "Answer one");
    await send(tutorId, "Answer two");

    const held = await beginTransaction(alpha);
    const res = await withExecutor(held.tx, () =>
      markConversationRead(messagingRunner, { readerId: studentId, conversationId }),
    );
    await held.commit();
    expect(res).toEqual({ ok: true, marked: 2 });

    const rows = await watcher.db.execute<{ sender_id: string; read: boolean }>(sql`
      select sender_id, read_at is not null as read from messages
       where conversation_id = ${conversationId}
    `);
    for (const r of rows) {
      expect(r.read).toBe(r.sender_id === tutorId);
    }
  });
});
