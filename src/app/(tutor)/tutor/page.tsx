import * as React from "react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { Banknote, CalendarClock, Check, Clock, X } from "lucide-react";
import { db } from "@/db";
import { profiles, tutorProfiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getBookingsForParticipant } from "@/db/queries/bookings";
import { getWalletBalanceFor } from "@/db/queries/wallet";
import { getTutorEarningsBreakdown } from "@/db/queries/withdrawals";
import { getLiveTutorCount } from "@/db/queries/tutors";
import { getTutorLiveState } from "@/db/queries/presence";
import {
  getProfileCompleteness,
  getTutorEarningsByMonth,
  getTutorHoursByMonth,
  getTutorStudents,
} from "@/db/queries/dashboard-stats";
import { getEarningsSettings, getWithdrawalSettings } from "@/lib/settings";
import { centsToUsdString, creditsToPayoutCents } from "@/lib/withdrawals/payout-rate";
import { countdownFraction, fullWhen, relativeWhen, calendarDaysBetween } from "@/lib/dashboard/when";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SummaryCard } from "@/components/features/dashboard/summary-card";
import { SessionCarousel, type SessionCardData } from "@/components/features/dashboard/session-carousel";
import { BarChart } from "@/components/features/dashboard/bar-chart";
import { PeopleList } from "@/components/features/dashboard/people-list";
import { BookingsTable } from "@/components/features/dashboard/bookings-table";
import { DashboardColumns, RailBox } from "@/components/features/dashboard/dashboard-columns";
import { GoLiveBanner } from "@/components/features/tutor/go-live-banner";
import { cn } from "@/lib/utils";

export const metadata = { title: "Today · NowTutors" };
export const dynamic = "force-dynamic";

const AHEAD = new Set(["pending_payment", "confirmed", "in_progress"]);

