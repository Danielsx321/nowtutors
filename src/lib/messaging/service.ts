import { isAttachmentPathFor } from "@/lib/messaging/attachments";
import {
  canStartConversation,
  RATE_LIMIT,
  validateBody,
  type MarkReadRefusal,
  type SendRefusal,
  type StarterProfile,
  type StartRefusal,
  type TargetProfile,
} from "@/lib/messaging/rules";

/**
 * The messaging write path (SPEC §7.9; Phase 9 Parts 1 and 2).
 *
 * **Every write is a server action on the trusted connection.** drizzle/0018
 * removed every client INSERT and UPDATE on `conversations` and `messages`, so
 * nothing here can be skipped by talking to PostgREST directly.
 *
 * **A send is one transaction:** the participant check, the suspension check,
 * the rate check, the insert and the `last_message_at` bump all commit together.
 * The bump is what fires the `conversations` UPDATE both participants' unread
 * badges listen to (§8), so a message that exists without it would never raise
 * a badge.
 *
 * **A double-submitted send lands once.** The composer sends a fresh
 * `clientKey` per message; the partial unique index on
 * `(conversation_id, client_key)` refuses the second insert and this returns the
 * first row as success, so the composer's retry path needs no special case.
 *
 * **Attachments (Part 2).** A message may carry one attachment path, and then its
 * text may be empty. The path must parse as an attachment path under THIS
 * conversation, so a participant can't attach an object from another thread.
 * That the object really exists, and its stored size and type, are checked by
 * the action against Storage before this runs; the database's
 * `messages_body_or_attachment` constraint backs up "never neither".
 *
 * **A missing conversation and someone else's conversation are the same
 * `not_found`**, so no action can be used to discover conversation ids.
 *
 * Behind {@link MessagingStore} so the rules run in unit tests without Postgres.
 * The adapter is `db/queries/messaging.ts`; the properties that only Postgres can
 * show (the pair-index race, the client-key race) are asserted in
 * `tests/integration/messaging.test.ts`.
 */

