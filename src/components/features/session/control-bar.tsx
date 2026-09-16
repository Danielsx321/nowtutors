"use client";

import * as React from "react";
import { LayoutGrid, Maximize2, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The room's control bar (design overhaul Part 4, research report 02).
 *
 * Every control is a labelled 44px target: the word sits under the icon at
 * every width, because a tooltip doesn't exist on a phone. Toggles are real
 * toggle buttons (`aria-pressed` = on) with a fixed accessible name, so a
 * screen reader hears "Microphone, toggle button, not pressed" rather than a
 * name that flips with the state. An off device reads in the danger colour as
 * well as by its icon. The end action is passed in and set apart on the right,
 * so it can't be hit on the way to Mute.
 *
 * Screen share and in-session chat are not here: they are their own phase
 * (DECISIONS, design overhaul Part 4), and an inert control that looks live is
 * worse than one that isn't there.
 */
export interface ControlBarProps {
  micEnabled: boolean;
  /** Null when this participant publishes no camera (a student, SPEC §9): no button. */
  cameraEnabled: boolean | null;
  /** Controls are inert until the room is live. */
  disabled?: boolean;
  onToggleMic: () => void;
  onToggleCamera?: () => void;
  /** Current layout, when the room offers the switch. */
  layout?: "spotlight" | "side-by-side";
  onToggleLayout?: () => void;
  /** The end or leave control, rendered apart on the right. */
  endAction: React.ReactNode;
  className?: string;
}

export function ControlBar({
  micEnabled,
  cameraEnabled,
  disabled,
  onToggleMic,
  onToggleCamera,
  layout,
  onToggleLayout,
  endAction,
  className,
}: ControlBarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Session controls"
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-raised px-3 py-2",
        className,
      )}
    >
      <div className="flex items-center gap-1">
        <ControlButton
          label="Mic"
          name="Microphone"
          on={micEnabled}
          disabled={disabled}
          onClick={onToggleMic}
          icon={micEnabled ? <Mic aria-hidden /> : <MicOff aria-hidden />}
        />
        {cameraEnabled !== null && onToggleCamera && (
          <ControlButton
            label="Camera"
            name="Camera"
            on={cameraEnabled}
            disabled={disabled}
            onClick={onToggleCamera}
            icon={cameraEnabled ? <Video aria-hidden /> : <VideoOff aria-hidden />}
          />
        )}
        {layout && onToggleLayout && (
          <button
            type="button"
            onClick={onToggleLayout}
            className="focus-ring hidden min-h-11 min-w-16 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-text hover:bg-surface-muted md:flex [&_svg]:size-5"
          >
            {layout === "spotlight" ? <LayoutGrid aria-hidden /> : <Maximize2 aria-hidden />}
            <span className="text-caption">{layout === "spotlight" ? "Side by side" : "Spotlight"}</span>
          </button>
        )}
      </div>
      <div className="flex items-center border-l border-border pl-3">{endAction}</div>
    </div>
  );
}

function ControlButton({
  label,
  name,
  on,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  name: string;
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={name}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "focus-ring flex min-h-11 min-w-16 flex-col items-center justify-center gap-0.5 rounded-lg px-2 transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-5",
        on ? "text-text hover:bg-surface-muted" : "bg-danger-surface text-danger hover:brightness-110",
      )}
    >
      {icon}
      <span aria-hidden className="text-caption">
        {on ? label : `${label} off`}
      </span>
    </button>
  );
}
