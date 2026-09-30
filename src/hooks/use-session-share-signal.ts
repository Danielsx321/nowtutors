"use client";

import * as React from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useRetryingChannel, type RealtimeStatus } from "@/hooks/use-retrying-channel";

export type SessionRole = "tutor" | "student";

/** The one message on the channel: who is sharing their screen right now. */
interface SharePayload {
  from: SessionRole;
  sharing: boolean;
}

export function sessionShareTopic(bookingId: string): string {
  return `session-share:${bookingId}`;
}

/**
 * Who is sharing a screen, told to the other person in the room (2026-09-30).
 *
 * Agora carries one video track per participant and does not say whether it is
 * a camera or a screen (`lib/agora/client.ts`, module note). The picture arrives
 * either way; what this adds is the label and the layout: "Sharing screen" on
 * the tile and letterboxing instead of a cropped fill. So it is a Supabase
 * Realtime **broadcast** on a per-booking topic, the same transport the
 * broadcast viewer count uses (`use-broadcast-presence.ts`), sent by whoever
 * flips their share and re-sent after every (re)subscribe so a person who
 * arrives mid-share learns of it. Nothing here is authorization: a spoofed
 * message could only mislabel a tile, and the booking id is not guessable.
 * Nothing here polls; a send happens when `sharing` changes and when the
 * channel comes up.
 */
export function useSessionShareSignal(
  bookingId: string | null,
  role: SessionRole | null,
  sharing: boolean,
): { remoteSharing: boolean; status: RealtimeStatus } {
  const [remoteSharing, setRemoteSharing] = React.useState(false);
  const channelRef = React.useRef<RealtimeChannel | null>(null);
  const roleRef = React.useRef(role);
  roleRef.current = role;
  const sharingRef = React.useRef(sharing);
  sharingRef.current = sharing;

  React.useEffect(() => {
    setRemoteSharing(false);
  }, [bookingId]);

  const topic = bookingId && role ? sessionShareTopic(bookingId) : null;

  const announce = React.useCallback(() => {
    const from = roleRef.current;
    if (!from || !channelRef.current) return;
    const payload: SharePayload = { from, sharing: sharingRef.current };
    void channelRef.current.send({ type: "broadcast", event: "share", payload }).catch(() => {});
  }, []);

  const status = useRetryingChannel(
    topic,
    (client) => {
      const channel = client.channel(topic!, { config: { broadcast: { self: false } } });
      channel.on("broadcast", { event: "share" }, ({ payload }) => {
        const message = payload as Partial<SharePayload> | undefined;
        if (!message || message.from === roleRef.current || typeof message.sharing !== "boolean") return;
        setRemoteSharing(message.sharing);
      });
      channelRef.current = channel;
      return channel;
    },
    announce,
  );

  // The flip itself. Also tells the other side "not sharing" on stop.
  React.useEffect(() => {
    if (!topic) return;
    announce();
  }, [sharing, topic, announce]);

  return { remoteSharing, status };
}
