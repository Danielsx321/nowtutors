import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The live signal, as text (DESIGN.md, "The live signal"). Green text on the
 * green surface, always with a word: "Live now" for a tutor taking instant
 * requests, "LIVE" for a broadcast, with an optional viewer count. Never a bare
 * dot: the dot is decoration for the label, not the indicator.
 */
export interface LiveChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  label?: string;
  /** Broadcast viewer count. Rendered as "· 12" after the label. */
  viewers?: number;
  size?: "sm" | "md";
}

export function LiveChip({
  label = "Live now",
  viewers,
  size = "md",
  className,
  ...props
}: LiveChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-live-surface font-semibold text-live",
        size === "sm" ? "px-2 py-0.5 text-caption" : "px-2.5 py-1 text-small",
        className,
      )}
      {...props}
    >
      <span
        className="animate-pulse-live size-2 shrink-0 rounded-full bg-live"
        aria-hidden
      />
      {label}
      {viewers != null && (
        <span data-numeric className="font-medium">
          · {viewers.toLocaleString()}
        </span>
      )}
    </span>
  );
}
