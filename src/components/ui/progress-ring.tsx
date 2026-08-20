import * as React from "react";
import { cn } from "@/lib/utils";

export interface ProgressRingProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** 0–1 fraction remaining. */
  value: number;
  size?: number;
  strokeWidth?: number;
  label?: React.ReactNode;
  /** Announce changes politely (used by the 60s request countdown). */
  live?: boolean;
}

/**
 * Circular progress indicator — the instant-request 60-second countdown ring
 * (SPEC §10.2). Turns from purple → warning → danger as it empties.
 */
export function ProgressRing({
  value,
  size = 72,
  strokeWidth = 6,
  label,
  live,
  className,
  ...props
}: ProgressRingProps) {
  const v = Math.max(0, Math.min(1, value));
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const color =
    v > 0.5 ? "text-purple-500" : v > 0.2 ? "text-warning" : "text-danger";

  return (
    <div
      className={cn("relative inline-grid place-items-center", className)}
      style={{ width: size, height: size }}
      role={live ? "timer" : undefined}
      aria-live={live ? "polite" : undefined}
      {...props}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={strokeWidth}
          className="text-gray-200"
          stroke="currentColor"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className={cn(color, "transition-[stroke-dashoffset] duration-500")}
          stroke="currentColor"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
        />
      </svg>
      {label != null && (
        <span className="absolute text-body font-bold text-gray-700">
          {label}
        </span>
      )}
    </div>
  );
}
