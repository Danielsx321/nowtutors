import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The teal banner card at the top of a dashboard (pages.html `.banner`): a
 * small caps kicker, a large title, then whatever row the page passes (an
 * action, a face stack). The decoration is thin rings and three orange pins,
 * drawn with borders and flat fills; there is no gradient (DESIGN.md v2).
 * The decoration is `aria-hidden`.
 */
export function Banner({
  kicker,
  title,
  children,
  className,
}: {
  kicker: string;
  title: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      // Read by tests/e2e/design-smoke.spec.ts (Part I): every dashboard leads with this.
      data-dashboard-banner=""
      className={cn(
        "relative grid min-h-[220px] gap-[22px] overflow-hidden rounded-panel bg-primary p-[clamp(24px,3.4vw,40px)] text-on-primary",
        className,
      )}
    >
      <span aria-hidden className="absolute -right-[90px] -top-[70px] size-[360px] rounded-full border border-on-primary/15" />
      <span aria-hidden className="absolute -right-5 -top-2.5 size-[230px] rounded-full border border-on-primary/15" />
      <span aria-hidden className="absolute right-10 top-[50px] size-[110px] rounded-full border border-on-primary/15" />
      <span aria-hidden className="absolute right-[210px] top-10 hidden size-2.5 rounded-full bg-spark sm:block" />
      <span aria-hidden className="absolute right-[70px] top-[150px] size-2.5 rounded-full bg-spark" />
      <span aria-hidden className="absolute right-[150px] top-[112px] hidden size-[7px] rounded-full bg-spark sm:block" />

      <div className="relative z-[1]">
        <p className="text-caption font-semibold uppercase tracking-[0.14em] text-on-primary/70">{kicker}</p>
        <h2 className="mt-2 max-w-[18ch] font-display text-[clamp(28px,3.4vw,44px)] font-medium leading-[1.05] tracking-[-0.03em]">
          {title}
        </h2>
      </div>
      {children && <div className="relative z-[1] flex flex-wrap items-center gap-4">{children}</div>}
    </section>
  );
}
