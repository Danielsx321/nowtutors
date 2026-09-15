import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt, uuidPk } from "./_helpers";
import { profiles } from "./identity";

// One thread per participant pair — enforced by a unique expression index on
// (least, greatest) added in a custom migration (SPEC §4.5).
export const conversations = pgTable("conversations", {
  id: uuidPk(),
  participantA: uuid("participant_a")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  participantB: uuid("participant_b")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const messages = pgTable(
  "messages",
  {
    id: uuidPk(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => profiles.id),
    body: text("body"),
    attachmentUrl: text("attachment_url"),
    readAt: timestamp("read_at", { withTimezone: true }),
    // One per composer send (Phase 9 Part 1). A double-submitted send lands once:
    // the second insert hits the unique index and the service returns the first.
    clientKey: uuid("client_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("messages_conv_created_idx").on(t.conversationId, t.createdAt.desc()),
    uniqueIndex("messages_conv_client_key_unique")
      .on(t.conversationId, t.clientKey)
      .where(sql`${t.clientKey} is not null`),
    // Unread counts only ever look at unread rows.
    index("messages_unread_idx").on(t.conversationId).where(sql`${t.readAt} is null`),
    // Phase 9 Part 2: a message is text, an attachment, or both, never neither.
    // `attachment_url` holds the object PATH in the private bucket, never a URL.
    check("messages_body_or_attachment", sql`${t.body} is not null or ${t.attachmentUrl} is not null`),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title"),
    body: text("body"),
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("notifications_user_created_idx").on(t.userId, t.createdAt.desc())],
);
