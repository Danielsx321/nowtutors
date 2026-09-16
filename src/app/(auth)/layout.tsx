import { Wordmark } from "@/components/layout/wordmark";

/**
 * Public auth shell: a centred raised card on the muted canvas (SPEC §6, §10). Auth
 * pages are public; per-page server logic redirects an already-signed-in user.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface-muted">
      <header className="w-full px-4 py-6 md:px-6">
        <Wordmark href="/" size="sm" />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md rounded-xl border border-border bg-surface-raised p-6 md:p-8">{children}</div>
      </main>
    </div>
  );
}
