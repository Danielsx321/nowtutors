"use client";

import * as React from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { toggleFavourite } from "@/actions/favourites";

export type FavouriteMode = "student" | "anon" | "hidden";

export interface FavouriteHeartProps {
  tutorId: string;
  initialFavourited: boolean;
  mode: FavouriteMode;
  /** Where an anonymous viewer is sent on click. */
  loginHref?: string;
  className?: string;
}

/**
 * The favourite heart on a TutorCard. Students toggle optimistically; anonymous
 * viewers are routed to /login (favouriting requires a student account); tutors/
 * admins don't see it. Sits on a card that is itself a link, so clicks are stopped
 * from bubbling.
 */
export function FavouriteHeart({
  tutorId,
  initialFavourited,
  mode,
  loginHref = "/login",
  className,
}: FavouriteHeartProps) {
  const [favourited, setFavourited] = React.useState(initialFavourited);
  const [pending, startTransition] = React.useTransition();

  if (mode === "hidden") return null;

  const base = cn(
    "focus-ring grid size-9 place-items-center rounded-full bg-white/90 shadow-sm transition-colors hover:bg-white",
    className,
  );

  if (mode === "anon") {
    return (
      <Link
        href={loginHref}
        aria-label="Log in to save this tutor"
        onClick={(e) => e.stopPropagation()}
        className={base}
      >
        <Heart className="size-5 text-gray-500" />
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={favourited}
      aria-label={favourited ? "Remove from favourites" : "Add to favourites"}
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = !favourited;
        setFavourited(next); // optimistic
        startTransition(async () => {
          try {
            const res = await toggleFavourite({ tutorId });
            setFavourited(res.favourited);
          } catch {
            setFavourited(!next); // revert
          }
        });
      }}
      className={cn(base, "disabled:opacity-60")}
    >
      <Heart
        className={cn(
          "size-5 transition-colors",
          favourited ? "fill-purple-500 text-purple-500" : "text-gray-500",
        )}
      />
    </button>
  );
}
