import { AppShell } from "@/components/layout/app-shell";

/**
 * Admin area shell. Presentational only — SPEC §5/§6 restrict this to
 * role = admin; that guard (requireRole('admin')) is added in Phase 3 (auth).
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell role="admin">{children}</AppShell>;
}
