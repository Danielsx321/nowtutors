import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The new-message email is queued after a send that created a message, and
 * never for a retried client key that found the first send (SPEC §7.9, §11;
 * Phase 10 Part 3). Who is away and whether this is the first unread message
 * are decided inside `newMessageEmails`, after the response; `isAway` and the
 * queries are covered elsewhere.
 */

const m = vi.hoisted(() => ({
  queueEmails: vi.fn(),
  newMessageEmails: vi.fn(),
  sendCore: vi.fn(),
  getMessageFor: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/email", () => ({ queueEmails: (...a: unknown[]) => m.queueEmails(...a) }));
vi.mock("@/lib/email/message-emails", () => ({ newMessageEmails: (...a: unknown[]) => m.newMessageEmails(...a) }));
vi.mock("@/lib/auth/guards", () => ({
  requireUser: async () => ({ id: "sender-1" }),
  getSessionProfile: async () => null,
}));
vi.mock("@/db/queries/messaging", () => ({
  getConversationHeaderFor: vi.fn(),
  getMessageFor: (...a: unknown[]) => m.getMessageFor(...a),
  getThreadPageFor: vi.fn(),
  getUnreadCountFor: vi.fn(),
  messagingRunner: "runner",
}));
vi.mock("@/lib/messaging/attachments", () => ({
  ATTACHMENT_BUCKET: "b",
  attachmentObjectPath: vi.fn(),
  attachmentRefusalMessage: vi.fn(),
  isAttachmentPathFor: vi.fn(),
  parseAttachmentPath: vi.fn(),
  validateAttachment: vi.fn(),
}));
vi.mock("@/lib/messaging/service", () => ({
  DuplicateClientKeyError: class extends Error {},
  markConversationRead: vi.fn(),
  sendMessage: (...a: unknown[]) => m.sendCore(...a),
  startConversation: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createServiceClient: vi.fn() }));

const { sendMessage } = await import("@/actions/messaging");

const CONV = randomUUID();
const MSG = randomUUID();
const row = {
  id: MSG,
  conversationId: CONV,
  senderId: "sender-1",
  body: "Hi",
  attachmentUrl: null,
  readAt: null,
  createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getMessageFor.mockResolvedValue({ ...row, createdAt: row.createdAt.toISOString(), attachmentPath: null });
});

describe("new-message email hook", () => {
  it("queues the email for a newly created message", async () => {
    m.sendCore.mockResolvedValue({ ok: true, message: row, created: true });
    const res = await sendMessage({ conversationId: CONV, body: "Hi", clientKey: randomUUID() });
    expect(res).toMatchObject({ ok: true });
    expect(m.queueEmails).toHaveBeenCalledTimes(1);
    await (m.queueEmails.mock.calls[0][0] as () => Promise<unknown>)();
    expect(m.newMessageEmails).toHaveBeenCalledWith(MSG);
  });

  it("queues nothing for a retried client key", async () => {
    m.sendCore.mockResolvedValue({ ok: true, message: row, created: false });
    await sendMessage({ conversationId: CONV, body: "Hi", clientKey: randomUUID() });
    expect(m.queueEmails).not.toHaveBeenCalled();
  });

  it("queues nothing for a refused send", async () => {
    m.sendCore.mockResolvedValue({ ok: false, reason: "rate_limited" });
    await sendMessage({ conversationId: CONV, body: "Hi", clientKey: randomUUID() });
    expect(m.queueEmails).not.toHaveBeenCalled();
  });
});
