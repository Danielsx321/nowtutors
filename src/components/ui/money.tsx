import * as React from "react";
import { cn } from "@/lib/utils";

export interface MoneyProps extends React.HTMLAttributes<HTMLSpanElement> {
  credits: number;
  /** USD per credit from the direct-pay basis package (`lib/credits/packages.ts`). Never hard-code. */
  usdPerCredit?: number;
  /** Render the "≈ $X" anchor after the credits. Needs `usdPerCredit`. */
  showUsd?: boolean;
  /** "hr", "session"... rendered as "/ hr". */
  per?: string;
  size?: "sm" | "md" | "lg";
  /** Prefix a sign: "+20 cr" / "−20 cr" for transaction lists. */
  signed?: boolean;
  /**
   * For narrow cells (the card's Rate): "45 cr" on one line and the "≈ $" anchor
   * on the next, with the `per` unit in the accessible label only, since the
   * cell's own label already says Rate.
   */
  stacked?: boolean;
}

const sizes = {
  sm: { amount: "text-body font-semibold", rest: "text-caption" },
  md: { amount: "text-h3 font-semibold", rest: "text-small" },
  lg: { amount: "text-h1 font-semibold", rest: "text-small" },
} as const;

export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * One formatter for credits and their dollar anchor (DESIGN.md, "Money").
 * `<Money credits={20} usdPerCredit={1} showUsd />` renders "20 cr ≈ $20".
 * Tabular figures. The payout rate ($1/credit to tutors) is a tutor-side
 * number and never goes through `showUsd` on a student surface.
 */
export function Money({
  credits,
  usdPerCredit,
  showUsd,
  per,
  size = "md",
  signed,
  stacked,
  className,
  ...props
}: MoneyProps) {
  const s = sizes[size];
  const abs = Math.abs(credits);
  const sign = signed ? (credits < 0 ? "−" : "+") : "";
  const usd = showUsd && usdPerCredit != null ? abs * usdPerCredit : null;
  const label = `${sign}${abs.toLocaleString()} ${abs === 1 ? "credit" : "credits"}${
    per ? ` per ${per}` : ""
  }${usd != null ? `, about ${formatUsd(usd)}` : ""}`;
  if (stacked) {
    return (
      <span data-numeric className={cn("relative flex flex-col text-text", className)} {...props}>
        <span className="sr-only">{label}</span>
        <span aria-hidden className="whitespace-nowrap">
          <span className={cn("font-display", s.amount)}>
            {sign}
            {abs.toLocaleString()}
          </span>{" "}
          <span className={cn("text-text-muted", s.rest)}>cr</span>
        </span>
        {usd != null && (
          <span aria-hidden className={cn("whitespace-nowrap text-text-muted", s.rest)}>
            ≈ {formatUsd(usd)}
          </span>
        )}
      </span>
    );
  }

  return (
    <span
      data-numeric
      className={cn("relative inline-flex flex-wrap items-baseline gap-x-1.5 text-text", className)}
      {...props}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden className={cn("font-display", s.amount)}>
        {sign}
        {abs.toLocaleString()}
      </span>
      <span aria-hidden className={cn("text-text-muted", s.rest)}>
        cr{per ? ` / ${per}` : ""}
      </span>
      {usd != null && (
        <span aria-hidden className={cn("text-text-muted", s.rest)}>
          ≈ {formatUsd(usd)}
        </span>
      )}
    </span>
  );
}
