import * as React from "react";
import { cn } from "@/lib/utils";

export interface OnAirRingProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Draw the ring. When false, renders the child alone (same layout box). */
  active?: boolean;
  /** Static ring with no glow, for grids of many cards or reduced motion. */
  still?: boolean;
  children: React.ReactNode;
}

/**
 * The green on-air ring around the photo of a tutor who is taking instant
 * requests right now (DESIGN.md, "The live signal"). It marks "start in 60
 * seconds"; broadcasting is the LIVE chip without a ring. Pair it with a
 * `LiveChip` label: the ring alone is not the indicator, because colour
 * alone never is. Wrap an `Avatar` or a photo.
 */
export function OnAirRing({
  active = true,
  still,
  className,
  children,
  ...props
}: OnAirRingProps) {
  return (
    <span
      className={cn(
        "relative inline-block rounded-full",
        active && "ring-[3px] ring-live",
        active && !still && "animate-on-air",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
