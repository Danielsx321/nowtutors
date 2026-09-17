# NowTutors — Design

_The design contract. SPEC §10 says what the system is; this file says how to use it. Read it before styling anything. Values live in `src/app/globals.css` (for the browser) and `src/lib/design/tokens.ts` (for the test); the two must agree, and `tests/unit/design-tokens.test.ts` fails if they don't._

Direction: **"live globe"** (v2, approved 2026-09-17; mockups in the workspace at `outputs/premium-mockup/`, research at `outputs/premium-design-research/`). The first overhaul ("On Air", 2026-09-15) fixed a dated look and left a plain one. v2 keeps its bones (roles not colours, one live signal, real faces, proof on the person) and gives the product a face: a warm off-white canvas with white cards on it, teal on the main actions, yellow on the second action beside them, orange as a mark, and a turning globe on the home page showing where tutors are live this minute.

Colour has a job or it doesn't appear. Teal leads, yellow answers it, green means live and nothing else, orange marks a spot.

## Tokens

Components reference roles, never colours. `bg-surface-raised`, `text-text-muted`, `border-border`, `bg-live`. There is no `bg-purple-500` any more, and Tailwind's own palette is switched off (`--color-*: initial`), so `bg-red-500` doesn't exist either.

Two themes, same roles. Light on `:root`; dark under `.theme-dark`. The dark scope exists for the live rooms (session, classroom, broadcast viewer) and for dark islands like the footer. A component never knows which theme it is in.

| Token | Light | Dark (rooms) | Role, one sentence |
|---|---|---|---|
| `ground` | `#F1F1EF` | `#0E0F12` | The page canvas. Warm off-white, so a white card reads as a card without a shadow. |
| `surface` | = ground | = ground | The older name for the canvas, kept so existing `bg-surface` code stays correct. New code uses `bg-ground`. |
| `surface-raised` | `#FFFFFF` | `#16181D` | Cards, panels, popovers. |
| `surface-muted` | `#E9E9E5` | `#16181D` | Grouped areas, table headers, skeletons, the quiet avatar fallback. |
| `surface-inverse` | `#15171C` | `#15171C` | Non-interactive dark fills: the tooltip. Interactive dark areas use a dark island instead (below). |
| `text` | `#111214` | `#F2F3F5` | Body and headings. 16.57:1 on ground. |
| `text-muted` | `#63676E` | `#A4A9B4` | Secondary text. 5.02:1 on ground, 5.68:1 on cards. |
| `text-on-inverse` | `#FFFFFF` | `#FFFFFF` | Text on `surface-inverse`. |
| `primary` | `#0B3A47` | `#F2F3F5` | The teal fill: the main action on a screen and the active nav pill. In a room it inverts to a light pill, because teal on near-black is too dim to carry a button. |
| `on-primary` | `#FFFFFF` | `#0E0F12` | Text on `primary`. 12.28:1 light. |
| `highlight` | `#F6C544` | `#F6C544` | The yellow fill: the second action beside a primary one ("Book for later"). Same in both themes. |
| `on-highlight` | `#111214` | `#111214` | Text on `highlight`. 11.59:1. |
| `ink` | `#111214` | `#F2F3F5` | A neutral solid button, for actions inside a card where teal would compete with the page's own primary. |
| `on-ink` | `#FFFFFF` | `#0E0F12` | Text on `ink`. |
| `spark` | `#E8843A` | `#E8843A` | Orange, for **marks only**: globe dots, a small badge, the log-out glyph. Never text, never a large fill. |
| `spark-text` | `#A85416` | `#F0A868` | The readable orange, for the rare orange word or icon. 4.71:1 on ground. |
| `accent` | `#0B3A47` | `#7FC4D1` | The brand teal as links, selected states and the focus ring. |
| `live` | `#1E7A46` | `#5FD68A` | The live signal: "Live now" and "LIVE" as text, the dot, the on-air ring, the "Request now" fill. Never on the teal accent (2.3:1). |
| `on-live` | `#FFFFFF` | `#0E0F12` | Text on `live`. |
| `live-surface` | `#E6F7EC` | `#16181D` | The live chip's background. `live` on it: 4.81:1. |
| `border` | `#E2E2DF` | `#2A2E37` | Hairlines and card borders. Decorative, no floor. |
| `border-strong` | `#767C88` | `#767C88` | Inputs, checkboxes, anything a person has to find. 3.71:1 on ground. |
| `focus` | = accent | = accent | The one focus ring. |
| `danger` | `#B3261E` | `#FF8A80` | Destructive text and buttons, with `danger-surface` behind danger alerts. |
| `warning` | `#8A5A00` | `#FFC857` | Warning text, on `warning-surface`. |
| `success` | = live | = live | One green. A success state and a live state never compete in the same view. |

Plus `scrim` (the inverse surface at 60%, 70% in rooms) behind modals and drawers.

