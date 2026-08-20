import { AppShell } from "@/components/layout/app-shell";

/**
 * Tutor area shell. Presentational only — SPEC §6 guards role = tutor AND
 * approval_status = approved (and shows /tutor/pending-approval otherwise);
 * those guards land in Phase 3 (auth).
 */
export default function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell role="tutor">{children}</AppShell>;
}
