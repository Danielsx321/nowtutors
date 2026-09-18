import * as React from "react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { CalendarClock, Clock, Coins } from "lucide-react";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getBookingsForParticipant } from "@/db/queries/bookings";
import { getWalletBalanceFor } from "@/db/queries/wallet";
import { browseTutors, getLiveTutorCount } from "@/db/queries/tutors";
import { getLearnerHoursByMonth, getStudentTutors } from "@/db/queries/dashboard-stats";
import { parseTutorSearchParams } from "@/lib/tutors/filters";
import { getUsdPerCredit } from "@/lib/settings";
import { countdownFraction, fullWhen, relativeWhen } from "@/lib/dashboard/when";
import { formatUsd } from "@/components/ui/money";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Banner } from "@/components/features/dashboard/banner";
import { SummaryCard } from "@/components/features/dashboard/summary-card";
import { SessionCarousel, type SessionCardData } from "@/components/features/dashboard/session-carousel";
import { BarChart } from "@/components/features/dashboard/bar-chart";
import { PeopleList } from "@/components/features/dashboard/people-list";
import { DashboardColumns, RailBox } from "@/components/features/dashboard/dashboard-columns";
import { BookingsTable } from "@/components/features/dashboard/bookings-table";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard · NowTutors" };
export const dynamic = "force-dynamic";

/** Statuses a student still has ahead of them. */
const AHEAD = new Set(["pending_payment", "confirmed", "in_progress"]);

function greeting(now: Date, timeZone: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now),
  );
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function faceLine(names: string[], total: number) {
  const first = names.slice(0, 2).map((n) => n.split(/\s+/)[0]);
  const rest = total - first.length;
  if (first.length === 0) return null;
  if (rest <= 0) return first.join(" and ");
  return `${first.join(", ")} and ${rest} more`;
}

/**
 * `/dashboard`, the student's home (live-globe rebuild Part E; pages.html,
 * Student dashboard). Everything on it is read from data the app already has:
 *
 * - the teal banner: the real live count and faces, and one way in;
 * - three summary cards: the next session, the credit balance with its dollar
 *   anchor, and this month's sessions and hours;
 * - "Upcoming sessions" as photo cards, each opening its booking page, which
 *   owns the join window;
 * - the right column: a greeting with the balance, hours learned per month,
 *   and "Your tutors" with Request when they can take one now;
 * - "Your bookings" across the full width.
 *
 * Every block has an honest empty state that leads somewhere.
 */
