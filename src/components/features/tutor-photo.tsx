"use client";

import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * A tutor's photo as a rounded inset (DESIGN.md, "Cards" and "Photos"). Fills
 * its box, so the caller sets the size or aspect ratio. Falls back to quiet
 * initials on the muted surface when there's no photo or it fails to load: a
 * missing photo reads as missing, not as a design choice.
 */
export function TutorPhoto({
  src,
  name,
  sizes,
  className,
  initialsClassName,
}: {
  src: string | null;
  name: string;
  /** `next/image` sizes hint for the rendered width. */
  sizes: string;
  className?: string;
  initialsClassName?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  const showImg = src && !failed;
  return (
    <div className={cn("relative overflow-hidden rounded-lg bg-surface-muted", className)}>
      {showImg ? (
        <Image
          src={src}
          alt={`Photo of ${name}`}
          fill
          sizes={sizes}
          className="object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          role="img"
          aria-label={`${name}, no photo yet`}
          className={cn(
            "absolute inset-0 grid place-items-center font-display font-semibold text-text-muted",
            initialsClassName,
          )}
        >
          <span aria-hidden>{initials(name)}</span>
        </div>
      )}
    </div>
  );
}
