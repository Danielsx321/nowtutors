"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { sessionPriceCredits } from "@/lib/credits/pricing";
import { createScheduledBooking } from "@/actions/bookings";
import type { BookableSubject } from "@/db/queries/bookings";

export type BookingMode = "student" | "anon" | "self" | "tutor";

interface BookingWidgetProps {
  tutorId: string;
  hourlyRateCredits: number;
  durations: number[];
  slotsByDuration: Record<number, string[]>;
  subjects: BookableSubject[];
  mode: BookingMode;
  viewerTimeZone: string;
  tutorTimeZone: string;
  walletBalance: number;
  loginHref: string;
}

/**
 * Scheduled-booking picker (SPEC §7.3, student side). Slots are computed
 * server-side and rendered here in the STUDENT's timezone, with the tutor's zone
 * shown as a secondary label. Duration/subject/slot/notes → createScheduledBooking,
 * which re-validates the slot and re-derives the price server-side; this UI never
 * sends a price. Credits path only in this phase.
 */
export function BookingWidget({
  tutorId,
  hourlyRateCredits,
  durations,
  slotsByDuration,
  subjects,
  mode,
  viewerTimeZone,
  tutorTimeZone,
  walletBalance,
  loginHref,
}: BookingWidgetProps) {
  const router = useRouter();
  const [duration, setDuration] = React.useState<number>(durations[0] ?? 60);
  const [subjectId, setSubjectId] = React.useState<string>(subjects[0]?.id ?? "");
  const [selectedSlot, setSelectedSlot] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const slots = React.useMemo(
    () => slotsByDuration[duration] ?? [],
    [slotsByDuration, duration],
  );
  const price = sessionPriceCredits(hourlyRateCredits, duration);
  const canAfford = walletBalance >= price;

  // Group slot instants into day sections, rendered in the viewer's timezone.
  const dayGroups = React.useMemo(() => groupByDay(slots, viewerTimeZone), [slots, viewerTimeZone]);

  // A slot selected under one duration may not exist under another.
  React.useEffect(() => {
    if (selectedSlot && !slots.includes(selectedSlot)) setSelectedSlot(null);
  }, [slots, selectedSlot]);

  if (mode === "anon") {
    return (
      <Alert variant="info" title="Sign in to book">
        <Link href={loginHref} className="font-medium text-purple-500 hover:underline">
          Log in or create an account
        </Link>{" "}
        to book a session with this tutor.
      </Alert>
    );
  }
  if (mode === "tutor") {
    return <Alert variant="info">Switch to a student account to book a session.</Alert>;
  }
  if (mode === "self") {
    return <Alert variant="info">This is your own profile.</Alert>;
  }

  if (subjects.length === 0) {
    return <Alert variant="warning">This tutor hasn’t listed any subjects yet.</Alert>;
  }
  if (durations.every((d) => (slotsByDuration[d] ?? []).length === 0)) {
    return (
      <Alert variant="info" title="No open times right now">
        This tutor has no bookable slots in the next few days. Check back soon.
      </Alert>
    );
  }

  async function onConfirm() {
    if (!selectedSlot) return;
    setSubmitting(true);
    setError(null);
    const result = await createScheduledBooking({
      tutorId,
      subjectId,
      startAt: selectedSlot,
      durationMinutes: duration,
      notes: notes.trim() || undefined,
    });
    if ("error" in result) {
      setError(result.error);
      setSubmitting(false);
      return;
    }
    router.push(`/dashboard/bookings/${result.bookingId}`);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="booking-duration">Session length</Label>
        <div className="flex gap-2" id="booking-duration" role="group" aria-label="Session length">
          {durations.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDuration(d)}
              aria-pressed={d === duration}
              className={cn(
                "focus-ring flex-1 rounded-md border px-3 py-2 text-small font-medium transition-colors",
                d === duration
                  ? "border-purple-500 bg-purple-500 text-white"
                  : "border-gray-200 bg-white text-gray-700 hover:border-gray-300",
              )}
            >
              {d} min
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="booking-subject">Subject</Label>
        <Select value={subjectId} onValueChange={setSubjectId}>
          <SelectTrigger id="booking-subject">
            <SelectValue placeholder="Choose a subject" />
          </SelectTrigger>
          <SelectContent>
            {subjects.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Pick a time</Label>
        <p className="text-caption text-gray-500">
          Times shown in your timezone ({viewerTimeZone}). Tutor’s timezone: {tutorTimeZone}.
        </p>
        <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border border-gray-200 p-3">
          {dayGroups.length === 0 && (
            <p className="py-4 text-center text-small text-gray-500">
              No {duration}-minute slots available.
            </p>
          )}
          {dayGroups.map((group) => (
            <div key={group.key} className="space-y-1.5">
              <p className="text-caption font-semibold uppercase tracking-wide text-gray-500">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {group.slots.map((slot) => (
                  <button
                    key={slot.iso}
                    type="button"
                    onClick={() => setSelectedSlot(slot.iso)}
                    aria-pressed={slot.iso === selectedSlot}
                    className={cn(
                      "focus-ring rounded-md border px-2.5 py-1.5 text-small transition-colors",
                      slot.iso === selectedSlot
                        ? "border-purple-500 bg-purple-500 text-white"
                        : "border-gray-200 bg-white text-gray-700 hover:border-purple-300",
                    )}
                  >
                    {slot.time}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="booking-notes">What you’d like help with (optional)</Label>
        <Textarea
          id="booking-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="e.g. Quadratic equations ahead of my exam"
        />
      </div>

      <div className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2">
        <span className="text-small text-gray-500">Price</span>
        <span className="text-body font-semibold text-gray-700">{price} credits</span>
      </div>

      {selectedSlot && !canAfford && (
        <Alert variant="warning" title="Not enough credits">
          This session costs {price} credits; your balance is {walletBalance}.{" "}
          <Link href="/dashboard/wallet" className="font-medium text-purple-500 hover:underline">
            Top up
          </Link>
          .
        </Alert>
      )}
      {error && <Alert variant="danger">{error}</Alert>}

      <Button
        className="w-full"
        onClick={onConfirm}
        disabled={!selectedSlot || !subjectId || submitting || !canAfford}
        loading={submitting}
      >
        {selectedSlot ? `Book for ${price} credits` : "Select a time"}
      </Button>
    </div>
  );
}

interface DaySlot {
  iso: string;
  time: string;
}
interface DayGroup {
  key: string;
  label: string;
  slots: DaySlot[];
}

function groupByDay(isoSlots: string[], timeZone: string): DayGroup[] {
  const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayLabelFmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });

  const groups = new Map<string, DayGroup>();
  for (const iso of isoSlots) {
    const d = new Date(iso);
    const key = dayKeyFmt.format(d);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: dayLabelFmt.format(d), slots: [] };
      groups.set(key, group);
    }
    group.slots.push({ iso, time: timeFmt.format(d) });
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}
