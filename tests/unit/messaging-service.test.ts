import { beforeEach, describe, expect, it } from "vitest";
import { RATE_LIMIT, type StarterProfile, type TargetProfile } from "@/lib/messaging/rules";
import {
  DuplicateClientKeyError,
  markConversationRead,
  sendMessage,
  startConversation,
  type ConversationRow,
  type MessageRow,
  type MessagingRunner,
  type MessagingStore,
  type NewMessage,
} from "@/lib/messaging/service";

/**
 * The messaging write path (SPEC §7.9; Phase 9 Part 1) through the
 * {@link MessagingStore} seam.
 *
 * What is NOT here: the pair-index race and the client-key race. Those are
 * properties of Postgres indexes and row locks and live in
 * `tests/integration/messaging.test.ts`.
 */

const STUDENT = "student-1";
const OTHER_STUDENT = "student-2";
const TUTOR = "tutor-1";

class FakeMessaging implements MessagingStore {
  profiles = new Map<string, TargetProfile>();
  conversations: ConversationRow[] = [];
  messages: (MessageRow & { clientKey: string | null })[] = [];
  /** Messages outside the rate window still count as existing rows. */
  recentOverride: number | null = null;
  touched: { conversationId: string; messageId: string }[] = [];
  private seq = 0;
  private clock = new Date("2026-09-15T10:00:00Z").getTime();

  async getStarter(userId: string): Promise<StarterProfile | null> {
    const p = this.profiles.get(userId);
    return p ? { id: p.id, role: p.role, isSuspended: p.isSuspended } : null;
  }
  async getTarget(userId: string): Promise<TargetProfile | null> {
    return this.profiles.get(userId) ?? null;
  }
  async upsertConversation(a: string, b: string): Promise<ConversationRow> {
    const found = this.conversations.find(
      (c) =>
        (c.participantA === a && c.participantB === b) ||
        (c.participantA === b && c.participantB === a),
    );
    if (found) return found;
    const row = { id: `c-${++this.seq}`, participantA: a, participantB: b };
    this.conversations.push(row);
    return row;
  }
  async lockConversation(id: string): Promise<ConversationRow | null> {
    return this.conversations.find((c) => c.id === id) ?? null;
  }
  async countRecentBySender(senderId: string): Promise<number> {
    if (this.recentOverride !== null) return this.recentOverride;
    return this.messages.filter((m) => m.senderId === senderId).length;
  }
  async insertMessage(row: NewMessage): Promise<MessageRow> {
    if (
      this.messages.some(
        (m) => m.conversationId === row.conversationId && m.clientKey === row.clientKey,
      )
    ) {
      throw new DuplicateClientKeyError(row.conversationId, row.clientKey);
    }
    const message = {
      id: `m-${++this.seq}`,
      conversationId: row.conversationId,
      senderId: row.senderId,
      body: row.body,
      attachmentUrl: null,
      readAt: null,
      createdAt: new Date((this.clock += 1000)),
      clientKey: row.clientKey,
    };
    this.messages.push(message);
    return message;
  }
  async findByClientKey(conversationId: string, clientKey: string): Promise<MessageRow | null> {
    return (
      this.messages.find(
        (m) => m.conversationId === conversationId && m.clientKey === clientKey,
      ) ?? null
    );
  }
  async touchConversation(conversationId: string, messageId: string): Promise<void> {
    this.touched.push({ conversationId, messageId });
  }
  async markRead(conversationId: string, readerId: string): Promise<number> {
    let n = 0;
    for (const m of this.messages) {
      if (m.conversationId === conversationId && m.senderId !== readerId && m.readAt === null) {
        m.readAt = new Date(this.clock);
        n++;
      }
    }
    return n;
  }
}

let fake: FakeMessaging;
let run: MessagingRunner;

beforeEach(() => {
  fake = new FakeMessaging();
  fake.profiles.set(STUDENT, { id: STUDENT, role: "student", isSuspended: false, approvalStatus: null });
  fake.profiles.set(OTHER_STUDENT, {
    id: OTHER_STUDENT,
    role: "student",
    isSuspended: false,
    approvalStatus: null,
  });
  fake.profiles.set(TUTOR, { id: TUTOR, role: "tutor", isSuspended: false, approvalStatus: "approved" });
  run = (fn) => fn(fake);
});

async function openThread(): Promise<string> {
  const res = await startConversation(run, { starterId: STUDENT, targetId: TUTOR });
  if (!res.ok) throw new Error(`could not open thread: ${res.reason}`);
  return res.conversationId;
}

