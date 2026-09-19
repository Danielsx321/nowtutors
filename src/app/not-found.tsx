import Link from "next/link";
import { Compass } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { SiteShell } from "@/components/layout/site-shell";

export const metadata = { title: "Page not found · NowTutors" };

/**
 * The 404. Next rendered its own bare one until now, which dropped a visitor
 * onto an unbranded page with no way back. It carries the site shell like every
 * other public page (SPEC §10.3) and offers the two things a lost visitor
 * usually wants.
 */
export default function NotFound() {
  return (
    <SiteShell>
      <div className="flex items-center justify-center px-4 py-20">
        <EmptyState
          headingLevel={1}
          icon={<Compass className="size-6" />}
          title="We can't find that page"
          description="The link may be old, or the page may have moved. Browse tutors who are online now, or start from the home page."
          action={
            <div className="flex flex-wrap justify-center gap-2.5">
              <Button asChild variant="primary">
                <Link href="/tutors">Find a tutor</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/">Go home</Link>
              </Button>
            </div>
          }
        />
      </div>
    </SiteShell>
  );
}
