import * as React from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import type { LessonToReview } from "@/db/queries/reviews";

/**
 * "Rate your lessons" on the student dashboard (reviews v1 follow-up,
 * 2026-11-22): completed lessons from the last 30 days without a review, each
 * linking straight to the form on its booking page. The caller renders it only
 * when there is something to rate, so it never shows as an empty box.
 */
export function RateLessons({ lessons, timeZone }: { lessons: LessonToReview[]; timeZone: string }) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" });
  return (
    <ul className="grid gap-3">
      {lessons.map((l) => {
        const tutor = l.tutorName?.trim() || "Tutor";
        const first = l.tutorName?.trim().split(/\s+/)[0] || "your tutor";
        return (
          <li key={l.bookingId} className="flex items-center gap-3">
            <Avatar name={tutor} src={l.tutorAvatarUrl ?? undefined} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-small font-medium text-text">
                {l.subjectName ? `${l.subjectName} with ${first}` : `Lesson with ${first}`}
              </p>
              <p className="text-caption text-text-muted">{fmt.format(l.endedAt)}</p>
            </div>
            <Link
              href={`/dashboard/bookings/${l.bookingId}#review`}
              className="focus-ring shrink-0 rounded-sm text-small font-medium text-accent hover:underline"
              aria-label={`Rate your ${l.subjectName ? `${l.subjectName} ` : ""}lesson with ${first}`}
            >
              Rate
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
