import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * The home globe (live-globe rebuild Part C).
 *
 * Asserted: without WebGL the soft fallback sphere shows and cobe is never
 * loaded; with reduced motion the same, even when WebGL works; with WebGL the
 * globe is created with the live markers passed through as cobe locations,
 * the fallback goes away, and unmounting destroys it. The whole thing is
 * `aria-hidden`: the live count lives in the hero text.
 */

const createGlobe = vi.fn();
const destroy = vi.fn();
const update = vi.fn();

vi.mock("cobe", () => ({
  default: (...args: unknown[]) => {
    createGlobe(...args);
    return { update, destroy };
  },
}));

import { Globe } from "@/components/features/home/globe";

const MARKERS = [
  { lat: 5.6, lng: -0.2 },
  { lat: 41.9, lng: 12.5 },
];

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function setWebGL(available: boolean) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => (available ? ({} as RenderingContext) : null)) as never,
  );
}

beforeEach(() => {
  createGlobe.mockClear();
  destroy.mockClear();
  update.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Globe", () => {
  it("shows the fallback sphere and never loads cobe without WebGL", async () => {
    setReducedMotion(false);
    setWebGL(false);
    const { container } = render(<Globe markers={MARKERS} />);
    const root = container.firstElementChild!;
    await waitFor(() => expect(root.getAttribute("data-globe-state")).toBe("fallback"));
    expect(container.querySelector("[data-globe-fallback]")).toBeTruthy();
    expect(container.querySelector("canvas")).toBeNull();
    expect(createGlobe).not.toHaveBeenCalled();
  });

  it("stays a static sphere with reduced motion, even when WebGL works", async () => {
    setReducedMotion(true);
    setWebGL(true);
    const { container } = render(<Globe markers={MARKERS} />);
    const root = container.firstElementChild!;
    await waitFor(() => expect(root.getAttribute("data-globe-state")).toBe("fallback"));
    expect(container.querySelector("[data-globe-fallback]")).toBeTruthy();
    expect(createGlobe).not.toHaveBeenCalled();
  });

  it("creates the globe with the live markers and removes the fallback", async () => {
    setReducedMotion(false);
    setWebGL(true);
    const { container, unmount } = render(<Globe markers={MARKERS} />);
    const root = container.firstElementChild!;
    await waitFor(() => expect(root.getAttribute("data-globe-state")).toBe("ready"));

    expect(createGlobe).toHaveBeenCalledTimes(1);
    const [canvas, opts] = createGlobe.mock.calls[0] as [HTMLCanvasElement, { markers: unknown[] }];
    expect(canvas.tagName).toBe("CANVAS");
    expect(opts.markers).toEqual([
      { location: [5.6, -0.2], size: expect.any(Number) },
      { location: [41.9, 12.5], size: expect.any(Number) },
    ]);
    expect(container.querySelector("[data-globe-fallback]")).toBeNull();

    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("turns with no dots when nobody is live", async () => {
    setReducedMotion(false);
    setWebGL(true);
    const { container } = render(<Globe markers={[]} />);
    await waitFor(() =>
      expect(container.firstElementChild!.getAttribute("data-globe-state")).toBe("ready"),
    );
    const [, opts] = createGlobe.mock.calls[0] as [HTMLCanvasElement, { markers: unknown[] }];
    expect(opts.markers).toEqual([]);
  });

  it("draws one buffer pixel per screen pixel: the device ratio is applied once, by cobe", async () => {
    // cobe 2 sets canvas.width = width * devicePixelRatio itself. Passing a
    // width already multiplied by the ratio made the buffer 4x too large on a
    // retina screen (4400 x 4400 for an 1100 px globe; performance review P2).
    setReducedMotion(false);
    setWebGL(true);
    vi.stubGlobal("devicePixelRatio", 2);
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 500, height: 500, top: 0, left: 0, right: 500, bottom: 500, x: 0, y: 0, toJSON: () => ({}),
    });
    const { container } = render(<Globe markers={[]} />);
    await waitFor(() =>
      expect(container.firstElementChild!.getAttribute("data-globe-state")).toBe("ready"),
    );
    const [, opts] = createGlobe.mock.calls[0] as [
      HTMLCanvasElement,
      { width: number; height: number; devicePixelRatio: number },
    ];
    expect(opts.width * opts.devicePixelRatio).toBe(1000);
    expect(opts.height * opts.devicePixelRatio).toBe(1000);
    vi.unstubAllGlobals();
  });

  it("stops turning while it is scrolled out of view, and starts again when it comes back", async () => {
    setReducedMotion(false);
    setWebGL(true);

    // Frames by hand, so the test decides when one runs.
    let queued: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => queued.push(cb));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      queued[id - 1] = () => {};
    });
    const runFrame = () => {
      const due = queued;
      queued = [];
      due.forEach((cb) => cb(0));
    };

    let notify: (visible: boolean) => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
          notify = (visible) => cb([{ isIntersecting: visible }]);
        }
        observe() {}
        disconnect() {}
      },
    );

    const { container } = render(<Globe markers={[]} />);
    await waitFor(() =>
      expect(container.firstElementChild!.getAttribute("data-globe-state")).toBe("ready"),
    );
    const turns = () => update.mock.calls.filter(([s]) => "phi" in (s as object)).length;

    runFrame();
    runFrame();
    const whileVisible = turns();
    expect(whileVisible).toBeGreaterThan(0);

    notify(false);
    runFrame();
    runFrame();
    runFrame();
    expect(turns()).toBe(whileVisible);

    notify(true);
    runFrame();
    runFrame();
    expect(turns()).toBeGreaterThan(whileVisible);
    vi.unstubAllGlobals();
  });

  it("is hidden from assistive tech", () => {
    setReducedMotion(false);
    setWebGL(false);
    const { container } = render(<Globe markers={MARKERS} />);
    expect(container.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
  });
});
