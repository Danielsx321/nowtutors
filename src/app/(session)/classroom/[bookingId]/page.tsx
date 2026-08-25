import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { CalendarClock, DoorClosed, Info } from "lucide-react";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireUser } from "@/lib/auth/guards";
import { getClassroomBooking } from "@/db/queries/classroom";
import {
  checkLessonSpaceAccess,
  joinWindowFor,
  JOIN_WINDOW_AFTER_MINUTES,
  JOIN_WINDOW_BEFORE_MINUTES,
} from "@/lib/lessonspace/session-access";
import { bookingStatusMeta } from "@/lib/bookings/status";
import { Badge } from "@/components/ui/badge";
import { ClassroomFrame } from "@/components/features/classroom/classroom-frame";
import {
  COUNTDOWN_VISIBLE_MS,
  JoinWindowRefresh,
  OpensInCountdown,
} from "@/components/features/classroom/join-window-refresh";

export const metadata = { title: "Classroom · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/classroom/[bookingId]` — the scheduled-session room (SPEC §6, §7.3, §7.7).
 *
 * **The sibling of `/session/[bookingId]`, and it lives in the same route group
 * for the same reason.** `(session)`'s layout exists because a session room is
 * the one authenticated area *both* roles enter, so a `requireRole` in the
 * layout would redirect half of every room away from it; the guard there stops
 * at "signed in, onboarded, not suspended" and leaves participation to the page,
 * because only the page knows which booking. Every word of that applies to a
 * classroom unchanged — SPEC §6 lists both under the same "SESSION
 * (participants only)" heading — so this is a second page in an existing group
 * rather than a second group. See DECISIONS, Phase 7 Part 2.
 *
 * **Which panel renders is `checkLessonSpaceAccess`'s answer, not this file's.**
 * The join window (§7.3: ten minutes before the start, thirty minutes after the
 * end) is decided once, in a pure function, against the server's clock — the
 * same call `POST /api/lessonspace/join` makes before it will issue a link. This
 * page switches on the refusal *tag*; it does not compare timestamps, and
 * nothing about the window is evaluated in the browser. A page that decided for
 * itself would be a second definition of the window and could disagree with the
 * route that actually grants entry.
 *
 * **A booking that does not exist and a booking belonging to two other people
 * produce the identical `notFound()`** — the same discipline as `/session` and
 * `/api/agora/token`. Nothing below the participation check can run for a
 * stranger, so the URL cannot be walked to discover which booking ids are real.
 */
export default async function ClassroomPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const user = await requireUser();
  const [row, [me]] = await Promise.all([
    getClassroomBooking(bookingId),
    db
      .select({ timezone: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
  ]);

  const access = checkLessonSpaceAccess(row, user.id);

  // Missing and not-yours, answered identically. `!row` is first so the compiler
  // can narrow; the clause that follows is the one that matters, and both reach
  // the same `notFound()`.
  if (!row || (!access.ok && access.reason === "not_found")) notFound();

  // An instant booking has an Agora room, not a classroom (§7.4). Send the
  // participant to their actual room rather than explaining a URL they did not
  // choose — the mirror image of what `/session` now does with a scheduled one.
  if (!access.ok && access.reason === "not_scheduled") {
    redirect(`/session/${bookingId}`);
  }

  // Presentational only: whose name goes in the subheading, and which bookings
  // list "Back" returns to. The role LessonSpace acts on (`teacher` / `student`,
  // and the leader flag) is derived inside the join route from this same row —
  // never here, and never in the browser.
  const viewerIsTutor = row.tutorId === user.id;
  const otherPartyName = viewerIsTutor ? row.studentName : row.tutorName;
  const backHref = viewerIsTutor
    ? `/tutor/bookings/${bookingId}`
    : `/dashboard/bookings/${bookingId}`;

  const timeZone = me?.timezone ?? "UTC";
  const joinWindow = joinWindowFor(row);

  return (
    <div className="flex flex-col gap-5 px-4 py-2 md:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-gray-700">
            {row.subjectName ?? "Tutoring session"}
          </h1>
          <p className="mt-1 text-body text-gray-500">
            with {otherPartyName}
            {row.durationMinutes ? ` · ${row.durationMinutes} minutes` : ""}
          </p>
        </div>
        <Badge variant={bookingStatusMeta(row.status).variant}>
          {bookingStatusMeta(row.status).label}
        </Badge>
      </header>

      {access.ok ? (
        <>
          <ClassroomFrame bookingId={bookingId} otherPartyName={otherPartyName} />
          {/* The room does not stay open forever (§7.3). At the closing edge the
              server re-decides and this page becomes the "window closed" panel,
              rather than leaving a dead iframe on screen. */}
          {joinWindow && <JoinWindowRefresh at={joinWindow.closesAt.toISOString()} />}
        </>
      ) : access.reason === "too_early" ? (
        <NotOpenYet
          opensAt={joinWindow?.opensAt ?? null}
          timeZone={timeZone}
          backHref={backHref}
        />
      ) : access.reason === "too_late" ? (
        <WindowClosed closesAt={joinWindow?.closesAt ?? null} timeZone={timeZone} backHref={backHref} />
      ) : (
        <NotJoinable status={row.status} backHref={backHref} />
      )}
    </div>
  );
}

/** `3:50 PM GMT+1` in the viewer's own timezone (§7.3 renders in theirs). */
function formatTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
}

/** `Tuesday, August 25` — shown only when the wait spans a day boundary. */
function formatDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(at);
}

