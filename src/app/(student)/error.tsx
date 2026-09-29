"use client";

import * as React from "react";
import { ErrorView } from "@/components/layout/error-view";

/** Student area (Phase 10 Part 5). Rendered inside this area's layout, so its navigation stays. */
export default function AreaError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorView
      error={error}
      reset={reset}
      message="Something on our side broke while loading your dashboard."
      home={{ href: "/dashboard", label: "Go to your dashboard" }}
    />
  );
}
