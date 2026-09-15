"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { LiveChip } from "@/components/ui/live-chip";
import { setInstantAvailability } from "@/actions/presence";

export interface GoLiveToggleProps {
  /**
   * `card` is the full explainer (the tutor's own page). `compact` is the
   * topbar: the switch, a short label, and the live state as a chip. Same
   * component, same action, same guards.
   */
  variant?: "card" | "compact";
  /** Live for INSTANT sessions. A broadcast is not this. */
  initialLive: boolean;
  /**
   * The tutor's live broadcast, when they are in broadcast mode (Phase 9 Part
   * 3). The toggle is locked while it is set: Q5 says a broadcasting tutor
   * can't take instant sessions, and `setInstantAvailability` refuses anyway.
   */
  broadcastHref?: string | null;
}

/**
 * "Available for instant sessions" — the go-live toggle on `/tutor` (SPEC §7.5).
 *
 * Optimistic, then reconciled with what the server actually wrote; a failure
 * snaps the switch back rather than leaving the tutor believing they are live
 * when they are not. The button being enabled is NOT the authorization — the
 * action re-checks role, approval, suspension, verified email and broadcast
 * mode server-side (CLAUDE.md: "Do not rely on the client hiding a button").
 *
 * Going live is unrestricted by the tutor's calendar; a scheduled booking is
 * checked at accept (Part 2), not here.
 */
export function GoLiveToggle({
  initialLive,
  broadcastHref,
  variant = "card",
}: GoLiveToggleProps) {
  const [live, setLive] = React.useState(initialLive);
  const [pending, startTransition] = React.useTransition();
  const broadcasting = !!broadcastHref;

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

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-2">
        {live && !broadcasting ? (
          <LiveChip size="sm" />
        ) : (
          <label htmlFor="go-live" className="hidden text-small text-text-muted sm:block">
            {broadcasting ? "Broadcasting" : "Go live"}
          </label>
        )}
        <Switch
          id="go-live"
          checked={broadcasting ? false : live}
          disabled={pending || broadcasting}
          onCheckedChange={onChange}
          aria-label={
            broadcasting
              ? "Available for instant sessions, locked while you are broadcasting"
              : "Available for instant sessions"
          }
        />
      </div>
    );
  }

  return (
    <div className="flex items-start gap-4 rounded-xl border border-border p-4">
      <div className="min-w-0 flex-1">
        <label
          htmlFor="go-live"
          className="block text-body font-medium text-text"
        >
          Available for instant sessions
        </label>
        <p className="mt-1 text-small text-text-muted">
          {broadcasting ? (
            <>
              You&apos;re broadcasting, so students can&apos;t request you right now.{" "}
              <Link href={broadcastHref} className="focus-ring rounded-sm text-accent hover:underline">
                Return to your broadcast
              </Link>{" "}
              to end it first.
            </>
          ) : live ? (
            "Students browsing Live now can see you and request a session."
          ) : (
            "Turn this on to appear on the Live now list."
          )}
        </p>
      </div>
      <Switch
        id="go-live"
        checked={broadcasting ? false : live}
        disabled={pending || broadcasting}
        onCheckedChange={onChange}
        aria-label="Available for instant sessions"
      />
    </div>
  );
}
