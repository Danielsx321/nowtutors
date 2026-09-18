import { AppShell } from "@/components/layout/app-shell";
import { requireRole } from "@/lib/auth/guards";
import { getShellIdentity } from "@/db/queries/shell";

/**
 * Admin area shell. SPEC §5/§6: guards role = admin (Layer 2). Layout guard is a
 * redirect; every admin action/route re-checks requireRole('admin') itself.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireRole("admin");
  const identity = await getShellIdentity(user.id);
  return (
    <AppShell
      role="admin"
      userName={identity.displayName ?? user.email ?? undefined}
      avatarUrl={identity.avatarUrl}
    >
      {children}
    </AppShell>
  );
}
