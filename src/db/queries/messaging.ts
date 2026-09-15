import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { conversations, messages, profiles, tutorProfiles } from "@/db/schema";
import { pgErrorCode } from "@/lib/credits/ledger";
import { parseAttachmentPath, type AttachmentKind } from "@/lib/messaging/attachments";
import type { StarterProfile, TargetProfile } from "@/lib/messaging/rules";
import {
  DuplicateClientKeyError,
  type ConversationRow,
  type MessageRow,
  type MessagingRunner,
  type MessagingStore,
} from "@/lib/messaging/service";

/**
 * The Drizzle adapter for messaging (SPEC §4.5, §7.9; Phase 9 Part 1). The
 * rules live in `lib/messaging/`; this file only says how each step reaches
 * Postgres, plus the reads the inbox and thread pages render.
 *
 * **Trusted server connection only.** `drizzle/0018` revoked every client write
 * on `conversations` and `messages`. Every caller is a server action or a
 * server component that has already derived the viewer from the session, and
 * every read below takes that viewer id and scopes to it: the trusted
 * connection bypasses RLS, so the participant check here is the authorization.
 *
 * `updated_at` is maintained by the `set_updated_at` trigger (`drizzle/0003`).
 */

const UNIQUE_VIOLATION = "23505";

const messageColumns = {
  id: messages.id,
  conversationId: messages.conversationId,
  senderId: messages.senderId,
  body: messages.body,
  attachmentUrl: messages.attachmentUrl,
  readAt: messages.readAt,
  createdAt: messages.createdAt,
};

const conversationColumns = {
  id: conversations.id,
  participantA: conversations.participantA,
  participantB: conversations.participantB,
};

function messagingStore(tx: DbTransaction): MessagingStore {
  return {
    async getStarter(userId): Promise<StarterProfile | null> {
      const [row] = await tx
        .select({ id: profiles.id, role: profiles.role, isSuspended: profiles.isSuspended })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      return row ?? null;
    },

    async getTarget(userId): Promise<TargetProfile | null> {
      const [row] = await tx
        .select({
          id: profiles.id,
          role: profiles.role,
          isSuspended: profiles.isSuspended,
          approvalStatus: tutorProfiles.approvalStatus,
        })
        .from(profiles)
        .leftJoin(tutorProfiles, eq(tutorProfiles.userId, profiles.id))
        .where(eq(profiles.id, userId))
        .limit(1);
      return row ?? null;
    },

    async upsertConversation(a, b): Promise<ConversationRow> {
      // DO NOTHING rather than a no-op DO UPDATE: an update would fire a
      // `conversations` UPDATE event at both participants for a thread that
      // did not change. A concurrent start that loses the race waits on the
      // pair index, conflicts, and the SELECT below (a new statement under READ
      // COMMITTED) sees the winner's committed row.
      await tx
        .insert(conversations)
        .values({ participantA: a, participantB: b })
        .onConflictDoNothing();
      const [row] = await tx
        .select(conversationColumns)
        .from(conversations)
        .where(
          sql`least(${conversations.participantA}, ${conversations.participantB}) = least(${a}::uuid, ${b}::uuid)
          and greatest(${conversations.participantA}, ${conversations.participantB}) = greatest(${a}::uuid, ${b}::uuid)`,
        )
        .limit(1);
      if (!row) throw new Error("conversation upsert returned no row");
      return row;
    },

    async lockConversation(id): Promise<ConversationRow | null> {
      const [row] = await tx
        .select(conversationColumns)
        .from(conversations)
        .where(eq(conversations.id, id))
        .for("update")
        .limit(1);
      return row ?? null;
    },

    async countRecentBySender(senderId, windowSeconds): Promise<number> {
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(messages)
        .where(
          and(
            eq(messages.senderId, senderId),
            sql`${messages.createdAt} > now() - make_interval(secs => ${windowSeconds})`,
          ),
        );
      return Number(row?.n ?? 0);
    },

    async insertMessage(values): Promise<MessageRow> {
      try {
        const [row] = await tx
          .insert(messages)
          .values({
            conversationId: values.conversationId,
            senderId: values.senderId,
            body: values.body,
            attachmentUrl: values.attachmentUrl,
            clientKey: values.clientKey,
          })
          .returning(messageColumns);
        return row;
      } catch (err) {
        // `messages_conv_client_key_unique` is the only unique index on the
        // table besides the generated primary key, so a 23505 here is it.
        if (pgErrorCode(err) === UNIQUE_VIOLATION) {
          throw new DuplicateClientKeyError(values.conversationId, values.clientKey);
        }
        throw err;
      }
    },

    async findByClientKey(conversationId, clientKey): Promise<MessageRow | null> {
      const [row] = await tx
        .select(messageColumns)
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), eq(messages.clientKey, clientKey)))
        .limit(1);
      return row ?? null;
    },

    async touchConversation(conversationId, messageId): Promise<void> {
      // In SQL, so `last_message_at` equals the message's `created_at` to the
      // microsecond (a JavaScript Date would drop them).
      await tx.execute(sql`
        update conversations c
           set last_message_at = m.created_at
          from messages m
         where m.id = ${messageId}
           and c.id = ${conversationId}
           and m.conversation_id = c.id
      `);
    },

    async markRead(conversationId, readerId): Promise<number> {
      const rows = await tx
        .update(messages)
        .set({ readAt: sql`now()` })
        .where(
          and(
            eq(messages.conversationId, conversationId),
            sql`${messages.senderId} <> ${readerId}`,
            sql`${messages.readAt} is null`,
          ),
        )
        .returning({ id: messages.id });
      return rows.length;
    },
  };
}

