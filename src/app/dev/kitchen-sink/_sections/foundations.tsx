import * as React from "react";
import { cn } from "@/lib/utils";
import { Section, Demo, type Surface } from "./kit";
import { contrastRatio, formatRatio } from "@/lib/design/contrast";
import { pairs, tokens, type TokenName } from "@/lib/design/tokens";

/** One token swatch, labelled by role. The colour comes from the utility, so
 *  this gallery holds no raw hex; the value printed under it is read from
 *  tokens.ts for the current theme. */
function Swatch({
  token,
  role,
  className,
  surface,
}: {
  token: TokenName;
  role: string;
  className: string;
  surface: Surface;
}) {
  return (
    <div className="w-28 space-y-1.5">
      <div className={cn("h-14 w-full rounded-md border border-border", className)} />
      <div>
        <p className="text-small font-medium text-text">{token}</p>
        <p className="text-caption text-text-muted">{role}</p>
        <p data-numeric className="text-caption text-text-muted">
          {tokens[token][surface]}
        </p>
      </div>
    </div>
  );
}

/**
 * Tokens (SPEC §10.1, docs/DESIGN.md): every role swatch, then every
 * sanctioned pair with its computed contrast for the theme on screen. The
 * unit test asserts the same numbers; this section is for eyes.
 */
export function FoundationsSection({ surface }: { surface: Surface }) {
  return (
    <Section id="foundations" title="Tokens" surface={surface}>
      <Demo label="Surfaces" surface={surface}>
        <Swatch token="surface" role="page canvas" className="bg-surface" surface={surface} />
        <Swatch token="surface-raised" role="cards, panels" className="bg-surface-raised" surface={surface} />
        <Swatch token="surface-muted" role="grouped areas" className="bg-surface-muted" surface={surface} />
        <Swatch token="surface-inverse" role="footer, tooltip" className="bg-surface-inverse" surface={surface} />
      </Demo>

      <Demo label="Text and actions" surface={surface}>
        <Swatch token="text" role="body, headings" className="bg-text" surface={surface} />
        <Swatch token="text-muted" role="secondary" className="bg-text-muted" surface={surface} />
        <Swatch token="primary" role="primary button" className="bg-primary" surface={surface} />
        <Swatch token="accent" role="links, focus, small accents (teal)" className="bg-accent" surface={surface} />
        <Swatch token="border" role="hairlines" className="bg-border" surface={surface} />
        <Swatch token="border-strong" role="inputs" className="bg-border-strong" surface={surface} />
      </Demo>

      <Demo label="Live and status. Green is live now; never green on the teal accent." surface={surface}>
        <Swatch token="live" role="Live now, LIVE, Request now" className="bg-live" surface={surface} />
        <Swatch token="live-surface" role="live chip fill" className="bg-live-surface" surface={surface} />
        <Swatch token="danger" role="destructive" className="bg-danger" surface={surface} />
        <Swatch token="warning" role="warning text" className="bg-warning" surface={surface} />
        <Swatch token="success" role="= live" className="bg-success" surface={surface} />
      </Demo>

      <Demo label="Type: Funnel Display for titles and names, Funnel Sans for everything else. The wordmark is a vector, not a font" surface={surface} className="flex-col items-start gap-2">
        <p className="font-display text-display font-bold text-text">Learn anything, live.</p>
        <p className="font-display text-h2 font-semibold text-text">Amara Okafor</p>
        <p className="text-body text-text">
          Body at 15px. Funnel Sans 400 to 600. Numbers line up in tables and money: <span data-numeric>1,240 cr ≈ $1,240</span>.
        </p>
        <p className="text-small text-text-muted">Small at 13px: the size to read on a 360px Android screen before signing off.</p>
      </Demo>

      <Demo label="Focus ring: one utility, re-resolves inside .theme-dark. Tab through." surface={surface}>
        <button className="focus-ring rounded-full bg-primary px-4 py-2 text-small font-medium text-on-primary">
          On the canvas
        </button>
        <div className="theme-dark rounded-lg bg-surface p-3">
          <button className="focus-ring rounded-full border border-border-strong px-4 py-2 text-small font-medium text-text">
            Inside a dark island
          </button>
        </div>
      </Demo>

      <Demo label={`Contrast, ${surface} theme: every sanctioned pair and its ratio (test floor 4.5:1 text, 3:1 controls)`} surface={surface} className="items-stretch">
        <div className="w-full overflow-x-auto rounded-md border border-border">
          <table className="w-full text-small">
            <thead className="bg-surface-muted text-left text-text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Pair</th>
                <th className="px-3 py-2 font-medium">Used for</th>
                <th className="px-3 py-2 text-right font-medium">Ratio</th>
                <th className="px-3 py-2 text-right font-medium">Floor</th>
                <th className="px-3 py-2 font-medium">Sample</th>
              </tr>
            </thead>
            <tbody>
              {pairs
                .filter((p) => !p.themes || p.themes.includes(surface))
                .map((p) => {
                  const ratio = contrastRatio(tokens[p.fg][surface], tokens[p.bg][surface]);
                  const ok = ratio >= p.floor;
                  return (
                    <tr key={`${p.fg}/${p.bg}`} className="border-t border-border">
                      <td className="px-3 py-1.5 text-text">
                        {p.fg} <span className="text-text-muted">on</span> {p.bg}
                      </td>
                      <td className="px-3 py-1.5 text-text-muted">{p.note}</td>
                      <td className={cn("px-3 py-1.5 text-right font-medium", ok ? "text-success" : "text-danger")}>
                        {formatRatio(ratio)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-text-muted">{p.floor}:1</td>
                      <td className="px-3 py-1.5">
                        <span
                          className="inline-block rounded-sm border border-border px-2 py-0.5 text-caption font-medium"
                          style={{ color: tokens[p.fg][surface], background: tokens[p.bg][surface] }}
                        >
                          Aa
                        </span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Demo>
    </Section>
  );
}
