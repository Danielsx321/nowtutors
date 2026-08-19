"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function label12h(h: number, m: number) {
  const period = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${pad(m)} ${period}`;
}

export interface TimePickerProps {
  value?: string; // "HH:mm" (24h)
  onChange?: (value: string) => void;
  /** Interval between options, minutes. */
  stepMinutes?: number;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  placeholder?: string;
  className?: string;
}

/**
 * Time selector — a token-styled Select of times at a fixed interval (no extra
 * dependency). Values are 24h "HH:mm"; labels render 12h. Used by the
 * availability editor in Phase 4.
 */
export function TimePicker({
  value,
  onChange,
  stepMinutes = 30,
  disabled,
  invalid,
  id,
  placeholder = "Select time",
  className,
}: TimePickerProps) {
  const options = React.useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (let mins = 0; mins < 24 * 60; mins += stepMinutes) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      out.push({ value: `${pad(h)}:${pad(m)}`, label: label12h(h, m) });
    }
    return out;
  }, [stepMinutes]);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} invalid={invalid} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
