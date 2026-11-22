import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getRecentReviewsForAdmin } from "@/db/queries/reviews";
import { safeTimeZone } from "@/db/queries/admin-overview";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { RatingStars } from "@/components/ui/rating-stars";
import { Badge } from "@/components/ui/badge";
import { ReviewVisibilityButton } from "@/components/features/reviews/review-visibility-button";

export const metadata = { title: "Reviews · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/admin/reviews` (reviews v1, 2026-11-22). The newest 100 reviews, hidden
 * ones included, with Hide / Show. A hidden review leaves the profile and the
 * tutor's average; nothing is deleted. `requireRole('admin')` first,
 * independently of the layout (§5 Layer 2); the action checks again.
 */
export default async function AdminReviewsPage() {
  const { user } = await requireRole("admin");
  const [rows, [me]] = await Promise.all([
    getRecentReviewsForAdmin(100),
    db.select({ timezone: profiles.timezone }).from(profiles).where(eq(profiles.id, user.id)).limit(1),
  ]);
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: safeTimeZone(me?.timezone) });

  return (
    <div className="w-full space-y-6 py-2">
      <div>
        <h1 className="font-display text-[clamp(28px,3vw,38px)] font-medium leading-tight tracking-[-0.03em] text-text">
          Reviews
        </h1>
        <p className="mt-1 text-body text-text-muted">
          Students review a lesson once it is completed. Hide a review that breaks the rules; it leaves the
          profile and the tutor&apos;s rating, and you can show it again.
        </p>
      </div>

      <DataTable
        caption="Reviews"
        rows={rows}
        rowKey={(r) => r.id}
        minWidth={860}
        empty={<EmptyState title="No reviews yet" description="Reviews appear here as students leave them." />}
        columns={[
          {
            key: "when",
            header: "When",
            className: "whitespace-nowrap align-top",
            cell: (r) => <span className="text-small text-text-muted">{fmt.format(r.createdAt)}</span>,
          },
          {
            key: "tutor",
            header: "Tutor",
            className: "align-top",
            cell: (r) => (
              <Link href={`/tutors/${r.tutorSlug}`} className="focus-ring rounded-sm text-small font-medium text-accent hover:underline">
                {r.tutorName ?? r.tutorSlug}
              </Link>
            ),
          },
          {
            key: "review",
            header: "Review",
            className: "align-top",
            cell: (r) => (
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <RatingStars value={r.rating} size="sm" showValue={false} />
                  <span className="text-small text-text-muted">{r.reviewer}</span>
                  {!r.isPublished && <Badge variant="warning">Hidden</Badge>}
                </div>
                {r.comment && <p className="max-w-[60ch] whitespace-pre-line text-small text-text">{r.comment}</p>}
              </div>
            ),
          },
          {
            key: "action",
            header: "Action",
            className: "align-top text-right",
            cell: (r) => <ReviewVisibilityButton reviewId={r.id} published={r.isPublished} />,
          },
        ]}
      />
    </div>
  );
}
