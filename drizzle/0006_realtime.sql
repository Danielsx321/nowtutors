-- Custom migration: enable Supabase Realtime on the tables the app subscribes to
-- (SPEC §8). REPLICA IDENTITY FULL where UPDATE payloads/filters need old values.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.session_requests;
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.tutor_profiles;
--> statement-breakpoint
ALTER TABLE public.session_requests REPLICA IDENTITY FULL;
--> statement-breakpoint
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
--> statement-breakpoint
ALTER TABLE public.tutor_profiles REPLICA IDENTITY FULL;