export const messagingRunner: MessagingRunner = (fn) =>
  db.transaction((tx) => fn(messagingStore(tx)));

// ── Reads for the pages ──────────────────────────────────────────────────────

export interface ConversationListItem {
  id: string;
  otherPartyId: string;
  otherPartyName: string;
  otherPartyAvatarUrl: string | null;
  lastMessagePreview: string | null;
  lastMessageFromMe: boolean;
  lastMessageAt: Date | null;
  unreadCount: number;
}

const PREVIEW_CHARS = 80;

/** The viewer's threads, newest activity first, with unread counts. */
export async function listConversationsFor(userId: string): Promise<ConversationListItem[]> {
  const rows = await db.execute<{
    id: string;
    other_id: string;
    other_name: string | null;
    other_full_name: string | null;
    other_avatar_url: string | null;
    last_body: string | null;
    last_sender_id: string | null;
    last_attachment_url: string | null;
    last_message_at: string | null;
    unread_count: number;
  }>(sql`
    select c.id,
           o.id as other_id,
           o.display_name as other_name,
           o.full_name as other_full_name,
           o.avatar_url as other_avatar_url,
           last.body as last_body,
           last.sender_id as last_sender_id,
           last.attachment_url as last_attachment_url,
           c.last_message_at::text as last_message_at,
           (select count(*)::int
              from messages u
             where u.conversation_id = c.id
               and u.sender_id <> ${userId}
               and u.read_at is null) as unread_count
      from conversations c
      join profiles o
        on o.id = case when c.participant_a = ${userId} then c.participant_b else c.participant_a end
      left join lateral (
        select m.body, m.sender_id, m.attachment_url
          from messages m
         where m.conversation_id = c.id
         order by m.created_at desc, m.id desc
         limit 1
      ) last on true
     where c.participant_a = ${userId} or c.participant_b = ${userId}
     order by c.last_message_at desc nulls last, c.created_at desc
     limit 100
  `);
  return rows.map((r) => ({
    id: r.id,
    otherPartyId: r.other_id,
    otherPartyName: r.other_name ?? r.other_full_name ?? "NowTutors user",
    otherPartyAvatarUrl: r.other_avatar_url,
    lastMessagePreview:
      r.last_body == null
        ? r.last_attachment_url
          ? "Sent an attachment"
          : null
        : r.last_body.length > PREVIEW_CHARS
          ? `${r.last_body.slice(0, PREVIEW_CHARS).trimEnd()}…`
          : r.last_body,
    lastMessageFromMe: r.last_sender_id === userId,
    lastMessageAt: r.last_message_at ? new Date(r.last_message_at) : null,
    unreadCount: Number(r.unread_count),
  }));
}

export interface ConversationHeader {
  id: string;
  otherPartyId: string;
  otherPartyName: string;
  otherPartyAvatarUrl: string | null;
  otherPartyRole: "student" | "tutor" | "admin" | null;
  /** Set when the other party is an approved tutor, for a profile link. */
  otherPartyTutorSlug: string | null;
}

/** The thread header, or null for a missing or foreign conversation. */
export async function getConversationHeaderFor(
  conversationId: string,
  userId: string,
): Promise<ConversationHeader | null> {
  const rows = await db.execute<{
    id: string;
    other_id: string;
    other_name: string | null;
    other_full_name: string | null;
    other_avatar_url: string | null;
    other_role: "student" | "tutor" | "admin" | null;
    tutor_slug: string | null;
  }>(sql`
    select c.id,
           o.id as other_id,
           o.display_name as other_name,
           o.full_name as other_full_name,
           o.avatar_url as other_avatar_url,
           o.role as other_role,
           case when tp.approval_status = 'approved' then tp.slug end as tutor_slug
      from conversations c
      join profiles o
        on o.id = case when c.participant_a = ${userId} then c.participant_b else c.participant_a end
      left join tutor_profiles tp on tp.user_id = o.id
     where c.id = ${conversationId}
       and (c.participant_a = ${userId} or c.participant_b = ${userId})
     limit 1
  `);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    otherPartyId: r.other_id,
    otherPartyName: r.other_name ?? r.other_full_name ?? "NowTutors user",
    otherPartyAvatarUrl: r.other_avatar_url,
    otherPartyRole: r.other_role,
    otherPartyTutorSlug: r.tutor_slug,
  };
}

