import * as React from "react";
import { cn } from "@/lib/utils";

/** The preview theme. `dark` wraps the page in `.theme-dark`, the scope the
 *  live rooms use, so every primitive is checked in both palettes. */
export type Surface = "light" | "dark";

/* Under semantic tokens the same classes are right on both themes; these
   helpers stay so the section files read the same as before. */
export function heading(_surface: Surface) {
  void _surface;
  return "text-text";
}
export function muted(_surface: Surface) {
  void _surface;
  return "text-text-muted";
}
export function ring(_surface: Surface) {
  void _surface;
  return "focus-ring";
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
      <h2 className={cn("font-display text-h2 font-semibold", heading(surface))}>{title}</h2>
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
      <p className={cn("text-small font-medium", muted(surface))}>{label}</p>
      <div className={cn("flex flex-wrap items-center gap-3", className)}>
        {children}
      </div>
    </div>
  );
}
