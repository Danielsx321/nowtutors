"use client";

import * as React from "react";
import { ErrorView } from "@/components/layout/error-view";

/** Session rooms. A session is timed on the server, so a crashed room page loses nothing (Phase 10 Part 5). Rendered inside this area's layout, so its navigation stays. */
export default function AreaError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorView
      error={error}
      reset={reset}
      message="Something on our side broke while loading the room."
      home={{ href: "/", label: "Leave the room" }}
      extra="If your session was running, it still is. Try again to rejoin; the time is kept on our side."
    />
  );
}
