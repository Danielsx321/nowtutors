import { AppShell } from "@/components/layout/app-shell";

/**
 * Student area shell. Presentational only — SPEC §6 says this layout guards
 * role = student; that guard (requireRole) is added in Phase 3 (auth). Sample
 * chrome values are placeholders until wallet/profile data exists.
 */
export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell role="student" showCredits credits={0}>
      {children}
    </AppShell>
  );
}
