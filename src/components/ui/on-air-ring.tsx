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
 * The yellow on-air ring around the photo of a tutor who is taking instant
 * requests right now (DESIGN.md, "The live signal"). This is the ONLY place
 * signal yellow touches a tutor: it marks "start in 60 seconds", not
 * "broadcasting" (that is the green LIVE chip). Pair it with a `LiveChip`
 * label; the ring alone is not the indicator. Wrap an `Avatar` or a photo.
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
        active && "ring-[3px] ring-signal",
        active && !still && "animate-on-air",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