export interface ThreadAttachment {
  /** The safe file name shown in the thread. */
  name: string;
  kind: AttachmentKind;
}

export interface ThreadMessage {
  id: string;
  senderId: string;
  body: string | null;
  /** Null for a text-only message. Downloads go through `getAttachmentUrl`. */
  attachment: ThreadAttachment | null;
  createdAt: string;
  readAt: string | null;
}

export interface ThreadCursor {
  createdAt: string;
  id: string;
}

export const THREAD_PAGE_SIZE = 50;

/** What the thread may show of a stored path: the safe name and the kind, never the path. */
function toAttachment(path: string | null): ThreadAttachment | null {
  if (!path) return null;
  const parsed = parseAttachmentPath(path);
  return parsed ? { name: parsed.name, kind: parsed.kind } : null;
}

/**
 * One page of a thread, oldest first for display. `before` pages backwards.
 * Empty for a missing or foreign conversation; callers check the header first.
 * Timestamps stay ISO text, so the cursor round-trips with its microseconds.
 */
export async function getThreadPageFor(
  conversationId: string,
  userId: string,
  before?: ThreadCursor,
): Promise<{ messages: ThreadMessage[]; hasOlder: boolean }> {
  const rows = await db.execute<{
    id: string;
    sender_id: string;
    body: string | null;
    attachment_url: string | null;
    created_at: string;
    read_at: string | null;
  }>(sql`
    select m.id, m.sender_id, m.body, m.attachment_url,
           to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
           case when m.read_at is null then null
                else to_char(m.read_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as read_at
      from messages m
      join conversations c on c.id = m.conversation_id
     where m.conversation_id = ${conversationId}
       and (c.participant_a = ${userId} or c.participant_b = ${userId})
       ${before ? sql`and (m.created_at, m.id) < (${before.createdAt}::timestamptz, ${before.id}::uuid)` : sql``}
     order by m.created_at desc, m.id desc
     limit ${THREAD_PAGE_SIZE + 1}
  `);
  const hasOlder = rows.length > THREAD_PAGE_SIZE;
  const page = rows.slice(0, THREAD_PAGE_SIZE).reverse();
  return {
    hasOlder,
    messages: page.map((r) => ({
      id: r.id,
      senderId: r.sender_id,
      body: r.body,
      attachment: toAttachment(r.attachment_url),
      createdAt: r.created_at,
      readAt: r.read_at,
    })),
  };
}

/** One message, or null when it's missing or not in the viewer's thread. */
export async function getMessageFor(
  messageId: string,
  userId: string,
): Promise<(ThreadMessage & { conversationId: string; attachmentPath: string | null }) | null> {
  const rows = await db.execute<{
    id: string;
    conversation_id: string;
    sender_id: string;
    body: string | null;
    attachment_url: string | null;
    created_at: string;
    read_at: string | null;
  }>(sql`
    select m.id, m.conversation_id, m.sender_id, m.body, m.attachment_url,
           to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
           case when m.read_at is null then null
                else to_char(m.read_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as read_at
      from messages m
      join conversations c on c.id = m.conversation_id
     where m.id = ${messageId}
       and (c.participant_a = ${userId} or c.participant_b = ${userId})
     limit 1
  `);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    body: r.body,
    attachment: toAttachment(r.attachment_url),
    attachmentPath: r.attachment_url,
    createdAt: r.created_at,
    readAt: r.read_at,
  };
}

/** Messages from other people in the viewer's threads that they haven't read. */
export async function getUnreadCountFor(userId: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    select count(*)::int as n
      from messages m
      join conversations c on c.id = m.conversation_id
     where (c.participant_a = ${userId} or c.participant_b = ${userId})
       and m.sender_id <> ${userId}
       and m.read_at is null
  `);
  return Number(rows[0]?.n ?? 0);
}

/** The thread between two people, if one exists. Never creates one. */
export async function findConversationBetween(
  userId: string,
  otherId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      sql`least(${conversations.participantA}, ${conversations.participantB}) = least(${userId}::uuid, ${otherId}::uuid)
      and greatest(${conversations.participantA}, ${conversations.participantB}) = greatest(${userId}::uuid, ${otherId}::uuid)`,
    )
    .limit(1);
  return row?.id ?? null;
}
