"use server";

import { z } from "zod";
import { getSessionProfile, requireUser } from "@/lib/auth/guards";
import {
  getMessageFor,
  getThreadPageFor,
  getUnreadCountFor,
  messagingRunner,
  type ThreadMessage,
} from "@/db/queries/messaging";
import { messagingRefusalMessage } from "@/lib/messaging/rules";
import {
  DuplicateClientKeyError,
  markConversationRead as markConversationReadCore,
  sendMessage as sendMessageCore,
  startConversation as startConversationCore,
} from "@/lib/messaging/service";

/**
 * Messaging server actions (SPEC §7.9; Phase 9 Part 1).
 *
 * **Identity always comes from the session**, never from the input (§5 Layer
 * 2). Writes call `requireUser()` first. The READS below are called from
 * client hooks without an `await` chain a redirect could travel through, so
 * they read the session profile and return an empty result when there is none,
 * rather than throwing a `NEXT_REDIRECT` that would surface as an unhandled
 * rejection (§5, "An action called from a layout must guard the same way").
 *
 * No `revalidatePath`: both message routes are `force-dynamic`, and the thread
 * and badge update over Realtime, so a revalidation would only re-render the
 * page a send came from.
 *
 * TODO(Phase 10): email the recipient when they have been offline for more
 * than 5 minutes (§7.9, §11), honouring `notification_preferences.messages`.
 */

const uuid = z.string().uuid();

export type StartConversationResult =
  | { ok: true; conversationId: string; href: string }
  | { error: string };

export async function startConversation(input: {
  tutorId: string;
}): Promise<StartConversationResult> {
  const user = await requireUser();
  const parsed = z.object({ tutorId: uuid }).safeParse(input);
  if (!parsed.success) return { error: messagingRefusalMessage("target_unavailable") };

  const res = await startConversationCore(messagingRunner, {
    starterId: user.id,
    targetId: parsed.data.tutorId,
  });
  if (!res.ok) return { error: messagingRefusalMessage(res.reason) };
  // Only a student can start one, so the student route is always right.
  return {
    ok: true,
    conversationId: res.conversationId,
    href: `/dashboard/messages/${res.conversationId}`,
  };
}

export type SendMessageResult = { ok: true; message: ThreadMessage } | { error: string };

const sendSchema = z.object({
  conversationId: uuid,
  clientKey: uuid,
  // The service trims and enforces the real limit; this only stops an absurd
  // payload before it reaches the database.
  body: z.string().max(20_000),
});

export async function sendMessage(input: {
  conversationId: string;
  body: string;
  clientKey: string;
}): Promise<SendMessageResult> {
  const user = await requireUser();
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { error: messagingRefusalMessage("not_found") };

  const attempt = () =>
    sendMessageCore(messagingRunner, {
      senderId: user.id,
      conversationId: parsed.data.conversationId,
      body: parsed.data.body,
      clientKey: parsed.data.clientKey,
    });

  let res;
  try {
    res = await attempt();
  } catch (err) {
    // The index backstop fired (service.ts): the first send committed while
    // this one was past its lookup. One retry finds it by key and returns it.
    if (!(err instanceof DuplicateClientKeyError)) throw err;
    res = await attempt();
  }
  if (!res.ok) return { error: messagingRefusalMessage(res.reason) };

  // Re-read through the participant-scoped query, so the row the composer shows
  // has the same ISO timestamp (microseconds included) as a Realtime read-back.
  const message = await getMessageFor(res.message.id, user.id);
  if (!message) return { error: messagingRefusalMessage("not_found") };
  return {
    ok: true,
    message: {
      id: message.id,
      senderId: message.senderId,
      body: message.body,
      createdAt: message.createdAt,
      readAt: message.readAt,
    },
  };
}

export async function markConversationRead(input: {
  conversationId: string;
}): Promise<{ ok: true; marked: number } | { error: string }> {
  const profile = await getSessionProfile();
  if (!profile) return { error: messagingRefusalMessage("not_found") };
  const parsed = z.object({ conversationId: uuid }).safeParse(input);
  if (!parsed.success) return { error: messagingRefusalMessage("not_found") };

  const res = await markConversationReadCore(messagingRunner, {
    readerId: profile.id,
    conversationId: parsed.data.conversationId,
  });
  if (!res.ok) return { error: messagingRefusalMessage(res.reason) };
  return { ok: true, marked: res.marked };
}

const cursorSchema = z.object({
  createdAt: z.string().datetime({ precision: 6 }),
  id: uuid,
});

export async function getThreadPage(input: {
  conversationId: string;
  before?: { createdAt: string; id: string };
}): Promise<{ messages: ThreadMessage[]; hasOlder: boolean }> {
  const profile = await getSessionProfile();
  const parsed = z
    .object({ conversationId: uuid, before: cursorSchema.optional() })
    .safeParse(input);
  if (!profile || !parsed.success) return { messages: [], hasOlder: false };
  return getThreadPageFor(parsed.data.conversationId, profile.id, parsed.data.before);
}

/**
 * One message, read back after a Realtime INSERT (§8: the payload is a
 * notification, the data comes from here). Null for anything the viewer can't
 * see, including a message from another conversation.
 */
export async function getMessage(input: {
  messageId: string;
  conversationId: string;
}): Promise<ThreadMessage | null> {
  const profile = await getSessionProfile();
  const parsed = z.object({ messageId: uuid, conversationId: uuid }).safeParse(input);
  if (!profile || !parsed.success) return null;
  const message = await getMessageFor(parsed.data.messageId, profile.id);
  if (!message || message.conversationId !== parsed.data.conversationId) return null;
  return {
    id: message.id,
    senderId: message.senderId,
    body: message.body,
    createdAt: message.createdAt,
    readAt: message.readAt,
  };
}

/** Unread messages for the topbar badge. 0 when signed out. */
export async function getUnreadCount(): Promise<number> {
  const profile = await getSessionProfile();
  if (!profile || profile.role === "admin") return 0;
  return getUnreadCountFor(profile.id);
}
