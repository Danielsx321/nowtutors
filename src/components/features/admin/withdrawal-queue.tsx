"use client";

import * as React from "react";
import { Check, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WithdrawalStatusBadge } from "@/components/features/withdrawals/status-badge";
import {
  approveWithdrawal,
  markWithdrawalPaid,
  rejectWithdrawal,
} from "@/actions/admin-withdrawals";
import type { WithdrawalStatus } from "@/lib/withdrawals/withdrawals";

export interface QueueWithdrawal {
  id: string;
  tutorName: string | null;
  tutorEmail: string;
  amountCredits: number;
  amountUsd: string;
  payoutDestination: string;
  status: WithdrawalStatus;
  adminNote: string | null;
  externalReference: string | null;
  /** Pre-formatted in the admin's timezone by the page. */
  requestedLabel: string;
  processedLabel: string | null;
}

/**
 * One withdrawal in the admin queue (SPEC §6 `/admin/withdrawals`, §7.11).
 * Requested → Approve or Reject. Approved → Mark paid (with the PayPal
 * transaction id) or Reject. The server re-checks the status under a row lock,
 * so a second admin acting on the same row gets a clear refusal.
 */
function WithdrawalCard({ w }: { w: QueueWithdrawal }) {
  const [mode, setMode] = React.useState<"idle" | "pay" | "reject">("idle");
  const [reference, setReference] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const open = w.status === "requested" || w.status === "approved";

  const act = (fn: () => Promise<{ error: string } | { ok: true }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if ("error" in res) setError(res.error);
      else setMode("idle");
    });

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-body-lg font-bold text-gray-700">
              {w.tutorName ?? "Unnamed tutor"}
            </p>
            <p className="text-small text-gray-500">{w.tutorEmail}</p>
          </div>
          <div className="text-right">
            <p className="text-h3 font-bold text-gray-700">${w.amountUsd}</p>
            <p className="text-small text-gray-500">
              {w.amountCredits.toLocaleString()} credits
            </p>
          </div>
        </div>

        <dl className="grid gap-x-4 gap-y-1 text-small sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-gray-500">Pay to (PayPal)</dt>
            <dd className="break-all font-medium text-gray-700">{w.payoutDestination}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-gray-500">Requested</dt>
            <dd className="text-gray-700">{w.requestedLabel}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-gray-500">Status</dt>
            <dd>
              <WithdrawalStatusBadge status={w.status} />
            </dd>
          </div>
          {w.processedLabel && (
            <div className="flex gap-2">
              <dt className="text-gray-500">Last action</dt>
              <dd className="text-gray-700">{w.processedLabel}</dd>
            </div>
          )}
          {w.externalReference && (
            <div className="flex gap-2">
              <dt className="text-gray-500">PayPal transaction</dt>
              <dd className="break-all text-gray-700">{w.externalReference}</dd>
            </div>
          )}
          {w.adminNote && (
            <div className="flex gap-2 sm:col-span-2">
              <dt className="text-gray-500">Note</dt>
              <dd className="text-gray-700">{w.adminNote}</dd>
            </div>
          )}
        </dl>

        {error && <Alert variant="danger">{error}</Alert>}

        {mode === "pay" && (
          <div className="space-y-1.5">
            <Label htmlFor={`ref-${w.id}`} required>
              PayPal transaction ID
            </Label>
            <Input
              id={`ref-${w.id}`}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-small text-gray-500">
              Send ${w.amountUsd} to {w.payoutDestination} in PayPal first, then
              paste the transaction ID here.
            </p>
          </div>
        )}
        {mode === "reject" && (
          <div className="space-y-1.5">
            <Label htmlFor={`note-${w.id}`} required>
              Reason (shown to the tutor)
            </Label>
            <Textarea
              id={`note-${w.id}`}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <p className="text-small text-gray-500">
              Rejecting returns {w.amountCredits.toLocaleString()} credits to the
              tutor&apos;s wallet.
            </p>
          </div>
        )}

        {open && (
          <div className="flex flex-wrap gap-2">
            {mode === "idle" && w.status === "requested" && (
              <Button loading={pending} onClick={() => act(() => approveWithdrawal({ id: w.id }))}>
                <Check aria-hidden />
                Approve
              </Button>
            )}
            {mode === "idle" && w.status === "approved" && (
              <Button onClick={() => setMode("pay")}>
                <Check aria-hidden />
                Mark paid
              </Button>
            )}
            {mode === "idle" && (
              <Button variant="secondary" onClick={() => setMode("reject")}>
                <X aria-hidden />
                Reject
              </Button>
            )}
            {mode === "pay" && (
              <Button
                loading={pending}
                onClick={() =>
                  act(() => markWithdrawalPaid({ id: w.id, externalReference: reference }))
                }
              >
                Confirm paid
              </Button>
            )}
            {mode === "reject" && (
              <Button
                variant="danger"
                loading={pending}
                onClick={() => act(() => rejectWithdrawal({ id: w.id, note }))}
              >
                Confirm rejection
              </Button>
            )}
            {mode !== "idle" && (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setMode("idle");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function WithdrawalQueue({
  withdrawals,
  emptyLabel,
}: {
  withdrawals: QueueWithdrawal[];
  emptyLabel: string;
}) {
  if (withdrawals.length === 0) return <EmptyState title={emptyLabel} />;
  return (
    <div className="space-y-4">
      {withdrawals.map((w) => (
        <WithdrawalCard key={w.id} w={w} />
      ))}
    </div>
  );
}
