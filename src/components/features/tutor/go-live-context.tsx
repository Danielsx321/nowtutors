"use client";

import * as React from "react";
import { toast } from "sonner";
import { setInstantAvailability } from "@/actions/presence";

/**
 * One go-live state per tutor page (live-globe rebuild Part F). The topbar
 * switch and the dashboard banner's button both change availability; if each
 * kept its own `useState`, flipping one would leave the other showing the old
 * answer. The provider holds the state and the one handler, so both controls
 * read and write the same thing, and the toasts the presence E2E waits for
 * ("…can request an instant session." / "…offline for instant sessions.") come
 * from one place.
 *
 * Optimistic, then reconciled with what the server actually wrote; a failure
 * snaps back rather than leaving the tutor believing they are live when they
 * are not. The action re-checks role, approval, suspension, verified email and
 * broadcast mode server-side, so the controls being enabled is never the
 * authorization.
 */
interface GoLiveValue {
  live: boolean;
  pending: boolean;
  /** Set when the tutor is broadcasting: instant availability is locked. */
  broadcastHref: string | null;
  setLive: (next: boolean) => void;
}

const GoLiveContext = React.createContext<GoLiveValue | null>(null);

export function useGoLiveState(initialLive: boolean, broadcastHref: string | null): GoLiveValue {
  const [live, setLiveState] = React.useState(initialLive);
  const [pending, startTransition] = React.useTransition();
  // The last confirmed-or-optimistic value, read by the handler. Not a state
  // updater: React may run updaters twice, which would send the action twice.
  const liveRef = React.useRef(initialLive);

  const apply = React.useCallback((value: boolean) => {
    liveRef.current = value;
    setLiveState(value);
  }, []);

  const setLive = React.useCallback(
    (next: boolean) => {
      const previous = liveRef.current;
      apply(next); // optimistic
      startTransition(async () => {
        try {
          const res = await setInstantAvailability({ live: next });
          if ("error" in res) {
            apply(previous);
            toast.error(res.error);
            return;
          }
          apply(res.isLive);
          toast.success(
            res.isLive
              ? "You're live — students can request an instant session."
              : "You're offline for instant sessions.",
          );
        } catch {
          apply(previous);
          toast.error("Could not change your availability. Try again.");
        }
      });
    },
    [apply],
  );

  return { live, pending, broadcastHref, setLive };
}

export function GoLiveProvider({
  initialLive,
  broadcastHref,
  children,
}: {
  initialLive: boolean;
  broadcastHref: string | null;
  children: React.ReactNode;
}) {
  const value = useGoLiveState(initialLive, broadcastHref);
  return <GoLiveContext.Provider value={value}>{children}</GoLiveContext.Provider>;
}

/** The shared state, or null outside a tutor shell. */
export function useGoLive(): GoLiveValue | null {
  return React.useContext(GoLiveContext);
}
