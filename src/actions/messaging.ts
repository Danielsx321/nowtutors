"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSessionProfile, requireUser } from "@/lib/auth/guards";
import {
  getConversationHeaderFor,
  getMessageFor,
  getThreadPageFor,
  getUnreadCountFor,
  messagingRunner,
  type ThreadMessage,
} from "@/db/queries/messaging";
import {
  ATTACHMENT_BUCKET,
  attachmentObjectPath,
  attachmentRefusalMessage,
  isAttachmentPathFor,
  parseAttachmentPath,
  validateAttachment,
} from "@/lib/messaging/attachments";
import { messagingRefusalMessage } from "@/lib/messaging/rules";
import {
  DuplicateClientKeyError,
  markConversationRead as markConversationReadCore,
  sendMessage as sendMessageCore,
  startConversation as startConversationCore,
} from "@/lib/messaging/service";
import { createServiceClient } from "@/lib/supabase/admin";

/**
 * Messaging server actions (SPEC §7.9; Phase 9 Parts 1 and 2).
 *
 * **Identity always comes from the session**, never from the input (§5 Layer
 * 2). Writes call `requireUser()` first. The READS below are called from
 * client hooks without an `await` chain a redirect could travel through, so
 * they read the session profile and return an empty result when there is none,
 * rather than throwing a `NEXT_REDIRECT` that would surface as an unhandled
 * rejection (§5, "An action called from a layout must guard the same way").
 *
 * **Attachments use the service role, and only after a participant check.** The
 * `message-attachments` bucket is private with no client policies
 * (`drizzle/0019`). `createAttachmentUpload` signs one upload to a path it makes
 * itself, `sendMessage` confirms that object exists with an allowed stored size
 * and type before attaching it, and `getAttachmentUrl` signs a 5-minute download.
 *
 * No `revalidatePath`: both message routes are `force-dynamic`, and the thread
 * and badge update over Realtime, so a revalidation would only re-render the
 * page a send came from.
 *
 * TODO(Phase 10): email the recipient when they have been offline for more
 * than 5 minutes (§7.9, §11), honouring `notification_preferences.messages`.
 */

const uuid = z.string().uuid();

/** How long a signed download link works. Long enough to open, short enough not to share. */
const DOWNLOAD_TTL_SECONDS = 300;

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

export type CreateAttachmentUploadResult =
  | { ok: true; path: string; token: string }
  | { error: string };

const uploadSchema = z.object({
  conversationId: uuid,
  name: z.string().min(1).max(500),
  type: z.string().max(200),
  size: z.number().int(),
});

/**
 * Sign one upload into the private bucket for a participant (Part 2). The path
 * is made here, under this conversation, so the client never chooses where an
 * object lands. The browser then uploads with `uploadToSignedUrl`.
 */
export async function createAttachmentUpload(input: {
  conversationId: string;
  name: string;
  type: string;
  size: number;
}): Promise<CreateAttachmentUploadResult> {
  const user = await requireUser();
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { error: attachmentRefusalMessage("attachment_type") };

  const file = validateAttachment(parsed.data);
  if (!file.ok) return { error: attachmentRefusalMessage(file.reason) };

  const header = await getConversationHeaderFor(parsed.data.conversationId, user.id);
  if (!header) return { error: messagingRefusalMessage("not_found") };

  const path = attachmentObjectPath(parsed.data.conversationId, randomUUID(), parsed.data.name);
  const { data, error } = await createServiceClient()
    .storage.from(ATTACHMENT_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[messages/attachments] signed upload failed", { error: error?.message });
    return { error: attachmentRefusalMessage("attachment_missing") };
  }
  return { ok: true, path: data.path, token: data.token };
}

/**
 * Does the uploaded object really exist, with an allowed stored size and type?
 * The browser's own report of the file is not trusted: this reads what Storage
 * holds. The bucket's limits refuse a bad upload already; this refuses a send
 * that points at nothing, or at something Storage accepted under other rules.
 */
