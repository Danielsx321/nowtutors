import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * LIVE status indicator. The ONLY component that uses live-green (SPEC §10.1:
 * live green appears only on live status). Pulsing dot respects reduced motion
 * via the global stylesheet.
 */
export interface LivePillProps extends React.HTMLAttributes<HTMLSpanElement> {
  label?: string;
}

export function LivePill({ label = "LIVE", className, ...props }: LivePillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-live-500 px-2.5 py-0.5 text-caption font-bold uppercase tracking-wide text-white",
        className,
      )}
      {...props}
    >
      <span className="relative grid size-2 place-items-center" aria-hidden>
        <span className="absolute size-2 animate-ping rounded-full bg-white/70" />
        <span className="size-1.5 rounded-full bg-white" />
      </span>
      {label}
    </span>
  );
}
