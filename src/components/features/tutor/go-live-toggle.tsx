"use client";

import * as React from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setInstantAvailability } from "@/actions/presence";

export interface GoLiveToggleProps {
  initialLive: boolean;
}

/**
 * "Available for instant sessions" — the go-live toggle on `/tutor` (SPEC §7.5).
 *
 * Optimistic, then reconciled with what the server actually wrote; a failure
 * snaps the switch back rather than leaving the tutor believing they are live
 * when they are not. The button being enabled is NOT the authorization — the
 * action re-checks role, approval, suspension and verified email server-side
 * (CLAUDE.md: "Do not rely on the client hiding a button").
 *
 * Going live is unrestricted by the tutor's calendar; a scheduled booking is
 * checked at accept (Part 2), not here.
 */
export function GoLiveToggle({ initialLive }: GoLiveToggleProps) {
  const [live, setLive] = React.useState(initialLive);
  const [pending, startTransition] = React.useTransition();

  const onChange = (next: boolean) => {
    const previous = live;
    setLive(next); // optimistic
    startTransition(async () => {
      try {
        const res = await setInstantAvailability({ live: next });
        if ("error" in res) {
          setLive(previous);
          toast.error(res.error);
          return;
        }
        setLive(res.isLive);
        toast.success(
          res.isLive
            ? "You're live — students can request an instant session."
            : "You're offline for instant sessions.",
        );
      } catch {
        setLive(previous);
        toast.error("Could not change your availability. Try again.");
      }
    });
  };

  return (
    <div className="flex items-start gap-4 rounded-lg border border-gray-200 p-4">
      <div className="min-w-0 flex-1">
        <label
          htmlFor="go-live"
          className="block text-body font-medium text-gray-700"
        >
          Available for instant sessions
        </label>
        <p className="mt-1 text-small text-gray-500">
          {live
            ? "Students browsing Live now can see you and request a session."
            : "Turn this on to appear on the Live now list."}
        </p>
      </div>
      <Switch
        id="go-live"
        checked={live}
        disabled={pending}
        onCheckedChange={onChange}
        aria-label="Available for instant sessions"
      />
    </div>
  );
}