/**
 * Before the window opens. Says **when**, not just "not yet" — a person who
 * arrives early wants a time they can come back at, and §7.3's ten minutes is
 * not a rule anyone should have to know.
 *
 * The page reloads itself once at `opensAt` ({@link JoinWindowRefresh}), so
 * somebody who waits here does not have to discover that a refresh was needed.
 */
function NotOpenYet({
  opensAt,
  timeZone,
  backHref,
}: {
  opensAt: Date | null;
  timeZone: string;
  backHref: string;
}) {
  const soon =
    opensAt !== null && opensAt.getTime() - Date.now() <= COUNTDOWN_VISIBLE_MS;
  // The day is worth saying only when it is not today — "at 3:50 PM" is clearer
  // than "at 3:50 PM on Tuesday, August 25" when Tuesday is today.
  const otherDay =
    opensAt !== null &&
    formatDay(opensAt, timeZone) !== formatDay(new Date(), timeZone);

  return (
    <Panel
      icon={<CalendarClock className="mt-0.5 size-6 shrink-0 text-gold-400" aria-hidden />}
      title="The classroom isn't open yet"
      backHref={backHref}
    >
      {opensAt ? (
        <>
          <p className="max-w-prose text-body text-ink-300">
            It opens {JOIN_WINDOW_BEFORE_MINUTES} minutes before your session, at{" "}
            <span className="text-white">{formatTime(opensAt, timeZone)}</span>
            {otherDay ? ` on ${formatDay(opensAt, timeZone)}` : ""}. You can leave
            this page open — it&apos;ll let you in on its own.
          </p>
          {soon && (
            <div className="mt-4">
              <p className="text-caption uppercase tracking-wide text-ink-300">Opens in</p>
              <OpensInCountdown opensAt={opensAt.toISOString()} />
            </div>
          )}
          <JoinWindowRefresh at={opensAt.toISOString()} />
        </>
      ) : (
        <p className="max-w-prose text-body text-ink-300">
          This session doesn&apos;t have a start time yet, so there&apos;s nothing
          to open. Your bookings page has the details.
        </p>
      )}
    </Panel>
  );
}

/**
 * After the window closes. Says nothing about a refund or a reschedule, because
 * there is neither: cancellation is disabled for both parties and there is no
 * reschedule path (§7.3, §18). Offering one would be worse than saying nothing.
 */
function WindowClosed({
  closesAt,
  timeZone,
  backHref,
}: {
  closesAt: Date | null;
  timeZone: string;
  backHref: string;
}) {
  return (
    <Panel
      icon={<DoorClosed className="mt-0.5 size-6 shrink-0 text-ink-300" aria-hidden />}
      title="This classroom has closed"
      backHref={backHref}
    >
      <p className="max-w-prose text-body text-ink-300">
        The classroom stays open until {JOIN_WINDOW_AFTER_MINUTES} minutes after a
        session ends
        {closesAt ? (
          <>
            , which was{" "}
            <span className="text-white">{formatTime(closesAt, timeZone)}</span> on{" "}
            {formatDay(closesAt, timeZone)}
          </>
        ) : null}
        . If something went wrong with this session, your bookings page has the
        full record.
      </p>
    </Panel>
  );
}

/**
 * The booking is not in a joinable state at all — awaiting payment, already
 * completed, or ended by an admin. Distinct from the two window panels because
 * the window is not the reason and waiting will not change it.
 */
function NotJoinable({ status, backHref }: { status: string; backHref: string }) {
  return (
    <Panel
      icon={<Info className="mt-0.5 size-6 shrink-0 text-ink-300" aria-hidden />}
      title="There's no classroom to join"
      backHref={backHref}
    >
      <p className="max-w-prose text-body text-ink-300">
        This booking is marked{" "}
        <span className="text-white">
          {bookingStatusMeta(status).label.toLowerCase()}
        </span>
        , so there&apos;s no room to open. Your bookings page has the full history.
      </p>
    </Panel>
  );
}

/** The one ink card every non-room state renders into (§10.1: one ink surface). */
function Panel({
  icon,
  title,
  backHref,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  backHref: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-6 shadow-sm">
      <div className="flex gap-4">
        {icon}
        <div className="min-w-0">
          <h2 className="text-h3 font-bold text-white">{title}</h2>
          <div className="mt-2">{children}</div>
          <Link
            href={backHref}
            className="focus-ring-on-ink mt-4 inline-flex items-center rounded-sm text-small font-medium text-gold-400 hover:underline"
          >
            Back to this booking
          </Link>
        </div>
      </div>
    </div>
  );
}
