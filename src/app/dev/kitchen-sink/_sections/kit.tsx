import * as React from "react";
import { cn } from "@/lib/utils";

export type Surface = "light" | "ink";

/** Surface-aware text classes so on-surface copy stays legible on both
 *  backgrounds — this is what makes the light/ink toggle catch the
 *  purple-on-ink contrast trap from SPEC §10.1 (amendment #1). */
export function heading(surface: Surface) {
  return surface === "ink" ? "text-white" : "text-gray-700";
}
export function muted(surface: Surface) {
  return surface === "ink" ? "text-ink-300" : "text-gray-500";
}
/** Surface-correct focus ring: gold on ink, purple on light (SPEC §10.3). */
export function ring(surface: Surface) {
  return surface === "ink" ? "focus-ring-on-ink" : "focus-ring";
}

export function Section({
  id,
  title,
  surface,
  children,
}: {
  id: string;
  title: string;
  surface: Surface;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 space-y-6">
      <h2 className={cn("text-h2 font-bold", heading(surface))}>{title}</h2>
      {children}
    </section>
  );
}

/** A labelled sub-block. Items wrap on a row by default. */
export function Demo({
  label,
  surface,
  children,
  className,
}: {
  label: string;
  surface: Surface;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="space-y-2">
      <p className={cn("text-caption font-medium uppercase tracking-wide", muted(surface))}>
        {label}
      </p>
      <div className={cn("flex flex-wrap items-center gap-3", className)}>
        {children}
      </div>
    </div>
  );
}
