"use client";

import * as React from "react";
import { Alert } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import type { NotificationSettingsValues } from "@/lib/auth/schemas";
import { updateNotificationSettings } from "@/actions/settings";

type Key = keyof NotificationSettingsValues;

const ROWS: Array<{ key: Key; label: string; help: string }> = [
  {
    key: "booking_confirmations",
    label: "Booking confirmations and session summaries",
    help: "An email with a calendar invite when a session is booked, and a summary after it.",
  },
  {
    key: "reminders",
    label: "Session reminders",
    help: "A day before and an hour before each booked session.",
  },
  {
    key: "messages",
    label: "New messages while you're away",
    help: "One email when a message arrives and you haven't been on NowTutors for a few minutes.",
  },
];

/**
 * The three switches. Each saves on its own as it flips, so there is no Save
 * button to forget. Money, cancellations and account decisions are always
 * emailed; the note under the list says so rather than showing switches that
 * do nothing.
 */
export function NotificationForm({ initial }: { initial: NotificationSettingsValues }) {
  const [values, setValues] = React.useState(initial);
  const [status, setStatus] = React.useState<{ kind: "saved" | "error"; text: string } | null>(null);
  const [pending, start] = React.useTransition();

  function flip(key: Key, next: boolean) {
    const previous = values;
    const updated = { ...values, [key]: next };
    setValues(updated);
    setStatus(null);
    start(async () => {
      const res = await updateNotificationSettings(updated);
      if ("error" in res) {
        setValues(previous);
        setStatus({ kind: "error", text: res.error });
      } else {
        setStatus({ kind: "saved", text: "Saved." });
      }
    });
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border">
        {ROWS.map((row) => (
          <li key={row.key} className="flex items-start justify-between gap-4 py-3 first:pt-0">
            <div>
              <label htmlFor={`pref-${row.key}`} className="text-body font-medium text-text">
                {row.label}
              </label>
              <p id={`pref-${row.key}-help`} className="text-small text-text-muted">
                {row.help}
              </p>
            </div>
            <Switch
              id={`pref-${row.key}`}
              checked={values[row.key]}
              disabled={pending}
              aria-describedby={`pref-${row.key}-help`}
              onCheckedChange={(v) => flip(row.key, v)}
            />
          </li>
        ))}
      </ul>
      <p className="text-small text-text-muted">
        Receipts, refunds, cancellations and account decisions are always emailed.
      </p>
      <div aria-live="polite">
        {status ? <Alert variant={status.kind === "saved" ? "success" : "danger"}>{status.text}</Alert> : null}
      </div>
    </div>
  );
}
