"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toast";
import { ActiveSessionProvider, useActiveSession } from "@/components/features/session/active-session";
import { MiniPlayer } from "@/components/features/session/mini-player";

/**
 * App-wide client providers, mounted once in the root layout.
 * - TooltipProvider: shared delay/skip config for all tooltips.
 * - Toaster: sonner root, restyled to brand tokens (see toast.tsx).
 * - ActiveSessionProvider + MiniPlayer: the instant-session call lives here,
 *   above every route group, so leaving the room doesn't hang up; off the
 *   room it shows in the mini-player (active-session.tsx).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      <ActiveSessionProvider>
        {children}
        <MiniPlayer />
        <AppToaster />
      </ActiveSessionProvider>
    </TooltipProvider>
  );
}

/**
 * Toasts step aside for the mini-player: the other bottom corner on desktop,
 * and above the player on phones (player 76px up, about 260px tall).
 */
function AppToaster() {
  const { playerCorner } = useActiveSession();
  const bottom = playerCorner === "bl" || playerCorner === "br";
  return (
    <Toaster
      position={playerCorner === "br" ? "bottom-left" : "bottom-right"}
      mobileBottom={bottom ? 350 : 88}
    />
  );
}
