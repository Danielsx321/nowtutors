import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { Clock, Pencil, XCircle } from "lucide-react";
import { db } from "@/db";
import { tutorProfiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { signOut } from "@/actions/auth";
import { changeReason, parseApprovalNote } from "@/lib/tutors/change-reasons";

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

  // On hold with a reason (tutor-request-changes): say what to fix and open
  // the door to the editor, which admits any approval status.
  if (tp?.approval === "changes_requested") {
    const asked = parseApprovalNote(tp.note);
    return (
      <div className="mx-auto max-w-lg py-12">
        <EmptyState
          icon={<Pencil className="size-6" />}
          title="A few changes before you're back"
          description="Your profile is paused while you make a couple of changes. Save it when you're done and we'll take another look, usually within a day."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button asChild>
                <Link href="/tutor/profile">Edit your profile</Link>
              </Button>
              <form action={signOut}>
                <Button type="submit" variant="outline">
                  Log out
                </Button>
              </form>
            </div>
          }
        />
        {(asked.reasons.length > 0 || asked.note) && (
          <div className="mt-6 space-y-3 rounded-lg border border-border bg-surface-muted p-4 text-small">
            <p className="font-semibold text-text">What our team asked for</p>
            {asked.reasons.length > 0 && (
              <ul className="list-disc space-y-1.5 pl-5 text-text">
                {asked.reasons.map((k) => {
                  const r = changeReason(k);
                  return (
                    <li key={k}>
                      <span className="font-medium">{r.label}.</span> {r.guidance}
                    </li>
                  );
                })}
              </ul>
            )}
            {asked.note && <p className="whitespace-pre-line text-text">{asked.note}</p>}
          </div>
        )}
      </div>
    );
  }

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
            : "Our team reviews new tutor profiles before they go live. You'll get an email as soon as you're approved, usually within a day."
        }
        action={
          <form action={signOut}>
            <Button type="submit" variant="outline">
              Log out
            </Button>
          </form>
        }
      />
      {rejected ? null : (
        <p className="mt-6 text-center text-small text-text-muted">
          While you wait,{" "}
          <a
            href="/tutor-guide.pdf"
            target="_blank"
            rel="noopener"
            className="focus-ring rounded-sm text-accent underline"
          >
            read the tutor guide
          </a>{" "}
          (PDF): going live, taking a request, and how you get paid.
        </p>
      )}
    </div>
  );
}
