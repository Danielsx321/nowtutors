import * as React from "react";
import { cn } from "@/lib/utils";
import type { QualityLevel } from "@/components/features/session/connection-banner";

/*
 * The two chips in the v2 session room (live-globe Part H, session-room
 * mockup): presence in the top bar, connection quality on the stage. Kept out
 * of session-room.tsx so the kitchen sink can show them without the SDK.
 */

/**
 * "Connected" once the other person's media is in the room; until then, who
 * the room is waiting for. Not a live region: arrival is already announced by
 * the other person's audio, and the banner handles problems.
 */
export function PresenceChip({ present, otherPartyName }: { present: boolean; otherPartyName: string }) {
  return present ? (
    <span className="inline-flex items-center gap-2 rounded-full bg-live-surface px-3 py-1.5 text-small font-medium text-live">
      <span className="size-2 rounded-full bg-live" aria-hidden />
      Connected
    </span>
  ) : (
    <span className="inline-flex items-center gap-2 rounded-full bg-surface-raised px-3 py-1.5 text-small text-text-muted">
      Waiting for {otherPartyName}…
    </span>
  );
}

const QUALITY_COPY: Record<QualityLevel, { label: string; dot: string }> = {
  good: { label: "Good connection", dot: "bg-live" },
  fair: { label: "Fair connection", dot: "bg-warning" },
  poor: { label: "Weak connection", dot: "bg-danger" },
  bad: { label: "Weak connection", dot: "bg-danger" },
};

export function QualityChip({ level }: { level: QualityLevel }) {
  const { label, dot } = QUALITY_COPY[level];
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-ground/70 px-3 py-1.5 text-small text-text">
      <span className={cn("size-2 rounded-full", dot)} aria-hidden />
      {label}
    </span>
  );
}