Every pairing a component may draw is listed in `tokens.ts` with its WCAG floor, and the test checks all of them in both themes. A pair that isn't there isn't sanctioned.

**Compatibility aliases.** Until Part G of the rebuild, `globals.css` also carries the old colour-named utilities (`ink-900`, `gold-400`, `gray-500`...) mapped to the nearest role, under a heading that says REMOVE IN PART G. Don't write new code against them.

### Dark islands

The one focus ring is the accent, and the deep teal on near-black measures 1.46:1. So: **interactive content on a dark background lives inside a `.theme-dark` scope**, never on a bare `bg-surface-inverse`. Inside the scope every role re-resolves and the component code stays identical. The site footer is a dark island. A tooltip is not (nothing in it takes focus), so it can use `surface-inverse` directly.

## Type

Two faces, both bundled by `next/font` at build (no runtime request to Google). The wordmark is a vector, so no font carries it.

- **Funnel Display**, 600 to 800, via `font-display`: page titles, section titles, tutor names, the hero, the big number on a stat card. `h1`, `h2`, `h3` get it from the base stylesheet.
- **Funnel Sans**, 400 to 600, via `font-sans`: everything else. Body is 15px on 24px.

Scale (size/leading): display 40/44, h1 32/38, h2 24/30, h3 20/26, body-lg 17/26, body 15/24, small 13/20, caption 12/16. Numbers that sit in columns or represent money use tabular figures: put `data-numeric` on the element (tables get it automatically).

The hero headline is centred and wide, about 22 characters a line, in the display face. One weight, no coloured word in it.

## Shape and space

Cards `rounded-card` (22px). The panel that holds a group of cards, and every modal, `rounded-panel` (26px). A photo inset inside a card `rounded-photo` (15px). Inputs, selects and menus `rounded-lg` (14px). Chips, badges and every button `rounded-full`.

Buttons are 38px (`sm`), 46px (`md`) and 54px (`lg`) tall. `md` and up clear the 44px touch target.

Spacing on the 4px grid. Comfortable density on marketplace pages (card padding 20px). Compact on admin tables (rows 40px). Pages are full-bleed with a `px-4 md:px-6` gutter; `container-page` (1200px) is for the rare boxed reading page.

## Buttons

| Variant | Fill | When |
|---|---|---|
| `primary` | teal | The main action on the screen, and the only teal fill. One per view. |
| `highlight` | yellow | The second action standing beside a primary one. |
| `ink` | near-black | A neutral action inside a card, where teal would compete with the page's primary. |
| `outline` | bordered | Everything else that isn't the point of the screen. |
| `ghost` | none | Toolbars, menus, table rows. |
| `live` | green | Live actions only ("Request now", "Go live", "Join"). Rare by design. |
| `danger` | red | Destructive only. |

`secondary` is a deprecated alias of `outline` and goes in Part G.

## Cards

The tutor card is the product. Its anatomy, in order: photo inset with the on-air ring when the tutor takes instant requests; live chip top-left only when live or broadcasting (an offline tutor shows **no** status text: absence is the signal); favourite top-right; name in the display face; country; headline; the proof row (`StatRow`: Experience, Sessions, Rate with the "≈ $" anchor); one call to action. `live` "Request now" for instant-available, a "Watch live" link for broadcasting, `ink` "Book a session" otherwise.

Two variants: `grid` (photo on top, `md` and up) and `row` (88px photo beside the text, phones and short lists). The whole card links to the profile through a stretched link on the name; the chip, heart and action sit above it. In a grid the ring is static (`OnAirRing still`): many pulsing rings at once is noise.

Rating is not in the row until reviews exist, which comes after launch (SPEC §18, Noora 2026-09-16).

Cards separate from the canvas by their border, not a shadow. A card that is one big link lifts 3px with `shadow-lift` on hover and holds still under reduced motion.

## Icons

Plain line icons, stroke 1.8, drawn in `currentColor` or teal. No icon sits on a tinted tile, a coloured circle or a rounded square of its own. An icon next to text takes the text's colour unless it is the live signal.

## Photos

Students book people they can see. From Part G, `approveTutor` refuses a tutor without an `avatar_url`, and tutor onboarding requires a photo. Until then, the fallback is quiet: initials in the display face on `surface-muted` in `text-muted`. A missing photo reads as missing, not as a design choice.

Photos are inset inside the card with `rounded-photo`, never bled to the card's own edge, and never tinted or duotoned.

## Dashboards

Students, tutors and admins share one shell: a labelled sidebar grouped into sections, a topbar with search, then the page.

The page reads in this order, every role:

1. A teal banner card carrying the one thing that matters now (live tutors for a student, go-live and incoming requests for a tutor, the approval queue for an admin).
2. Summary cards, plain line icons, real numbers only.
3. The middle: a photo carousel of what's coming up, or the queue that needs working.
4. A right column: greeting, a chart of real history, and a short list (your tutors, recent students, recent activity).
5. **Tables run full width at the bottom**, under both the main area and the right column.

