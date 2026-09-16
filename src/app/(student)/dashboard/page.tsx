import Link from "next/link";
import { eq } from "drizzle-orm";
import { CalendarClock, ChevronRight } from "lucide-react";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import {
  getBookingsForParticipant,
  getRecentTutorsForStudent,
  groupBookingsByTab,
} from "@/db/queries/bookings";
import { getWalletBalanceFor } from "@/db/queries/wallet";
import { getFavouriteTutors } from "@/db/queries/favourites";
import { getUsdPerCredit } from "@/lib/settings";
import { bookingStatusMeta } from "@/lib/bookings/status";
import { Avatar, Badge, Button, EmptyState } from "@/components/ui";
import { Money } from "@/components/ui/money";
import { TutorCard } from "@/components/features/tutor-card";
import { TutorPhoto } from "@/components/features/tutor-photo";
import { MessageTutorButton } from "@/components/features/messaging/message-tutor-button";

export const metadata = { title: "Dashboard · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/dashboard`, the student's home and where the role guard sends students
 * (`homeFor.student`). A feed, not a stat grid (design overhaul Part 3,
 * research report 03): the next session first, with the way in and a Message
 * shortcut; then what else is coming; then the balance with Buy credits; then
 * saved tutors, and recent tutors to book again. Every block has a designed
 * empty state that leads somewhere.
 */
export default async function StudentDashboardPage() {
  const { user } = await requireRole("student");

  const [items, balance, recentTutors, favourites, usdPerCredit, [me]] = await Promise.all([
    getBookingsForParticipant(user.id, "student"),
    getWalletBalanceFor(user.id),
    getRecentTutorsForStudent(user.id),
    getFavouriteTutors(user.id),
    getUsdPerCredit(),
    db
      .select({ timezone: profiles.timezone, displayName: profiles.displayName })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
  ]);

  const timeZone = me?.timezone ?? "UTC";
  const groups = groupBookingsByTab(items);
  const now = new Date();
  const upcoming = groups.upcoming.filter(
    (b) => b.status === "in_progress" || (b.scheduledEndAt ?? b.scheduledStartAt ?? now) > now,
  );
  const [next, ...later] = upcoming;

  const whenFmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const shortFmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const firstName = me?.displayName?.trim().split(/\s+/)[0];

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-8">
      <h1 className="font-display text-h1 font-bold text-text">
        {firstName ? `Hi, ${firstName}` : "Your learning"}
      </h1>

      {/* 1. Next session */}
      <section aria-labelledby="next-title" className="space-y-3">
        <h2 id="next-title" className="text-h3 font-semibold text-text">
          Next session
        </h2>
        {next ? (
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface-raised p-4 sm:flex-row sm:items-center">
            <TutorPhoto
              src={next.otherPartyAvatarUrl}
              name={next.otherPartyName ?? "Tutor"}
              sizes="72px"
              className="size-[72px] shrink-0"
              initialsClassName="text-h3"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-display text-body-lg font-semibold text-text">
                  {next.otherPartyName ?? "Tutor"}
                </p>
                <Badge variant={bookingStatusMeta(next.status).variant}>
                  {bookingStatusMeta(next.status).label}
                </Badge>
              </div>
              <p className="text-body text-text">
                {next.scheduledStartAt ? whenFmt.format(next.scheduledStartAt) : "Unscheduled"}
              </p>
              <p className="text-small text-text-muted">
                {[next.subjectName, next.durationMinutes ? `${next.durationMinutes} min` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
              {/* The join button and its window live on the booking page, which
                  runs the same access decision the classroom enforces. */}
              <Button asChild>
                <Link href={`/dashboard/bookings/${next.id}`}>
                  {next.status === "in_progress" ? "Join session" : "Open session"}
                </Link>
              </Button>
              <MessageTutorButton
                tutorId={next.otherPartyId}
                signedIn
                loginHref="/login?next=/dashboard"
                variant="secondary"
              />
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<CalendarClock className="size-6" />}
            title="Nothing booked yet"
            description="Find a tutor who is live now, or book a time that suits you."
            action={
              <Button asChild>
                <Link href="/">Find a tutor</Link>
              </Button>
            }
          />
        )}
      </section>

      {/* 2. Coming up */}
      {later.length > 0 && (
        <section aria-labelledby="later-title" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="later-title" className="text-h3 font-semibold text-text">
              Coming up
            </h2>
            <Link
              href="/dashboard/bookings"
              className="focus-ring rounded-sm text-small font-medium text-accent hover:underline"
            >
              All bookings
            </Link>
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface-raised">
            {later.slice(0, 4).map((b) => (
              <li key={b.id}>
                <Link
                  href={`/dashboard/bookings/${b.id}`}
                  className="focus-ring flex items-center gap-3 rounded-xl p-3 hover:bg-surface-muted"
                >
                  <Avatar src={b.otherPartyAvatarUrl} name={b.otherPartyName ?? undefined} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-text">
                      {b.otherPartyName ?? "Tutor"}
                      {b.subjectName ? ` · ${b.subjectName}` : ""}
                    </p>
                    <p className="text-small text-text-muted">
                      {b.scheduledStartAt ? shortFmt.format(b.scheduledStartAt) : "Unscheduled"}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-text-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3. Balance */}
      <section
        aria-labelledby="balance-title"
        className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-surface-muted p-5"
      >
        <div className="space-y-1">
          <h2 id="balance-title" className="text-small font-medium text-text-muted">
            Credit balance
          </h2>
          <Money credits={balance} usdPerCredit={usdPerCredit ?? undefined} showUsd={usdPerCredit != null} size="lg" />
        </div>
        <Button asChild variant="secondary">
          <Link href="/dashboard/wallet">Buy credits</Link>
        </Button>
      </section>

      {/* 4. Saved tutors */}
      <section aria-labelledby="saved-title" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="saved-title" className="text-h3 font-semibold text-text">
            Saved tutors
          </h2>
          {favourites.length > 3 && (
            <Link
              href="/dashboard/favourites"
              className="focus-ring rounded-sm text-small font-medium text-accent hover:underline"
            >
              See all {favourites.length}
            </Link>
          )}
        </div>
        {favourites.length === 0 ? (
          <p className="text-body text-text-muted">
            Tap the heart on a tutor to keep them here.{" "}
            <Link href="/" className="focus-ring rounded-sm font-medium text-accent hover:underline">
              Browse tutors
            </Link>
          </p>
        ) : (
          <ul className="grid gap-3">
            {favourites.slice(0, 3).map((t) => (
              <li key={t.userId}>
                <TutorCard
                  tutor={t}
                  favouriteMode="student"
                  usdPerCredit={usdPerCredit}
                  variant="row"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 5. Book again */}
      {recentTutors.length > 0 && (
        <section aria-labelledby="again-title" className="space-y-3">
          <h2 id="again-title" className="text-h3 font-semibold text-text">
            Book again
          </h2>
          <ul className="flex flex-wrap gap-3">
            {recentTutors.map((t) => (
              <li key={t.userId}>
                <Link
                  href={`/tutors/${t.slug}`}
                  className="focus-ring flex items-center gap-2 rounded-full border border-border bg-surface-raised py-1 pl-1 pr-4 hover:border-border-strong"
                >
                  <Avatar src={t.avatarUrl} name={t.displayName ?? undefined} size="sm" />
                  <span className="text-small font-medium text-text">{t.displayName ?? "Tutor"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
