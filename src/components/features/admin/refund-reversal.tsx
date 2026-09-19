"use client";

import * as React from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reverseRefundedPayment } from "@/actions/admin-bookings";

/**
 * After a FULL refund made in PayPal (SPEC §7.6; Phase 8 Part 6, rule 4): take
 * back the credits the payment added, or cancel the booking a direct payment
 * paid for. A partial refund is a manual adjustment on the user's page.
 */
export function RefundReversal({ paymentId, buyerId }: { paymentId: string; buyerId: string }) {
  const [note, setNote] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [outcome, setOutcome] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = React.useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reverse this refund</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-small text-text-muted">
          Only after a <strong>full</strong> refund in PayPal. It removes the credits this payment added (up to what the
          student still has), or cancels the booking a direct payment paid for without a second refund. For a partial
          refund, adjust credits on the{" "}
          <a href={`/admin/users/${buyerId}`} className="focus-ring text-accent underline">
            student&apos;s page
          </a>{" "}
          instead.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor={`reverse-note-${paymentId}`} required>
            Why (admins only)
          </Label>
          <Textarea id={`reverse-note-${paymentId}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {outcome && (
          <Alert variant={outcome.kind === "ok" ? "success" : "danger"} role="status">
            {outcome.text}
          </Alert>
        )}
        {confirming ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                start(async () => {
                  setOutcome(null);
                  const res = await reverseRefundedPayment({ paymentId, note });
                  setOutcome("error" in res ? { kind: "error", text: res.error } : { kind: "ok", text: res.message });
                  setConfirming(false);
                })
              }
            >
              Yes, reverse it
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => setConfirming(false)}>
              Back
            </Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Reverse refund
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
