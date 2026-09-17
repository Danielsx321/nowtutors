import "server-only";
import { SiteHeader, type SiteHeaderViewer } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { getSessionProfile, homeFor } from "@/lib/auth/guards";
import { getLiveTutorCount } from "@/db/queries/tutors";
import { getShellIdentity } from "@/db/queries/shell";

/**
 * Header + page + full footer, on every public-facing page (SPEC §10.3): the
 * public routes, the auth pages, onboarding, suspended, tutor pending-approval
 * and the 404. The signed-in app shell keeps its own chrome and does not use
 * this.
 *
 * It reads the viewer and the live count itself, so a page only has to wrap its
 * content. Both reads are request-memoized (`getSessionProfile` is `cache`d and
 * the live count is one small query), and a failure in either degrades to the
 * signed-out header and a footer that says nobody is live, rather than taking
 * the page down.
 */
export async function SiteShell({ children }: { children: React.ReactNode }) {
  const [profile, liveCount] = await Promise.all([
    getSessionProfile().catch(() => null),
    getLiveTutorCount().catch(() => 0),
  ]);

  let viewer: SiteHeaderViewer | null = null;
  if (profile?.role) {
    const identity = await getShellIdentity(profile.id).catch(() => null);
    viewer = {
      home: homeFor[profile.role],
      displayName: identity?.displayName ?? "Your account",
      avatarUrl: identity?.avatarUrl ?? null,
    };
  }

  return (
    <div className="flex min-h-screen flex-col bg-ground">
      <SiteHeader viewer={viewer} />
      <main className="flex-1">{children}</main>
      <SiteFooter liveCount={liveCount} viewerHome={viewer?.home ?? null} />
    </div>
  );
}
