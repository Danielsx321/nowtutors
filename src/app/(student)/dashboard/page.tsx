import Link from "next/link";
import { eq } from "drizzle-orm";
import { CalendarDays, CalendarClock, Wallet as WalletIcon, GraduationCap } from "lucide-react";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import {
  getBookingsForParticipant,
  getRecentTutorsForStudent,
  groupBookingsByTab,
} from "@/db/queries/bookings";
import { getWalletBalanceFor } from "@/db/queries/wallet";
import { bookingStatusMeta } from "@/lib/bookings/status";
import {
  Avatar,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  EmptyState,
  StatCard,
} from "@/components/ui";

export const metadata = { title: "Dashboard · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/dashboard` — the student's overview, and the home the role guard sends
 * students to (`homeFor.student`). It had no page until now, which is why
 * signing in as a student 404'd (same defect class as the tutor's `/tutor`,
 * Phase 6 Part 1) — mirrors that page's structure and data pattern.
 *
 * SPEC §6 only specifies this thinly ("Stat cards, next session, recent
 * tutors, wallet balance") — content below is built from existing query
 * patterns (bookings, wallet, favourites), not invented shapes.
 */
export default async function StudentDashboardPage() {
  const { user } = await requireRole("student");

  const [items, balance, recentTutors, [me]] = await Promise.all([
    getBookingsForParticipant(user.id, "student"),
    getWalletBalanceFor(user.id),
    getRecentTutorsForStudent(user.id),
    db
      .select({ timezone: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
  ]);

  const timeZone = me?.timezone ?? "UTC";
  const groups = groupBookingsByTab(items);
  const now = new Date();
  const nextSession =
    groups.upcoming.find((b) => b.scheduledStartAt && b.scheduledStartAt > now) ??
    null;

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-8">
      <div className="space-y-1">
        <h1 className="text-h1 font-bold text-gray-700">Dashboard</h1>
        <p className="text-body text-gray-500">
          Your sessions, tutors, and wallet at a glance.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Upcoming sessions"
          value={groups.upcoming.length}
          icon={<CalendarClock className="size-5" />}
        />
        <StatCard
          label="Total bookings"
          value={items.length}
          icon={<CalendarDays className="size-5" />}
        />
        <StatCard
          label="Wallet balance"
          value={balance.toLocaleString()}
          hint="credits"
          icon={<WalletIcon className="size-5" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Next session</CardTitle>
        </CardHeader>
        <CardContent>
          {nextSession ? (
            <Link
              href={`/dashboard/bookings/${nextSession.id}`}
              className="focus-ring flex items-center gap-3 rounded-lg border border-gray-200 p-3 transition-colors hover:border-gray-300 hover:bg-gray-50"
            >
              <Avatar
                src={nextSession.otherPartyAvatarUrl}
                name={nextSession.otherPartyName ?? undefined}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-gray-700">
                  {nextSession.otherPartyName ?? "Tutor"}
                  {nextSession.subjectName ? ` · ${nextSession.subjectName}` : ""}
                </p>
                <p className="text-small text-gray-500">
                  {nextSession.scheduledStartAt ? fmt.format(nextSession.scheduledStartAt) : "Unscheduled"}
                </p>
              </div>
              <Badge variant={bookingStatusMeta(nextSession.status).variant}>
                {bookingStatusMeta(nextSession.status).label}
              </Badge>
            </Link>
          ) : (
            <EmptyState
              icon={<CalendarClock className="size-6" />}
              title="No upcoming sessions"
              description="When you book a session it will show up here."
              action={
                <Button asChild>
                  <Link href="/tutors">Browse tutors</Link>
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent tutors</CardTitle>
        </CardHeader>
        <CardContent>
          {recentTutors.length === 0 ? (
            <EmptyState
              icon={<GraduationCap className="size-6" />}
              title="No sessions completed yet"
              description="Tutors you've had sessions with will show up here."
              action={
                <Button asChild>
                  <Link href="/tutors">Browse tutors</Link>
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {recentTutors.map((tutor) => (
                <Link
                  key={tutor.userId}
                  href={`/tutors/${tutor.slug}`}
                  className="focus-ring flex items-center gap-3 rounded-lg border border-gray-200 p-3 transition-colors hover:border-gray-300 hover:bg-gray-50"
                >
                  <Avatar src={tutor.avatarUrl} name={tutor.displayName ?? undefined} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-700">
                      {tutor.displayName ?? "Tutor"}
                    </p>
                    {tutor.subjectName && (
                      <p className="text-small text-gray-500">{tutor.subjectName}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
