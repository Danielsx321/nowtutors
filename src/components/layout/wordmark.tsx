import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface WordmarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** `onLight` (default): ink "Now". `onDark`: white "Now", for footers and rooms. */
  tone?: "onLight" | "onDark";
  size?: "sm" | "md" | "lg";
  /** Wrap in a link to `/`. */
  href?: string;
}

const sizes = {
  sm: "text-h3",
  md: "text-h2",
  lg: "text-h1",
} as const;

/**
 * The NowTutors wordmark (DESIGN.md, "Wordmark"): "Now" in ink, "Tutors" in
 * ink on a signal-yellow block. Set in DM Sans 700 through `font-wordmark`,
 * pinned so the app font can change without touching the logo. Yellow on
 * white is 1.29:1, which is why "Tutors" sits on a block rather than being
 * yellow text: ink on the block is 13.93:1. One component, used by the header,
 * footer, app shell and auth pages, so it can't drift.
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
        "inline-flex items-baseline font-wordmark font-bold leading-none tracking-tight",
        sizes[size],
        tone === "onDark" ? "text-text-on-inverse" : "text-text",
        className,
      )}
      {...props}
    >
      <span>Now</span>
      <span className="ml-0.5 rounded-sm bg-signal px-1 text-on-signal">Tutors</span>
    </span>
  );
  if (!href) return mark;
  return (
    <Link href={href} aria-label="NowTutors home" className="focus-ring inline-flex rounded-sm">
      {mark}
    </Link>
  );
}
