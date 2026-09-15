"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

export interface ProgressProps
  extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  /** 0 to 100. */
  value: number;
  tone?: "primary" | "live" | "warning" | "danger";
  /** Bar height. `xs` is the session-clock line under a top bar. */
  size?: "xs" | "sm" | "md";
}

const tones = {
  primary: "bg-primary",
  live: "bg-live",
  warning: "bg-warning",
  danger: "bg-danger",
} as const;

const heights = { xs: "h-0.5", sm: "h-1.5", md: "h-2.5" } as const;

/**
 * Linear progress (Radix Progress: `role="progressbar"` with
 * aria-valuenow/min/max). Used for the session clock line and the request
 * drain in linear layouts; the countdown ring keeps `ProgressRing`.
 */
export const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value, tone = "primary", size = "sm", ...props }, ref) => {
  const v = Math.max(0, Math.min(100, value));
  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={v}
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-surface-muted",
        heights[size],
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn("h-full rounded-full transition-[width] duration-300", tones[tone])}
        style={{ width: `${v}%` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = "Progress";
