import { AppShell } from "@/components/layout/app-shell";
import { requireRole } from "@/lib/auth/guards";
import { getWalletBalance } from "@/db/queries/bookings";
import { getShellIdentity } from "@/db/queries/shell";
import { getStudentTutors } from "@/db/queries/dashboard-stats";
import type { SidebarPeople } from "@/components/layout/sidebar";

/**
 * Student area shell. SPEC §5/§6: guards role = student (Layer 2). This layout
 * guard is a redirect, not authorization — every student action/route re-checks
 * with requireRole('student') independently.
 *
 * The credit pill reads the real balance: it was hard-coded to 0 while the
 * wallet page beside it showed the true number (design overhaul Part 2).
 * "Your tutors" in the sidebar (v2, Part E) are the tutors this student has
 * booked or saved, live ones first; a failure there drops the section rather
 * than the page.
 */
export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireRole("student");
  const [credits, identity, tutors] = await Promise.all([
    getWalletBalance(user.id),
    getShellIdentity(user.id),
    getStudentTutors(user.id, 3).catch(() => []),
  ]);

  const people: SidebarPeople = {
    heading: "Your tutors",
    people: tutors.map((t) => ({
      id: t.userId,
      name: t.name,
      avatarUrl: t.avatarUrl,
      href: `/tutors/${t.slug}`,
      live: t.liveNow,
      detail: t.liveNow
        ? "Live now"
        : t.sessions > 0
          ? `${t.sessions} ${t.sessions === 1 ? "session" : "sessions"}`
          : "Saved",
    })),
  };

  return (
    <AppShell
      role="student"
      showCredits
      credits={credits}
      userName={identity.displayName ?? user.email ?? undefined}
      avatarUrl={identity.avatarUrl}
      people={people}
    >
      {children}
    </AppShell>
  );
}
