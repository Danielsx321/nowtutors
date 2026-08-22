"use client";

import * as React from "react";
import { Plus, Trash2, CalendarX2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { TimePicker } from "@/components/ui/time-picker";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { saveAvailability } from "@/actions/availability";
import type {
  AvailabilityExceptionRow,
  AvailabilityRuleRow,
} from "@/db/queries/availability";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Window {
  start: string; // "HH:MM"
  end: string;
}
type WeekState = Window[][]; // index 0..6 → windows

interface ExceptionState {
  date: string; // "YYYY-MM-DD"
  mode: "blocked" | "custom";
  start: string;
  end: string;
}

const hhmm = (t: string) => t.slice(0, 5);

/**
 * /tutor/availability editor (SPEC §4.2, §6). Standing WEEKLY rules (recurring
 * per weekday, in the tutor's timezone) plus one-off date exceptions — NOT
 * one-off slots. Submits the whole schedule; the action replaces it atomically
 * and re-validates every window server-side.
 */
export function AvailabilityEditor({
  timezone,
  initialRules,
  initialExceptions,
}: {
  timezone: string;
  initialRules: AvailabilityRuleRow[];
  initialExceptions: AvailabilityExceptionRow[];
}) {
  const [week, setWeek] = React.useState<WeekState>(() => {
    const w: WeekState = [[], [], [], [], [], [], []];
    for (const r of initialRules) {
      w[r.weekday]?.push({ start: hhmm(r.startTime), end: hhmm(r.endTime) });
    }
    return w;
  });
  const [exceptions, setExceptions] = React.useState<ExceptionState[]>(() =>
    initialExceptions.map((e) => ({
      date: e.date,
      mode: e.isAvailable ? "custom" : "blocked",
      start: e.startTime ? hhmm(e.startTime) : "09:00",
      end: e.endTime ? hhmm(e.endTime) : "17:00",
    })),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  function addWindow(day: number) {
    setSaved(false);
    setWeek((w) => w.map((d, i) => (i === day ? [...d, { start: "09:00", end: "17:00" }] : d)));
  }
  function removeWindow(day: number, idx: number) {
    setSaved(false);
    setWeek((w) => w.map((d, i) => (i === day ? d.filter((_, j) => j !== idx) : d)));
  }
  function setWindow(day: number, idx: number, patch: Partial<Window>) {
    setSaved(false);
    setWeek((w) =>
      w.map((d, i) => (i === day ? d.map((win, j) => (j === idx ? { ...win, ...patch } : win)) : d)),
    );
  }

  function addException() {
    setSaved(false);
    const today = new Date().toISOString().slice(0, 10);
    setExceptions((xs) => [...xs, { date: today, mode: "blocked", start: "09:00", end: "17:00" }]);
  }
  function removeException(idx: number) {
    setSaved(false);
    setExceptions((xs) => xs.filter((_, j) => j !== idx));
  }
  function setException(idx: number, patch: Partial<ExceptionState>) {
    setSaved(false);
    setExceptions((xs) => xs.map((x, j) => (j === idx ? { ...x, ...patch } : x)));
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    // Client-side sanity — the server re-validates authoritatively.
    for (let day = 0; day < 7; day++) {
      for (const win of week[day]) {
        if (win.start >= win.end) {
          setError(`${WEEKDAYS[day]}: end time must be after start time.`);
          setSaving(false);
          return;
        }
      }
    }

    const rules = week.flatMap((windows, weekday) =>
      windows.map((win) => ({ weekday, startTime: win.start, endTime: win.end, isActive: true })),
    );
    const exceptionPayload = exceptions.map((x) =>
      x.mode === "custom"
        ? { date: x.date, isAvailable: true, startTime: x.start, endTime: x.end }
        : { date: x.date, isAvailable: false, startTime: null, endTime: null },
    );

    const result = await saveAvailability({ rules, exceptions: exceptionPayload });
    setSaving(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSaved(true);
  }

  return (
    <div className="space-y-8">
      <Alert variant="info">
        Times are in your timezone ({timezone}). Students see slots converted to
        their own timezone. These are recurring weekly hours — use exceptions
        below for one-off changes.
      </Alert>

      <section className="space-y-3">
        <h2 className="text-h3 font-bold text-gray-700">Weekly hours</h2>
        <div className="space-y-3">
          {WEEKDAYS.map((name, day) => (
            <div key={name} className="rounded-lg border border-gray-200 p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-body font-medium text-gray-700">{name}</p>
                <Button variant="ghost" size="sm" onClick={() => addWindow(day)}>
                  <Plus className="size-4" aria-hidden />
                  Add hours
                </Button>
              </div>
              {week[day].length === 0 ? (
                <p className="text-small text-gray-500">Unavailable</p>
              ) : (
                <div className="space-y-2">
                  {week[day].map((win, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <TimePicker
                        value={win.start}
                        onChange={(v) => setWindow(day, idx, { start: v })}
                        className="w-32"
                      />
                      <span className="text-small text-gray-500">to</span>
                      <TimePicker
                        value={win.end}
                        onChange={(v) => setWindow(day, idx, { end: v })}
                        className="w-32"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeWindow(day, idx)}
                        aria-label={`Remove ${name} window`}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-h3 font-bold text-gray-700">Date exceptions</h2>
          <Button variant="secondary" size="sm" onClick={addException}>
            <Plus className="size-4" aria-hidden />
            Add exception
          </Button>
        </div>
        {exceptions.length === 0 ? (
          <p className="text-small text-gray-500">
            No exceptions. Add one to block a day off or set custom hours.
          </p>
        ) : (
          <div className="space-y-2">
            {exceptions.map((x, idx) => (
              <div
                key={idx}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-3"
              >
                <CalendarX2 className="size-4 text-gray-400" aria-hidden />
                <Input
                  type="date"
                  value={x.date}
                  onChange={(e) => setException(idx, { date: e.target.value })}
                  className="w-40"
                  aria-label="Exception date"
                />
                <Select
                  value={x.mode}
                  onValueChange={(v) => setException(idx, { mode: v as "blocked" | "custom" })}
                >
                  <SelectTrigger className="w-36" aria-label="Exception type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blocked">Day off</SelectItem>
                    <SelectItem value="custom">Custom hours</SelectItem>
                  </SelectContent>
                </Select>
                {x.mode === "custom" && (
                  <>
                    <TimePicker
                      value={x.start}
                      onChange={(v) => setException(idx, { start: v })}
                      className="w-32"
                    />
                    <span className="text-small text-gray-500">to</span>
                    <TimePicker
                      value={x.end}
                      onChange={(v) => setException(idx, { end: v })}
                      className="w-32"
                    />
                  </>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeException(idx)}
                  aria-label="Remove exception"
                  className="ml-auto"
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {error && <Alert variant="danger">{error}</Alert>}
      {saved && <Alert variant="success">Availability saved.</Alert>}

      <div className="flex justify-end">
        <Label className="sr-only">Save availability</Label>
        <Button onClick={onSave} loading={saving} disabled={saving}>
          Save availability
        </Button>
      </div>
    </div>
  );
}
