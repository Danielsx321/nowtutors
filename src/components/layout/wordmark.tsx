import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  MONOGRAM_PATH,
  MONOGRAM_VIEWBOX,
  WORDMARK_PATH,
  WORDMARK_VIEWBOX,
} from "@/components/layout/wordmark-paths";

export interface WordmarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** `onLight` (default): ink. `onDark`: white, for footers and rooms. */
  tone?: "onLight" | "onDark";
  size?: "sm" | "md" | "lg";
  /** Wrap in a link to `/`. */
  href?: string;
}

/** Height sets the size; the width follows the logo's own proportions. */
const sizes = {
  sm: "h-5",
  md: "h-7",
  lg: "h-9",
} as const;

/**
 * The NowTutors logo (DESIGN.md, "Wordmark"): Noora's lowercase "nowtutors"
 * drawn as one vector path in `currentColor`, so it is ink on light surfaces
 * and white on dark ones. Single colour on purpose: the logo has no brand
 * fill of its own. One component, used by the header, footer, app shell and
 * auth pages, so it can't drift.
 */
export function Wordmark({
  tone = "onLight",
  size = "md",
  href,
  className,
  ...props
}: WordmarkProps) {
  const mark = (
    <span
      className={cn(
        "inline-flex leading-none",
        tone === "onDark" ? "text-text-on-inverse" : "text-text",
        className,
      )}
      {...props}
    >
      <svg
        viewBox={WORDMARK_VIEWBOX}
        className={cn("w-auto", sizes[size])}
        role="img"
        aria-label="NowTutors"
        aria-hidden={href ? true : undefined}
        focusable="false"
      >
        <path fill="currentColor" fillRule="evenodd" d={WORDMARK_PATH} />
      </svg>
    </span>
  );
  if (!href) return mark;
  return (
    <Link href={href} aria-label="NowTutors home" className="focus-ring inline-flex rounded-sm">
      {mark}
    </Link>
  );
}

/** The logo's own "n", for places too narrow for the full mark (the collapsed sidebar rail). Decorative. */
export function Monogram({ className }: { className?: string }) {
  return (
    <svg
      viewBox={MONOGRAM_VIEWBOX}
      className={cn("size-7 text-text", className)}
      aria-hidden
      focusable="false"
    >
      <path fill="currentColor" fillRule="evenodd" d={MONOGRAM_PATH} />
    </svg>
  );
}
