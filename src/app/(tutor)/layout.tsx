import { AppShell } from "@/components/layout/app-shell";
import { requireRole } from "@/lib/auth/guards";
import { getInstantRequestTtlSeconds } from "@/lib/settings";
import { IncomingRequests } from "@/components/features/tutor/incoming-requests";

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
 */
export default async function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireRole("tutor", { requireApproval: false });
  const ttlSeconds = await getInstantRequestTtlSeconds();
  return (
    <AppShell role="tutor">
      <IncomingRequests tutorId={user.id} ttlSeconds={ttlSeconds} />
      {children}
    </AppShell>
  );
}
