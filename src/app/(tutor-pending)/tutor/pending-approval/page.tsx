import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { Clock, XCircle } from "lucide-react";
import { db } from "@/db";
import { tutorProfiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { signOut } from "@/actions/auth";

export const metadata = { title: "Pending approval · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * Shown instead of /tutor while approval_status != approved (SPEC §6). The
 * (tutor) layout guards role=tutor but NOT approval, so this page checks it
 * itself: an approved tutor is bounced to /tutor (no loop).
 */
export default async function PendingApprovalPage() {
  const { user } = await requireRole("tutor", { requireApproval: false });

  const [tp] = await db
    .select({ approval: tutorProfiles.approvalStatus, note: tutorProfiles.approvalNote })
    .from(tutorProfiles)
    .where(eq(tutorProfiles.userId, user.id))
    .limit(1);

  if (tp?.approval === "approved") redirect("/tutor");

  const rejected = tp?.approval === "rejected";

  return (
    <div className="mx-auto max-w-lg py-12">
      <EmptyState
        icon={
          rejected ? (
            <XCircle className="size-6" />
          ) : (
            <Clock className="size-6" />
          )
        }
        title={
          rejected
            ? "Your application wasn't approved"
            : "Your profile is under review"
        }
        description={
          rejected
            ? tp?.note ??
              "Please contact support if you think this was a mistake."
            : "Our team reviews new tutor profiles before they go live. You'll get an email as soon as you're approved — usually within a day."
        }
        action={
          <form action={signOut}>
            <Button type="submit" variant="secondary">
              Log out
            </Button>
          </form>
        }
      />
    </div>
  );
}
