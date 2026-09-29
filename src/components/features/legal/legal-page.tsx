import * as React from "react";
import Link from "next/link";

/**
 * The frame for `/legal/*` (Phase 10 Part 4). Plain long-form reading: one h1,
 * a last-updated line, sections with h2s, a readable measure.
 *
 * `draft` shows a note that the text has not been approved yet. Every page
 * ships with it on until Noora signs the copy off (RUNBOOK, Phase 10 Part 6),
 * and `<ToConfirm>` marks each fact only she can supply, so nothing invented
 * can pass for settled.
 */
export function LegalPage({
  title,
  updated,
  draft,
  children,
}: {
  title: string;
  updated: string;
  draft: boolean;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto w-full max-w-[72ch] px-4 py-10 md:px-6 md:py-14">
      <h1 className="font-display text-[clamp(30px,3.6vw,44px)] font-semibold leading-tight tracking-[-0.02em] text-text">
        {title}
      </h1>
      <p className="mt-2 text-small text-text-muted">Last updated {updated}</p>
      {draft ? (
        <p
          role="note"
          className="mt-5 rounded-lg border border-dashed border-border-strong bg-surface-raised px-4 py-3 text-small text-text-muted"
        >
          Draft for review. This page has not been approved by NowTutors yet. Marked items are still to
          be confirmed.
        </p>
      ) : null}
      <div className="mt-8 space-y-8 text-body leading-relaxed text-text [&_a]:text-accent [&_a]:underline [&_li]:ml-5 [&_li]:list-disc [&_ul]:mt-2 [&_ul]:space-y-1.5">
        {children}
      </div>
      <nav aria-label="Legal" className="mt-12 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-6 text-small">
        <Link href="/legal/terms" className="focus-ring rounded-sm text-text-muted hover:text-text">
          Terms of service
        </Link>
        <Link href="/legal/privacy" className="focus-ring rounded-sm text-text-muted hover:text-text">
          Privacy policy
        </Link>
        <Link href="/legal/refunds" className="focus-ring rounded-sm text-text-muted hover:text-text">
          Refunds and no-shows
        </Link>
      </nav>
    </article>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-h3 font-semibold text-text">{title}</h2>
      {children}
    </section>
  );
}

/** A fact only the business can supply. Visible on purpose until it's filled in. */
export function ToConfirm({ children }: { children: React.ReactNode }) {
  return (
    <span
      data-to-confirm
      className="rounded border border-dashed border-border-strong px-1 text-text-muted"
    >
      [to confirm: {children}]
    </span>
  );
}
