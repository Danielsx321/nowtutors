import "server-only";
import { and, eq, isNull, lt, ne } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, profiles } from "@/db/schema";
import type { EmailRequest } from "./types";

/**
 * The "new message while you were away" email (SPEC §7.9, §11; Phase 10 Part 3).
 *
 * Sent for a message only when all three hold, read after the send committed:
 * - the recipient has not been seen for more than {@link OFFLINE_AFTER_MINUTES}
 *   (`profiles.last_seen_at`, which the presence heartbeat bumps for every
 *   signed-in role; never seen counts as away);
 * - the message is still unread;
 * - it is the first unread message from this sender in this conversation, so a
 *   burst of ten messages emails once, and the next email waits until the
 *   recipient has read the thread.
 * The recipient's `messages` preference is checked by the sender, like every
 * other preference.
 */

export const OFFLINE_AFTER_MINUTES = 5;
const PREVIEW_CHARS = 140;

export async function newMessageEmails(messageId: string, now: Date = new Date()): Promise<EmailRequest[]> {
  const [row] = await db
    .select({
      conversationId: messages.conversationId,
      senderId: messages.senderId,
      body: messages.body,
      attachmentUrl: messages.attachmentUrl,
      readAt: messages.readAt,
      createdAt: messages.createdAt,
      participantA: conversations.participantA,
      participantB: conversations.participantB,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(eq(messages.id, messageId))
    .limit(1);
  if (!row || row.readAt) return [];

  const recipientId = row.participantA === row.senderId ? row.participantB : row.participantA;

  const [earlierUnread] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, row.conversationId),
        eq(messages.senderId, row.senderId),
        isNull(messages.readAt),
        lt(messages.createdAt, row.createdAt),
        ne(messages.id, messageId),
      ),
    )
    .limit(1);
  if (earlierUnread) return [];

  const people = await db
    .select({
      id: profiles.id,
      role: profiles.role,
      lastSeenAt: profiles.lastSeenAt,
      displayName: profiles.displayName,
      fullName: profiles.fullName,
    })
    .from(profiles)
    .where(eq(profiles.id, recipientId))
    .union(
      db
        .select({
          id: profiles.id,
          role: profiles.role,
          lastSeenAt: profiles.lastSeenAt,
          displayName: profiles.displayName,
          fullName: profiles.fullName,
        })
        .from(profiles)
        .where(eq(profiles.id, row.senderId)),
    );
  const recipient = people.find((p) => p.id === recipientId);
  const sender = people.find((p) => p.id === row.senderId);
  if (!recipient || !sender) return [];

  if (!isAway(recipient.lastSeenAt, now)) return [];

  const text = row.body?.trim() ?? "";
  const preview = text ? (text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1).trimEnd()}…` : text) : null;
  const base = recipient.role === "tutor" ? "/tutor/messages" : "/dashboard/messages";

  return [
    {
      type: "new-message",
      to: { userId: recipientId },
      props: {
        senderName: sender.displayName?.trim() || sender.fullName?.trim() || "Someone",
        preview,
        hasAttachment: row.attachmentUrl != null,
        threadPath: `${base}/${row.conversationId}`,
      },
    },
  ];
}

/** Away = not seen for more than five minutes, or never seen. */
export function isAway(lastSeenAt: Date | null, now: Date): boolean {
  if (!lastSeenAt) return true;
  return now.getTime() - lastSeenAt.getTime() > OFFLINE_AFTER_MINUTES * 60_000;
}
