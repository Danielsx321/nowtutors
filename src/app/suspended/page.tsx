import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { signOut } from "@/actions/auth";
import { SiteShell } from "@/components/layout/site-shell";

export const metadata = { title: "Account suspended · NowTutors" };

/** Where requireRole() sends a suspended account (SPEC §5). */
export default function SuspendedPage() {
  return (
    <SiteShell>
      <div className="flex items-center justify-center px-4 py-20">
        <EmptyState
          icon={<ShieldAlert className="size-6" />}
          title="Your account is suspended"
          description="Access to your dashboard is paused. Contact support if you think this is a mistake."
          action={
            <form action={signOut}>
              <Button type="submit" variant="outline">
                Log out
              </Button>
            </form>
          }
        />
      </div>
    </SiteShell>
  );
}
