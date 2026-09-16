# NowTutors — Design

_The design contract. SPEC §10 says what the system is; this file says how to use it. Read it before styling anything. Values live in `src/app/globals.css` (for the browser) and `src/lib/design/tokens.ts` (for the test); the two must agree, and `tests/unit/design-tokens.test.ts` fails if they don't._

Direction: **"On Air"** (design overhaul, 2026-09-15; research in the workspace under `outputs/deep-research/2026-09-15-nowtutors-design-overhaul/`). A white canvas with ink text and ink buttons, the brand teal used lightly for links and focus, one loud colour (live green) rationed to one job, real faces, and proof on the person. Brand settled with Noora on 2026-09-16: her logo, teal not plum, no yellow. The thing the product does that nobody else does, "a tutor is live right now, start in 60 seconds", is the visible signature.

## Tokens

Components reference roles, never colours. `bg-surface-raised`, `text-text-muted`, `border-border`, `bg-live`. There is no `bg-purple-500` any more, and Tailwind's own palette is switched off (`--color-*: initial`), so `bg-red-500` doesn't exist either.

Two themes, same roles. Light on `:root`; dark under `.theme-dark`. The dark scope exists for the live rooms (session, classroom, broadcast viewer: Part 4 of the overhaul puts `.theme-dark` on the `(session)` layout and `/live/[id]`) and for dark islands like the footer. A component never knows which theme it is in.

| Token | Light | Dark (rooms) | Role, one sentence |
|---|---|---|---|
| `surface` | `#FFFFFF` | `#111216` | The page canvas. |
| `surface-raised` | `#FFFFFF` | `#1B1D23` | Cards, panels, popovers. In light they separate from the canvas by a border, not a shadow. |
| `surface-muted` | `#F4F5F7` | `#1B1D23` | Grouped areas, table headers, skeletons, the quiet avatar fallback. |
| `surface-inverse` | `#15171C` | `#15171C` | Non-interactive dark fills: the tooltip. Interactive dark areas use a dark island instead (below). |
| `text` | `#15171C` | `#F2F3F5` | Body and headings. |
| `text-muted` | `#5A6070` | `#A4A9B4` | Secondary text. 6.28:1 light, 7.15:1 dark on raised. |
| `text-on-inverse` | `#FFFFFF` | `#FFFFFF` | Text on `surface-inverse`. |
| `primary` | `#15171C` | `#F2F3F5` | The primary button fill. Ink pill in light; in a room, a light pill with dark text. |
| `on-primary` | `#FFFFFF` | `#15171C` | Text on `primary`. |
| `accent` | `#0B3A47` | `#7FC4D1` | The brand teal, used lightly: links, selected states, the focus ring, small accents. Never a button fill or a large surface. 12.28:1 light, 8.60:1 dark. |
| `live` | `#1E7A46` | `#5FD68A` | The live signal: "Live now" and "LIVE" as text, the dot, the on-air ring, the "Request now" fill. Never on the teal accent (2.3:1). |
| `on-live` | `#FFFFFF` | `#111216` | Text on `live`. 5.35:1 light, 10.23:1 dark. |
| `live-surface` | `#E6F7EC` | `#1B1D23` | The live chip's background. `live` on it: 4.81:1 light. |
| `border` | `#E4E6EA` | `#2A2E37` | Hairlines and card borders. Decorative, no floor. |
| `border-strong` | `#8A909C` | `#6B7280` | Inputs, checkboxes, anything a person has to find. 3.21:1, clears the 3:1 control floor. |
| `focus` | = accent | = accent | The one focus ring. |
| `danger` | `#B3261E` | `#FF8A80` | Destructive text and buttons. `on-danger` (`#FFFFFF` / `#111216`) sits on it, 6.54:1. `danger-surface` (`#FBEAE9`) behind danger alerts. |
| `warning` | `#8A5A00` | `#FFC857` | Warning text, on `warning-surface` (`#FFF4D6`). 5.41:1. |
| `success` | = live | = live | One green. A success state and a live state never compete in the same view. |

Plus `scrim` (the inverse surface at 60%, 70% in rooms) behind modals and drawers.

**Compatibility aliases.** Until Part 6 of the overhaul, `globals.css` also carries the old colour-named utilities (`ink-900`, `gold-400`, `gray-500`...) mapped to the nearest role, under a heading that says REMOVE IN PART 6. They exist so the pages Parts 2 to 5 convert stay legible in between. Don't write new code against them.

### Dark islands

The one focus ring is the accent, and the deep teal on near-black measures 1.46:1. So: **interactive content on a dark background lives inside a `.theme-dark` scope**, never on a bare `bg-surface-inverse`. Inside the scope every role re-resolves (the ring becomes the light teal at 9.15:1, text becomes the dark `text`, buttons invert) and the component code stays identical. The footer is a dark island. A tooltip is not (nothing in it takes focus), so it can use `surface-inverse` directly.

## Type

Two faces, both bundled by `next/font` at build (no runtime request to Google). The wordmark is a vector, so no font carries it.

- **Funnel Display**, 600 to 800, via `font-display`: page titles, section titles, tutor names, the hero, the big number on a stat card. `h1`, `h2`, `h3` get it from the base stylesheet.
- **Funnel Sans**, 400 to 600, via `font-sans`: everything else. Body is 15px on 24px.

Scale (size/leading): display 40/44, h1 32/38, h2 24/30, h3 20/26, body-lg 17/26, body 15/24, small 13/20, caption 12/16. Numbers that sit in columns or represent money use tabular figures: put `data-numeric` on the element (tables get it automatically).

