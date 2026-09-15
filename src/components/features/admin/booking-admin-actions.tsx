"use client";

import * as React from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  forceCancelBooking,
  forceCompleteBooking,
  type AdminBookingActionResult,
} from "@/actions/admin-bookings";

type Outcome = { kind: "ok" | "error"; text: string } | null;
const toOutcome = (res: AdminBookingActionResult): Outcome =>
  "error" in res ? { kind: "error", text: res.error } : { kind: "ok", text: res.message };

function OutcomeAlert({ outcome }: { outcome: Outcome }) {
  if (!outcome) return null;
  return (
    <Alert variant={outcome.kind === "ok" ? "success" : "danger"} role="status">
      {outcome.text}
    </Alert>
  );
}

function CancelCard({ bookingId, refundCredits }: { bookingId: string; refundCredits: number | null }) {
  const [who, setWho] = React.useState<"cancelled_by_tutor" | "cancelled_by_student" | "">("");
  const [note, setNote] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [outcome, setOutcome] = React.useState<Outcome>(null);
  const [pending, start] = React.useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cancel and refund</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-small text-gray-500">
          The student gets {refundCredits ? `${refundCredits} credits` : "what they paid"} back as credits. Held tutor
          earnings are cancelled, released earnings still in the tutor&apos;s wallet are taken back, and anything
          already paid out stays with the tutor.
        </p>
        <fieldset className="space-y-1.5">
          <legend className="text-small font-medium text-gray-700">Who is the cancellation on?</legend>
          {(
            [
              ["cancelled_by_tutor", "The tutor"],
              ["cancelled_by_student", "The student"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-small text-gray-700">
              <input
                type="radio"
                name={`who-${bookingId}`}
                value={value}
                checked={who === value}
                onChange={() => setWho(value)}
                className="focus-ring size-4 accent-purple-500"
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="space-y-1.5">
          <Label htmlFor={`cancel-note-${bookingId}`} required>
            Why (admins only)
          </Label>
          <Textarea id={`cancel-note-${bookingId}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <OutcomeAlert outcome={outcome} />
        {confirming ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                start(async () => {
                  setOutcome(null);
                  setOutcome(toOutcome(await forceCancelBooking({ bookingId, status: who, note })));
                  setConfirming(false);
                })
              }
            >
              Yes, cancel and refund
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>
              Back
            </Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Cancel and refund
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function CompleteCard({ bookingId, statusLabel }: { bookingId: string; statusLabel: string }) {
  const [note, setNote] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [outcome, setOutcome] = React.useState<Outcome>(null);
  const [pending, start] = React.useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mark completed</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-small text-gray-500">
          Currently &quot;{statusLabel}&quot;. Completing it pays the tutor through the normal hold. Use it for a stuck
          session, or a tutor no-show when the tutor has shown they were there.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor={`complete-note-${bookingId}`} required>
            Why, and what proof you saw (admins only)
          </Label>
          <Textarea id={`complete-note-${bookingId}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <OutcomeAlert outcome={outcome} />
        {confirming ? (
          <div className="flex flex-wrap gap-2">
            <Button
              loading={pending}
              onClick={() =>
                start(async () => {
                  setOutcome(null);
                  setOutcome(toOutcome(await forceCompleteBooking({ bookingId, note })));
                  setConfirming(false);
                })
              }
            >
              Yes, mark completed
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>
              Back
            </Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            Mark completed
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** Force-cancel and force-complete controls for `/admin/bookings/[id]` (SPEC §6; Phase 8 Part 6). */
export function BookingAdminActions({
  bookingId,
  canCancel,
  canComplete,
  statusLabel,
  refundCredits,
}: {
  bookingId: string;
  canCancel: boolean;
  canComplete: boolean;
  statusLabel: string;
  refundCredits: number | null;
}) {
  if (!canCancel && !canComplete) {
    return <Alert variant="info">This booking is &quot;{statusLabel}&quot;. There&apos;s nothing to cancel or complete.</Alert>;
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {canCancel && <CancelCard bookingId={bookingId} refundCredits={refundCredits} />}
      {canComplete && <CompleteCard bookingId={bookingId} statusLabel={statusLabel} />}
    </div>
  );
}
