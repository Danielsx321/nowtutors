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
  surface: { light: "#FFFFFF", dark: "#111216" },
  "surface-raised": { light: "#FFFFFF", dark: "#1B1D23" },
  "surface-muted": { light: "#F4F5F7", dark: "#1B1D23" },
  "surface-inverse": { light: "#15171C", dark: "#15171C" },
  text: { light: "#15171C", dark: "#F2F3F5" },
  "text-muted": { light: "#5A6070", dark: "#A4A9B4" },
  "text-on-inverse": { light: "#FFFFFF", dark: "#FFFFFF" },
  primary: { light: "#15171C", dark: "#F2F3F5" },
  "on-primary": { light: "#FFFFFF", dark: "#15171C" },
  signal: { light: "#FEE401", dark: "#FEE401" },
  "on-signal": { light: "#15171C", dark: "#111216" },
  accent: { light: "#6B2A8A", dark: "#D2A8EA" },
  live: { light: "#1E7A46", dark: "#5FD68A" },
  "live-surface": { light: "#E6F7EC", dark: "#1B1D23" },
  border: { light: "#E4E6EA", dark: "#2A2E37" },
  "border-strong": { light: "#8A909C", dark: "#6B7280" },
  focus: { light: "#6B2A8A", dark: "#D2A8EA" },
  danger: { light: "#B3261E", dark: "#FF8A80" },
  "on-danger": { light: "#FFFFFF", dark: "#111216" },
  "danger-surface": { light: "#FBEAE9", dark: "#1B1D23" },
  warning: { light: "#8A5A00", dark: "#FFC857" },
  "warning-surface": { light: "#FFF4D6", dark: "#1B1D23" },
  success: { light: "#1E7A46", dark: "#5FD68A" },
  "success-surface": { light: "#E6F7EC", dark: "#1B1D23" },
} as const;

export type TokenName = keyof typeof tokens;

export const TEXT_FLOOR = 4.5;
export const UI_FLOOR = 3;

/**
 * Every foreground/background pairing a component is allowed to draw, with
 * the WCAG floor it must clear. A pair missing from this list is not a
 * sanctioned combination (yellow as text on white, for example, is absent on
 * purpose: it measures 1.29:1 and DESIGN.md bans it).
 */
export const pairs: ReadonlyArray<{
  fg: TokenName;
  bg: TokenName;
  floor: number;
  note: string;
  /** Themes the pair is drawn in. Default: both. */
  themes?: readonly Theme[];
}> = [
  { fg: "text", bg: "surface", floor: TEXT_FLOOR, note: "body on canvas" },
  { fg: "text", bg: "surface-raised", floor: TEXT_FLOOR, note: "body on cards" },
  { fg: "text", bg: "surface-muted", floor: TEXT_FLOOR, note: "body on grouped areas" },
  { fg: "text-muted", bg: "surface", floor: TEXT_FLOOR, note: "secondary on canvas" },
  { fg: "text-muted", bg: "surface-raised", floor: TEXT_FLOOR, note: "secondary on cards" },
  { fg: "text-muted", bg: "surface-muted", floor: TEXT_FLOOR, note: "secondary on grouped areas" },
  { fg: "on-primary", bg: "primary", floor: TEXT_FLOOR, note: "primary button label" },
  { fg: "on-signal", bg: "signal", floor: TEXT_FLOOR, note: "signal button label, wordmark block" },
  { fg: "accent", bg: "surface", floor: TEXT_FLOOR, note: "links" },
  { fg: "accent", bg: "surface-raised", floor: TEXT_FLOOR, note: "links on cards" },
  { fg: "live", bg: "surface", floor: TEXT_FLOOR, note: "LIVE text on canvas" },
  { fg: "live", bg: "live-surface", floor: TEXT_FLOOR, note: "Live now chip" },
  { fg: "text-on-inverse", bg: "surface-inverse", floor: TEXT_FLOOR, note: "footer text" },
  { fg: "border-strong", bg: "surface", floor: UI_FLOOR, note: "input borders" },
  { fg: "focus", bg: "surface", floor: UI_FLOOR, note: "focus ring on canvas" },
  // Interactive content on a dark surface sits inside a `.theme-dark` scope
  // (DESIGN.md, "Dark islands"), so the ring that lands on surface-inverse is
  // always the dark theme's. The light plum on near-black measures 1.98:1 and
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
