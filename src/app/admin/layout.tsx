import { AppShell } from "@/components/layout/app-shell";
import { requireRole } from "@/lib/auth/guards";

/**
 * Admin area shell. SPEC §5/§6: guards role = admin (Layer 2). Layout guard is a
 * redirect; every admin action/route re-checks requireRole('admin') itself.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole("admin");
  return <AppShell role="admin">{children}</AppShell>;
}
