"use client";

import * as React from "react";
import { Banknote } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requestWithdrawal } from "@/actions/withdrawals";

/**
 * The "Request withdrawal" control (SPEC §7.11).
 *
 * `blockedReason` only disables the button and explains why. The server action
 * re-derives every rule under the wallet lock and is the only authority: a
 * button enabled by stale data still gets refused there.
 */
export function WithdrawalRequest({
  availableCredits,
  availableUsd,
  blockedReason,
}: {
  availableCredits: number;
  /** `null` when the payout rate is not set. */
  availableUsd: string | null;
  blockedReason: string | null;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  return (
    <div className="space-y-4">
      {done && (
        <Alert variant="success" title="Withdrawal requested">
          {done}
        </Alert>
      )}
      {error && <Alert variant="danger">{error}</Alert>}
      {blockedReason && !done && <Alert variant="info">{blockedReason}</Alert>}

      <Button
        disabled={!!blockedReason || !!done}
        loading={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await requestWithdrawal();
            if ("error" in res) {
              setError(res.error);
              return;
            }
            setDone(
              `${res.amountCredits.toLocaleString()} credits ($${res.amountUsd}) are on hold and waiting for our team to pay out.`,
            );
          })
        }
      >
        <Banknote aria-hidden />
        {availableUsd
          ? `Withdraw ${availableCredits.toLocaleString()} credits ($${availableUsd})`
          : "Request withdrawal"}
      </Button>
      <p className="text-small text-gray-500">
        A withdrawal always takes your whole available balance. The credits are
        held straight away and paid to your PayPal account by our team.
      </p>
    </div>
  );
}
