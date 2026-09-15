"use client";

import * as React from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { adjustUserCredits, promoteToAdmin, setUserSuspended } from "@/actions/admin-users";
import type { AdminUserActionResult } from "@/actions/admin-users";

type Outcome = { kind: "ok" | "error"; text: string } | null;

function toOutcome(res: AdminUserActionResult): Outcome {
  return "error" in res ? { kind: "error", text: res.error } : { kind: "ok", text: res.message };
}

function OutcomeAlert({ outcome }: { outcome: Outcome }) {
  if (!outcome) return null;
  return (
    <Alert variant={outcome.kind === "ok" ? "success" : "danger"} role="status">
      {outcome.text}
    </Alert>
  );
}

function SuspensionCard({ userId, isSuspended, isSelf }: { userId: string; isSuspended: boolean; isSelf: boolean }) {
  const [confirming, setConfirming] = React.useState(false);
  const [outcome, setOutcome] = React.useState<Outcome>(null);
  const [pending, start] = React.useTransition();

  const run = (suspended: boolean) =>
    start(async () => {
      setOutcome(null);
      setOutcome(toOutcome(await setUserSuspended({ userId, suspended })));
      setConfirming(false);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Access</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-small text-gray-500">
          A suspended account can sign in but only sees the suspended page. A live tutor is taken offline.
        </p>
        <OutcomeAlert outcome={outcome} />
        {isSuspended ? (
          <Button variant="secondary" loading={pending} onClick={() => run(false)}>
            Unsuspend account
          </Button>
        ) : isSelf ? (
          <Alert variant="info">You can&apos;t suspend your own account.</Alert>
        ) : confirming ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" loading={pending} onClick={() => run(true)}>
              Yes, suspend
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Suspend account
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function AdjustCard({ userId }: { userId: string }) {
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  // One key per filled-in form: a double-click lands once, a new adjustment gets a new key.
  const [requestKey, setRequestKey] = React.useState(() => crypto.randomUUID());
  const [outcome, setOutcome] = React.useState<Outcome>(null);
  const [pending, start] = React.useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setOutcome(null);
      const delta = amount.trim() === "" ? Number.NaN : Number(amount);
      const res = await adjustUserCredits({ userId, delta, note, requestKey });
      setOutcome(toOutcome(res));
      if (!("error" in res)) {
        setAmount("");
        setNote("");
        setRequestKey(crypto.randomUUID());
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Adjust credits</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="adjust-amount" required>
              Credits (use a minus sign to remove)
            </Label>
            <Input
              id="adjust-amount"
              inputMode="numeric"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setRequestKey(crypto.randomUUID());
              }}
              placeholder="e.g. 20 or -20"
              className="max-w-48"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adjust-note" required>
              Why (admins only see this; the user sees &quot;Adjusted by NowTutors support&quot;)
            </Label>
            <Textarea id="adjust-note" rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </div>
          <OutcomeAlert outcome={outcome} />
          <Button type="submit" loading={pending}>
            Apply adjustment
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PromoteCard({ userId, email }: { userId: string; email: string }) {
  const [confirmEmail, setConfirmEmail] = React.useState("");
  const [outcome, setOutcome] = React.useState<Outcome>(null);
  const [pending, start] = React.useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Make admin</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setOutcome(null);
              setOutcome(toOutcome(await promoteToAdmin({ userId, confirmEmail })));
            });
          }}
        >
          <p className="text-small text-gray-500">
            Admins can change settings, money and other accounts. The wallet must be empty with no open sessions,
            withdrawals or unpaid earnings. There is no demote button yet.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="promote-email" required>
              Type {email} to confirm
            </Label>
            <Input
              id="promote-email"
              type="email"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              autoComplete="off"
            />
          </div>
          <OutcomeAlert outcome={outcome} />
          <Button type="submit" variant="danger" loading={pending} disabled={!confirmEmail.trim()}>
            Promote to admin
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** The three `/admin/users/[id]` controls (SPEC §6; Phase 8 Part 5). */
export function UserAdminActions({
  userId,
  email,
  role,
  isSuspended,
  isSelf,
}: {
  userId: string;
  email: string;
  role: "student" | "tutor" | "admin" | null;
  isSuspended: boolean;
  isSelf: boolean;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SuspensionCard userId={userId} isSuspended={isSuspended} isSelf={isSelf} />
      {(role === "student" || role === "tutor") && <AdjustCard userId={userId} />}
      {role !== "admin" && role !== null && <PromoteCard userId={userId} email={email} />}
    </div>
  );
}
