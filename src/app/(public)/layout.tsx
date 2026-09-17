import { SiteShell } from "@/components/layout/site-shell";

/**
 * Public shell — the site header and the full footer (SPEC §10.3). Applies to
 * every route in the (public) group. No auth here; unverified visitors may
 * browse (SPEC §7.1).
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}