export default async function StudentDashboardPage() {
  const { user } = await requireRole("student");

  const [[me], items, balance, usdPerCredit] = await Promise.all([
    db
      .select({ timezone: profiles.timezone, displayName: profiles.displayName, avatarUrl: profiles.avatarUrl })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
    getBookingsForParticipant(user.id, "student"),
    getWalletBalanceFor(user.id),
    getUsdPerCredit(),
  ]);
  const timeZone = me?.timezone ?? "UTC";

  const [liveCount, live, tutors, months] = await Promise.all([
    getLiveTutorCount().catch(() => 0),
    browseTutors(parseTutorSearchParams(new URLSearchParams("live=1")), { viewerId: user.id }).catch(() => ({
      cards: [],
      nextCursor: null,
    })),
    getStudentTutors(user.id, 4).catch(() => []),
    getLearnerHoursByMonth(user.id, timeZone, 5),
  ]);

  const now = new Date();
  const upcoming = items
    .filter(
      (b) =>
        AHEAD.has(b.status) &&
        (b.status === "in_progress" || (b.scheduledEndAt ?? b.scheduledStartAt ?? now) > now),
    )
    .sort((a, b) => (a.scheduledStartAt?.getTime() ?? 0) - (b.scheduledStartAt?.getTime() ?? 0));
  const past = items.filter((b) => !upcoming.includes(b));
  const next = upcoming[0] ?? null;
  const thisMonth = months[months.length - 1];

  const firstName = me?.displayName?.trim().split(/\s+/)[0] ?? null;
  const faces = live.cards.filter((c) => c.avatarUrl).slice(0, 3);

  const sessions: SessionCardData[] = upcoming.slice(0, 8).map((b) => {
    const start = b.scheduledStartAt ?? now;
    const name = b.otherPartyName ?? "Tutor";
    return {
      id: b.id,
      href: `/dashboard/bookings/${b.id}`,
      personName: name,
      personAvatarUrl: b.otherPartyAvatarUrl,
      subject: b.subjectName,
      title: b.notes?.trim() || (b.subjectName ? `${b.subjectName} with ${name.split(/\s+/)[0]}` : `Session with ${name}`),
      whenShort: relativeWhen(start, now, timeZone, b.status === "in_progress"),
      whenLong: [fullWhen(start, now, timeZone), b.durationMinutes ? `${b.durationMinutes} min` : null]
        .filter(Boolean)
        .join(" · "),
      progress: b.status === "in_progress" ? 1 : countdownFraction(start, now),
      progressLabel:
        b.status === "in_progress" ? "In progress now" : `Starts ${fullWhen(start, now, timeZone).toLowerCase()}`,
    };
  });

  const tableRows = [...upcoming, ...past].slice(0, 5);

  const main = (
    <>
      <Banner
        kicker="Live now"
        title={
          liveCount > 0
            ? `${liveCount.toLocaleString()} ${liveCount === 1 ? "tutor is" : "tutors are"} ready to teach you this minute`
            : "No tutors are live this minute"
        }
      >
        <Button asChild variant="highlight">
          {liveCount > 0 ? (
            <Link href="/tutors?live=1">Find a live tutor</Link>
          ) : (
            <Link href="/tutors">Book for later</Link>
          )}
        </Button>
        {faces.length > 0 && (
          <span className="flex items-center gap-3">
            <span className="flex">
              {faces.map((f, i) => (
                <Avatar
                  key={f.userId}
                  src={f.avatarUrl}
                  name={f.displayName ?? "Tutor"}
                  className={cn("size-10 border-2 border-primary", i > 0 && "-ml-2.5")}
                />
              ))}
            </span>
            <span className="text-small text-on-primary/75">
              {faceLine(
                faces.map((f) => f.displayName ?? "Tutor"),
                liveCount,
              )}
            </span>
          </span>
        )}
        {liveCount === 0 && (
          <span className="text-small text-on-primary/75">Tutors go live throughout the day.</span>
        )}
      </Banner>

      <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))]">
        <SummaryCard
          icon={CalendarClock}
          label="Next session"
          value={next?.scheduledStartAt ? fullWhen(next.scheduledStartAt, now, timeZone) : "Nothing booked"}
          href={next ? `/dashboard/bookings/${next.id}` : "/tutors"}
        />
        <SummaryCard
          icon={Coins}
          label="Credits"
          value={
            usdPerCredit != null
              ? `${balance.toLocaleString()} ≈ ${formatUsd(balance * usdPerCredit)}`
              : `${balance.toLocaleString()} credits`
          }
          href="/dashboard/wallet"
        />
        <SummaryCard
          icon={Clock}
          label="This month"
          value={`${thisMonth?.count ?? 0} ${thisMonth?.count === 1 ? "session" : "sessions"} · ${thisMonth?.value ?? 0} hrs`}
          href="/dashboard/bookings"
        />
      </div>

      <SessionCarousel
        title="Upcoming sessions"
        sessions={sessions}
        empty={
          <EmptyState
            icon={<CalendarClock className="size-6" />}
            title="Nothing booked yet"
            description="Find a tutor who is live now, or book a time that suits you."
            action={
              <Button asChild>
                <Link href="/tutors">Find a tutor</Link>
              </Button>
            }
          />
        }
      />
    </>
  );

  const rail = (
    <>
      <RailBox title="Your learning">
        <div className="grid justify-items-center gap-1.5 text-center">
          <div className="relative mb-1.5 rounded-full border-2 border-primary p-1.5">
            <Avatar src={me?.avatarUrl ?? undefined} name={me?.displayName ?? "You"} className="size-[100px] text-h1" />
            <Link
              href="/dashboard/wallet"
              aria-label={`${balance.toLocaleString()} credits, open wallet`}
              className="focus-ring absolute -right-2.5 top-1 rounded-full border-2 border-surface-raised bg-highlight px-2 py-0.5 text-caption font-semibold text-on-highlight"
            >
              {balance.toLocaleString()} cr
            </Link>
          </div>
          <p className="font-display text-[21px] font-semibold tracking-[-0.02em] text-text">
            {greeting(now, timeZone)}
            {firstName ? `, ${firstName}` : ""}
          </p>
          <p className="text-small text-text-muted">
            {next?.scheduledStartAt
              ? `Your next session is with ${(next.otherPartyName ?? "your tutor").split(/\s+/)[0]}, ${fullWhen(next.scheduledStartAt, now, timeZone).replace(/^(\w)/, (c) => c.toLowerCase())}.`
              : "No session booked yet."}
          </p>
        </div>
        <div className="rounded-[18px] border border-border p-4">
          <p className="mb-2 text-small font-medium text-text">Hours learned per month</p>
          <BarChart
            data={months.map((m) => ({ label: m.label, value: m.value }))}
            unit="hrs"
            title="Hours learned per month"
          />
        </div>
      </RailBox>

      <RailBox title="Your tutors">
        {tutors.length > 0 ? (
          <PeopleList
            people={tutors.map((t) => ({
              id: t.userId,
              name: t.name,
              avatarUrl: t.avatarUrl,
              href: `/tutors/${t.slug}`,
              live: t.liveNow,
              detail: [
                t.subject,
                t.liveNow
                  ? "live now"
                  : t.sessions > 0
                    ? `${t.sessions} ${t.sessions === 1 ? "session" : "sessions"}`
                    : "saved",
              ]
                .filter(Boolean)
                .join(" · "),
              action: t.instantNow
                ? { label: "Request", href: `/tutors/${t.slug}#start-now`, variant: "primary" as const }
                : { label: "Book again", href: `/tutors/${t.slug}#book`, variant: "outline" as const },
            }))}
          />
        ) : (
          <p className="text-small text-text-muted">
            Tutors you book or save will be here, with a way to request them when they&apos;re live.
          </p>
        )}
        <Button asChild variant="outline" className="w-full">
          <Link href="/tutors">See all tutors</Link>
        </Button>
      </RailBox>
    </>
  );

  const full = (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-text">Your bookings</h2>
        <Link href="/dashboard/bookings" className="focus-ring rounded-sm font-medium text-accent hover:underline">
          See all
        </Link>
      </div>
      {tableRows.length === 0 ? (
        <p className="rounded-card border border-border bg-surface-raised p-6 text-body text-text-muted">
          Your bookings will be listed here once you book a session.
        </p>
      ) : (
        <BookingsTable
          personHeading="Tutor"
          rows={tableRows.map((b) => ({
            id: b.id,
            href: `/dashboard/bookings/${b.id}`,
            personName: b.otherPartyName ?? "Tutor",
            personAvatarUrl: b.otherPartyAvatarUrl,
            detail: b.priceCredits != null ? `${b.priceCredits.toLocaleString()} credits` : null,
            subject: b.subjectName,
            when: b.scheduledStartAt ? fullWhen(b.scheduledStartAt, now, timeZone) : "Unscheduled",
            status: b.status,
          }))}
        />
      )}
    </>
  );

  return <DashboardColumns main={main} rail={rail} full={full} />;
}