export interface ConversationRow {
  id: string;
  participantA: string;
  participantB: string;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  attachmentUrl: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NewMessage {
  conversationId: string;
  senderId: string;
  body: string | null;
  /** The object path in the private bucket, never a URL. */
  attachmentUrl: string | null;
  clientKey: string;
}

/** Raised by the adapter when the client-key index refuses an insert. */
export class DuplicateClientKeyError extends Error {
  readonly code = "duplicate_client_key" as const;
  constructor(
    readonly conversationId: string,
    readonly clientKey: string,
  ) {
    super("A message with this client key already exists in the conversation.");
    this.name = "DuplicateClientKeyError";
  }
}

/** Storage for ONE transaction. Every method runs inside it. */
export interface MessagingStore {
  getStarter(userId: string): Promise<StarterProfile | null>;
  getTarget(userId: string): Promise<TargetProfile | null>;
  /**
   * Insert the pair's thread, or return the existing one. Must be a single
   * statement against the pair index so two concurrent starts get one row.
   */
  upsertConversation(a: string, b: string): Promise<ConversationRow>;
  /**
   * The conversation under `SELECT ... FOR UPDATE`, or null. The lock serializes
   * two sends in one thread so the rate count and `last_message_at` agree.
   */
  lockConversation(id: string): Promise<ConversationRow | null>;
  /** Messages this sender wrote in the last `windowSeconds`, by database clock. */
  countRecentBySender(senderId: string, windowSeconds: number): Promise<number>;
  /** Throws {@link DuplicateClientKeyError} on the client-key index. */
  insertMessage(row: NewMessage): Promise<MessageRow>;
  findByClientKey(conversationId: string, clientKey: string): Promise<MessageRow | null>;
  /** `last_message_at = <the message's created_at>`, written in SQL. */
  touchConversation(conversationId: string, messageId: string): Promise<void>;
  /** `read_at = now()` on the other party's unread messages. Returns the count. */
  markRead(conversationId: string, readerId: string): Promise<number>;
}

/** Runs `fn` in one transaction; a throw rolls everything back. */
export type MessagingRunner = <T>(
  fn: (store: MessagingStore) => Promise<T>,
) => Promise<T>;

function isParticipant(conversation: ConversationRow, userId: string): boolean {
  return conversation.participantA === userId || conversation.participantB === userId;
}

export async function startConversation(
  run: MessagingRunner,
  input: { starterId: string; targetId: string },
): Promise<
  { ok: true; conversationId: string } | { ok: false; reason: StartRefusal }
> {
  return run(async (store) => {
    const starter = await store.getStarter(input.starterId);
    if (!starter) return { ok: false as const, reason: "not_student" as const };
    const target = await store.getTarget(input.targetId);
    const allowed = canStartConversation(starter, target);
    if (!allowed.ok) return allowed;
    const conversation = await store.upsertConversation(input.starterId, input.targetId);
    return { ok: true as const, conversationId: conversation.id };
  });
}

/**
 * The text and attachment a send will store, or why not. With an attachment the
 * text is optional; without one it's required. Pure, so the composer's rule and
 * the server's rule can't drift.
 */
export function prepareContent(input: {
  conversationId: string;
  body: string;
  attachmentPath?: string | null;
}):
  | { ok: true; body: string | null; attachmentUrl: string | null }
  | { ok: false; reason: SendRefusal } {
  const path = input.attachmentPath ?? null;
  if (path !== null && !isAttachmentPathFor(input.conversationId, path)) {
    return { ok: false, reason: "attachment_invalid" };
  }
  const body = validateBody(input.body);
  if (body.ok) return { ok: true, body: body.body, attachmentUrl: path };
  if (body.reason === "empty" && path !== null) {
    return { ok: true, body: null, attachmentUrl: path };
  }
  return body;
}

export async function sendMessage(
  run: MessagingRunner,
  input: {
    senderId: string;
    conversationId: string;
    body: string;
    clientKey: string;
    attachmentPath?: string | null;
  },
): Promise<{ ok: true; message: MessageRow } | { ok: false; reason: SendRefusal }> {
  const content = prepareContent(input);
  if (!content.ok) return content;

  return run(async (store) => {
    const conversation = await store.lockConversation(input.conversationId);
    if (!conversation || !isParticipant(conversation, input.senderId)) {
      return { ok: false as const, reason: "not_found" as const };
    }

    // A retry of a send that already landed is a success, not a second
    // message, and it must not be counted against the rate limit either.
    const already = await store.findByClientKey(input.conversationId, input.clientKey);
    if (already) {
      if (already.senderId !== input.senderId) {
        return { ok: false as const, reason: "not_found" as const };
      }
      return { ok: true as const, message: already };
    }

    const sender = await store.getStarter(input.senderId);
    if (!sender || sender.isSuspended) {
      return { ok: false as const, reason: "sender_suspended" as const };
    }

    const recent = await store.countRecentBySender(input.senderId, RATE_LIMIT.windowSeconds);
    if (recent >= RATE_LIMIT.count) {
      return { ok: false as const, reason: "rate_limited" as const };
    }

    // The conversation lock above makes a same-key race wait for the first send
    // to commit, so `findByClientKey` sees it. The index is the backstop: if it
    // ever fires, the insert throws DuplicateClientKeyError, the transaction
    // rolls back, and the action's single retry reads the winner.
    const message = await store.insertMessage({
      conversationId: input.conversationId,
      senderId: input.senderId,
      body: content.body,
      attachmentUrl: content.attachmentUrl,
      clientKey: input.clientKey,
    });
    await store.touchConversation(input.conversationId, message.id);
    return { ok: true as const, message };
  });
}

export async function markConversationRead(
  run: MessagingRunner,
  input: { readerId: string; conversationId: string },
): Promise<{ ok: true; marked: number } | { ok: false; reason: MarkReadRefusal }> {
  return run(async (store) => {
    const conversation = await store.lockConversation(input.conversationId);
    if (!conversation || !isParticipant(conversation, input.readerId)) {
      return { ok: false as const, reason: "not_found" as const };
    }
    const marked = await store.markRead(input.conversationId, input.readerId);
    return { ok: true as const, marked };
  });
}
