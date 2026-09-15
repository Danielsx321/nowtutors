import * as React from "react";
import { Coins } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CreditBalanceProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  credits: number;
  size?: "sm" | "md" | "lg";
  /** @deprecated `ink` kept rendering for the old dark topbar. REMOVE IN PART 6. */
  tone?: "light" | "ink";
}

const sizeMap = {
  sm: { text: "text-small", icon: "size-3.5", pad: "px-2 py-0.5" },
  md: { text: "text-body font-medium", icon: "size-4", pad: "px-2.5 py-1" },
  lg: { text: "text-body-lg font-semibold", icon: "size-5", pad: "px-3 py-1.5" },
} as const;

/** Wallet credit balance pill, tabular figures so it doesn't jitter. */
export function CreditBalance({
  credits,
  size = "md",
  tone = "light",
  className,
  ...props
}: CreditBalanceProps) {
  const s = sizeMap[size];
  return (
    <span
      data-numeric
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border",
        s.pad,
        s.text,
        tone === "ink"
          ? "border-border-strong text-text-on-inverse"
          : "border-border bg-surface-muted text-text",
        className,
      )}
      aria-label={`${credits.toLocaleString()} credits`}
      {...props}
    >
      <Coins className={s.icon} aria-hidden />
      {credits.toLocaleString()}
    </span>
  );
}
