import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client, for server code that must reach something no
 * signed-in user may reach directly (SPEC §2.1: `SUPABASE_SERVICE_ROLE_KEY` is
 * server only, never imported into a Client Component).
 *
 * First used in Phase 9 Part 2 for the private `message-attachments` bucket,
 * which has no client storage policies (`drizzle/0019`). The service role
 * bypasses RLS, so **every caller authorizes first**: the messaging actions
 * check the viewer is a participant in the conversation before they sign an
 * upload or a download. `server-only` makes an import from a Client Component a
 * build error rather than a leaked key.
 */

let client: SupabaseClient | null = null;

export function createServiceClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service role is not configured (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).");
  }
  client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}
