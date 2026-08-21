import { AppShell } from "@/components/layout/app-shell";
import { requireRole } from "@/lib/auth/guards";

/**
 * Student area shell. SPEC §5/§6: guards role = student (Layer 2). This layout
 * guard is a redirect, not authorization — every student action/route re-checks
 * with requireRole('student') independently.
 */
export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole("student");
  return (
    <AppShell role="student" showCredits credits={0}>
      {children}
    </AppShell>
  );
}