async function verifyUploadedAttachment(conversationId: string, path: string): Promise<boolean> {
  if (!isAttachmentPathFor(conversationId, path)) return false;
  const parsed = parseAttachmentPath(path);
  if (!parsed) return false;
  const { data, error } = await createServiceClient().storage.from(ATTACHMENT_BUCKET).info(path);
  if (error || !data) return false;
  const info = data as { size?: number | null; contentType?: string | null; metadata?: Record<string, unknown> | null };
  const size = Number(info.size ?? info.metadata?.size ?? NaN);
  const type = String(info.contentType ?? info.metadata?.mimetype ?? "");
  return validateAttachment({ name: parsed.name, type, size }).ok;
}

export type SendMessageResult = { ok: true; message: ThreadMessage } | { error: string };

const sendSchema = z.object({
  conversationId: uuid,
  clientKey: uuid,
  // The service trims and enforces the real limit; this only stops an absurd
  // payload before it reaches the database.
  body: z.string().max(20_000),
  attachmentPath: z.string().max(300).nullish(),
});

export async function sendMessage(input: {
  conversationId: string;
  body: string;
  clientKey: string;
  attachmentPath?: string | null;
}): Promise<SendMessageResult> {
  const user = await requireUser();
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { error: messagingRefusalMessage("not_found") };
  const { conversationId, body, clientKey } = parsed.data;
  const attachmentPath = parsed.data.attachmentPath ?? null;

  // Only a participant may attach, and only an object that is really there.
  // The participant check comes first so a stranger learns nothing about paths.
  if (attachmentPath !== null) {
    const header = await getConversationHeaderFor(conversationId, user.id);
    if (!header) return { error: messagingRefusalMessage("not_found") };
    if (!(await verifyUploadedAttachment(conversationId, attachmentPath))) {
      return { error: attachmentRefusalMessage("attachment_missing") };
    }
  }

  const attempt = () =>
    sendMessageCore(messagingRunner, {
      senderId: user.id,
      conversationId,
      body,
      clientKey,
      attachmentPath,
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
  return { ok: true, message: toThreadMessage(message) };
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

/** The thread's view of a message: everything but the raw storage path. */
function toThreadMessage(message: ThreadMessage & { attachmentPath?: string | null }): ThreadMessage {
  return {
    id: message.id,
    senderId: message.senderId,
    body: message.body,
    attachment: message.attachment,
    createdAt: message.createdAt,
    readAt: message.readAt,
  };
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
  return toThreadMessage(message);
}

/**
 * A 5-minute signed link to a message's attachment, for a participant only
 * (Part 2). Null for a missing or foreign message, or one with no attachment.
 */
export async function getAttachmentUrl(input: {
  messageId: string;
  conversationId: string;
}): Promise<string | null> {
  const profile = await getSessionProfile();
  const parsed = z.object({ messageId: uuid, conversationId: uuid }).safeParse(input);
  if (!profile || !parsed.success) return null;
  const message = await getMessageFor(parsed.data.messageId, profile.id);
  if (
    !message ||
    message.conversationId !== parsed.data.conversationId ||
    !message.attachmentPath ||
    !isAttachmentPathFor(message.conversationId, message.attachmentPath)
  ) {
    return null;
  }
  const { data, error } = await createServiceClient()
    .storage.from(ATTACHMENT_BUCKET)
    .createSignedUrl(message.attachmentPath, DOWNLOAD_TTL_SECONDS);
  if (error || !data) {
    console.error("[messages/attachments] signed download failed", { error: error?.message });
    return null;
  }
  return data.signedUrl;
}

/** Unread messages for the topbar badge. 0 when signed out. */
export async function getUnreadCount(): Promise<number> {
  const profile = await getSessionProfile();
  if (!profile || profile.role === "admin") return 0;
  return getUnreadCountFor(profile.id);
}
