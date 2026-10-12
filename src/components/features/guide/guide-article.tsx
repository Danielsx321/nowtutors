import * as React from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { TUTOR_GUIDE, type Guide, type GuideBlock } from "@/content/tutor-guide";
import { parseInline } from "@/content/inline";

/**
 * `/tutor/guide`: the tutor guide (`content/tutor-guide.ts`) as a long-form
 * page. Same reading frame as `/legal/*` (one h1, a 72ch measure, h2 sections)
 * without `LegalPage` itself, whose footer nav is the three legal pages.
 *
 * A contents list at the top jumps to each section; the PDF link at the top is
 * the same file the approval email attaches, so a tutor who lost the email
 * gets it here.
 */
export function GuideArticle({ guide = TUTOR_GUIDE }: { guide?: Guide }) {
  return (
    <article className="mx-auto w-full max-w-[72ch] px-4 py-8 md:px-6 md:py-12">
      <h1 className="font-display text-[clamp(30px,3.6vw,44px)] font-semibold leading-tight tracking-[-0.02em] text-text">
        {guide.title}
      </h1>
      <p className="mt-2 text-small text-text-muted">Last updated {guide.updated}</p>
      <a
        href="/tutor-guide.pdf"
        download="NowTutors tutor guide.pdf"
        className="focus-ring mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-small font-medium text-text hover:border-border-strong"
      >
        <Download className="size-4" aria-hidden />
        Download as PDF
      </a>

      <div className="mt-8 space-y-4 text-body leading-relaxed text-text">
        {guide.intro.map((text, i) => (
          <p key={i}>
            <Inline text={text} />
          </p>
        ))}
      </div>

      <nav aria-label="On this page" className="mt-8 rounded-lg border border-border bg-surface-raised px-5 py-4">
        <p className="text-small font-semibold text-text">On this page</p>
        <ol className="mt-2 grid gap-1 text-small sm:grid-cols-2">
          {guide.sections.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="focus-ring rounded-sm text-accent hover:underline">
                {i + 1}. {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 space-y-10 text-body leading-relaxed text-text [&_a]:text-accent [&_a]:underline">
        {guide.sections.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-24 space-y-3">
            <h2 className="font-display text-h3 font-semibold text-text">{s.title}</h2>
            {s.blocks.map((b, i) => (
              <Block key={i} block={b} />
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.kind) {
    case "p":
      return (
        <p>
          <Inline text={block.text} />
        </p>
      );
    case "list":
      return (
        <ul className="ml-5 list-disc space-y-1.5">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline text={item} />
            </li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol className="ml-5 list-decimal space-y-1.5">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline text={item} />
            </li>
          ))}
        </ol>
      );
    case "note":
      return (
        <aside className="rounded-lg border-l-4 border-highlight bg-surface-raised px-4 py-3 text-small text-text">
          <Inline text={block.text} />
        </aside>
      );
  }
}

/** Guide text with its `[label](/path)` links as real links. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((seg, i) =>
        seg.kind === "text" ? (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        ) : seg.href.startsWith("/") ? (
          <Link key={i} href={seg.href} className="focus-ring rounded-sm">
            {seg.label}
          </Link>
        ) : (
          <a key={i} href={seg.href} className="focus-ring rounded-sm" rel="noopener">
            {seg.label}
          </a>
        ),
      )}
    </>
  );
}
