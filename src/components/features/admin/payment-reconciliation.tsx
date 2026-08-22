import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  creditTransactionLabel,
  formatCreditDelta,
} from "@/lib/credits/transaction-labels";
import type { AdminPaymentRecord } from "@/db/queries/admin-payments";

/**
 * The `/admin/payments` reconciliation view (SPEC §7.6).
 *
 * This is how an admin debugs the one live transaction that cannot be run from
 * Port Harcourt, so it deliberately favours **showing everything** over showing
 * it prettily: every field of the payments row, every ledger row that references
 * it, the booking when it is a direct-pay, and the raw PayPal payload verbatim.
 * Read-only — nothing here mutates.
 */

function statusVariant(status: string) {
  if (status === "captured") return "success" as const;
  if (status === "failed") return "danger" as const;
  if (status === "refunded") return "warning" as const;
  return "neutral" as const;
}

function bookingStatusVariant(status: string) {
  if (status === "confirmed" || status === "completed") return "success" as const;
  if (status === "pending_payment") return "warning" as const;
  if (status.startsWith("cancelled") || status.startsWith("no_show")) {
    return "danger" as const;
  }
  return "neutral" as const;
}

/** A definition row. Renders "—" rather than hiding an empty value. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-small text-gray-500">{label}</dt>
      <dd className="break-words font-medium text-gray-700">{children ?? "—"}</dd>
    </div>
  );
}

function Stamp({ at, timeZone }: { at: Date | null; timeZone: string }) {
  if (!at) return <>—</>;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "long",
  });
  return (
    <span title={at.toISOString()} className="tabular-nums">
      {fmt.format(at)}
    </span>
  );
}

export function PaymentReconciliation({
  payment,
  timeZone,
}: {
  payment: AdminPaymentRecord;
  timeZone: string;
}) {
  const ledgerNet = payment.ledger.reduce((sum, r) => sum + r.delta, 0);

  return (
    <div className="space-y-6">
      {/*
        The §7.6 "capture honoured, booking lost" state, stated outright rather
        than left to be inferred from a captured payment sitting beside an
        unconfirmed booking. Not an error and not a pending refund — the money
        became credits the student holds, and the only follow-up is that they
        may want help rebooking.
      */}
      {payment.creditsRetained && (
        <Alert
          variant="warning"
          title="Capture honoured, booking not confirmed — credits retained"
        >
          This direct-pay was captured and minted{" "}
          <strong>{payment.creditsGranted ?? "?"} credits</strong>, but the
          booking was never confirmed — the slot was already gone when the
          capture landed. There is no <code>booking_debit</code>, so the credits
          stayed in the student&apos;s wallet and are spendable on a new booking.
          <span className="mt-2 block">
            <strong>No refund is owed and none is due.</strong> The student lost
            the slot, not the money. If they are asking about it, point them at{" "}
            <code>/dashboard/wallet</code> — the balance is there.
          </span>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Payment</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant(payment.status)}>{payment.status}</Badge>
            <Badge variant="purple">{payment.purpose}</Badge>
            {payment.creditsRetained && (
              <Badge variant="warning">credits retained</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Amount">
              {payment.amountUsd} {payment.currency}
            </Field>
            <Field label="Credits granted">
              {payment.creditsGranted ?? "—"}
            </Field>
            <Field label="Provider">{payment.provider}</Field>
            <Field label="PayPal order id">
              <code className="text-small">{payment.providerOrderId}</code>
            </Field>
            <Field label="PayPal capture id">
              {payment.providerCaptureId ? (
                <code className="text-small">{payment.providerCaptureId}</code>
              ) : (
                "—"
              )}
            </Field>
            <Field label="payments.id">
              <code className="text-small">{payment.id}</code>
            </Field>
            <Field label="Buyer">
              {payment.buyerName ?? "—"}
              {payment.buyerEmail && (
                <span className="block text-small font-normal text-gray-500">
                  {payment.buyerEmail}
                </span>
              )}
            </Field>
            <Field label="Buyer id">
              <code className="text-small">{payment.userId}</code>
            </Field>
            <Field label="Booking id">
              {payment.bookingId ? (
                <code className="text-small">{payment.bookingId}</code>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Created">
              <Stamp at={payment.createdAt} timeZone={timeZone} />
            </Field>
            <Field label="Captured">
              <Stamp at={payment.capturedAt} timeZone={timeZone} />
            </Field>
            <Field label="Updated">
              <Stamp at={payment.updatedAt} timeZone={timeZone} />
            </Field>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Ledger rows</CardTitle>
          <span className="text-small text-gray-500">
            {payment.ledger.length} row{payment.ledger.length === 1 ? "" : "s"} · net{" "}
            <span className="tabular-nums">{formatCreditDelta(ledgerNet || 0)}</span>
          </span>
        </CardHeader>
        <CardContent className="space-y-3">
          {payment.ledger.length === 0 ? (
            <p className="text-body text-gray-500">
              No ledger rows reference this payment. Expected for a{" "}
              <code>created</code> or <code>failed</code> payment — and for a{" "}
              <code>captured</code> one it means the credit never landed.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Delta</TableHead>
                  <TableHead className="text-right">Balance after</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payment.ledger.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-gray-500">
                      <Stamp at={row.createdAt} timeZone={timeZone} />
                    </TableCell>
                    <TableCell>
                      {creditTransactionLabel(row.type)}
                      <span className="block text-small text-gray-500">
                        <code>{row.type}</code>
                      </span>
                    </TableCell>
                    <TableCell className="text-small text-gray-500">
                      {row.referenceType ?? "—"}
                      <span className="block break-all">
                        <code>{row.referenceId ?? "—"}</code>
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                      {formatCreditDelta(row.delta)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-gray-500">
                      {row.balanceAfter}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {payment.purpose === "booking" && payment.ledger.length === 2 && (
            <p className="text-small text-gray-500">
              A settled direct-pay is two rows — the <code>purchase</code> mint
              and the <code>booking_debit</code> spend — netting to zero. The
              student never held these credits (§7.6).
            </p>
          )}
          {payment.creditsRetained && (
            <p className="text-small text-gray-500">
              One row, not two: the <code>purchase</code> mint with no{" "}
              <code>booking_debit</code> beside it. The spend is written only
              when the booking confirms, so its absence is the record that this
              one did not (§7.6).
            </p>
          )}
        </CardContent>
      </Card>

      {payment.bookingId && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>Booking</CardTitle>
            {payment.booking && (
              <Badge variant={bookingStatusVariant(payment.booking.status)}>
                {payment.booking.status}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {payment.creditsRetained && payment.booking && (
              <p className="text-small text-gray-500">
                This booking is <code>{payment.booking.status}</code> and will
                stay that way — settlement does not retry a confirm, and a
                replayed capture will not debit for it.
              </p>
            )}
            {payment.booking ? (
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Student">{payment.booking.studentName}</Field>
                <Field label="Tutor">{payment.booking.tutorName}</Field>
                <Field label="Subject">{payment.booking.subjectName}</Field>
                <Field label="Starts">
                  <Stamp at={payment.booking.scheduledStartAt} timeZone={timeZone} />
                </Field>
                <Field label="Ends">
                  <Stamp at={payment.booking.scheduledEndAt} timeZone={timeZone} />
                </Field>
                <Field label="Duration">
                  {payment.booking.durationMinutes
                    ? `${payment.booking.durationMinutes} min`
                    : "—"}
                </Field>
                <Field label="Price (credits)">{payment.booking.priceCredits}</Field>
                <Field label="Payment method">{payment.booking.paymentMethod}</Field>
                <Field label="Booking created">
                  <Stamp at={payment.booking.createdAt} timeZone={timeZone} />
                </Field>
              </dl>
            ) : (
              <p className="text-body text-gray-500">
                This payment references booking{" "}
                <code>{payment.bookingId}</code>, but no such booking row exists.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Raw PayPal payload</CardTitle>
        </CardHeader>
        <CardContent>
          {payment.rawPayload == null ? (
            <p className="text-body text-gray-500">
              No payload stored. Set on capture and on webhook events; absent
              means neither has run for this payment.
            </p>
          ) : (
            <pre className="max-h-[32rem] overflow-auto rounded-md bg-gray-50 p-4 text-small leading-relaxed text-gray-700">
              <code>{JSON.stringify(payment.rawPayload, null, 2)}</code>
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
