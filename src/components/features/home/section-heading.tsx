import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The home page's section heading (pages.html, Home): a small teal kicker over
 * a large display title, with an optional action on the right.
 */
export function SectionHeading({
  id,
  kicker,
  title,
  action,
  center = false,
  className,
}: {
  id: string;
  kicker: string;
  title: string;
  action?: React.ReactNode;
  center?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-7 flex flex-wrap items-end justify-between gap-4",
        center && "flex-col items-center text-center",
        className,
      )}
    >
      <div>
        <span className="mb-3 block text-small font-semibold uppercase tracking-[0.12em] text-accent">
          {kicker}
        </span>
        <h2
          id={id}
          className={cn(
            "font-display text-[clamp(30px,3.6vw,46px)] font-medium leading-[1.05] tracking-[-0.03em] text-text text-balance",
            center && "mx-auto max-w-[20ch]",
          )}
        >
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}
