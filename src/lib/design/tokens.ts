/**
 * The design tokens as data (SPEC §10.1, docs/DESIGN.md).
 *
 * `src/app/globals.css` is where the browser reads them; this file is where
 * the test reads them. The two must agree, and `tests/unit/design-tokens.test.ts`
 * checks that by parsing the CSS. Nothing at runtime imports this except the
 * kitchen sink's Tokens section.
 */

export const themes = ["light", "dark"] as const;
export type Theme = (typeof themes)[number];

export const tokens = {
  ground: { light: "#F1F1EF", dark: "#0E0F12" },
  surface: { light: "#F1F1EF", dark: "#0E0F12" },
  "surface-raised": { light: "#FFFFFF", dark: "#16181D" },
  "surface-muted": { light: "#E9E9E5", dark: "#16181D" },
  "surface-inverse": { light: "#15171C", dark: "#15171C" },
  text: { light: "#111214", dark: "#F2F3F5" },
  "text-muted": { light: "#63676E", dark: "#A4A9B4" },
  "text-on-inverse": { light: "#FFFFFF", dark: "#FFFFFF" },
  primary: { light: "#0B3A47", dark: "#F2F3F5" },
  "on-primary": { light: "#FFFFFF", dark: "#0E0F12" },
  highlight: { light: "#F6C544", dark: "#F6C544" },
  "on-highlight": { light: "#111214", dark: "#111214" },
  ink: { light: "#111214", dark: "#F2F3F5" },
  "on-ink": { light: "#FFFFFF", dark: "#0E0F12" },
  spark: { light: "#E8843A", dark: "#E8843A" },
  "spark-text": { light: "#A85416", dark: "#F0A868" },
  accent: { light: "#0B3A47", dark: "#7FC4D1" },
  live: { light: "#1E7A46", dark: "#5FD68A" },
  "on-live": { light: "#FFFFFF", dark: "#0E0F12" },
  "live-surface": { light: "#E6F7EC", dark: "#16181D" },
  border: { light: "#E2E2DF", dark: "#2A2E37" },
  "border-strong": { light: "#767C88", dark: "#767C88" },
  focus: { light: "#0B3A47", dark: "#7FC4D1" },
  danger: { light: "#B3261E", dark: "#FF8A80" },
  "on-danger": { light: "#FFFFFF", dark: "#0E0F12" },
  "danger-surface": { light: "#FBEAE9", dark: "#16181D" },
  warning: { light: "#8A5A00", dark: "#FFC857" },
  "warning-surface": { light: "#FFF4D6", dark: "#16181D" },
  success: { light: "#1E7A46", dark: "#5FD68A" },
  "success-surface": { light: "#E6F7EC", dark: "#16181D" },
} as const;

export type TokenName = keyof typeof tokens;

export const TEXT_FLOOR = 4.5;
export const UI_FLOOR = 3;

/**
 * Every foreground/background pairing a component is allowed to draw, with
 * the WCAG floor it must clear. A pair missing from this list is not a
 * sanctioned combination (live green on the teal accent, for example, is
 * absent on purpose: it measures 2.3:1 and DESIGN.md bans it).
 */
export const pairs: ReadonlyArray<{
  fg: TokenName;
  bg: TokenName;
  floor: number;
  note: string;
  /** Themes the pair is drawn in. Default: both. */
  themes?: readonly Theme[];
}> = [
  { fg: "text", bg: "ground", floor: TEXT_FLOOR, note: "body on the page canvas" },
  { fg: "text-muted", bg: "ground", floor: TEXT_FLOOR, note: "secondary on the page canvas" },
  { fg: "accent", bg: "ground", floor: TEXT_FLOOR, note: "links on the page canvas" },
  { fg: "live", bg: "ground", floor: TEXT_FLOOR, note: "LIVE text on the page canvas" },
  { fg: "on-highlight", bg: "highlight", floor: TEXT_FLOOR, note: "yellow button label" },
  { fg: "on-ink", bg: "ink", floor: TEXT_FLOOR, note: "neutral solid button label" },
  { fg: "spark-text", bg: "ground", floor: TEXT_FLOOR, note: "orange text or icon on canvas" },
  { fg: "spark-text", bg: "surface-raised", floor: TEXT_FLOOR, note: "orange text or icon on cards" },
  { fg: "border-strong", bg: "ground", floor: UI_FLOOR, note: "input borders on canvas" },
  { fg: "focus", bg: "ground", floor: UI_FLOOR, note: "focus ring on the page canvas" },
  { fg: "text", bg: "surface", floor: TEXT_FLOOR, note: "body on canvas" },
  { fg: "text", bg: "surface-raised", floor: TEXT_FLOOR, note: "body on cards" },
  { fg: "text", bg: "surface-muted", floor: TEXT_FLOOR, note: "body on grouped areas" },
  { fg: "text-muted", bg: "surface", floor: TEXT_FLOOR, note: "secondary on canvas" },
  { fg: "text-muted", bg: "surface-raised", floor: TEXT_FLOOR, note: "secondary on cards" },
  { fg: "text-muted", bg: "surface-muted", floor: TEXT_FLOOR, note: "secondary on grouped areas" },
  { fg: "on-primary", bg: "primary", floor: TEXT_FLOOR, note: "primary button label" },
  { fg: "on-live", bg: "live", floor: TEXT_FLOOR, note: "live button label (Request now)" },
  { fg: "accent", bg: "surface", floor: TEXT_FLOOR, note: "links" },
  { fg: "accent", bg: "surface-raised", floor: TEXT_FLOOR, note: "links on cards" },
  { fg: "live", bg: "surface-raised", floor: UI_FLOOR, note: "on-air ring around a photo on a card" },
  { fg: "live", bg: "surface", floor: TEXT_FLOOR, note: "LIVE text on canvas" },
  { fg: "live", bg: "live-surface", floor: TEXT_FLOOR, note: "Live now chip" },
  { fg: "text-on-inverse", bg: "surface-inverse", floor: TEXT_FLOOR, note: "footer text" },
  { fg: "border-strong", bg: "surface", floor: UI_FLOOR, note: "input borders" },
  { fg: "focus", bg: "surface", floor: UI_FLOOR, note: "focus ring on canvas" },
  // Interactive content on a dark surface sits inside a `.theme-dark` scope
  // (DESIGN.md, "Dark islands"), so the ring that lands on surface-inverse is
  // always the dark theme's. The deep teal on near-black measures 1.46:1 and
  // is never drawn.
  { fg: "focus", bg: "surface-inverse", floor: UI_FLOOR, note: "focus ring inside a dark island", themes: ["dark"] },
  { fg: "on-danger", bg: "danger", floor: TEXT_FLOOR, note: "danger button label" },
  { fg: "danger", bg: "surface", floor: TEXT_FLOOR, note: "danger text, field errors" },
  { fg: "danger", bg: "danger-surface", floor: TEXT_FLOOR, note: "danger alert" },
  { fg: "warning", bg: "warning-surface", floor: TEXT_FLOOR, note: "warning alert" },
  { fg: "warning", bg: "surface", floor: TEXT_FLOOR, note: "warning text" },
  { fg: "success", bg: "success-surface", floor: TEXT_FLOOR, note: "success alert" },
  { fg: "accent", bg: "surface-muted", floor: TEXT_FLOOR, note: "selected item text" },
];

export function tokenValue(name: TokenName, theme: Theme): string {
  return tokens[name][theme];
}
