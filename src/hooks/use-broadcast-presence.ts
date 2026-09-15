"use client";

import * as React from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useRetryingChannel, type RealtimeStatus } from "@/hooks/use-retrying-channel";
import {
  broadcastPresenceTopic,
  countViewers,
  nextPeakToReport,
  type PresenceState,
} from "@/lib/broadcasts/presence";

/**
 * The broadcast viewer count over Supabase Realtime Presence (SPEC §7.8, §8;
 * Phase 9 Part 3).
 *
 * A viewer passes `viewerKey` (their Agora uid, so two tabs count once) and is
 * tracked as `{ role: "viewer" }` after every (re)subscribe. The host passes no
 * key and tracks nothing; they pass `onNewPeak`, which fires only when the count
 * rises above the highest number already reported, so the server hears about
 * new highs and nothing else. No interval: Presence pushes `sync` on every join
 * and leave.
 *
 * Runs on the shared retrying channel, so it gets the same JWT prelude,
 * watchdog and backoff as every other subscription.
 */
export function useBroadcastPresence(
  broadcastId: string | null,
  opts: { viewerKey?: string | null; onNewPeak?: (count: number) => void } = {},
): { count: number; status: RealtimeStatus } {
  const [count, setCount] = React.useState(0);
  const channelRef = React.useRef<RealtimeChannel | null>(null);
  const viewerKeyRef = React.useRef(opts.viewerKey ?? null);
  viewerKeyRef.current = opts.viewerKey ?? null;
  const onNewPeakRef = React.useRef(opts.onNewPeak);
  onNewPeakRef.current = opts.onNewPeak;
  const reportedRef = React.useRef(0);

  const topic = broadcastId ? broadcastPresenceTopic(broadcastId) : null;

  const status = useRetryingChannel(
    topic,
    (client) => {
      const key = viewerKeyRef.current;
      const channel = client.channel(
        topic!,
        key ? { config: { presence: { key } } } : undefined,
      );
      channel.on("presence", { event: "sync" }, () => {
        setCount(countViewers(channel.presenceState() as unknown as PresenceState));
      });
      channelRef.current = channel;
      return channel;
    },
    () => {
      // Tracking is per socket join, so it is redone after every (re)subscribe.
      if (viewerKeyRef.current) void channelRef.current?.track({ role: "viewer" });
    },
  );

  React.useEffect(() => {
    const next = nextPeakToReport(count, reportedRef.current);
    if (next === null) return;
    reportedRef.current = next;
    onNewPeakRef.current?.(next);
  }, [count]);

  return { count, status };
}
