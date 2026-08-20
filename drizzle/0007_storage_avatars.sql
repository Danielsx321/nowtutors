-- Custom migration: Supabase Storage for avatars (SPEC §7.2 — the named Bubble
-- "photos not rendering" bug fixed once). Public `avatars` bucket; objects are
-- world-readable, but a user may write only inside their own {uid}/ folder.
-- Idempotent so `db:reset` + migrate re-applies cleanly. Runs as the migration
-- role (Supabase `postgres` over the pooler) which owns storage policy management.

-- Public bucket (read via the public CDN path; next.config remotePatterns allows it).
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;
--> statement-breakpoint

-- RLS is already enabled on storage.objects by Supabase. Scope policies to the bucket.
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "avatars_public_read" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'avatars');
--> statement-breakpoint
DROP POLICY IF EXISTS "avatars_owner_insert" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "avatars_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "avatars_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "avatars_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
