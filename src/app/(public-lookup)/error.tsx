"use client";

import * as React from "react";
import { ErrorView } from "@/components/layout/error-view";

/**
 * Same error view as `(public)/error.tsx`, for the lookup pages that live in
 * their own group (see `layout.tsx` here). Rendered inside this area's layout,
 * so its navigation stays.
 */
export default function AreaError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorView
      error={error}
      reset={reset}
      message="Something on our side broke while loading this page."
      home={{ href: "/tutors", label: "Browse tutors" }}
    />
  );
}
