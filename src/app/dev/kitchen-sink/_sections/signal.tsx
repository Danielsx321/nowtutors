"use client";

import * as React from "react";
import { Section, Demo, type Surface } from "./kit";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LiveChip } from "@/components/ui/live-chip";
import { OnAirRing } from "@/components/ui/on-air-ring";
import { StatRow } from "@/components/ui/stat-row";
import { Money } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Wordmark } from "@/components/layout/wordmark";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * The primitives the design overhaul added (Part 1): the live signal pair,
 * the proof row, the money formatter, linear progress, the confirm dialog and
 * the wordmark. Part 3 composes them into the tutor card.
 */
export function SignalSection({ surface }: { surface: Surface }) {
  const [drain, setDrain] = React.useState(100);
  React.useEffect(() => {
    const id = window.setInterval(() => setDrain((d) => (d <= 0 ? 100 : d - 2)), 200);
    return () => window.clearInterval(id);
  }, []);

  return (
    <Section id="signal" title="Live signal, proof, money (new in the overhaul)" surface={surface}>
      <Demo label="Wordmark: Noora's nowtutors logo as one vector, ink on light, white on dark. Same component everywhere." surface={surface}>
        <Wordmark size="sm" />
        <Wordmark />
        <Wordmark size="lg" />
        <div className="theme-dark rounded-md bg-surface px-4 py-2">
          <Wordmark tone="onDark" />
        </div>
      </Demo>

      <Demo label="LiveChip: always a word. Live now (instant-available) vs LIVE with viewers (broadcasting)." surface={surface}>
        <LiveChip />
        <LiveChip label="LIVE" viewers={12} />
        <LiveChip size="sm" />
        <LiveChip size="sm" label="LIVE" viewers={2} />
      </Demo>

      <Demo label="OnAirRing: the green ring marks a tutor taking instant requests. Paired with the chip, never alone." surface={surface}>
        <OnAirRing>
          <Avatar size="xl" name="Liam Bennett" />
        </OnAirRing>
        <OnAirRing still>
          <Avatar size="lg" name="Liam Bennett" />
        </OnAirRing>
        <OnAirRing active={false}>
          <Avatar size="lg" name="Amara Okafor" />
        </OnAirRing>
        <Button variant="primary">Request now</Button>
      </Demo>

      <Demo label="StatRow: proof on the person (Experience, Sessions, Rate). New tutors say New." surface={surface} className="items-stretch">
        <StatRow
          className="w-80"
          stats={[
            { label: "Experience", value: "8y" },
            { label: "Sessions", value: "312" },
            { label: "Rate", value: <Money credits={45} usdPerCredit={1} showUsd size="sm" per="hr" /> },
          ]}
        />
        <StatRow
          size="sm"
          className="w-72"
          stats={[
            { label: "Experience", value: "New" },
            { label: "Sessions", value: "New" },
            { label: "Rate", value: <Money credits={20} size="sm" per="hr" /> },
          ]}
        />
      </Demo>

      <Demo label="Money: credits with the ≈ $ anchor from the basis package (never hard-coded)" surface={surface}>
        <Money credits={1240} usdPerCredit={1} showUsd size="lg" />
        <Money credits={45} usdPerCredit={1} showUsd per="hr" />
        <Money credits={20} signed size="sm" />
        <Money credits={-20} signed size="sm" />
      </Demo>

      <Demo label="Progress (linear) and ProgressRing (the 60 s countdown)" surface={surface} className="items-center">
        <div className="w-64 space-y-3">
          <Progress value={drain} tone={drain > 50 ? "primary" : drain > 20 ? "warning" : "danger"} aria-label="Request time remaining" />
          <Progress value={64} tone="live" size="md" aria-label="Session progress" />
          <Progress value={100} size="xs" aria-label="Thin line" />
        </div>
        <ProgressRing value={drain / 100} label={`${Math.round(drain * 0.6)}s`} live />
      </Demo>

      <Demo label="AlertDialog: money and destructive confirms. Outcome labels, nothing preselected, no outside-click dismiss (Escape still closes)." surface={surface}>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="secondary">Withdraw 45 credits ($45.00)</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Withdraw $45 to PayPal?</AlertDialogTitle>
              <AlertDialogDescription>
                45 credits go to <span data-numeric className="text-text">l•••@example.com</span>. This can&apos;t be
                reversed once processed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep credits</AlertDialogCancel>
              <AlertDialogAction>Withdraw $45 to PayPal</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="danger">End for everyone</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>End the session for both of you?</AlertDialogTitle>
              <AlertDialogDescription>
                12 minutes remain. Ending now completes the booking and pays the tutor.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Stay in the session</AlertDialogCancel>
              <AlertDialogAction variant="danger">End for everyone</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Demo>
    </Section>
  );
}
