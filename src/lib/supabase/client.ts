import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components (avatar upload, the favourite heart's
 * optimistic session read, the Google sign-in button). Uses the public anon key.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
