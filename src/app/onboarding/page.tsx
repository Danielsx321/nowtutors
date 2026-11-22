import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { subjects as subjectsTable } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";
import { requireUser, getSessionProfile, homeFor } from "@/lib/auth/guards";
import { OnboardingFlow } from "@/components/features/onboarding/onboarding-flow";
import { SiteShell } from "@/components/layout/site-shell";

export const metadata = { title: "Get started · NowTutors" };
export const dynamic = "force-dynamic"; // per-user, reads the session

export default async function OnboardingPage() {
  const user = await requireUser(); // → /login if not signed in
  const profile = await getSessionProfile();
  // Onboarding is a one-time step: once a role is set it is immutable (§7.1).
  if (profile?.role) redirect(homeFor[profile.role]);

  // Email sign-ups give their name on the sign-up form (audit, 18 Nov 2026);
  // Google gives `full_name` / `name`. Either starts the name field filled.
  // `requireUser` reads only the token's claims, so the metadata is fetched
  // once here; onboarding is a one-time page.
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const meta = (authData.user?.user_metadata ?? {}) as Record<string, unknown>;
  const rawName = [meta.full_name, meta.name].find((v): v is string => typeof v === "string");
  const defaultName = rawName?.trim().slice(0, 80) ?? "";

  const subjectRows = await db
    .select({ slug: subjectsTable.slug, name: subjectsTable.name })
    .from(subjectsTable)
    .where(eq(subjectsTable.isActive, true))
    .orderBy(asc(subjectsTable.sortOrder));

  return (
    <SiteShell>
      <div className="px-4 py-12">
        <div className="mx-auto w-full max-w-xl rounded-panel border border-border bg-surface-raised p-6 sm:p-8">
          <OnboardingFlow userId={user.id} subjects={subjectRows} defaultName={defaultName} />
        </div>
      </div>
    </SiteShell>
  );
}
