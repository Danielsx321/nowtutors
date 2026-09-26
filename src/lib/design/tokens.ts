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
  ground: { light: "#EFEFEF", dark: "#1B2633" },
  surface: { light: "#EFEFEF", dark: "#1B2633" },
  "surface-raised": { light: "#FFFFFF", dark: "#243244" },
  "surface-muted": { light: "#E4E4E4", dark: "#243244" },
  "surface-inverse": { light: "#1F2B3A", dark: "#1F2B3A" },
  text: { light: "#1F2B3A", dark: "#F2F4F7" },
  "text-muted": { light: "#5A6472", dark: "#A9B3C0" },
  "text-on-inverse": { light: "#FFFFFF", dark: "#FFFFFF" },
  primary: { light: "#1C5E92", dark: "#F2F4F7" },
  "on-primary": { light: "#FFFFFF", dark: "#1B2633" },
  highlight: { light: "#BF4019", dark: "#BF4019" },
  "on-highlight": { light: "#FFFFFF", dark: "#FFFFFF" },
  ink: { light: "#1F2B3A", dark: "#F2F4F7" },
  "on-ink": { light: "#FFFFFF", dark: "#1B2633" },
  spark: { light: "#E8582D", dark: "#E8582D" },
  "spark-text": { light: "#B83C17", dark: "#F0A868" },
  accent: { light: "#1C5E92", dark: "#8FC6F2" },
  live: { light: "#1E7A46", dark: "#5FD68A" },
  "on-live": { light: "#FFFFFF", dark: "#1B2633" },
  "live-surface": { light: "#E6F7EC", dark: "#243244" },
  border: { light: "#DCDCDC", dark: "#33425A" },
  "border-strong": { light: "#6F7986", dark: "#7A8797" },
  focus: { light: "#1C5E92", dark: "#8FC6F2" },
  danger: { light: "#B3261E", dark: "#FF8A80" },
  "on-danger": { light: "#FFFFFF", dark: "#1B2633" },
  "danger-surface": { light: "#FBEAE9", dark: "#243244" },
  warning: { light: "#8A5A00", dark: "#FFC857" },
  "warning-surface": { light: "#FFF4D6", dark: "#243244" },
  success: { light: "#1E7A46", dark: "#5FD68A" },
  "success-surface": { light: "#E6F7EC", dark: "#243244" },
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
  { fg: "on-highlight", bg: "highlight", floor: TEXT_FLOOR, note: "orange button label (highlight)" },
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
