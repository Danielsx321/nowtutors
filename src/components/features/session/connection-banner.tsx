"use client";

import * as React from "react";
import type { ConnectionState } from "agora-rtc-sdk-ng";
import { Loader2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NetworkQuality } from "@/lib/agora/client";
import { cn } from "@/lib/utils";

/** Agora's scale: 1 excellent, 2 good, 3 fair, 4 poor, 5 bad, 6 down, 0 unknown. */
export type QualityLevel = "good" | "fair" | "poor" | "bad";

export function qualityLevel(n: number): QualityLevel {
  if (n >= 5) return "bad";
  if (n === 4) return "poor";
  if (n === 3) return "fair";
  return "good"; // 0 (unknown) reads as good: no warning without evidence
}

export interface ConnectionBannerProps {
  phase: "connecting" | "joining" | "live";
  connection: ConnectionState | null;
  quality: NetworkQuality | null;
  /** "Tutor" or "Student": whose connection the remote warning is about. */
  otherRole: string;
  /** Set when turning video off is a real option (the tutor, camera on). */
  onTurnOffVideo?: () => void;
  /** Offered when the connection has dropped for good. */
  onRejoin: () => void;
}

/**
 * What the connection is doing, in words a person can act on (design overhaul
 * Part 4, research report 02). One polite live region, so each change is
 * announced once and a settled connection says nothing at all.
 *
 * Driven by the SDK's own `connection-state-change` and `network-quality`
 * events (SPEC §7.4 "connection quality indicator, reconnect handling"). Nothing
 * here decides anything about the session; Rejoin is the room's existing retry.
 */
export function ConnectionBanner({
  phase,
  connection,
  quality,
  otherRole,
  onTurnOffVideo,
  onRejoin,
}: ConnectionBannerProps) {
  const mine = quality ? qualityLevel(Math.max(quality.uplink, quality.downlink)) : "good";
  const theirs = quality ? qualityLevel(quality.remote) : "good";

  let tone: "info" | "warning" | "danger" | null = null;
  let body: React.ReactNode = null;

  if (phase === "connecting") {
    tone = "info";
    body = <Spinning>Connecting to the session…</Spinning>;
  } else if (phase === "joining") {
    tone = "info";
    body = <Spinning>Joining the room…</Spinning>;
  } else if (connection === "DISCONNECTED") {
    tone = "danger";
    body = (
      <span className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2">
          <WifiOff className="size-4 shrink-0" aria-hidden />
          You&apos;ve lost the connection.
        </span>
        <Button size="sm" variant="secondary" onClick={onRejoin}>
          Rejoin
        </Button>
      </span>
    );
  } else if (connection === "RECONNECTING" || connection === "CONNECTING") {
    tone = "warning";
    body = <Spinning>Reconnecting…</Spinning>;
  } else if (mine === "poor" || mine === "bad") {
    tone = "warning";
    body = onTurnOffVideo ? (
      <span className="flex flex-wrap items-center gap-3">
        Your connection is weak. Turn off video to keep audio clear.
        <Button size="sm" variant="secondary" onClick={onTurnOffVideo}>
          Turn off video
        </Button>
      </span>
    ) : (
      "Your connection is weak, so audio may break up. Moving closer to your router can help."
    );
  } else if (theirs === "bad") {
    tone = "warning";
    body = `${otherRole}'s connection is unstable. Give it a moment.`;
  }

  return (
    <div role="status" aria-live="polite" className={cn(!tone && "sr-only")}>
      {tone && (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-small",
            tone === "info" && "border-border bg-surface-raised text-text",
            tone === "warning" && "border-warning bg-warning-surface text-warning",
            tone === "danger" && "border-danger bg-danger-surface text-danger",
          )}
        >
          {body}
        </div>
      )}
    </div>
  );
}

function Spinning({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
      {children}
    </span>
  );
}
