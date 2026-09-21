import * as React from "react";
import { preload } from "react-dom";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { MONOGRAM_PATH, MONOGRAM_VIEWBOX } from "@/components/layout/wordmark-paths";

/**
 * The logo's outline, one static file. Versioned in its name because
 * `next.config.ts` serves `/brand/*` as immutable: a new outline is a new file.
 */
export const WORDMARK_SRC = "/brand/wordmark.v1.svg";

/**
 * The file as a mask over a block of `currentColor`. Width follows the height
 * through the logo's own proportions (its viewBox, 1058 x 163.25).
 */
const MASK: React.CSSProperties = {
  aspectRatio: "1058 / 163.25",
  maskImage: `url(${WORDMARK_SRC})`,
  WebkitMaskImage: `url(${WORDMARK_SRC})`,
  maskSize: "contain",
  WebkitMaskSize: "contain",
  maskRepeat: "no-repeat",
  WebkitMaskRepeat: "no-repeat",
  maskPosition: "center",
  WebkitMaskPosition: "center",
  printColorAdjust: "exact",
};

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
 * The NowTutors logo (DESIGN.md, "Wordmark"): Noora's lowercase "nowtutors",
 * one vector path painted in `currentColor`, so it is ink on light surfaces
 * and white on dark ones. Single colour on purpose: the logo has no brand
 * fill of its own. One component, used by the header, footer, app shell and
 * auth pages, so it can't drift.
 *
 * The path is 34 KB, so it is not inline. It is one cached file used as a CSS
 * mask (performance review P4): inline it was about 136 KB of every page.
 * Preloaded, so the header logo doesn't wait for the stylesheet. In forced
 * colours the block takes the system text colour, where a background would
 * otherwise be dropped.
 */
export function Wordmark({
  tone = "onLight",
  size = "md",
  href,
  className,
  ...props
}: WordmarkProps) {
  preload(WORDMARK_SRC, { as: "image", type: "image/svg+xml" });
  const mark = (
    <span
      className={cn(
        "inline-flex leading-none",
        tone === "onDark" ? "text-text-on-inverse" : "text-text",
        className,
      )}
      {...props}
    >
      <span
        data-wordmark
        role="img"
        aria-label="NowTutors"
        aria-hidden={href ? true : undefined}
        className={cn(
          "block bg-current forced-color-adjust-none forced-colors:bg-[CanvasText]",
          sizes[size],
        )}
        style={MASK}
      />
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
