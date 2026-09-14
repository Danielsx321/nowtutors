"use client";

import * as React from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updatePayoutEmail } from "@/actions/tutor-payout";

/** PayPal payout email (SPEC §6 `/tutor/settings`). Validated again on the server. */
export function PayoutEmailForm({ email }: { email: string | null }) {
  const [value, setValue] = React.useState(email ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, start] = React.useTransition();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          setSaved(false);
          const res = await updatePayoutEmail({ email: value });
          if ("error" in res) setError(res.error);
          else setSaved(true);
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="paypal-email" required>
          PayPal email
        </Label>
        <Input
          id="paypal-email"
          type="email"
          autoComplete="email"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          placeholder="you@example.com"
        />
        <FieldError>{error ?? undefined}</FieldError>
      </div>
      {saved && <Alert variant="success">PayPal email saved.</Alert>}
      <Button type="submit" loading={pending}>
        Save
      </Button>
      <p className="text-small text-gray-500">
        Withdrawals are paid to this address. Changing it doesn&apos;t affect a
        withdrawal you&apos;ve already requested.
      </p>
    </form>
  );
}
