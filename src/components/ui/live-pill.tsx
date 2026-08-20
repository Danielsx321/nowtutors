import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * LIVE status indicator. The ONLY component that uses live-green (SPEC §10.1:
 * live green appears only on live status). Pulsing dot respects reduced motion
 * via the global stylesheet.
 */
export interface LivePillProps extends React.HTMLAttributes<HTMLSpanElement> {
  label?: string;
  /** `ink` for the ink card/surface: live-400 fill + ink-900 text (4.75:1).
   *  Default is the light-surface treatment: live-500 fill + white text. */
  surface?: "light" | "ink";
}

export function LivePill({
  label = "LIVE",
  surface = "light",
  className,
  ...props
}: LivePillProps) {
  const ink = surface === "ink";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-bold uppercase tracking-wide",
        ink ? "bg-live-400 text-ink-900" : "bg-live-500 text-white",
        className,
      )}
      {...props}
    >
      <span className="relative grid size-2 place-items-center" aria-hidden>
        <span
          className={cn(
            "absolute size-2 animate-ping rounded-full",
            ink ? "bg-ink-900/50" : "bg-white/70",
          )}
        />
        <span
          className={cn(
            "size-1.5 rounded-full",
            ink ? "bg-ink-900" : "bg-white",
          )}
        />
      </span>
      {label}
    </span>
  );
}
