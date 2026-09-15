-- Phase 9 Part 1: messaging and broadcasts write paths (SPEC §4.5, §4.6, §5;
-- DECISIONS, "Phase 9 Part 1").
--
-- PARTLY HAND-WRITTEN. `drizzle-kit generate` produced the first three
-- statements from src/db/schema/communication.ts (messages.client_key, its
-- partial unique index, the unread index). The policy and privilege changes
-- after them are hand-written: drizzle-kit does not manage this project's RLS
-- (0005, 0012, 0015).
--
-- WHY. drizzle/0005 gave `authenticated` INSERT/UPDATE on these tables with
-- ownership-only checks. Proven on the test project before this file existed
-- (`pnpm db:verify-rls:test`, 2026-09-15), a signed-in user could:
--   * INSERT a conversation with any profile (student to student, anyone to an
--     unapproved tutor);
--   * rewrite a conversation's other participant, handing a stranger the thread;
--   * UPDATE the other party's message body;
--   * INSERT a message past every server rule (length, suspension, rate,
--     last_message_at);
--   * INSERT a broadcast as ANY role with an agora_channel of their choosing.
--     The §9 broadcast token branch reads the channel off that row, so this was
--     a publisher token into someone's private `session_<booking id>` channel
--     the moment that branch shipped;
--   * INSERT broadcast_viewers rows (anon included) to flood viewer counts.
-- Every one of these writes needs rules RLS cannot express, and SPEC §5
-- already records that a column REVOKE is overridden by a table-level grant.
-- So every client write is removed. Reads are unchanged: participants read
-- their threads, anyone reads broadcasts. Realtime relies on those SELECT
-- policies and keeps working.
--
-- Authorization for the trusted path is SPEC §5 Layer 2: every messaging
-- action calls requireUser() and derives the caller from the session.

ALTER TABLE "messages" ADD COLUMN "client_key" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conv_client_key_unique" ON "messages" USING btree ("conversation_id","client_key") WHERE "messages"."client_key" is not null;--> statement-breakpoint
CREATE INDEX "messages_unread_idx" ON "messages" USING btree ("conversation_id") WHERE "messages"."read_at" is null;
--> statement-breakpoint

DROP POLICY IF EXISTS "conversations_insert" ON public.conversations;
--> statement-breakpoint
DROP POLICY IF EXISTS "conversations_update" ON public.conversations;
--> statement-breakpoint
DROP POLICY IF EXISTS "messages_insert" ON public.messages;
--> statement-breakpoint
DROP POLICY IF EXISTS "messages_update" ON public.messages;
--> statement-breakpoint
DROP POLICY IF EXISTS "broadcasts_write" ON public.broadcasts;
--> statement-breakpoint
DROP POLICY IF EXISTS "broadcast_viewers_insert" ON public.broadcast_viewers;
--> statement-breakpoint
DROP POLICY IF EXISTS "broadcast_viewers_update" ON public.broadcast_viewers;
--> statement-breakpoint

-- Policies alone would already deny these (RLS is enabled and no write policy
-- remains), but the privileges go too, so re-adding a permissive policy later
-- is not enough to reopen a hole by accident. SELECT grants are untouched.
REVOKE INSERT, UPDATE, DELETE ON public.conversations FROM anon, authenticated;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON public.messages FROM anon, authenticated;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON public.broadcasts FROM anon, authenticated;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON public.broadcast_viewers FROM anon, authenticated;
