import { SectionHeading } from "@/components/features/home/section-heading";
import { TRUST_GUARANTEE, TRUST_GUARANTEE_CONFIRMED } from "@/lib/copy/trust";
import type { HomeProof } from "@/db/queries/dashboard-stats";

/**
 * "Proof you can check" (pages.html, Home). Every number is read from the
 * database on the request (`getHomeProof`), and a tile whose number is zero is
 * left out rather than shown as zero or padded.
 *
 * The mockup's "100% photo-checked" tile is not here: it becomes true only
 * when Part G makes a photo a condition of tutor approval, and it's added then.
 */
export function ProofWall({ proof }: { proof: HomeProof }) {
  const tiles = [
    { value: proof.sessionsTaught, label: "sessions taught" },
    { value: proof.tutors, label: proof.tutors === 1 ? "tutor to choose from" : "tutors to choose from" },
    { value: proof.subjects, label: proof.subjects === 1 ? "subject taught" : "subjects taught" },
  ].filter((t) => t.value > 0);

  return (
    <section aria-labelledby="proof-title" className="px-4 pb-[clamp(64px,9vw,120px)] md:px-6">
      <div className="mx-auto max-w-[var(--container-page)]">
        <SectionHeading id="proof-title" kicker="Why NowTutors" title="Proof you can check" />
        <ul className="grid gap-[18px] md:grid-cols-[1.2fr_1fr_1fr]">
          {TRUST_GUARANTEE_CONFIRMED && (
            <li className="flex flex-col justify-between gap-2.5 rounded-card bg-primary p-[26px] text-on-primary md:row-span-2">
              <b className="font-display text-[clamp(30px,3.2vw,42px)] font-medium leading-[1.08] tracking-[-0.03em]">
                {TRUST_GUARANTEE}
              </b>
              <p className="text-on-primary/75">The no-show promise, on every session.</p>
            </li>
          )}
          {tiles.map((t) => (
            <li key={t.label} className="flex flex-col gap-2.5 rounded-card border border-border bg-surface-raised p-[26px]">
              <b data-numeric className="font-display text-[clamp(34px,4vw,52px)] font-medium leading-none tracking-[-0.03em] text-text">
                {t.value.toLocaleString()}
              </b>
              <p className="text-body text-text-muted">{t.label}</p>
            </li>
          ))}
          <li className="flex flex-col gap-2.5 rounded-card border border-border bg-surface-raised p-[26px]">
            <b className="font-display text-[clamp(34px,4vw,52px)] font-medium leading-none tracking-[-0.03em] text-text">
              PayPal
            </b>
            <p className="text-body text-text-muted">secure payment, credits or pay per session</p>
          </li>
        </ul>
      </div>
    </section>
  );
}
