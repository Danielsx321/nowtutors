import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { beginTransaction, openConnection, withExecutor, type TestConnection } from "./helpers/test-db";

/**
 * The new-message email decision against real rows (SPEC §7.9; Phase 10
 * Part 3): an away recipient gets one email for the first unread message from
 * a sender, none for the second, none once they are online. Everything runs
 * inside one transaction that is rolled back, so the test project keeps no
 * messages, conversations or `last_seen_at` changes.
 */
type Executor = import("@/db").DbTransaction;

vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { currentExecutor } = await import("./helpers/test-db");
  return {
    db: {
      execute: (query: SQL) => currentExecutor().execute(query),
      select: ((...args: Parameters<Executor["select"]>) => currentExecutor().select(...args)) as Executor["select"],
    },
  };
});

const { newMessageEmails } = await import("@/lib/email/message-emails");

let conn: TestConnection;

beforeAll(() => {
  conn = openConnection("messages");
});

afterAll(async () => {
  await conn.end();
});

describe("newMessageEmails on the test project", () => {
  it("emails once for a burst while the tutor is away, and not at all once they are online", async () => {
    const held = await beginTransaction(conn);
    try {
      await withExecutor(held.tx, async () => {
        const [people] = await held.tx.execute<{ student: string; tutor: string }>(sql`
          select (select id from profiles where role = 'student' order by created_at limit 1) as student,
                 (select id from profiles where role = 'tutor' order by created_at limit 1) as tutor`);
        const { student, tutor } = people;

        // Away: last seen an hour ago.
        await held.tx.execute(sql`update profiles set last_seen_at = now() - interval '1 hour' where id = ${tutor}`);
        const [conv] = await held.tx.execute<{ id: string }>(sql`
          insert into conversations (participant_a, participant_b) values (${student}, ${tutor})
          on conflict do nothing returning id`);
        const conversationId =
          conv?.id ??
          (
            await held.tx.execute<{ id: string }>(sql`
              select id from conversations
               where (participant_a = ${student} and participant_b = ${tutor})
                  or (participant_a = ${tutor} and participant_b = ${student}) limit 1`)
          )[0].id;
        // Anything already unread from this student would make ours "not first".
        await held.tx.execute(sql`
          update messages set read_at = now()
           where conversation_id = ${conversationId} and sender_id = ${student} and read_at is null`);

        const send = async (body: string) =>
          (
            await held.tx.execute<{ id: string }>(sql`
              insert into messages (conversation_id, sender_id, body, client_key, created_at)
              values (${conversationId}, ${student}, ${body}, ${randomUUID()}, clock_timestamp()) returning id`)
          )[0].id;

        const first = await send("Could we cover quadratics on Thursday?");
        const second = await send("Also, I have a test on Friday.");

        const forFirst = await newMessageEmails(first);
        expect(forFirst).toHaveLength(1);
        expect(forFirst[0]).toMatchObject({
          type: "new-message",
          to: { userId: tutor },
          props: {
            preview: "Could we cover quadratics on Thursday?",
            hasAttachment: false,
            threadPath: `/tutor/messages/${conversationId}`,
          },
        });
        expect(await newMessageEmails(second)).toEqual([]);

        // Online now: nothing, even for a fresh first message.
        await held.tx.execute(sql`update messages set read_at = now() where id in (${first}, ${second})`);
        await held.tx.execute(sql`update profiles set last_seen_at = now() where id = ${tutor}`);
        const third = await send("One more thing.");
        expect(await newMessageEmails(third)).toEqual([]);
      });
    } finally {
      await held.rollback();
    }
  });
});
