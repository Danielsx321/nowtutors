import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * The v2 room pieces (live-globe Part H, session-room mockup).
 *
 * Asserted: the presence chip says "Connected" only once the other person is
 * in, and who the room is waiting for until then; the quality chip turns the
 * SDK's level into words; the video tile renders an overlay on the stage; the
 * control bar keeps its fixed accessible names, shows an off device in words,
 * and puts the end action last.
 */

import { PresenceChip, QualityChip } from "@/components/features/session/room-chips";
import { VideoTile } from "@/components/features/session/video-tile";
import { ControlBar } from "@/components/features/session/control-bar";

afterEach(cleanup);

describe("PresenceChip", () => {
  it("says Connected when the other person is in the room", () => {
    render(<PresenceChip present otherPartyName="Sofia" />);
    expect(screen.getByText("Connected")).toBeTruthy();
  });

  it("names who the room is waiting for until then", () => {
    render(<PresenceChip present={false} otherPartyName="Sofia" />);
    expect(screen.queryByText("Connected")).toBeNull();
    expect(screen.getByText("Waiting for Sofia…")).toBeTruthy();
  });
});

describe("QualityChip", () => {
  it.each([
    ["good", "Good connection"],
    ["fair", "Fair connection"],
    ["poor", "Weak connection"],
    ["bad", "Weak connection"],
  ] as const)("reads %s as %s", (level, text) => {
    render(<QualityChip level={level} />);
    expect(screen.getByText(text)).toBeTruthy();
  });
});

describe("VideoTile overlay", () => {
  it("renders the overlay on the stage", () => {
    render(
      <VideoTile
        primary
        name="Sofia"
        roleLabel="Tutor"
        track={null}
        emptyReason="waiting"
        overlay={<QualityChip level="good" />}
      />,
    );
    expect(screen.getByText("Good connection")).toBeTruthy();
    expect(screen.getByText("Waiting to join…")).toBeTruthy();
  });
});

describe("ControlBar", () => {
  it("keeps fixed names, shows an off device in words, and puts the end action last", () => {
    const onToggleMic = vi.fn();
    render(
      <ControlBar
        micEnabled={false}
        cameraEnabled
        onToggleMic={onToggleMic}
        onToggleCamera={() => {}}
        endAction={<button type="button">End session</button>}
      />,
    );
    const mic = screen.getByRole("button", { name: "Microphone" });
    expect(mic.getAttribute("aria-pressed")).toBe("false");
    expect(mic.textContent).toContain("Mic off");
    expect(screen.getByRole("button", { name: "Camera" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(mic);
    expect(onToggleMic).toHaveBeenCalledTimes(1);

    const buttons = screen.getByRole("toolbar", { name: "Session controls" }).querySelectorAll("button");
    expect(buttons[buttons.length - 1]!.textContent).toBe("End session");
  });
});
