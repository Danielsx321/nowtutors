"use client";

import * as React from "react";
import { useUnreadCount } from "@/hooks/use-unread-count";

/**
 * One unread count for the whole shell.
 *
 * The topbar link and the mobile bottom bar both show the badge, and both are
 * always mounted (the bar is hidden with CSS, not unmounted), so each calling
 * `useUnreadCount` would open two Realtime channels on the same topic for every
 * signed-in page. The provider runs the hook once; consumers read the value.
 *
 * Components used outside the shell (and the DOM tests, which render the link
 * on its own) keep working: with no provider above them, `useSharedUnreadCount`
 * falls back to its own subscription.
 */
const UnreadCountContext = React.createContext<number | null>(null);

export function UnreadCountProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  const count = useUnreadCount(enabled);
  return (
    <UnreadCountContext.Provider value={count}>{children}</UnreadCountContext.Provider>
  );
}

export function useSharedUnreadCount(enabled: boolean): number {
  const shared = React.useContext(UnreadCountContext);
  // Hook order stays fixed: the fallback always runs, but subscribes to nothing
  // when a provider is supplying the count.
  const own = useUnreadCount(enabled && shared === null);
  return shared ?? own;
}
