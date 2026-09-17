import { SiteShell } from "@/components/layout/site-shell";

/**
 * Auth shell: the same header and footer as the rest of the site, with the form
 * on a raised card in the middle. Signing in used to happen on a bare page with
 * a wordmark and no way back into the site; now log in, sign up and the
 * password pages carry the whole shell (SPEC §10.3, approved mockup "Log in").
 *
 * Auth pages are public; per-page server logic redirects an already-signed-in
 * user.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <SiteShell>
      <div className="flex items-center justify-center px-4 py-14 md:py-20">
        <div className="w-full max-w-md rounded-panel border border-border bg-surface-raised p-6 md:p-8">
          {children}
        </div>
      </div>
    </SiteShell>
  );
}
