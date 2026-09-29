"use client";

import * as React from "react";

/**
 * Drag a floating panel and let it settle in the nearest corner (the session
 * mini-player, 2026-09-29).
 *
 * Pointer events with capture, so a drag that leaves the handle keeps going.
 * While dragging the panel follows the pointer with a transform; on release it
 * snaps to the corner nearest its centre and the corner is remembered for this
 * browser. Arrow keys on the handle move it to the neighbouring corner, which
 * is the keyboard way to do the same thing (and how the DOM test drives it).
 *
 * No dependency: SPEC §2 has no drag library, and four corners don't need one.
 */

export type Corner = "tl" | "tr" | "bl" | "br";

export const CORNER_KEY = "nt:mini-corner";

const CORNERS: Corner[] = ["tl", "tr", "bl", "br"];

function readCorner(fallback: Corner): Corner {
  try {
    const stored = window.localStorage.getItem(CORNER_KEY);
    return CORNERS.includes(stored as Corner) ? (stored as Corner) : fallback;
  } catch {
    return fallback;
  }
}

function writeCorner(corner: Corner): void {
  try {
    window.localStorage.setItem(CORNER_KEY, corner);
  } catch {
    // Private window or blocked storage: the corner just isn't remembered.
  }
}

/** The corner a point is nearest to, by which half of the viewport it is in. */
export function nearestCorner(x: number, y: number, width: number, height: number): Corner {
  const top = y < height / 2;
  const left = x < width / 2;
  return `${top ? "t" : "b"}${left ? "l" : "r"}` as Corner;
}

/** Where an arrow key sends the panel from a corner. Unchanged at an edge. */
export function moveCorner(corner: Corner, key: string): Corner {
  const vertical = corner[0] as "t" | "b";
  const horizontal = corner[1] as "l" | "r";
  switch (key) {
    case "ArrowLeft":
      return `${vertical}l` as Corner;
    case "ArrowRight":
      return `${vertical}r` as Corner;
    case "ArrowUp":
      return `t${horizontal}` as Corner;
    case "ArrowDown":
      return `b${horizontal}` as Corner;
    default:
      return corner;
  }
}

export interface SnapDrag {
  corner: Corner;
  /** True while the pointer is down on the handle. */
  dragging: boolean;
  /** Applied to the panel: the live offset while dragging, nothing otherwise. */
  style: React.CSSProperties;
  panelRef: React.RefObject<HTMLDivElement | null>;
  handleProps: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  };
}

export function useSnapDrag(fallback: Corner = "br"): SnapDrag {
  const [corner, setCornerState] = React.useState<Corner>(fallback);
  const [offset, setOffset] = React.useState<{ x: number; y: number } | null>(null);
  const origin = React.useRef<{ x: number; y: number } | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  // Read after mount: the server render has no storage, and reading it during
  // render would mismatch the hydrated markup.
  React.useEffect(() => {
    setCornerState(readCorner(fallback));
  }, [fallback]);

  const setCorner = React.useCallback((next: Corner) => {
    setCornerState(next);
    writeCorner(next);
  }, []);

  const onPointerDown = React.useCallback((e: React.PointerEvent<HTMLElement>) => {
    // Only the primary button, and not when the press is on a control inside the handle.
    if (e.button !== 0 || (e.target as HTMLElement).closest("a,button:not([data-drag-handle])")) return;
    origin.current = { x: e.clientX, y: e.clientY };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // jsdom and some older browsers: the drag still works inside the handle.
    }
    setOffset({ x: 0, y: 0 });
  }, []);

  const onPointerMove = React.useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!origin.current) return;
    setOffset({ x: e.clientX - origin.current.x, y: e.clientY - origin.current.y });
  }, []);

  const end = React.useCallback(
    (e: React.PointerEvent<HTMLElement>, snap: boolean) => {
      if (!origin.current) return;
      origin.current = null;
      setOffset(null);
      if (!snap) return;
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCorner(
        nearestCorner(rect.left + rect.width / 2, rect.top + rect.height / 2, window.innerWidth, window.innerHeight),
      );
    },
    [setCorner],
  );

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (!e.key.startsWith("Arrow")) return;
      e.preventDefault();
      setCorner(moveCorner(corner, e.key));
    },
    [corner, setCorner],
  );

  return {
    corner,
    dragging: offset !== null,
    style: offset ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : {},
    panelRef,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e) => end(e, true),
      onPointerCancel: (e) => end(e, false),
      onKeyDown,
    },
  };
}
