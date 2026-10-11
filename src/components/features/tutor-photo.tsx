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
 *
 * Tutors upload portraits (a phone selfie, a passport-style headshot) and the
 * boxes are landscape, so a centred crop takes the head off. `fit="cover"`
 * (default) crops with the focus a quarter of the way down, where a face sits
 * in almost every portrait. `fit="contain"` shows the whole photo over a
 * blurred, enlarged copy of itself, for the one place the photo is the point
 * (the profile stage): no grey bars, nothing cut.
 */
export function TutorPhoto({
  src,
  name,
  sizes,
  className,
  initialsClassName,
  fit = "cover",
}: {
  src: string | null;
  name: string;
  /** `next/image` sizes hint for the rendered width. */
  sizes: string;
  className?: string;
  initialsClassName?: string;
  /** `cover` crops with a face-high focus; `contain` shows the whole photo over a blurred backdrop. */
  fit?: "cover" | "contain";
}) {
  const [failed, setFailed] = React.useState(false);
  const showImg = src && !failed;
  return (
    <div className={cn("relative overflow-hidden rounded-lg bg-surface-muted", className)}>
      {showImg ? (
        <>
          {fit === "contain" && (
            <Image
              src={src}
              alt=""
              aria-hidden
              fill
              sizes={sizes}
              className="scale-110 object-cover blur-xl saturate-[1.15]"
            />
          )}
          <Image
            src={src}
            alt={`Photo of ${name}`}
            fill
            sizes={sizes}
            className={fit === "contain" ? "object-contain" : "object-cover object-[50%_25%]"}
            onError={() => setFailed(true)}
          />
        </>
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
