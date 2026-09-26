# NowTutors — Design

_The design contract. SPEC §10 says what the system is; this file says how to use it. Read it before styling anything. Values live in `src/app/globals.css` (for the browser) and `src/lib/design/tokens.ts` (for the test); the two must agree, and `tests/unit/design-tokens.test.ts` fails if they don't._

Direction: **v3, design round 3** (2026-09-26, Noora's two references: the page structure of oranum.com and the colours of the InstaEDU tutoring site; notes in the workspace at `outputs/nowtutors/round-3-references-2026-09-26/`, mockups at `outputs/nowtutors/round-3-mockups/`). v3 keeps v2's bones (roles not colours, one live signal, real faces, proof on the person, the same components) and changes two things: the palette, which moves to navy, mid blue, green and orange on a light grey canvas with white cards; and the shape of the public pages, which follow Oranum (a subject sidebar beside a live carousel and a card grid, a profile with a stage). The globe and the v2 home blocks are parked, not deleted (DECISIONS, round 3 Part C). Dashboards and rooms keep their v2 layout in the v3 colours.

Colour has a job or it doesn't appear. Blue leads, orange says act now, green means live and nothing else, navy holds the frame.

## Tokens

Components reference roles, never colours. `bg-surface-raised`, `text-text-muted`, `border-border`, `bg-live`. There is no `bg-purple-500` any more, and Tailwind's own palette is switched off (`--color-*: initial`), so `bg-red-500` doesn't exist either.

Two themes, same roles. Light on `:root`; dark under `.theme-dark`. The dark scope exists for the live rooms (session, classroom, broadcast viewer) and for dark islands like the footer. A component never knows which theme it is in.

| Token | Light | Dark (rooms, header, footer) | Role, one sentence |
|---|---|---|---|
| `ground` | `#EFEFEF` | `#1B2633` | The page canvas: the light grey band from the InstaEDU reference, so a white card reads as a card without a shadow. In the dark scope it is navy. |
| `surface` | = ground | = ground | The older name for the canvas, kept so existing `bg-surface` code stays correct. New code uses `bg-ground`. |
| `surface-raised` | `#FFFFFF` | `#243244` | Cards, panels, popovers. |
| `surface-muted` | `#E4E4E4` | `#243244` | Grouped areas, table headers, skeletons, the quiet avatar fallback. |
| `surface-inverse` | `#1F2B3A` | `#1F2B3A` | Non-interactive dark fills: the tooltip. Interactive dark areas use a dark island instead (below). |
| `text` | `#1F2B3A` | `#F2F4F7` | Body and headings, navy. 14.34:1 on white, 12.36:1 on ground. |
| `text-muted` | `#5A6472` | `#A9B3C0` | Secondary text. Clears 4.5:1 on ground and on cards. |
| `text-on-inverse` | `#FFFFFF` | `#FFFFFF` | Text on `surface-inverse`. |
| `primary` | `#1C5E92` | `#F2F4F7` | The mid-blue fill: the main action on a screen, the search band, the active nav. 6.85:1 with a white label. In a room it inverts to a light pill, because the blue on navy is too dim to carry a button. |
| `on-primary` | `#FFFFFF` | `#1B2633` | Text on `primary`. |
| `highlight` | `#BF4019` | `#BF4019` | The orange fill, act now: Sign up, "See tutors", and the second action standing beside a primary one. 5.3:1 with a white label. |
| `on-highlight` | `#FFFFFF` | `#FFFFFF` | Text on `highlight`. |
| `ink` | `#1F2B3A` | `#F2F4F7` | Navy. The header, the footer, a neutral solid button inside a card where blue would compete with the page's own primary. |
| `on-ink` | `#FFFFFF` | `#1B2633` | Text on `ink`. |
| `spark` | `#E8582D` | `#E8582D` | The bright orange, for **marks only**: a small badge, an unread count, the log-out glyph. Never text. A large orange fill is `highlight`. |
| `spark-text` | `#B83C17` | `#F0A868` | The readable orange, for the rare orange word or icon. Clears 4.5:1 on ground. |
| `accent` | `#1C5E92` | `#8FC6F2` | The brand blue as links, selected states and the focus ring. |
| `live` | `#1E7A46` | `#5FD68A` | The live signal: "Live now" and "LIVE" as text, the dot, the on-air ring, the "Go live" and "Join" fills. Never on the blue accent. |
| `on-live` | `#FFFFFF` | `#1B2633` | Text on `live`. |
| `live-surface` | `#E6F7EC` | `#243244` | The live chip's background. |
| `border` | `#DCDCDC` | `#33425A` | Hairlines and card borders. Decorative, no floor. |
| `border-strong` | `#6F7986` | `#7A8797` | Inputs, checkboxes, anything a person has to find. Clears 3:1 on ground. |
| `focus` | = accent | = accent | The one focus ring. |
| `danger` | `#B3261E` | `#FF8A80` | Destructive text and buttons, with `danger-surface` behind danger alerts. |
| `warning` | `#8A5A00` | `#FFC857` | Warning text, on `warning-surface`. Amber on purpose, alerts only, never a fill. |
| `success` | = live | = live | One green. A success state and a live state never compete in the same view. |

Plus `scrim` (the inverse surface at 60%, 70% in rooms) behind modals and drawers.

Every pairing a component may draw is listed in `tokens.ts` with its WCAG floor, and the test checks all of them in both themes. A pair that isn't there isn't sanctioned.

**Compatibility aliases.** Until Part G of the rebuild, `globals.css` also carries the old colour-named utilities (`ink-900`, `gold-400`, `gray-500`...) mapped to the nearest role, under a heading that says REMOVE IN PART G. Don't write new code against them.

### Dark islands

The one focus ring is the accent, and the mid blue on navy measures about 2:1. So: **interactive content on a dark background lives inside a `.theme-dark` scope**, never on a bare `bg-surface-inverse`. Inside the scope every role re-resolves and the component code stays identical. The site header and the site footer are dark islands (v3), and so are the rooms. A tooltip is not (nothing in it takes focus), so it can use `surface-inverse` directly.

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
| `primary` | blue | The main action on the screen, and the only blue fill. One per view. |
| `highlight` | orange | Act now: Sign up in the header, "See tutors" on the search band, and the second action standing beside a primary one. |
| `ink` | navy | A neutral action inside a card, where blue would compete with the page's primary. |
| `outline` | bordered | Everything else that isn't the point of the screen. |
| `ghost` | none | Toolbars, menus, table rows. |
| `live` | green | Going on air only ("Go live", "Join", "Try another live tutor"). Rare by design. "Request now" is `primary` from Part D: the green belongs to the tutor (ring, chip), not the student's button. |
| `danger` | red | Destructive only. |

`secondary` is a deprecated alias of `outline` and goes in Part G.

## Cards

The tutor card is the product. Its anatomy, in order (v2, Part D, as mocked in `pages.html`): a white card with 10px padding and a 22px radius; the photo inset at 15px (`rounded-photo`) with the on-air ring when the tutor takes instant requests; the live chip on the photo, top-left, on a white pill, only when live or broadcasting (an offline tutor shows **no** status text: absence is the signal); favourite top-right; name in the display face with the country, by name, on the same line; the one-line pitch; the first subject as a tag; the proof row (`StatRow`: Experience, Sessions, Rate, with the rate stacked as "45 cr" over "≈ $60"); one full-width action. `primary` (teal) "Request now" for instant-available, `outline` "Watch live" for broadcasting, `ink` "Book a session" otherwise. The card rises 3px with `shadow-lift` on hover, never under reduced motion. Below `md` the `row` variant keeps the same states in a horizontal card.

The profile follows the same parts at a larger size: a square photo at 24px radius (ring outside a ground-coloured gap when instant-available), the name at display size, a meta line (country, languages, two subject tags), the proof row on white, then white blocks (About, Subjects, This week, Background) and a 26px sticky panel.

Two variants: `grid` (photo on top, `md` and up) and `row` (88px photo beside the text, phones and short lists). The whole card links to the profile through a stretched link on the name; the chip, heart and action sit above it. In a grid the ring is static (`OnAirRing still`): many pulsing rings at once is noise.

Rating is not in the row until reviews exist, which comes after launch (SPEC §18, Noora 2026-09-16).

Cards separate from the canvas by their border, not a shadow. A card that is one big link lifts 3px with `shadow-lift` on hover and holds still under reduced motion.

## Public pages (v3)

The public shape is Oranum's, in the InstaEDU colours (design round 3, 2026-09-26).

- **Header (Part B).** A 56px navy bar, a dark island: wordmark left; "Live tutors" and "All tutors" as text links, the current one underlined in `accent` (no pills); a subject search (a plain form to `/tutors?q=`) on `/tutors`, since home has its own search band and a profile's point is the panel; Log in as text, Sign up as the `highlight` orange fill. Signed in, the actions become the avatar and a `highlight` link to the person's home. Below `md`, a menu button with the same links, the search and the same actions.
- **Footer (Part B).** Navy, a dark island. Brand and the real live count, then "For tutors" and "Help" link columns and the trust pair, then the bottom bar. A Legal column arrives with Phase 10. Every href is checked against `lib/routes.ts`.
- **Home and browse (Part C).** One layout, two routes: a blue search band, a 220px sidebar at `lg` (Live now, Subjects with counts, Price, Languages) beside a "Live now" carousel and an "All tutors" grid four across at 1440; the chip row below `lg`. The globe and the v2 home blocks are parked.
- **Tutor card (Part D).** Landscape photo with the live chip and the heart on it and the name and country on a navy strip along its bottom edge; under the photo the stacked rate and up to three subject chips; one action.
- **Profile (Part E).** A stage on the left (the photo, or the broadcast player for a signed-in student when the tutor is live), the identity block and the white blocks under it, the sticky panel on the right unchanged.

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

Built in Part E (2026-09-18), in code:

- **Shell** (`app-shell`, `sidebar`, `topbar`): white 250px sidebar at `lg` (Overview, the role's people section, Account with Log out in `spark-text`), an icon rail from `md` to `lg`, the bottom bar below `md`. Active item is a teal pill; Messages carries an orange count with ink digits. The topbar sits on the ground with no rule: a search pill (students search tutors), the Messages circle, the avatar with the name.
- **Page layout** (`DashboardColumns`): main column and a 340px right column from `xl`, stacked below it, and a full-width row for tables.
- **Pieces** (`src/components/features/dashboard/`): `Banner` (rings and pins, no gradient), `SummaryCard` (the whole card links; no "⋮" menu with nothing in it), `SessionCarousel`, `BarChart` (one scale, teal current bar, light teal others, `role="img"` with every value in the label), `PeopleList`, `BookingsTable`, `RailBox`.

## The live signal

Two states, one colour family, mutually exclusive (SPEC §7.8: a broadcasting tutor can't take instant requests).

- **Instant-available** ("Live now"): the green `OnAirRing` around the photo, plus a `LiveChip` reading "Live now", plus the teal `primary` "Request now" button.
- **Broadcasting** ("LIVE"): a `LiveChip` reading "LIVE" with the viewer count. No ring; the ring means "start in 60 seconds", not "watch".

The chip is always text. A dot on its own is decoration, never the indicator. No red for live, anywhere.

## Rooms

Every live room is dark navy (v3): `.theme-dark` on the `(session)` layout (instant session, classroom, broadcast host) and on the `/live/[id]` band under the light site header. Dialogs portal outside that wrapper, so a room's own confirms carry `className="theme-dark"` themselves.

- **Lobby first.** A device check before anything joins. Join is disabled until it passes; a blocked device says exactly where to allow it.
- **Top bar (v2, Part H).** The heading and who with on the left, a `live` "Connected" chip once the other person is in (a muted "Waiting for {name}…" before), and the clock as a pill with a thin progress line, pushed right.
- **Spotlight.** The tutor's video is the picture (students publish audio only, SPEC §9) on a 26px stage (`rounded-panel`) with a "Good / Fair / Weak connection" chip top-left and name plates on the canvas colour at 70%. The student is a 16:10 picture-in-picture, 16px radius with a 2px ground-coloured edge, 18px in from the corner from `md`, stacked below on phones.
- **Control bar.** One dark rounded bar (22px), controls centred. 44px labelled toggles with a fixed accessible name and `aria-pressed` = on; an off device turns coral and says "Mic off". The end action sits apart on the right as a coral `danger` pill.
- **Broadcasts** use the same stage; the audience count ("3 watching") is a chip on the picture, and the host's status bar is one rounded dark bar like the control bar. The Lobby's Join is `live` green: joining is going on air.
- **Connection banner.** One polite live region. Silent when all is well; words and one action when it isn't.
- **Time.** The clock turns `warning` at 5 minutes and `danger` in the last minute; a toast at 5, a banner from 2, each announced once.
- **The incoming request is a call.** Green on-air ring round the student, a short rise-in, Accept focused and green, a two-note chime the tutor can mute, and a notice that stays when a call is missed.
- **The student's wait never dead-ends.** No answer or a decline offers "Try another live tutor" and "Book a time with {name}".

Sounds are synthesised with Web Audio; the product ships no audio files.

## Money

`<Money credits={45} usdPerCredit={rate} showUsd per="hr" />` renders "45 cr / hr ≈ $45". `usdPerCredit` comes from the direct-pay basis package (`lib/credits/packages.ts`); it is never hard-coded. The payout rate to tutors ($1 per credit) is a tutor-side number and never appears on a student surface.

Money confirms (withdraw, refund, reversal) use `AlertDialog` and restate the exact amount and destination with outcome-labelled buttons: "Withdraw $45 to PayPal" and "Keep credits", not "OK" and "Cancel". `AlertDialog` renders `role="alertdialog"`; Playwright's `getByRole("dialog")` does not match it.

## Motion

150 to 220ms, ease-out, nothing longer than 2s, except the globe, which turns slowly and forever. Keyframes live in `globals.css` under the existing reduced-motion block. Everything animated has a static alternative: the live dot becomes a solid dot, the on-air ring a solid ring, the globe is replaced by its static sphere (cobe is not even loaded), the hero's floating tutor cards stop drifting, and the cards stop lifting.

## Wordmark

`<Wordmark />`: Noora's lowercase "nowtutors" logo, one SVG path painted in `currentColor`. The path is a static file (`public/brand/wordmark.v1.svg`) used as a CSS mask, never inline: it is 34 KB (DECISIONS, "Performance review: the logo"). Ink on light; `tone="onDark"` gives white for footers and rooms. Sizes set the height (`sm` 20px, `md` 28px, `lg` 36px). The logo is single-colour: never put it on a teal or green block to "brand" it. `<Monogram />` (the logo's "n") is for the collapsed sidebar rail only.

## Tables

Text left, numbers right (`numeric` on `TableHead` and `TableCell`), tabular figures, header row on `surface-muted` in sentence case, hairline row borders, no stripes, no centred columns. Admin tables are compact. On a dashboard a table spans the full width at the bottom of the page.

## Banned tells

Each one is a reason the first mockups read as a template rather than a product. The token test fails the build on the first two.

- **Decorative gradients.** No background glow behind a hero, no gradient headline text, no gradient card fill. The only gradients in `src/` are the globe's fallback sphere and the skeleton shimmer, both in the test's allowlist.
- **Yellow anywhere.** It left the system in v3. Amber `warning` is for alerts only.
- **Orange as text, or as any fill other than `highlight`.** `spark` is a mark. Readable orange is `spark-text`, used rarely. The act-now fill is `highlight` and nothing else is orange.
- Tinted tiles or coloured circles behind icons.
- Coloured side stripes on cards or alerts, and multicolour rules under a section.
- More than one loud fill in a view, or a second teal fill competing with the primary action.
- Indigo or violet anywhere.
- Tracked all-caps eyebrows, and one coloured word in a headline.
- Glassmorphism outside the home hero's single proof strip.
- Emoji as icons.
- Dark by default outside the rooms, the header and the footer.
- Live green on the blue accent, and a bare colour dot as the only live indicator.
- Invented content: ratings, awards, badges, streaks or goals the app doesn't actually have.
- `bg-[#hex]`, `text-[#hex]`, or any raw hex outside `globals.css` and `tokens.ts` (the unit test greps for it; the Google sign-in logo is the one allowed exception).
- "OK" and "Cancel" on a confirm.
