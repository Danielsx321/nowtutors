import * as React from "react";
import { cn } from "@/lib/utils";
import { Section, Demo, muted, type Surface } from "./kit";

/** A single named token swatch — labelled by token, never by raw hex, so this
 *  gallery contains no hardcoded colour values (acceptance #1). */
function Swatch({
  token,
  role,
  className,
  surface,
}: {
  token: string;
  role: string;
  className: string;
  surface: Surface;
}) {
  return (
    <div className="space-y-1.5">
      <div className={cn("size-16 rounded-md border border-ink-700", className)} />
      <div>
        <p className={cn("text-small font-medium", surface === "ink" ? "text-white" : "text-gray-700")}>
          {token}
        </p>
        <p className={cn("text-caption", muted(surface))}>{role}</p>
      </div>
    </div>
  );
}

/**
 * Design foundations — the ink ramp, the two focus-ring treatments, and the
 * ink-800 interaction state. Added in the Phase 2 ink amendment so Daniels can
 * eyeball the palette and the accessibility split before merge.
 */
export function FoundationsSection({ surface }: { surface: Surface }) {
  return (
    <Section id="foundations" title="Foundations" surface={surface}>
      <Demo label="Ink ramp — one surface (ink-900); 800 is interaction, not a surface" surface={surface}>
        <Swatch token="ink-950" role="active nav / scrim" className="bg-ink-950" surface={surface} />
        <Swatch token="ink-900" role="THE surface" className="bg-ink-900" surface={surface} />
        <Swatch token="ink-800" role="hover / pressed" className="bg-ink-800" surface={surface} />
        <Swatch token="ink-700" role="border / divider" className="bg-ink-700" surface={surface} />
        <Swatch token="ink-300" role="muted text" className="bg-ink-300" surface={surface} />
      </Demo>

      <Demo label="Brand & live" surface={surface}>
        <Swatch token="purple-500" role="fill only on ink" className="bg-purple-500" surface={surface} />
        <Swatch token="gold-400" role="CTA / focus on ink" className="bg-gold-400" surface={surface} />
        <Swatch token="live-500" role="dots / pulses" className="bg-live-500" surface={surface} />
        <Swatch token="live-400" role="LIVE badge fill" className="bg-live-400" surface={surface} />
      </Demo>

      <Demo
        label="Focus rings — purple on light, gold on ink (§10.3). Tab to each."
        surface={surface}
      >
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <button className="focus-ring rounded-md bg-purple-500 px-4 py-2 text-small font-medium text-white">
            Light surface · purple ring
          </button>
        </div>
        <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
          <button className="focus-ring-on-ink rounded-md border border-ink-700 px-4 py-2 text-small font-medium text-white">
            Ink surface · gold ring
          </button>
        </div>
      </Demo>

      <Demo
        label="ink-800 is a hover/pressed state, never a surface — hover the rows"
        surface={surface}
      >
        <div className="w-64 space-y-1 rounded-lg border border-ink-700 bg-ink-900 p-2">
          {["Dashboard", "Bookings", "Messages"].map((item) => (
            <div
              key={item}
              tabIndex={0}
              className="focus-ring-on-ink cursor-default rounded-md px-3 py-2 text-body font-medium text-gray-200 transition-colors hover:bg-ink-800 hover:text-white"
            >
              {item}
            </div>
          ))}
        </div>
      </Demo>
    </Section>
  );
}