describe("startConversation", () => {
  it("opens one thread for a student and an approved tutor, and returns it again", async () => {
    const first = await openThread();
    const second = await openThread();
    expect(second).toBe(first);
    expect(fake.conversations).toHaveLength(1);
  });

  it("refuses a tutor opening a thread and writes nothing", async () => {
    const res = await startConversation(run, { starterId: TUTOR, targetId: STUDENT });
    expect(res).toEqual({ ok: false, reason: "not_student" });
    expect(fake.conversations).toHaveLength(0);
  });

  it("refuses a student messaging another student", async () => {
    const res = await startConversation(run, { starterId: STUDENT, targetId: OTHER_STUDENT });
    expect(res).toEqual({ ok: false, reason: "target_unavailable" });
    expect(fake.conversations).toHaveLength(0);
  });

  it("refuses an unknown target the same way as a wrong one", async () => {
    const res = await startConversation(run, { starterId: STUDENT, targetId: "nobody" });
    expect(res).toEqual({ ok: false, reason: "target_unavailable" });
  });
});

describe("sendMessage", () => {
  it("inserts the trimmed body and bumps the conversation in the same run", async () => {
    const conversationId = await openThread();
    const res = await sendMessage(run, {
      senderId: STUDENT,
      conversationId,
      body: "  Hello  ",
      clientKey: "k1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.message.body).toBe("Hello");
    expect(fake.touched).toEqual([{ conversationId, messageId: res.message.id }]);
  });

  it("lets the tutor reply inside a thread the student opened", async () => {
    const conversationId = await openThread();
    const res = await sendMessage(run, {
      senderId: TUTOR,
      conversationId,
      body: "Hi, happy to help",
      clientKey: "k2",
    });
    expect(res.ok).toBe(true);
  });

  it("returns the first message for a repeated client key and inserts nothing more", async () => {
    const conversationId = await openThread();
    const first = await sendMessage(run, { senderId: STUDENT, conversationId, body: "Once", clientKey: "same" });
    const again = await sendMessage(run, { senderId: STUDENT, conversationId, body: "Once", clientKey: "same" });
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.message.id).toBe(first.message.id);
    expect(fake.messages).toHaveLength(1);
    expect(fake.touched).toHaveLength(1);
  });

  it("does not hand one participant's message to the other through a reused key", async () => {
    const conversationId = await openThread();
    await sendMessage(run, { senderId: STUDENT, conversationId, body: "Mine", clientKey: "shared" });
    const res = await sendMessage(run, { senderId: TUTOR, conversationId, body: "Theirs", clientKey: "shared" });
    expect(res).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a non-participant exactly like a missing conversation", async () => {
    const conversationId = await openThread();
    const foreign = await sendMessage(run, {
      senderId: OTHER_STUDENT,
      conversationId,
      body: "Let me in",
      clientKey: "k3",
    });
    const missing = await sendMessage(run, {
      senderId: STUDENT,
      conversationId: "no-such-thread",
      body: "Hello?",
      clientKey: "k4",
    });
    expect(foreign).toEqual({ ok: false, reason: "not_found" });
    expect(missing).toEqual({ ok: false, reason: "not_found" });
    expect(fake.messages).toHaveLength(0);
  });

  it("refuses a suspended sender", async () => {
    const conversationId = await openThread();
    fake.profiles.set(TUTOR, { ...fake.profiles.get(TUTOR)!, isSuspended: true });
    const res = await sendMessage(run, { senderId: TUTOR, conversationId, body: "Hi", clientKey: "k5" });
    expect(res).toEqual({ ok: false, reason: "sender_suspended" });
  });

  it("refuses at the rate limit and allows just under it", async () => {
    const conversationId = await openThread();
    fake.recentOverride = RATE_LIMIT.count - 1;
    expect(
      (await sendMessage(run, { senderId: STUDENT, conversationId, body: "ok", clientKey: "r1" })).ok,
    ).toBe(true);
    fake.recentOverride = RATE_LIMIT.count;
    expect(
      await sendMessage(run, { senderId: STUDENT, conversationId, body: "too many", clientKey: "r2" }),
    ).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("refuses an empty body before touching the store", async () => {
    const res = await sendMessage(run, {
      senderId: STUDENT,
      conversationId: "anything",
      body: "   ",
      clientKey: "k6",
    });
    expect(res).toEqual({ ok: false, reason: "empty" });
  });
});

describe("markConversationRead", () => {
  it("marks only the other party's unread messages", async () => {
    const conversationId = await openThread();
    await sendMessage(run, { senderId: STUDENT, conversationId, body: "Question", clientKey: "a" });
    await sendMessage(run, { senderId: TUTOR, conversationId, body: "Answer 1", clientKey: "b" });
    await sendMessage(run, { senderId: TUTOR, conversationId, body: "Answer 2", clientKey: "c" });

    const res = await markConversationRead(run, { readerId: STUDENT, conversationId });
    expect(res).toEqual({ ok: true, marked: 2 });
    const own = fake.messages.find((m) => m.senderId === STUDENT)!;
    expect(own.readAt).toBeNull();
  });

  it("refuses a non-participant", async () => {
    const conversationId = await openThread();
    const res = await markConversationRead(run, { readerId: OTHER_STUDENT, conversationId });
    expect(res).toEqual({ ok: false, reason: "not_found" });
  });
});
