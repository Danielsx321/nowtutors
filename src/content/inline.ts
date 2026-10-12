/**
 * The one piece of markup guide text may carry: `[label](/path)` for a link.
 * Everything else is plain text. Both renderers of `TUTOR_GUIDE` (the
 * `/tutor/guide` page and the PDF builder) walk these segments, so a link
 * written once reads the same on screen and on paper.
 */
export type InlineSegment = { kind: "text"; text: string } | { kind: "link"; label: string; href: string };

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): InlineSegment[] {
  const out: InlineSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    out.push({ kind: "link", label: m[1], href: m[2] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** Every href in a piece of guide text, for the link test. */
export function linksIn(text: string): string[] {
  return parseInline(text)
    .filter((s): s is Extract<InlineSegment, { kind: "link" }> => s.kind === "link")
    .map((s) => s.href);
}
