import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Wordmark } from "@/components/layout/wordmark";
import { Button } from "@/components/ui/button";
import { signOut } from "@/actions/auth";

export const metadata = { title: "Account suspended · NowTutors" };

/** Where requireRole() sends a suspended account (SPEC §5). */
export default function SuspendedPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface-muted">
      <header className="container-page py-6">
        <Wordmark href="/" size="sm" />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <EmptyState
          icon={<ShieldAlert className="size-6" />}
          title="Your account is suspended"
          description="Access to your dashboard is paused. Contact support if you think this is a mistake."
          action={
            <form action={signOut}>
              <Button type="submit" variant="secondary">
                Log out
              </Button>
            </form>
          }
        />
      </main>
    </div>
  );
}
