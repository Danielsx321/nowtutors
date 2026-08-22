import Link from "next/link";
import { ArrowLeft, Clock, CalendarDays, BookOpen, Video } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { bookingStatusMeta } from "@/lib/bookings/status";
import type { BookingDetail } from "@/db/queries/bookings";

interface BookingDetailViewProps {
  booking: BookingDetail;
  viewerTimeZone: string;
  backHref: string;
}

/**
 * Shared booking-detail view for both sides (SPEC §6, §7.3). The join button is
 * a deliberately disabled placeholder — LessonSpace classroom wiring is Phase 7;
 * showing a labelled, inert affordance reads as complete without implying a
 * working flow. There is NO cancel control: cancellation is disabled for both
 * parties (SPEC §7.3, §18).
 */
export function BookingDetailView({ booking, viewerTimeZone, backHref }: BookingDetailViewProps) {
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
        className="focus-ring mb-4 inline-flex items-center gap-1.5 rounded-sm text-small text-gray-500 hover:text-gray-700"
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
                <p className="text-caption uppercase tracking-wide text-gray-500">
                  {booking.otherPartyRole === "tutor" ? "Session with" : "Student"}
                </p>
                <h1 className="text-h2 font-bold text-gray-700">
                  {booking.otherPartyName ?? "—"}
                </h1>
              </div>
            </div>
            <Badge variant={meta.variant}>{meta.label}</Badge>
          </div>

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
            <div className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2">
              <span className="text-small text-gray-500">
                {booking.isStudent ? "Paid" : "You earn"}
              </span>
              <span className="text-body font-semibold text-gray-700">
                {booking.priceCredits} credits
              </span>
            </div>
          )}

          {booking.studentNotes && (
            <div className="space-y-1">
              <p className="text-caption uppercase tracking-wide text-gray-500">
                {booking.isStudent ? "Your notes" : "Student notes"}
              </p>
              <p className="whitespace-pre-line text-body text-gray-700">
                {booking.studentNotes}
              </p>
            </div>
          )}

          {isUpcoming && (
            <div className="space-y-2 border-t border-gray-100 pt-4">
              <Button className="w-full" disabled>
                <Video className="size-4" aria-hidden />
                Join classroom
              </Button>
              <p className="text-center text-caption text-gray-500">
                The join button opens 10 minutes before the session. The classroom
                arrives in a later release.
              </p>
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
      <span className="mt-0.5 text-gray-400" aria-hidden>
        {icon}
      </span>
      <div>
        <dt className="text-caption uppercase tracking-wide text-gray-500">{term}</dt>
        <dd className="text-body text-gray-700">{children}</dd>
      </div>
    </div>
  );
}
