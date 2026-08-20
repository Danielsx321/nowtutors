"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toast";

/**
 * App-wide client providers, mounted once in the root layout.
 * - TooltipProvider: shared delay/skip config for all tooltips.
 * - Toaster: sonner root, restyled to brand tokens (see toast.tsx).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      {children}
      <Toaster />
    </TooltipProvider>
  );
}
