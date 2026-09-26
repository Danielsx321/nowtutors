import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { contrastRatio } from "@/lib/design/contrast";
import { pairs, themes, tokens, type TokenName } from "@/lib/design/tokens";

const ROOT = join(__dirname, "..", "..");
const GLOBALS = join(ROOT, "src", "app", "globals.css");
const css = readFileSync(GLOBALS, "utf8");

/** Files allowed to hold a raw hex value. Everything else styles through tokens. */
const HEX_ALLOWED = new Set([
  "src/app/globals.css",
  "src/lib/design/tokens.ts",
  // Google's sign-in button carries Google's own logo colours, which are not
  // ours to tokenise (brand guidelines require the exact values).
  "src/components/features/auth/google-button.tsx",
]);

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

/** Reads `--name: #hex` out of a `:root { ... }` or `.theme-dark { ... }` block. */
function cssBlock(selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block present in globals.css`).toBeGreaterThan(-1);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

describe("design tokens: contrast floors (SPEC §10.3)", () => {
  for (const theme of themes) {
    for (const pair of pairs) {
      if (pair.themes && !pair.themes.includes(theme)) continue;
      it(`${theme}: ${pair.fg} on ${pair.bg} ≥ ${pair.floor}:1 (${pair.note})`, () => {
        const ratio = contrastRatio(tokens[pair.fg][theme], tokens[pair.bg][theme]);
        expect(ratio).toBeGreaterThanOrEqual(pair.floor);
      });
    }
  }

  it("has no pair that draws live green on the teal accent", () => {
    const bad = pairs.filter(
      (p) => (p.fg === "live" && p.bg === "accent") || (p.fg === "accent" && p.bg === "live"),
    );
    expect(bad).toEqual([]);
  });

  // v3 (design round 3): yellow left the system. `highlight` is orange, the
  // act-now fill from the InstaEDU reference. Green alone still means live.
  it("has no yellow role: highlight is orange and no token sits in the yellow band", () => {
    expect(Object.keys(tokens)).not.toContain("signal");
    expect(css).not.toMatch(/--signal\b/);
    expect(tokens.highlight.light.toUpperCase()).not.toBe("#F6C544");
    const yellow: string[] = [];
    for (const [name, v] of Object.entries(tokens)) {
      for (const theme of themes) {
        const hex = v[theme].replace("#", "");
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        // Yellow: red and green both high and close, blue well under both.
        if (r > 180 && g > 150 && Math.abs(r - g) < 0.15 * r && b < 0.5 * r) yellow.push(`${name}.${theme}`);
      }
    }
    // The warning colours are amber on purpose (alerts), never a fill or a signal.
    expect(yellow.filter((n) => !n.startsWith("warning"))).toEqual([]);
  });
});

/**
 * v2 bans the tells that made the mockups look templated (DESIGN.md, "Banned
 * tells"). Two of them are cheap to catch mechanically.
 */
describe("design tokens: banned tells (DESIGN.md v2)", () => {
  /** Gradients allowed on purpose, with the reason. */
  const GRADIENT_ALLOWED = new Set([
    // The globe's fallback sphere, drawn before WebGL is ready or when it is
    // unavailable. A sphere without a gradient is a flat disc.
    "src/components/features/home/globe.tsx",
    // The skeleton shimmer sweep, which is motion, not decoration.
    "src/components/ui/skeleton.tsx",
  ]);

  it("uses no CSS gradient in src/ outside the allowlist", () => {
    const hits: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      const rel = relative(ROOT, file);
      if (GRADIENT_ALLOWED.has(rel)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/(linear|radial|conic)-gradient\(|\bbg-gradient-to-\b/.test(line)) {
            hits.push(`${rel}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(hits).toEqual([]);
  });

  it("never draws the orange spark as text (spark-text is the readable one)", () => {
    const hits: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      const rel = relative(ROOT, file);
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          // `text-spark-text` is fine; `text-spark` on its own is not.
          if (/\btext-spark(?!-text)\b/.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });
});

describe("design tokens: globals.css matches tokens.ts", () => {
  const light = cssBlock(":root");
  const dark = cssBlock(".theme-dark");

  for (const name of Object.keys(tokens) as TokenName[]) {
    it(`declares --${name} in both themes with the values from tokens.ts`, () => {
      const re = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`);
      const l = re.exec(light);
      const d = re.exec(dark);
      expect(l?.[1]?.toUpperCase(), `light --${name}`).toBe(tokens[name].light.toUpperCase());
      expect(d?.[1]?.toUpperCase(), `dark --${name}`).toBe(tokens[name].dark.toUpperCase());
    });
  }

  it("maps every token into the Tailwind theme as --color-<name>", () => {
    for (const name of Object.keys(tokens)) {
      expect(css, `--color-${name}`).toMatch(new RegExp(`--color-${name}:\\s*var\\(--${name}\\)`));
    }
  });

  it("drops Tailwind's default palette", () => {
    expect(css).toMatch(/--color-\*:\s*initial/);
  });

  it("has exactly one focus-ring utility", () => {
    expect(css.match(/@utility focus-ring\b/g)?.length).toBe(1);
    expect(css).not.toMatch(/@utility focus-ring-on-ink/);
  });
});

describe("design tokens: no raw hex outside the token files", () => {
  it("finds no #hex literal in src/ outside the allowed files", () => {
    const hits: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      const rel = relative(ROOT, file);
      if (HEX_ALLOWED.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        // A hex colour: # then 3, 4, 6 or 8 hex digits, not followed by more
        // word characters (so "#12ab" matches, "#123abc-anchor" style ids don't).
        if (/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/.test(line)) {
          hits.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });
});
