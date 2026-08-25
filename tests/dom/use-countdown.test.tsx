import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useCountdown } from "@/hooks/use-countdown";

/**
 * `useCountdown`, against the shape that broke the tutor's modal.
 *
 * The hook has three consumers besides that modal — the student's waiting ring,
 * `SessionTimer`'s one-shot `onExpired`, and the classroom's "opens in" — and
 * every one of them reads `elapsed` or the number on the render where the
 * deadline first arrives. So the property asserted here is the hook's, not any
 * one screen's: a deadline that becomes non-null on a LATER render must be
 * measured against that render's deadline, never against a value left over
 * from the previous one.
 */

interface Probe {
  secondsLeft: number;
  fraction: number;
  elapsed: boolean;
}

/** Records what the hook returned on every render, in order. */
function Harness({
  expiresAt,
  totalSeconds,
  log,
}: {
  expiresAt: string | null;
  totalSeconds: number;
  log: Probe[];
}) {
  const countdown = useCountdown(expiresAt, totalSeconds);
  log.push({ ...countdown });
  return <span data-testid="seconds">{countdown.secondsLeft}</span>;
}

const NOW = new Date("2026-08-25T12:00:00.000Z");
const in60s = new Date(NOW.getTime() + 60_000).toISOString();

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  // Unmount BEFORE restoring the real clock. Unmounting runs the countdown's
  // effect cleanup, which calls `clearInterval` on an id the FAKE timers
  // issued; doing that after `useRealTimers()` hands a fake id to the real
  // implementation. `cleanup()` is idempotent, so the setup file's own call is
  // then a no-op — which makes this correct whichever order Vitest runs the
  // two `afterEach` hooks in, rather than relying on knowing that order.
  cleanup();
  vi.useRealTimers();
});

describe("useCountdown", () => {
  it("is not elapsed on the render where the deadline first appears", () => {
    const log: Probe[] = [];
    const { rerender } = render(
      <Harness expiresAt={null} totalSeconds={60} log={log} />,
    );
    log.length = 0;

    // The deadline arrives on a re-render — the exact transition the tutor's
    // queue makes when a request lands. NOT ONE of the renders that follow may
    // report `elapsed`, including the first, before any effect has run.
    rerender(<Harness expiresAt={in60s} totalSeconds={60} log={log} />);

    expect(log.length).toBeGreaterThan(0);
    expect(log.map((r) => r.elapsed)).not.toContain(true);
    expect(log[0].secondsLeft).toBe(60);
    expect(log[0].fraction).toBe(1);
  });

  it("reports nothing running when there is no deadline", () => {
    const log: Probe[] = [];
    render(<Harness expiresAt={null} totalSeconds={60} log={log} />);
    expect(log[0]).toEqual({ secondsLeft: 0, fraction: 0, elapsed: false });
  });

  it("ticks down once a second and stops at zero", async () => {
    const log: Probe[] = [];
    const { getByTestId } = render(
      <Harness expiresAt={in60s} totalSeconds={60} log={log} />,
    );
    expect(getByTestId("seconds").textContent).toBe("60");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(getByTestId("seconds").textContent).toBe("59");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getByTestId("seconds").textContent).toBe("29");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getByTestId("seconds").textContent).toBe("0");
  });

  it("is elapsed straight away for a deadline already in the past", () => {
    const log: Probe[] = [];
    render(
      <Harness
        expiresAt={new Date(NOW.getTime() - 1_000).toISOString()}
        totalSeconds={60}
        log={log}
      />,
    );
    expect(log[0]).toEqual({ secondsLeft: 0, fraction: 0, elapsed: true });
  });

  it("re-arms on a new deadline instead of staying elapsed", async () => {
    const log: Probe[] = [];
    const { rerender } = render(
      <Harness expiresAt={in60s} totalSeconds={60} log={log} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(log[log.length - 1].elapsed).toBe(true);

    // A second request, arriving after the first expired — the queue's next
    // entry. The stale `0` used to survive this transition too.
    const next = new Date(Date.now() + 60_000).toISOString();
    log.length = 0;
    rerender(<Harness expiresAt={next} totalSeconds={60} log={log} />);
    expect(log.map((r) => r.elapsed)).not.toContain(true);
    expect(log[0].secondsLeft).toBe(60);
  });
});
