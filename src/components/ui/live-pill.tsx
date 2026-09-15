import * as React from "react";
import { LiveChip, type LiveChipProps } from "@/components/ui/live-chip";

/**
 * @deprecated Thin re-export of `LiveChip` for the pages Parts 3 to 5 convert.
 * The `surface` prop is accepted and ignored (the chip is surface-agnostic).
 * REMOVE IN PART 6.
 */
export interface LivePillProps extends LiveChipProps {
  surface?: "light" | "ink";
}

export function LivePill({ surface: _surface, label = "LIVE", ...props }: LivePillProps) {
  void _surface;
  return <LiveChip label={label} {...props} />;
}
