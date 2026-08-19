"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const sizes = {
  sm: "size-8 text-caption",
  md: "size-10 text-small",
  lg: "size-14 text-body-lg",
  xl: "size-20 text-h2",
} as const;

function initials(name?: string) {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  src?: string | null;
  name?: string;
  size?: keyof typeof sizes;
}

/**
 * User avatar with a generated initials fallback (SPEC §7.2). Falls back to
 * initials both when no src is given and when the image fails to load — so the
 * "photos not rendering" failure never shows a broken image.
 */
export function Avatar({
  src,
  name,
  size = "md",
  className,
  ...props
}: AvatarProps) {
  const [failed, setFailed] = React.useState(false);
  const showImg = src && !failed;
  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-purple-100 font-medium text-purple-700",
        sizes[size],
        className,
      )}
      {...props}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element -- next/image host allowlist lands in Phase 3
        <img
          src={src}
          alt={name ? `${name}’s avatar` : "Avatar"}
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden>{initials(name)}</span>
      )}
      {!showImg && <span className="sr-only">{name ?? "Avatar"}</span>}
    </span>
  );
}
