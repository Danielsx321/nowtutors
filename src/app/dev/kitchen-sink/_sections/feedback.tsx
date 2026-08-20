"use client";

import { Info } from "lucide-react";
import { Section, Demo, muted, type Surface } from "./kit";
import { cn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ProgressRing } from "@/components/ui/progress-ring";
import { toast } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function FeedbackSection({ surface }: { surface: Surface }) {
  return (
    <Section id="feedback" title="Feedback & status" surface={surface}>
      <Demo label="Alert" surface={surface} className="flex-col items-stretch">
        <Alert variant="info" title="Heads up">
          Your session starts in 10 minutes.
        </Alert>
        <Alert variant="success" title="Booking confirmed">
          We’ve emailed you the details and a calendar invite.
        </Alert>
        <Alert variant="warning" title="Low balance">
          You have fewer than 30 credits left.
        </Alert>
        <Alert variant="danger" title="Payment failed">
          We couldn’t capture your PayPal order. Try again.
        </Alert>
      </Demo>

      <Demo label="Toast (click to fire)" surface={surface}>
        <Button variant="secondary" onClick={() => toast.success("Session booked", { description: "Tomorrow at 3:00 PM" })}>
          Success
        </Button>
        <Button variant="secondary" onClick={() => toast.error("Something went wrong")}>
          Error
        </Button>
        <Button variant="secondary" onClick={() => toast.warning("Your tutor is running late")}>
          Warning
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast("New message", {
              description: "From your Physics tutor",
              action: { label: "View", onClick: () => {} },
            })
          }
        >
          With action
        </Button>
      </Demo>

      <Demo label="Tooltip" surface={surface}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="secondary" size="icon" aria-label="Info">
              <Info />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Credits never expire</TooltipContent>
        </Tooltip>
        <span className={cn("text-small", muted(surface))}>
          Hover or focus the button
        </span>
      </Demo>

      <Demo label="Spinner" surface={surface}>
        <Spinner size="sm" />
        <Spinner size="md" />
        <Spinner size="lg" />
      </Demo>

      <Demo label="Progress ring (60s request countdown)" surface={surface}>
        {/* `live` wires role=timer + aria-live; the real per-second tick is
            driven by the instant-request flow in Phase 6. */}
        <ProgressRing value={48 / 60} label={48} live />
        <ProgressRing value={0.75} label="75%" />
        <ProgressRing value={0.35} label="35%" />
        <ProgressRing value={0.1} label="10%" />
      </Demo>

      <Demo label="Skeleton" surface={surface} className="flex-col items-stretch">
        <div className="flex items-center gap-3">
          <Skeleton className="size-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      </Demo>
    </Section>
  );
}
