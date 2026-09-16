import Link from "next/link";
import { ArrowLeft, Clock, CalendarDays, BookOpen, Video } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { bookingStatusMeta } from "@/lib/bookings/status";
import type { BookingDetail } from "@/db/queries/bookings";
import {
  checkLessonSpaceAccess,
  joinWindowFor,
  JOIN_WINDOW_BEFORE_MINUTES,
} from "@/lib/lessonspace/session-access";
import { JoinWindowRefresh } from "@/components/features/classroom/join-window-refresh";

interface BookingDetailViewProps {
  booking: BookingDetail;
  /** The signed-in participant, so the join state comes from the shared decision. */
  viewerId: string;
  viewerTimeZone: string;
  backHref: string;
  /**
   * The page's messaging control for the other participant (Phase 9 Part 1):
   * a Message button for a student, a link to an existing thread for a tutor.
   * The page decides, because only a student may start a conversation.
   */
  messageAction?: React.ReactNode;
}

/**
 * Shared booking-detail view for both sides (SPEC §6, §7.3).
 *
 * **This is the way into the classroom** (§7.3, "Joining"), and Phase 7 Part 2
 * replaced the inert placeholder that stood here with the real thing. The
 * button's state is `checkLessonSpaceAccess`'s answer — the *same* pure decision
 * `/classroom/[bookingId]` renders and `POST /api/lessonspace/join` enforces — so
 * an enabled button and a granted link cannot disagree, and this file contains no
 * arithmetic on §7.3's ten-and-thirty minutes. A disabled button is a courtesy,
 * not a control: the route re-decides regardless (CLAUDE.md — never rely on the
 * client hiding a button).
 *
 * There is NO cancel control: cancellation is disabled for both parties
 * (SPEC §7.3, §18).
 */
export function BookingDetailView({
  booking,
  viewerId,
  viewerTimeZone,
  backHref,
  messageAction,
}: BookingDetailViewProps) {
  const meta = bookingStatusMeta(booking.status);
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: viewerTimeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: viewerTimeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const start = booking.scheduledStartAt;
  const end = booking.scheduledEndAt;
  const isUpcoming = booking.status === "confirmed" || booking.status === "in_progress";

  return (
    <div className="mx-auto max-w-2xl py-8">
      <Link
        href={backHref}
        className="focus-ring mb-4 inline-flex items-center gap-1.5 rounded-sm text-small text-text-muted hover:text-text"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to bookings
      </Link>

      <Card>
        <CardContent className="space-y-6 p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <Avatar
                src={booking.otherPartyAvatarUrl}
                name={booking.otherPartyName ?? "—"}
                size="lg"
              />
              <div>
                <p className="text-caption text-text-muted">
                  {booking.otherPartyRole === "tutor" ? "Session with" : "Student"}
                </p>
                <h1 className="font-display text-h2 font-bold text-text">
                  {booking.otherPartyName ?? "—"}
                </h1>
              </div>
            </div>
            <Badge variant={meta.variant}>{meta.label}</Badge>
          </div>

          {messageAction && <div>{messageAction}</div>}

          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail icon={<CalendarDays className="size-4" />} term="Date">
              {start ? dateFmt.format(start) : "—"}
            </Detail>
            <Detail icon={<Clock className="size-4" />} term="Time">
              {start ? timeFmt.format(start) : "—"}
              {end ? ` – ${timeFmt.format(end)}` : ""}
            </Detail>
            <Detail icon={<BookOpen className="size-4" />} term="Subject">
              {booking.subjectName ?? "—"}
            </Detail>
            <Detail icon={<Clock className="size-4" />} term="Length">
              {booking.durationMinutes ? `${booking.durationMinutes} minutes` : "—"}
            </Detail>
          </dl>

          {booking.priceCredits != null && (
            <div className="flex items-center justify-between rounded-md bg-surface-muted px-3 py-2">
              <span className="text-small text-text-muted">
                {booking.isStudent ? "Paid" : "You earn"}
              </span>
              <span data-numeric className="text-body font-semibold text-text">
                {booking.priceCredits} credits
              </span>
            </div>
          )}

          {booking.studentNotes && (
            <div className="space-y-1">
              <p className="text-caption text-text-muted">
                {booking.isStudent ? "Your notes" : "Student notes"}
              </p>
              <p className="whitespace-pre-line text-body text-text">
                {booking.studentNotes}
              </p>
            </div>
          )}

          {isUpcoming && (
            <div className="space-y-2 border-t border-border pt-4">
              <JoinControl
                booking={booking}
                viewerId={viewerId}
                timeFmt={timeFmt}
              />
            </div>
          )}

          {booking.status === "confirmed" && (
            <Alert variant="info">
              This session is confirmed and paid with credits. There’s no
              cancellation on the standard path — contact support if something’s
              wrong.
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The join affordance, in whichever of its four states applies right now.
 *
 * Everything it switches on comes from {@link checkLessonSpaceAccess}: the page
 * hands it the booking row and the viewer, and the shared decision says open,
 * too early, too late, or "that is an instant booking". `JoinWindowRefresh` then
 * re-asks the server at the boundary, so a page left open at 2:49 does not still
 * read "opens at 2:50" a minute later — the client re-renders the server's
 * answer, it never computes its own.
 */
function JoinControl({
  booking,
  viewerId,
  timeFmt,
}: {
  booking: BookingDetail;
  viewerId: string;
  timeFmt: Intl.DateTimeFormat;
}) {
  const access = checkLessonSpaceAccess(
    {
      id: booking.id,
      studentId: booking.studentId,
      tutorId: booking.tutorId,
      status: booking.status,
      type: booking.bookingType,
      scheduledStartAt: booking.scheduledStartAt,
      scheduledEndAt: booking.scheduledEndAt,
    },
    viewerId,
  );
  const joinWindow = joinWindowFor(booking);

  if (access.ok) {
    return (
      <>
        <Button className="w-full" asChild>
          <Link href={`/classroom/${booking.id}`}>
            <Video className="size-4" aria-hidden />
            Join classroom
          </Link>
        </Button>
        {joinWindow && <JoinWindowRefresh at={joinWindow.closesAt.toISOString()} />}
      </>
    );
  }

  // An instant booking rendered on a detail page: its room is the Agora session
  // (§7.4), not a classroom. The list query is scheduled-only, so this is the
  // rare direct link rather than the normal path.
  if (access.reason === "not_scheduled") {
    return (
      <Button className="w-full" asChild>
        <Link href={`/session/${booking.id}`}>
          <Video className="size-4" aria-hidden />
          Open session room
        </Link>
      </Button>
    );
  }

  return (
    <>
      <Button className="w-full" disabled>
        <Video className="size-4" aria-hidden />
        Join classroom
      </Button>
      <p className="text-center text-caption text-text-muted">
        {access.reason === "too_early" && joinWindow
          ? `Opens ${JOIN_WINDOW_BEFORE_MINUTES} minutes before the session, at ${timeFmt.format(joinWindow.opensAt)}.`
          : access.reason === "too_late"
            ? "The join window for this session has closed."
            : "This session can’t be joined right now."}
      </p>
      {access.reason === "too_early" && joinWindow && (
        <JoinWindowRefresh at={joinWindow.opensAt.toISOString()} />
      )}
    </>
  );
}

function Detail({
  icon,
  term,
  children,
}: {
  icon: React.ReactNode;
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-border-strong" aria-hidden>
        {icon}
      </span>
      <div>
        <dt className="text-caption text-text-muted">{term}</dt>
        <dd className="text-body text-text">{children}</dd>
      </div>
    </div>
  );
}
