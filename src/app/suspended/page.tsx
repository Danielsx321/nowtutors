import { GraduationCap, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { signOut } from "@/actions/auth";

export const metadata = { title: "Account suspended · NowTutors" };

/** Where requireRole() sends a suspended account (SPEC §5). */
export default function SuspendedPage() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="container-page py-6">
        <Link
          href="/"
          className="focus-ring inline-flex items-center gap-2 rounded-sm text-h3 font-bold text-gray-700"
        >
          <GraduationCap className="size-6 text-purple-500" aria-hidden />
          NowTutors
        </Link>
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
