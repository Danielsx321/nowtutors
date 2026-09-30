"use client";

import * as React from "react";
import { LayoutGrid, Maximize2, MessageSquare, Mic, MicOff, MonitorUp, MonitorX, Video, VideoOff } from "lucide-react";
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
 * v2 (live-globe Part H): one dark rounded bar, controls centred, End session a
 * coral pill with a gap before it, as in the session-room mockup. Hover uses
 * the border colour because in the room `surface-muted` equals the bar.
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
  /** Sharing this screen. Omit when the browser cannot capture one: no button. */
  sharing?: boolean;
  onToggleShare?: () => void;
  /** The chat panel is open. Omit when the room has no chat: no button. */
  chatOpen?: boolean;
  onToggleChat?: () => void;
  /** Messages received while the panel was closed. */
  chatUnread?: number;
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
  sharing,
  onToggleShare,
  chatOpen,
  onToggleChat,
  chatUnread = 0,
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
        "flex flex-wrap items-center justify-center gap-1.5 rounded-[22px] bg-surface-raised p-2.5 sm:gap-2.5",
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
        {sharing !== undefined && onToggleShare && (
          <button
            type="button"
            aria-label="Share screen"
            aria-pressed={sharing}
            disabled={disabled}
            onClick={onToggleShare}
            className={cn(
              "focus-ring flex min-h-11 min-w-16 flex-col items-center justify-center gap-0.5 rounded-[14px] px-2 py-2 transition-colors sm:min-w-[72px] sm:px-2.5 hover:bg-border disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-5",
              sharing ? "text-live" : "text-text",
            )}
          >
            {sharing ? <MonitorX aria-hidden /> : <MonitorUp aria-hidden />}
            <span aria-hidden className="text-caption">
              {sharing ? "Stop sharing" : "Share"}
            </span>
          </button>
        )}
        {chatOpen !== undefined && onToggleChat && (
          <button
            type="button"
            aria-label={chatUnread > 0 ? `Chat, ${chatUnread} unread` : "Chat"}
            aria-pressed={chatOpen}
            onClick={onToggleChat}
            className={cn(
              "focus-ring relative flex min-h-11 min-w-16 flex-col items-center justify-center gap-0.5 rounded-[14px] px-2 py-2 text-text transition-colors sm:min-w-[72px] sm:px-2.5 hover:bg-border [&_svg]:size-5",
              chatOpen && "bg-border",
            )}
          >
            <MessageSquare aria-hidden />
            <span aria-hidden className="text-caption">
              Chat
            </span>
            {chatUnread > 0 && !chatOpen && (
              <span
                aria-hidden
                className="absolute right-2 top-1.5 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground"
              >
                {chatUnread > 9 ? "9+" : chatUnread}
              </span>
            )}
          </button>
        )}
        {layout && onToggleLayout && (
          <button
            type="button"
            onClick={onToggleLayout}
            className="focus-ring hidden min-h-11 min-w-[72px] flex-col items-center justify-center gap-0.5 rounded-[14px] px-2.5 py-2 text-text hover:bg-border md:flex [&_svg]:size-5"
          >
            {layout === "spotlight" ? <LayoutGrid aria-hidden /> : <Maximize2 aria-hidden />}
            <span className="text-caption">{layout === "spotlight" ? "Side by side" : "Spotlight"}</span>
          </button>
        )}
      </div>
      <div className="ml-1 flex items-center sm:ml-[18px]">{endAction}</div>
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
        "focus-ring flex min-h-11 min-w-16 flex-col items-center justify-center gap-0.5 rounded-[14px] px-2 py-2 transition-colors sm:min-w-[72px] sm:px-2.5 hover:bg-border disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-5",
        on ? "text-text" : "text-danger",
      )}
    >
      {icon}
      <span aria-hidden className="text-caption">
        {on ? label : `${label} off`}
      </span>
    </button>
  );
}
