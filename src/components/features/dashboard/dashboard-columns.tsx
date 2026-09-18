import * as React from "react";

/**
 * A dashboard's page layout inside the app shell (pages.html dashboards):
 * the main column and a 340px right column side by side from `xl`, stacked
 * below it, then an optional full-width row for tables underneath both
 * (Daniels' edit to the Part 0 mockup: tables span the full width).
 */
export function DashboardColumns({
  main,
  rail,
  full,
}: {
  main: React.ReactNode;
  rail?: React.ReactNode;
  full?: React.ReactNode;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-6">{main}</div>
      {rail && <aside className="flex min-w-0 flex-col gap-5">{rail}</aside>}
      {full && <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">{full}</div>}
    </div>
  );
}

/** A white right-column box (pages.html `.rbox`). */
export function RailBox({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-panel border border-border bg-surface-raised p-[22px]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-[19px] font-semibold tracking-[-0.02em] text-text">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
