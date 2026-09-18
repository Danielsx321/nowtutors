import { CreditCard, ShieldCheck, UserCheck, Video } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The glass strip across the bottom of the hero (pages.html, Home). Plain teal
 * line icons, no tinted tiles (DESIGN.md v2, "Banned tells").
 *
 * The fourth item says tutors are approved before they teach, which is true
 * today. The mockup's "photo-checked" wording waits for Part G, which makes a
 * photo a condition of approval.
 */
const ITEMS: { icon: LucideIcon; title: string; detail: string }[] = [
  { icon: ShieldCheck, title: "No-show promise", detail: "Credits come back" },
  { icon: CreditCard, title: "PayPal", detail: "Secure payment" },
  { icon: Video, title: "Live video", detail: "Right in the browser" },
  { icon: UserCheck, title: "Real tutors", detail: "Approved before they teach" },
];

export function ProofStrip() {
  return (
    <ul className="grid grid-cols-2 overflow-hidden rounded-card border border-surface-raised bg-surface-raised/85 shadow-lg backdrop-blur-lg md:grid-cols-4">
      {ITEMS.map(({ icon: Icon, title, detail }, i) => (
        <li
          key={title}
          className={
            "flex items-center gap-3 px-4 py-4 text-left text-small leading-snug text-text-muted md:px-5 " +
            [
              i % 2 === 1 ? "border-l border-border" : "",
              i >= 2 ? "border-t border-border md:border-t-0" : "",
              i === 2 ? "md:border-l" : "",
            ].join(" ")
          }
        >
          <Icon className="size-6 shrink-0 text-accent" aria-hidden strokeWidth={1.75} />
          <span>
            <b className="block font-display text-body font-semibold text-text">{title}</b>
            {detail}
          </span>
        </li>
      ))}
    </ul>
  );
}