function greeting(now: Date, timeZone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/**
 * `/tutor`, the tutor's home and where the role guard sends tutors
 * (`homeFor.tutor`). Live-globe rebuild Part F, as approved in Part 0
 * (pages.html, Tutor dashboard), from data the app already has:
 *
 * - the teal banner: live state in words and one button, sharing the topbar
 *   switch's state;
 * - three summary cards: next session, available to withdraw, taught this
 *   month;
 * - today's sessions (or the next ones) as photo cards, each opening the
 *   booking page, which owns the join window;
 * - the right column: the profile with its checklist, earnings in three
 *   stages with Withdraw only on Available, credits earned per month, and
 *   recent students with Message where a conversation exists;
 * - upcoming bookings across the full width.
 *
 * An incoming request is not repeated here as a strip: the call modal mounted
 * in the tutor layout already interrupts every tutor page, this one included
 * (DECISIONS, Part F).
 *
 * requireRole('tutor') re-checks role + approval (§5 Layer 2) independently of
 * the layout; every action re-checks again.
 */
export default async function TutorTodayPage() {
  const { user } = await requireRole("tutor");

  const [[me], items, balance, breakdown, withdrawals, earningsSettings, liveCount, liveState] = await Promise.all([
    db
      .select({
        timezone: profiles.timezone,
        displayName: profiles.displayName,
        avatarUrl: profiles.avatarUrl,
        rate: tutorProfiles.hourlyRateCredits,
        taught: tutorProfiles.completedSessions,
      })
      .from(profiles)
      .innerJoin(tutorProfiles, eq(tutorProfiles.userId, profiles.id))
      .where(eq(profiles.id, user.id))
      .limit(1),
    getBookingsForParticipant(user.id, "tutor"),
    getWalletBalanceFor(user.id),
    getTutorEarningsBreakdown(user.id),
    getWithdrawalSettings(),
    getEarningsSettings(),
    getLiveTutorCount().catch(() => 0),
    getTutorLiveState(user.id),
  ]);
  const timeZone = me?.timezone ?? "UTC";

  const [hours, earned, profile, students] = await Promise.all([
    getTutorHoursByMonth(user.id, timeZone, 5),
    getTutorEarningsByMonth(user.id, timeZone, 5),
    getProfileCompleteness(user.id),
    getTutorStudents(user.id, 4).catch(() => []),
  ]);

  const now = new Date();
  const upcoming = items
    .filter(
      (b) =>
        AHEAD.has(b.status) &&
        (b.status === "in_progress" || (b.scheduledEndAt ?? b.scheduledStartAt ?? now) > now),
    )
    .sort((a, b) => (a.scheduledStartAt?.getTime() ?? 0) - (b.scheduledStartAt?.getTime() ?? 0));
  const today = upcoming.filter(
    (b) => b.status === "in_progress" || (b.scheduledStartAt && calendarDaysBetween(now, b.scheduledStartAt, timeZone) === 0),
  );
  const carousel = today.length > 0 ? today : upcoming;
  const next = upcoming[0] ?? null;
  const thisMonth = hours[hours.length - 1];

  const rate = withdrawals.payoutUsdPerCredit;
  const availableUsd = rate !== null ? centsToUsdString(creditsToPayoutCents(balance, rate)) : null;
  const firstName = me?.displayName?.trim().split(/\s+/)[0] ?? null;
  const selfLive = !!liveState?.isLive;
  const othersLive = Math.max(0, liveCount - (selfLive ? 1 : 0));

  const sessions: SessionCardData[] = carousel.slice(0, 8).map((b) => {
    const start = b.scheduledStartAt ?? now;
    const name = b.otherPartyName ?? "Student";
    return {
      id: b.id,
      href: `/tutor/bookings/${b.id}`,
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

  const sessionsWith = new Map(students.map((s) => [s.userId, s.sessions]));
  const checklist = [
    { ok: profile.hasPhoto, text: profile.hasPhoto ? "Photo added" : "Add a photo" },
    {
      ok: profile.subjects > 0,
      text: profile.subjects > 0 ? `${profile.subjects} ${profile.subjects === 1 ? "subject" : "subjects"} listed` : "List your subjects",
    },
    {
      ok: profile.availabilityRules > 0,
      text: profile.availabilityRules > 0 ? "Weekly availability set" : "Set your weekly availability",
    },
    { ok: profile.hasAbout, text: profile.hasAbout ? "About written" : "Write your About" },
  ];

  const main = (
    <>
      <GoLiveBanner othersLive={othersLive} />

      <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))]">
        <SummaryCard
          icon={CalendarClock}
          label="Next session"
          value={next?.scheduledStartAt ? fullWhen(next.scheduledStartAt, now, timeZone) : "Nothing booked"}
          href={next ? `/tutor/bookings/${next.id}` : "/tutor/availability"}
        />
        <SummaryCard
          icon={Banknote}
          label="Available to withdraw"
          value={availableUsd ? `${balance.toLocaleString()} cr ≈ $${availableUsd}` : `${balance.toLocaleString()} credits`}
          href="/tutor/withdrawals"
        />
        <SummaryCard
          icon={Clock}
          label="Taught this month"
          value={`${thisMonth?.count ?? 0} ${thisMonth?.count === 1 ? "session" : "sessions"} · ${thisMonth?.value ?? 0} hrs`}
          href="/tutor/bookings"
        />
      </div>

      <SessionCarousel
        title={today.length > 0 ? "Today's sessions" : "Upcoming sessions"}
        sessions={sessions}
        empty={
          <EmptyState
            icon={<CalendarClock className="size-6" />}
            title="No sessions booked"
            description="Open more times in your availability, or go live to take instant requests."
            action={
              <Button asChild>
                <Link href="/tutor/availability">Set availability</Link>
              </Button>
            }
          />
        }
      />
    </>
  );

  const rail = (
    <>
      <RailBox
        title="Your profile"
        action={
          <Link href="/tutor/profile" className="focus-ring rounded-sm text-small font-medium text-accent hover:underline">
            Edit
          </Link>
        }
      >
        <div className="grid justify-items-center gap-1.5 text-center">
          <div className={cn("relative mb-1.5 rounded-full border-2 p-1.5", selfLive ? "border-live" : "border-primary")}>
            <Avatar src={me?.avatarUrl ?? undefined} name={me?.displayName ?? "You"} className="size-[100px] text-h1" />
            {me?.rate != null && (
              <span className="absolute -right-3 top-1 rounded-full border-2 border-surface-raised bg-highlight px-2 py-0.5 text-caption font-semibold text-on-highlight">
                {me.rate} cr/hr
              </span>
            )}
          </div>
          <p className="font-display text-[21px] font-semibold tracking-[-0.02em] text-text">
            {greeting(now, timeZone)}
            {firstName ? `, ${firstName}` : ""}
          </p>
          <p className="text-small text-text-muted">
            {(me?.taught ?? 0).toLocaleString()} {me?.taught === 1 ? "session" : "sessions"} taught · approved tutor
          </p>
          <ul className="mt-2.5 grid w-full gap-2 text-left text-small">
            {checklist.map((c) => (
              <li key={c.text} className={cn("flex items-center gap-2", c.ok ? "text-live" : "text-spark-text")}>
                {c.ok ? <Check className="size-4 shrink-0" aria-hidden /> : <X className="size-4 shrink-0" aria-hidden />}
                <span className="sr-only">{c.ok ? "Done:" : "To do:"}</span>
                {c.text}
              </li>
            ))}
          </ul>
        </div>
      </RailBox>

      <RailBox title="Earnings">
        <div className="grid gap-2.5">
          <Stage label={`Held · releases after ${earningsSettings.earningsHoldHours} hrs`} value={`${breakdown.totals.held.toLocaleString()} cr`} />
          <Stage
            highlight
            label="Available"
            value={availableUsd ? `${balance.toLocaleString()} cr ≈ $${availableUsd}` : `${balance.toLocaleString()} cr`}
            action={
              balance > 0 ? (
                <Button asChild size="sm" className="h-[34px] px-3.5">
                  <Link href="/tutor/withdrawals">Withdraw</Link>
                </Button>
              ) : null
            }
          />
          <Stage label="Paid out so far" value={`${breakdown.totals.withdrawn.toLocaleString()} cr`} />
        </div>
        <div className="rounded-[18px] border border-border p-4">
          <p className="mb-2 text-small font-medium text-text">Credits earned per month</p>
          <BarChart
            data={earned.map((m) => ({ label: m.label, value: m.value }))}
            unit="cr"
            title="Credits earned per month"
          />
        </div>
      </RailBox>

      <RailBox title="Recent students">
        {students.length > 0 ? (
          <PeopleList
            people={students.map((st) => ({
              id: st.userId,
              name: st.name,
              avatarUrl: st.avatarUrl,
              href: st.conversationId ? `/tutor/messages/${st.conversationId}` : "/tutor/bookings",
              detail: [st.subject, st.sessions > 0 ? `${st.sessions} ${st.sessions === 1 ? "session" : "sessions"}` : "upcoming"]
                .filter(Boolean)
                .join(" · "),
              action: st.conversationId
                ? { label: "Message", href: `/tutor/messages/${st.conversationId}`, variant: "outline" as const }
                : undefined,
            }))}
          />
        ) : (
          <p className="text-small text-text-muted">Students you teach will be listed here.</p>
        )}
      </RailBox>
    </>
  );

  const full = (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-text">Upcoming bookings</h2>
        <Link href="/tutor/bookings" className="focus-ring rounded-sm font-medium text-accent hover:underline">
          See all
        </Link>
      </div>
      {upcoming.length === 0 ? (
        <p className="rounded-card border border-border bg-surface-raised p-6 text-body text-text-muted">
          New bookings will be listed here.
        </p>
      ) : (
        <BookingsTable
          personHeading="Student"
          rows={upcoming.slice(0, 6).map((b) => {
            const count = sessionsWith.get(b.otherPartyId) ?? 0;
            return {
              id: b.id,
              href: `/tutor/bookings/${b.id}`,
              personName: b.otherPartyName ?? "Student",
              personAvatarUrl: b.otherPartyAvatarUrl,
              detail: count > 0 ? `${count} ${count === 1 ? "session" : "sessions"} with you` : "First session",
              subject: b.subjectName,
              when: b.scheduledStartAt ? fullWhen(b.scheduledStartAt, now, timeZone) : "Unscheduled",
              status: b.status,
            };
          })}
        />
      )}
    </>
  );

  return <DashboardColumns main={main} rail={rail} full={full} />;
}

/** One earnings stage row (pages.html `.stage-row`); the Available one is outlined teal. */
function Stage({
  label,
  value,
  action,
  highlight,
}: {
  label: string;
  value: string;
  action?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border px-3.5 py-3", highlight ? "border-primary" : "border-border")}>
      <div className="min-w-0">
        <p className="text-caption text-text-muted">{label}</p>
        <p data-numeric className="font-display text-[18px] font-semibold text-text">
          {value}
        </p>
      </div>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </div>
  );
}