Check Funnel Sans at 13px on a 360px Android screen before signing off Part 1. If it doesn't read, the drop-in swap is Schibsted Grotesk for display and Figtree for text (both verified present in the installed `next/font` data); record the swap in DECISIONS.

## Shape and space

`--radius: 0.75rem`. Controls (inputs, selects, menus) `rounded-md` (10px). Cards `rounded-xl` (20px) with a `rounded-lg` (14px) photo inset. Chips, badges and every button `rounded-full`.

Spacing on the 4px grid. Comfortable density on marketplace pages (browse, profile, dashboard: card padding 20px). Compact on admin tables (rows 40px). Pages are full-bleed with a `px-4 md:px-6` gutter; `container-page` (1200px) is for the rare boxed reading page.

## Cards

The tutor card is the product (research report 05). Its anatomy, in order: photo inset with the on-air ring when the tutor takes instant requests; live chip top-left only when live or broadcasting (an offline tutor shows **no** status text: absence is the signal); favourite top-right; name in the display face; country; headline; the proof row (`StatRow`: Experience, Sessions, Rate with the "≈ $" anchor); one call to action. `live` "Request now" for instant-available, a "Watch live" link for broadcasting, `primary` "Book a session" otherwise.

Two variants: `grid` (photo on top, `md` and up) and `row` (88px photo beside the text, phones and short lists such as Saved tutors). The whole card links to the profile through a stretched link on the name; the chip, heart and action sit above it. "Request now" goes to `/tutors/[slug]#start-now`. A tutor who is online but doesn't take instant requests reads as bookable, not live. In a grid the ring is static (`OnAirRing still`): many pulsing rings at once is noise.

Rating is not in the row until reviews exist, which comes after launch (SPEC §18, Noora 2026-09-16). The slot is documented; it goes first in the row when it lands.

Cards separate from the canvas by their border and hover to `border-strong`. No shadow at rest. Shadows are for things that float (popovers, drawers, modals).

## Photos

Students book people they can see. From Part 6 of the overhaul, `approveTutor` refuses a tutor without an `avatar_url`, and tutor onboarding requires a photo. Until then, and for tutors approved earlier, the fallback is quiet: initials in the display face on `surface-muted` in `text-muted`. A missing photo reads as missing, not as a lilac design choice.

## The live signal

Two states, one colour family, mutually exclusive (SPEC §7.8, Q5: a broadcasting tutor can't take instant requests).

- **Instant-available** ("Live now"): the green `OnAirRing` around the photo, plus a `LiveChip` reading "Live now", plus the `live` "Request now" button.
- **Broadcasting** ("LIVE"): a `LiveChip` reading "LIVE" with the viewer count. No ring; the ring means "start in 60 seconds", not "watch".

The chip is always text. A dot on its own is decoration, never the indicator. No red for live, anywhere.

## Money

`<Money credits={45} usdPerCredit={rate} showUsd per="hr" />` renders "45 cr / hr ≈ $45". `usdPerCredit` comes from the direct-pay basis package (`lib/credits/packages.ts`); it is never hard-coded. The payout rate to tutors ($1 per credit) is a tutor-side number and never appears on a student surface.

Money confirms (withdraw, refund, reversal) use `AlertDialog` and restate the exact amount and destination with outcome-labelled buttons: "Withdraw $45 to PayPal" and "Keep credits", not "OK" and "Cancel". Nothing preselected. `AlertDialog` renders `role="alertdialog"`; Playwright's `getByRole("dialog")` does not match it.

## Buttons

`primary` (ink pill, the default), `secondary` (bordered), `ghost`, `live` (green fill: live actions only, and rare), `danger`. Buttons are never teal. All pills. 44px minimum on touch (`md` is 44px tall).

## Motion

150 to 220ms, ease-out, nothing longer than 2s. Keyframes live in `globals.css` under the existing reduced-motion block. Everything animated has a static alternative: the live dot becomes a solid dot, the on-air ring a solid ring (`OnAirRing still`).

## Wordmark

`<Wordmark />`: Noora's lowercase "nowtutors" logo, one SVG path in `currentColor` (`components/layout/wordmark-paths.ts`). Ink on light; `tone="onDark"` gives white for footers and rooms. Sizes set the height (`sm` 20px, `md` 28px, `lg` 36px); the width follows. Her original artwork read "tutornow" and existed only in white; it was traced and re-set as "nowtutors" with a matching "s", and she approved it on 2026-09-16. The logo is single-colour: never put it on a teal or green block to "brand" it. `<Monogram />` (the logo's "n") is for the collapsed sidebar rail only. One component, used by the header, footer, app shell and auth pages.

## Tables

Text left, numbers right (`numeric` on `TableHead` and `TableCell`), tabular figures, header row on `surface-muted` in sentence case, hairline row borders, no stripes, no centred columns. Admin tables are compact.

## Banned

Because each one is on the "generic AI product" list (research report 04) or fails the floor:

- Indigo or violet anywhere. The accent is the brand teal for links and focus, never a button fill or a large teal area.
- Identical rounded cards with one radius and a soft shadow.
- Tracked all-caps eyebrows and labels.
- One coloured word in a headline.
- Gradient washes and glassmorphism.
- Emoji as icons.
- Decorative left stripes on cards or alerts.
- Dark by default outside the rooms.
- Yellow anywhere (retired 2026-09-16), and live green on the teal accent.
- A bare colour dot as the only live indicator.
- `bg-[#hex]`, `text-[#hex]`, or any raw hex outside `globals.css` and `tokens.ts` (the unit test greps for it; the Google sign-in logo is the one allowed exception).
- "OK" and "Cancel" on a confirm.
