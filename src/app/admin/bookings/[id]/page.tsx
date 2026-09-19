import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getAdminBookingDetail } from "@/db/queries/admin-bookings";
import { safeTimeZone } from "@/db/queries/admin-overview";
import { bookingStatusMeta } from "@/lib/bookings/status";
import { canForceCancel, canForceComplete } from "@/lib/bookings/admin-rules";
import { creditTransactionLabel, formatCreditDelta } from "@/lib/credits/transaction-labels";
import type { CreditTransactionType } from "@/lib/credits/ledger";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { BookingAdminActions } from "@/components/features/admin/booking-admin-actions";

export const metadata = { title: "Booking · NowTutors" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-gray-200 py-2 last:border-0">
      <dt className="text-small text-gray-500">{label}</dt>
      <dd className="text-right text-small text-gray-700">{children}</dd>
    </div>
  );
}

/**
 * `/admin/bookings/[id]` (SPEC §6; Phase 8 Part 6): what happened, who paid what,
 * what the tutor is owed, every ledger row for the booking, and the force-cancel
 * and force-complete controls. `requireRole('admin')` first (§5 Layer 2).
 */
export default async function AdminBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireRole("admin");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [detail, [me]] = await Promise.all([
    getAdminBookingDetail(id),
    db.select({ timezone: profiles.timezone }).from(profiles).where(eq(profiles.id, user.id)).limit(1),
  ]);
  if (!detail) notFound();

  const timeZone = safeTimeZone(me?.timezone);
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone });
  const when = (d: Date | null) => (d ? fmt.format(d) : "Not set");
  const meta = bookingStatusMeta(detail.status);
  const debit = detail.ledger.find((l) => l.type === "booking_debit");

  return (
    <div className="w-full space-y-6 py-2">
      <div className="space-y-2">
        <Link href="/admin/bookings" className="focus-ring text-small font-medium text-purple-700">
          All bookings
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-h1 font-bold text-gray-700">
            {detail.studentName} with {detail.tutorName}
          </h1>
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </div>
      </div>

      <BookingAdminActions
        bookingId={detail.id}
        canCancel={canForceCancel(detail.status)}
        canComplete={canForceComplete(detail.status)}
        statusLabel={meta.label}
        refundCredits={debit ? -debit.delta : null}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Session</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <Fact label="Type">{detail.type}</Fact>
              <Fact label="Starts">{when(detail.startsAt)}</Fact>
              {detail.scheduledEndAt && <Fact label="Ends">{when(detail.scheduledEndAt)}</Fact>}
              <Fact label="Length">{detail.durationMinutes ?? "?"} min</Fact>
              {detail.subjectName && <Fact label="Subject">{detail.subjectName}</Fact>}
              <Fact label="Student">
                <Link href={`/admin/users/${detail.studentId}`} className="focus-ring text-purple-700">
                  {detail.studentEmail}
                </Link>
              </Fact>
              <Fact label="Tutor">
                <Link href={`/admin/users/${detail.tutorId}`} className="focus-ring text-purple-700">
                  {detail.tutorEmail}
                </Link>
              </Fact>
              <Fact label="Student joined">{when(detail.studentJoinedAt)}</Fact>
              <Fact label="Tutor joined">{when(detail.tutorJoinedAt)}</Fact>
              <Fact label="Started">{when(detail.startedAt)}</Fact>
              <Fact label="Ended">{when(detail.endedAt)}</Fact>
              {detail.cancellationReason && <Fact label="Admin note">{detail.cancellationReason}</Fact>}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Money</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <Fact label="Price">{detail.priceCredits ?? "?"} credits</Fact>
              <Fact label="Paid with">{detail.paymentMethod ?? "Not recorded"}</Fact>
              {detail.payment && (
                <Fact label="PayPal payment">
                  <Link
                    href={`/admin/payments?ref=${encodeURIComponent(detail.payment.providerOrderId)}`}
                    className="focus-ring text-purple-700"
                  >
                    ${detail.payment.amountUsd} ({detail.payment.status})
                  </Link>
                </Fact>
              )}
              {detail.earning ? (
                <>
                  <Fact label="Tutor earnings">
                    {detail.earning.netCredits} of {detail.earning.grossCredits} credits ({detail.earning.status})
                  </Fact>
                  <Fact label="Releases">{when(detail.earning.availableAt)}</Fact>
                </>
              ) : (
                <Fact label="Tutor earnings">None</Fact>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ledger rows for this booking</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.ledger.length === 0 ? (
            <EmptyState title="No ledger rows" description="Nothing has moved credits for this booking." />
          ) : (
            <ul className="divide-y divide-gray-200">
              {detail.ledger.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-small">
                  <span className="text-gray-700">
                    {creditTransactionLabel(l.type as CreditTransactionType)} ·{" "}
                    {l.userId === detail.studentId ? "student" : l.userId === detail.tutorId ? "tutor" : "other"}
                  </span>
                  <span className="text-gray-500">
                    {formatCreditDelta(l.delta)} → {l.balanceAfter} · {fmt.format(l.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
