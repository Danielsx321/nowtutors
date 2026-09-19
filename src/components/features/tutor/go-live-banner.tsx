"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/features/dashboard/banner";
import { useGoLive } from "@/components/features/tutor/go-live-context";

/**
 * The tutor dashboard's banner (live-globe rebuild Part F; pages.html, Tutor
 * dashboard): the tutor's live state in words, and one button that changes it.
 * It shares the topbar switch's state (`GoLiveProvider`), so the two can never
 * disagree, and it is a button, not a second switch: the presence E2E finds the
 * one switch named "Available for instant sessions" on the page.
 *
 * While broadcasting, instant availability is locked (Q5); the banner says so
 * and links back to the broadcast.
 */
export function GoLiveBanner({ othersLive }: { othersLive: number }) {
  const state = useGoLive();
  if (!state) return null;
  const { live, pending, broadcastHref, setLive } = state;

  const others =
    othersLive > 0
      ? `${othersLive.toLocaleString()} other ${othersLive === 1 ? "tutor" : "tutors"} live`
      : "No other tutors live right now";

  if (broadcastHref) {
    return (
      <Banner kicker="You're broadcasting" title="Your live class is on air">
        <Button asChild variant="highlight">
          <Link href={broadcastHref}>Return to your broadcast</Link>
        </Button>
        <span className="text-small text-on-primary/75">Instant requests are paused while you broadcast.</span>
      </Banner>
    );
  }

  return live ? (
    <Banner kicker="You're live" title="Students can request you right now">
      <Button variant="highlight" onClick={() => setLive(false)} loading={pending}>
        Go offline
      </Button>
      <span className="text-small text-on-primary/75">{others}</span>
    </Banner>
  ) : (
    <Banner kicker="You're offline" title="Go live to take instant requests">
      <Button variant="highlight" onClick={() => setLive(true)} loading={pending}>
        Go live now
      </Button>
      <span className="text-small text-on-primary/75">{others}</span>
    </Banner>
  );
}
