import * as React from "react";
import Image from "next/image";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionHeading } from "@/components/features/home/section-heading";

/**
 * "Everything you need, from hello to homework" (pages.html, Home): five
 * phones fanned out, each a real screen of the app drawn in code rather than a
 * screenshot, so it can't go stale against the product: browse, waiting for a
 * tutor, the session room, the lobby, the wallet. The names inside are
 * illustrations, and the phones are hidden from assistive tech; the four notes
 * underneath carry the meaning.
 *
 * `id="how"` is the target of "How it works" in the header and footer.
 * Phones drop out from the edges as the screen narrows: five, then three,
 * then the room alone at 360px.
 */
const PHOTO = {
  sofia: "/images/home/tutor-sofia.jpg",
  kwame: "/images/home/tutor-kwame.jpg",
  marco: "/images/home/tutor-marco.jpg",
  tobi: "/images/home/student-tobi.jpg",
  student: "/images/home/hero.jpg",
};

const NOTES = [
  { title: "Find", text: "Live tutors first, with photos and prices." },
  { title: "Request", text: "A 60-second answer, never a dead end." },
  { title: "Learn", text: "Video, a lesson clock and clear controls." },
  { title: "Pay", text: "Credits and PayPal, nothing hidden." },
];

export function AppFan() {
  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-24 px-4 py-[clamp(64px,9vw,120px)] md:px-6">
      <div className="mx-auto max-w-[var(--container-page)]">
        <SectionHeading
          id="how-title"
          kicker="The whole lesson, in one app"
          title="Everything you need, from hello to homework"
          center
        />

        <div aria-hidden className="flex min-h-[430px] items-end justify-center overflow-hidden pt-5 md:min-h-[520px]">
          <Phone className="hidden -rotate-[10deg] translate-y-12 md:block">
            <BrowseScreen />
          </Phone>
          <Phone className="z-[1] hidden -rotate-[5deg] translate-y-3.5 min-[461px]:block">
            <WaitingScreen />
          </Phone>
          <Phone className="z-[3] w-[196px] md:w-[240px]">
            <RoomScreen />
          </Phone>
          <Phone className="z-[1] hidden rotate-[5deg] translate-y-3.5 min-[461px]:block">
            <LobbyScreen />
          </Phone>
          <Phone className="hidden rotate-[10deg] translate-y-12 md:block">
            <WalletScreen />
          </Phone>
        </div>

        <ul className="mt-12 grid gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))]">
          {NOTES.map((n) => (
            <li key={n.title} className="border-t border-ink pt-3.5">
              <b className="mb-1 block font-display text-[18px] font-semibold text-text">{n.title}</b>
              <span className="text-body text-text-muted">{n.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Phone({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "relative -mx-[26px] aspect-[9/19] w-[180px] flex-none rounded-[34px] bg-surface-inverse p-2 shadow-lg md:w-[220px]",
        className,
      )}
    >
      <div className="flex size-full flex-col overflow-hidden rounded-[27px] text-[11px]">{children}</div>
    </div>
  );
}

function Screen({ dark, className, children }: { dark?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-2.5 px-3.5 pb-3.5 pt-[30px]",
        dark ? "theme-dark bg-ground text-text" : "bg-ground text-text",
        className,
      )}
    >
      {children}
    </div>
  );
}

const screenTitle = "font-display text-[20px] font-semibold leading-[1.05] tracking-[-0.02em]";
const screenButton = "rounded-full py-[9px] text-center text-[11px] font-semibold";

function Row({ photo, name, detail }: { photo: string; name: string; detail: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-surface-raised p-2">
      <Image src={photo} alt="" width={30} height={30} className="size-[30px] rounded-[9px] object-cover" />
      <div className="leading-tight">
        <b>{name}</b>
        <br />
        <span className="text-text-muted">{detail}</span>
      </div>
    </div>
  );
}

function BrowseScreen() {
  return (
    <Screen>
      <span className="inline-flex items-center gap-1 self-start rounded-full bg-live-surface px-2 py-[3px] text-[10px] font-semibold text-live">
        <span className="size-1.5 rounded-full bg-live" /> Live now
      </span>
      <div className={screenTitle}>Find your tutor</div>
      <Row photo={PHOTO.sofia} name="Sofia" detail="Maths · 45 cr" />
      <Row photo={PHOTO.kwame} name="Kwame" detail="Coding · 60 cr" />
      <Row photo={PHOTO.marco} name="Marco" detail="Economics · 80 cr" />
    </Screen>
  );
}

/** A countdown ring drawn as two SVG circles (no conic gradient: DESIGN.md v2). */
function CountdownRing({ seconds, fraction }: { seconds: number; fraction: number }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto my-1.5 size-[84px]">
      <svg viewBox="0 0 84 84" className="size-full -rotate-90">
        <circle cx="42" cy="42" r={r} fill="none" strokeWidth="8" className="stroke-border" />
        <circle
          cx="42"
          cy="42"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeDasharray={`${c * fraction} ${c}`}
          className="stroke-live"
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-display text-[22px] font-bold">
        {seconds}
      </span>
    </div>
  );
}

function WaitingScreen() {
  return (
    <Screen dark className="text-center">
      <div className={screenTitle}>Waiting for Sofia</div>
      <CountdownRing seconds={42} fraction={0.72} />
      <div className="text-text-muted">Charged only if she accepts</div>
      <div className={cn(screenButton, "mt-auto bg-surface-raised")}>Cancel</div>
    </Screen>
  );
}

function RoomScreen() {
  return (
    <Screen dark className="pt-[26px]">
      <div className="flex justify-between">
        <b>Algebra</b>
        <span className="text-warning">24:10 left</span>
      </div>
      <div className="relative min-h-[120px] flex-1 overflow-hidden rounded-[14px]">
        <Image src={PHOTO.sofia} alt="" fill sizes="240px" className="object-cover" />
        <div className="absolute bottom-2 right-2 h-11 w-[58px] overflow-hidden rounded-lg border-2 border-ground">
          <Image src={PHOTO.student} alt="" fill sizes="60px" className="object-cover" />
        </div>
      </div>
      <div className="flex justify-around rounded-[14px] bg-surface-raised p-2">
        <i className="block size-[26px] rounded-full bg-border" />
        <i className="block size-[26px] rounded-full bg-border" />
        <i className="block h-[26px] w-10 rounded-full bg-danger" />
      </div>
    </Screen>
  );
}

function LobbyScreen() {
  return (
    <Screen>
      <div className={screenTitle}>Ready to join?</div>
      <div className="relative h-[110px] flex-none overflow-hidden rounded-[14px]">
        <Image src={PHOTO.tobi} alt="" fill sizes="220px" className="object-cover" />
      </div>
      <div className="flex items-center gap-1 font-semibold text-live">
        <Check className="size-3" /> Microphone ready
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        <i className="block h-full w-[64%] bg-live" />
      </div>
      <div className={cn(screenButton, "mt-auto bg-ink text-on-ink")}>Join session</div>
    </Screen>
  );
}

function WalletScreen() {
  return (
    <Screen>
      <div className="text-text-muted">Credit balance</div>
      <div className="font-display text-[40px] font-bold leading-none">240</div>
      <div className="text-text-muted">credits</div>
      <div className={cn(screenButton, "bg-highlight text-on-highlight")}>Buy credits</div>
      <div className="rounded-xl bg-surface-raised p-2">+ 200 · PayPal top-up</div>
      <div className="rounded-xl bg-surface-raised p-2">− 23 · Algebra with Sofia</div>
    </Screen>
  );
}
