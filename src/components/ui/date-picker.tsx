"use client";

import * as React from "react";
import { DayPicker } from "react-day-picker";
import { format } from "date-fns";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Calendar built on react-day-picker. We deliberately do NOT import
 * react-day-picker's stylesheet — every colour comes from our token utilities
 * via `classNames` (Phase 2 amendment #2), so the picker is fully on-brand and
 * the brand grep stays clean.
 */
export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "relative",
        month: "space-y-3",
        month_caption: "flex h-9 items-center justify-center",
        caption_label: "text-body font-medium text-gray-700",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous:
          "focus-ring grid size-9 place-items-center rounded-md text-gray-500 hover:bg-gray-50",
        button_next:
          "focus-ring grid size-9 place-items-center rounded-md text-gray-500 hover:bg-gray-50",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-9 text-caption font-medium text-gray-500",
        week: "flex w-full",
        day: "size-9 p-0 text-center",
        day_button:
          "focus-ring size-9 rounded-md text-small text-gray-700 transition-colors hover:bg-purple-100 aria-selected:bg-purple-500 aria-selected:text-white",
        today: "font-bold text-purple-700",
        outside: "text-gray-200",
        disabled: "opacity-40 pointer-events-none",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          ),
      }}
      {...props}
    />
  );
}

export interface DatePickerProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
}

/**
 * Date field: a trigger button that reveals the calendar in a lightweight
 * popover. No Radix Popover dependency — open state is local, and the panel
 * closes on select, Escape, or outside pointer (SPEC §10.3 keyboard support).
 */
export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabled,
  invalid,
  id,
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "focus-ring flex h-11 w-full items-center gap-2 rounded-md border bg-white px-3 text-body transition-colors",
          "disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60",
          invalid ? "border-danger" : "border-gray-200 hover:border-gray-500",
          value ? "text-gray-700" : "text-gray-500",
        )}
      >
        <CalendarIcon className="size-4 text-gray-500" aria-hidden />
        {value ? format(value, "PPP") : placeholder}
      </button>
      {open && (
        <div
          data-slot="popover"
          data-state="open"
          role="dialog"
          aria-label="Choose date"
          className="absolute z-50 mt-2 rounded-md border border-gray-200 bg-white shadow-md"
        >
          <Calendar
            mode="single"
            selected={value}
            onSelect={(d) => {
              onChange?.(d);
              setOpen(false);
            }}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}
