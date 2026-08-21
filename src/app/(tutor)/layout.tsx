import { AppShell } from "@/components/layout/app-shell";
import { requireRole } from "@/lib/auth/guards";

/**
 * Tutor area shell. SPEC §5/§6: guards role = tutor (Layer 2). Approval is NOT
 * enforced here — otherwise /tutor/pending-approval (which lives under this
 * layout) would redirect-loop. The real tutor pages call requireRole('tutor')
 * (approval enforced) themselves; pending-approval checks approval on its own.
 */
export default async function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole("tutor", { requireApproval: false });
  return <AppShell role="tutor">{children}</AppShell>;
}
