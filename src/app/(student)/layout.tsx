import { AppShell } from "@/components/layout/app-shell";
import { requireRole } from "@/lib/auth/guards";
import { getWalletBalance } from "@/db/queries/bookings";
import { getShellIdentity } from "@/db/queries/shell";

/**
 * Student area shell. SPEC §5/§6: guards role = student (Layer 2). This layout
 * guard is a redirect, not authorization — every student action/route re-checks
 * with requireRole('student') independently.
 *
 * The credit pill reads the real balance: it was hard-coded to 0 while the
 * wallet page beside it showed the true number (design overhaul Part 2).
 */
export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireRole("student");
  const [credits, identity] = await Promise.all([
    getWalletBalance(user.id),
    getShellIdentity(user.id),
  ]);
  return (
    <AppShell
      role="student"
      showCredits
      credits={credits}
      userName={identity.displayName ?? user.email ?? undefined}
    >
      {children}
    </AppShell>
  );
}
