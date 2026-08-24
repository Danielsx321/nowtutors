import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getSessionProfile, requireUser } from "@/lib/auth/guards";

/**
 * Session-area shell (SPEC §6 "SESSION — participants only").
 *
 * This group exists because `/session/[bookingId]` is the one authenticated area
 * **both roles enter**, so it cannot sit under `(student)` or `(tutor)`: either
 * placement would put a `requireRole` in the layout that redirects the other
 * half of the room away from their own session. The guard here is therefore
 * "signed in, onboarded, not suspended" and stops short of a role — participation
 * is the real authorization and only the page can check it, because only the page
 * knows which booking.
 *
 * `AppShell` still needs a role for its sidebar, so the viewer's own role picks
 * their normal navigation. Nothing about the room changes with it.
 */
export default async function SessionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  const profile = await getSessionProfile();
  if (!profile || profile.role == null) redirect("/onboarding");
  if (profile.isSuspended) redirect("/suspended");
  // Admins have no session of their own to be a participant in; the page's
  // participation check would 404 them anyway, but the shell has no nav for it.
  if (profile.role === "admin") redirect("/admin");

  return (
    <AppShell role={profile.role} title="Session">
      {children}
    </AppShell>
  );
}
