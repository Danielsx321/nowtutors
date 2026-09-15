-- Phase 9 Part 2: message attachments (SPEC §4.5, §7.9; DECISIONS, "Phase 9 Part 2").
--
-- PARTLY HAND-WRITTEN. `drizzle-kit generate` produced the CHECK constraint
-- from src/db/schema/communication.ts: a message is text, an attachment, or
-- both, never neither. The bucket below is hand-written: drizzle-kit does not
-- manage Supabase Storage (same as 0007 for avatars).
--
-- Settled 2026-09-15: jpg, png and PDF, up to 10 MB, one per message.
--
-- The bucket is PRIVATE and this migration adds NO storage.objects policies
-- for it. With RLS on storage.objects and no policy naming this bucket, an
-- anon or signed-in client can't list, read, upload or delete here at all.
-- Every upload is a signed upload URL and every download a short-lived signed
-- URL, both issued by a server action on the service role only after it has
-- checked the caller is a participant in the conversation the object belongs
-- to (object path `{conversation_id}/{uuid}/{safe name}`). The bucket's own
-- size and type limits back up the same checks in the action.

ALTER TABLE "messages" ADD CONSTRAINT "messages_body_or_attachment" CHECK ("messages"."body" is not null or "messages"."attachment_url" is not null);
--> statement-breakpoint

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-attachments',
  'message-attachments',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
