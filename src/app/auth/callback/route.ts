import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { homeFor } from "@/lib/auth/guards";

/**
 * The single OAuth / email-link handler (SPEC §6). Supabase redirects here with
 * a `code` after: Google sign-in, email-confirmation, and password-reset links.
 * We exchange the code for a session, then route:
 *   - an explicit in-app `next` (e.g. /reset-password, /onboarding) is honoured;
 *   - otherwise: /onboarding if the profile has no role yet, else the role home.
 *
 * Google-on-existing-email LINKING is handled by Supabase (automatic same-email
 * identity linking — see RUNBOOK): a Google login whose email matches a
 * confirmed password account resolves to the SAME auth user, so the profiles row
 * (keyed by auth id, created once by the on_auth_user_created trigger with
 * ON CONFLICT DO NOTHING) is never duplicated. This handler adds no profile row.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextRaw = searchParams.get("next");
  const next =
    nextRaw && nextRaw.startsWith("/") && !nextRaw.startsWith("//")
      ? nextRaw
      : null;

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  if (next) return NextResponse.redirect(`${origin}${next}`);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login?error=auth`);

  const [p] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  const dest = p?.role ? homeFor[p.role] : "/onboarding";
  return NextResponse.redirect(`${origin}${dest}`);
}
