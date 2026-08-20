import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Loading placeholder. A shimmer sweep plays over a neutral block; the sweep is
 * disabled under prefers-reduced-motion (global stylesheet), leaving a static
 * tint.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-shimmer relative overflow-hidden rounded-md bg-gray-200",
        "after:absolute after:inset-0 after:-translate-x-full after:bg-gradient-to-r after:from-transparent after:via-white/60 after:to-transparent",
        className,
      )}
      {...props}
    />
  );
}
