import { AppShell } from "@/components/layout/app-shell";
import { requireRole } from "@/lib/auth/guards";
import { getInstantRequestTtlSeconds } from "@/lib/settings";
import { getTutorLiveState } from "@/db/queries/presence";
import { getOwnLiveBroadcastId } from "@/db/queries/broadcasts";
import { getShellIdentity } from "@/db/queries/shell";
import { IncomingRequests } from "@/components/features/tutor/incoming-requests";
import { getTutorStudents } from "@/db/queries/dashboard-stats";
import type { SidebarPeople } from "@/components/layout/sidebar";

/**
 * Tutor area shell. SPEC §5/§6: guards role = tutor (Layer 2). Approval is NOT
 * enforced here — otherwise /tutor/pending-approval (which lives under this
 * layout) would redirect-loop. The real tutor pages call requireRole('tutor')
 * (approval enforced) themselves; pending-approval checks approval on its own.
 *
 * The incoming-request subscription is mounted here rather than on `/tutor`
 * (SPEC §8: "Tutor authenticated layout") so a live tutor sitting on their
 * availability editor or their bookings list still sees a request arrive. It is
 * safe under the relaxed approval guard above: only tutors in the `live_tutors`
 * view — which requires approval — can be sent a request at all, so an
 * unapproved tutor's subscription simply never fires.
 *
 * The go-live state is read here rather than on `/tutor` because the switch now
 * rides in the topbar (design overhaul Part 2), so a tutor can go live from any
 * page instead of navigating home first.
 */
export default async function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireRole("tutor", { requireApproval: false });
  const [ttlSeconds, live, liveBroadcastId, identity, students] = await Promise.all([
    getInstantRequestTtlSeconds(),
    getTutorLiveState(user.id),
    getOwnLiveBroadcastId(user.id),
    getShellIdentity(user.id),
    getTutorStudents(user.id, 3).catch(() => []),
  ]);
  // "Your students" in the sidebar (v2, Part F). A failure drops the section, not the page.
  const people: SidebarPeople = {
    heading: "Your students",
    people: students.map((st) => ({
      id: st.userId,
      name: st.name,
      avatarUrl: st.avatarUrl,
      href: st.conversationId ? `/tutor/messages/${st.conversationId}` : "/tutor/bookings",
      detail: [st.subject, st.sessions > 0 ? `${st.sessions} ${st.sessions === 1 ? "session" : "sessions"}` : "upcoming"]
        .filter(Boolean)
        .join(" · "),
    })),
  };
  const broadcasting = live?.liveMode === "broadcast";
  return (
    <AppShell
      role="tutor"
      userName={identity.displayName ?? user.email ?? undefined}
      avatarUrl={identity.avatarUrl}
      people={people}
      goLive={{
        initialLive: (live?.isLive ?? false) && live?.liveMode === "instant",
        broadcastHref: broadcasting
          ? liveBroadcastId
            ? `/broadcast/${liveBroadcastId}`
            : "/tutor/broadcasts"
          : null,
      }}
    >
      <IncomingRequests tutorId={user.id} ttlSeconds={ttlSeconds} />
      {children}
    </AppShell>
  );
}
