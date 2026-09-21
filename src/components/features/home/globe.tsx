"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { GlobeMarker } from "@/lib/geo/country-centroids";

/**
 * The home hero's turning globe (live-globe rebuild Part C, DESIGN.md v2).
 * Drawn with `cobe` (SPEC §2), a ~5 KB WebGL globe, loaded with a dynamic
 * import so it never sits in the first-load bundle.
 *
 * Dots are real: the countries of tutors live right now, passed in by the page
 * (`getLiveTutorCountries` then `toGlobeMarkers`). With nobody live the globe
 * still turns, with no dots, and the hero's pill says so.
 *
 * Until the globe is ready, and for good when motion is reduced or WebGL is
 * missing, a soft sphere stands in. That sphere is the one gradient DESIGN.md
 * allows outside the skeleton shimmer: without it the fallback is a flat disc.
 * With reduced motion `cobe` is not even downloaded; the static sphere is the
 * whole experience.
 *
 * Purely decorative (`aria-hidden`): the live count is in the hero text.
 */

/** cobe takes colours as 0-1 RGB triples. These match the tokens: ground, spark, a white-teal mist. */
const BASE_COLOR: [number, number, number] = [0.97, 0.97, 0.96];
const MARKER_COLOR: [number, number, number] = [0.91, 0.52, 0.23];
const GLOW_COLOR: [number, number, number] = [0.8, 0.92, 0.93];
const MARKER_SIZE = 0.06;
const SPIN_PER_FRAME = 0.0022;

export type GlobeState = "fallback" | "loading" | "ready";

/** Can this browser draw WebGL at all? jsdom, old devices and some locked-down browsers can't. */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

function toCobeMarkers(markers: GlobeMarker[]) {
  return markers.map((m) => ({ location: [m.lat, m.lng] as [number, number], size: MARKER_SIZE }));
}

export function Globe({ markers, className }: { markers: GlobeMarker[]; className?: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const globeRef = React.useRef<{ update: (s: Record<string, unknown>) => void } | null>(null);
  const [state, setState] = React.useState<GlobeState>("loading");

  // Keep the latest markers for the first draw without re-creating the globe.
  const markersRef = React.useRef(markers);
  markersRef.current = markers;

  React.useEffect(() => {
    if (prefersReducedMotion() || !hasWebGL()) {
      setState("fallback");
      return;
    }

    let cancelled = false;
    let frame = 0;
    let destroy: (() => void) | undefined;
    let resize: ResizeObserver | undefined;
    let inView: IntersectionObserver | undefined;

    import("cobe")
      .then(({ default: createGlobe }) => {
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;

        // cobe 2 multiplies width and height by `devicePixelRatio` itself, so
        // it gets the CSS size. Passing pixels drew 4x the buffer on a retina
        // screen (DECISIONS, "Performance review: the globe").
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const sizeOf = () => Math.max(1, Math.round(canvas.getBoundingClientRect().width));
        let size = sizeOf();
        let phi = 0.2;

        const globe = createGlobe(canvas, {
          devicePixelRatio: dpr,
          width: size,
          height: size,
          phi,
          theta: 0.28,
          dark: 0,
          diffuse: 1.25,
          mapSamples: 22000,
          mapBrightness: 5.5,
          mapBaseBrightness: 0.02,
          baseColor: BASE_COLOR,
          markerColor: MARKER_COLOR,
          glowColor: GLOW_COLOR,
          markers: toCobeMarkers(markersRef.current),
          opacity: 0.96,
        });
        globeRef.current = globe as unknown as { update: (s: Record<string, unknown>) => void };
        destroy = () => globe.destroy();

        if (typeof ResizeObserver === "function") {
          resize = new ResizeObserver(() => {
            size = sizeOf();
            globe.update({ width: size, height: size });
          });
          resize.observe(canvas);
        }

        // cobe 2 has no loop of its own: turn it here, one step per frame,
        // and only while the globe is on screen. Scrolled away, it draws nothing.
        let visible = true;
        const tick = () => {
          if (!visible) return;
          phi += SPIN_PER_FRAME;
          globe.update({ phi });
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);

        if (typeof IntersectionObserver === "function") {
          inView = new IntersectionObserver(([entry]) => {
            const next = entry?.isIntersecting ?? true;
            if (next === visible) return;
            visible = next;
            cancelAnimationFrame(frame);
            if (visible) frame = requestAnimationFrame(tick);
          });
          inView.observe(canvas);
        }
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("fallback");
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      resize?.disconnect();
      inView?.disconnect();
      destroy?.();
      globeRef.current = null;
    };
  }, []);

  // New live data (a later render) updates the dots in place.
  React.useEffect(() => {
    globeRef.current?.update({ markers: toCobeMarkers(markers) });
  }, [markers]);

  return (
    <div
      aria-hidden
      data-globe-state={state}
      data-marker-count={markers.length}
      className={cn("relative aspect-square", className)}
    >
      {state !== "ready" && (
        <div
          data-globe-fallback
          className="absolute inset-[6%] rounded-full"
          style={{
            background:
              "radial-gradient(circle at 40% 30%, var(--surface-raised), var(--surface-muted) 70%)",
          }}
        />
      )}
      {state !== "fallback" && (
        <canvas
          ref={canvasRef}
          className={cn(
            "size-full transition-opacity duration-1000 ease-out",
            state === "ready" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  );
}