Only real data. No invented awards, ratings, goals, streaks or follow buttons.

## The live signal

Two states, one colour family, mutually exclusive (SPEC §7.8: a broadcasting tutor can't take instant requests).

- **Instant-available** ("Live now"): the green `OnAirRing` around the photo, plus a `LiveChip` reading "Live now", plus the `live` "Request now" button.
- **Broadcasting** ("LIVE"): a `LiveChip` reading "LIVE" with the viewer count. No ring; the ring means "start in 60 seconds", not "watch".

The chip is always text. A dot on its own is decoration, never the indicator. No red for live, anywhere.

## Rooms

Every live room is dark: `.theme-dark` on the `(session)` layout (instant session, classroom, broadcast host) and on the `/live/[id]` band under the light site header. Dialogs portal outside that wrapper, so a room's own confirms carry `className="theme-dark"` themselves.

- **Lobby first.** A device check before anything joins. Join is disabled until it passes; a blocked device says exactly where to allow it.
- **Spotlight.** The tutor's video is the picture (students publish audio only, SPEC §9); the student is a small tile in the corner from `md`, stacked below on phones.
- **Control bar.** 44px labelled toggles with a fixed accessible name and `aria-pressed` = on; an off device turns the danger colour and says "Mic off". The end action sits apart on the right, in `danger`.
- **Connection banner.** One polite live region. Silent when all is well; words and one action when it isn't.
- **Time.** The clock turns `warning` at 5 minutes and `danger` in the last minute; a toast at 5, a banner from 2, each announced once.
- **The incoming request is a call.** Green on-air ring round the student, a short rise-in, Accept focused and green, a two-note chime the tutor can mute, and a notice that stays when a call is missed.
- **The student's wait never dead-ends.** No answer or a decline offers "Try another live tutor" and "Book a time with {name}".

Sounds are synthesised with Web Audio; the product ships no audio files.

## Money

`<Money credits={45} usdPerCredit={rate} showUsd per="hr" />` renders "45 cr / hr ≈ $45". `usdPerCredit` comes from the direct-pay basis package (`lib/credits/packages.ts`); it is never hard-coded. The payout rate to tutors ($1 per credit) is a tutor-side number and never appears on a student surface.

Money confirms (withdraw, refund, reversal) use `AlertDialog` and restate the exact amount and destination with outcome-labelled buttons: "Withdraw $45 to PayPal" and "Keep credits", not "OK" and "Cancel". `AlertDialog` renders `role="alertdialog"`; Playwright's `getByRole("dialog")` does not match it.

## Motion

150 to 220ms, ease-out, nothing longer than 2s, except the globe, which turns slowly and forever. Keyframes live in `globals.css` under the existing reduced-motion block. Everything animated has a static alternative: the live dot becomes a solid dot, the on-air ring a solid ring, the globe stops and the cards stop lifting.

## Wordmark

`<Wordmark />`: Noora's lowercase "nowtutors" logo, one SVG path in `currentColor`. Ink on light; `tone="onDark"` gives white for footers and rooms. Sizes set the height (`sm` 20px, `md` 28px, `lg` 36px). The logo is single-colour: never put it on a teal or green block to "brand" it. `<Monogram />` (the logo's "n") is for the collapsed sidebar rail only.

## Tables

Text left, numbers right (`numeric` on `TableHead` and `TableCell`), tabular figures, header row on `surface-muted` in sentence case, hairline row borders, no stripes, no centred columns. Admin tables are compact. On a dashboard a table spans the full width at the bottom of the page.

## Banned tells

Each one is a reason the first mockups read as a template rather than a product. The token test fails the build on the first two.

- **Decorative gradients.** No background glow behind a hero, no gradient headline text, no gradient card fill. The only gradients in `src/` are the globe's fallback sphere and the skeleton shimmer, both in the test's allowlist.
- **Orange as text or as a large fill.** Orange is a mark. Readable orange is `spark-text`, used rarely.
- Tinted tiles or coloured circles behind icons.
- Coloured side stripes on cards or alerts, and multicolour rules under a section.
- More than one loud fill in a view, or a second teal fill competing with the primary action.
- Indigo or violet anywhere.
- Tracked all-caps eyebrows, and one coloured word in a headline.
- Glassmorphism outside the home hero's single proof strip.
- Emoji as icons.
- Dark by default outside the rooms.
- Live green on the teal accent, and a bare colour dot as the only live indicator.
- Invented content: ratings, awards, badges, streaks or goals the app doesn't actually have.
- `bg-[#hex]`, `text-[#hex]`, or any raw hex outside `globals.css` and `tokens.ts` (the unit test greps for it; the Google sign-in logo is the one allowed exception).
- "OK" and "Cancel" on a confirm.
