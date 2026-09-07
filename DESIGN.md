---
name: "Squid Ink"
description: "Bot-free AI meeting notepad. A print desk rendered in a browser: warm newsprint, zero radius, one ink."
colors:
  paper: "oklch(0.979 0.011 84)"
  raised: "oklch(0.960 0.014 82)"
  canvas: "oklch(0.948 0.016 82)"
  rail: "oklch(0.922 0.019 80)"
  pane: "oklch(0.922 0.019 80)"
  dock: "oklch(0.960 0.014 82)"
  rule: "oklch(0.856 0.023 80)"
  rule-2: "oklch(0.870 0.021 82)"
  rule-3: "oklch(0.898 0.019 82)"
  control-edge: "oklch(0.585 0.016 70)"
  ink: "oklch(0.226 0.022 62)"
  ink-2: "oklch(0.300 0.021 62)"
  ink-3: "oklch(0.310 0.020 62)"
  ink-prose: "oklch(0.226 0.022 62)"
  ink-stat: "oklch(0.226 0.022 62)"
  muted: "oklch(0.500 0.018 64)"
  meta: "oklch(0.530 0.017 64)"
  meta-2: "oklch(0.530 0.017 64)"
  meta-3: "oklch(0.455 0.018 62)"
  meta-4: "oklch(0.530 0.017 64)"
  meta-5: "oklch(0.530 0.017 64)"
  faint: "oklch(0.660 0.015 68)"
  placeholder: "oklch(0.585 0.016 66)"
  rail-idle: "oklch(0.450 0.018 62)"
  notice: "oklch(0.415 0.019 62)"
  notice-bg: "oklch(0.898 0.019 82)"
  accent: "oklch(0.452 0.148 146)"
  accent-pressed: "oklch(0.402 0.138 146)"
  accent-text: "oklch(0.352 0.130 146)"
  on-accent: "oklch(0.978 0.024 140)"
  tint: "oklch(0.905 0.064 142)"
  tint-hover: "oklch(0.858 0.098 142)"
  seg-wash: "oklch(0.905 0.064 142)"
  waveform: "oklch(0.800 0.052 142)"
  live: "oklch(0.520 0.170 25)"
  speaker-1: "oklch(0.50 0.10 252)"
  speaker-1-avatar: "oklch(0.90 0.04 252)"
  speaker-2: "oklch(0.47 0.09 155)"
  speaker-2-avatar: "oklch(0.90 0.04 155)"
  speaker-3: "oklch(0.48 0.09 55)"
  speaker-3-avatar: "oklch(0.90 0.04 60)"
typography:
  display:
    fontFamily: "Bitter, Georgia, serif"
    fontSize: "29px"
    fontWeight: 500
    lineHeight: 1.14
    letterSpacing: "-0.012em"
  page-title:
    fontFamily: "Bitter, Georgia, serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Bitter, Georgia, serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "normal"
  title:
    fontFamily: "Bitter, Georgia, serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "normal"
  subtitle:
    fontFamily: "Bitter, Georgia, serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "normal"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.66
    letterSpacing: "normal"
  body-row:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  body-dense:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.56
    letterSpacing: "normal"
  body-compact:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  caption:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  body-tight:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "normal"
  numeral:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.01em"
  stamp:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "10.5px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  action:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.06em"
  meta-2:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "9.5px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.14em"
  meta:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "9px"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "0.14em"
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "8.5px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.16em"
rounded:
  none: "0"
  full: "9999px"
spacing:
  hair: "1px"
  xs: "5px"
  sm: "7px"
  md: "9px"
  lg: "11px"
  xl: "13px"
  row-gap: "14px"
  gutter: "18px"
  feed-gutter: "24px"
  pane-gutter: "26px"
  corner-safe: "24px"
  hud-reserve: "72px"
components:
  button-record:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.ink}"
    typography: "{typography.subtitle}"
    rounded: "{rounded.none}"
    padding: "9px 13px"
  button-record-header:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.action}"
    rounded: "{rounded.none}"
    padding: "7px 13px"
  button-record-header-hover:
    backgroundColor: "{colors.accent-pressed}"
    textColor: "{colors.on-accent}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.meta}"
    rounded: "{rounded.none}"
    padding: "5px 9px"
  button-primary-hover:
    backgroundColor: "{colors.accent-pressed}"
    textColor: "{colors.on-accent}"
  button-outline:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.notice}"
    typography: "{typography.meta}"
    rounded: "{rounded.none}"
    padding: "5px 8px"
  button-ghost:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.rail-idle}"
    typography: "{typography.meta}"
    rounded: "{rounded.none}"
    padding: "5px 8px"
  button-pending:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.faint}"
    typography: "{typography.action}"
    rounded: "{rounded.none}"
    padding: "7px 11px"
  readout-recording:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    typography: "{typography.action}"
    rounded: "{rounded.none}"
    padding: "7px 11px"
  pill-status:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.muted}"
    typography: "{typography.meta}"
    rounded: "{rounded.none}"
    padding: "2px 7px"
  pill-status-analyzing:
    backgroundColor: "{colors.tint}"
    textColor: "{colors.accent-text}"
  pill-status-failed:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.live}"
  chip-citation:
    backgroundColor: "{colors.tint}"
    textColor: "{colors.accent-text}"
    typography: "{typography.action}"
    rounded: "{rounded.none}"
    padding: "1px 5px"
  chip-citation-hover:
    backgroundColor: "{colors.tint-hover}"
    textColor: "{colors.accent-text}"
  input-text:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body-dense}"
    rounded: "{rounded.none}"
    padding: "8px 10px"
  nav-item:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.ink-2}"
    typography: "{typography.body-dense}"
    rounded: "{rounded.none}"
    padding: "7px 8px"
  nav-item-current:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
  nav-item-pending:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.faint}"
  row-note:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    padding: "11px 24px"
  row-note-hover:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.ink}"
  tab-lens:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.rail-idle}"
    typography: "{typography.subtitle}"
    rounded: "{rounded.none}"
    padding: "8px 11px 9px"
  tab-lens-selected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  card-stat:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.subtitle}"
    rounded: "{rounded.none}"
    padding: "10px 11px"
  avatar-speaker:
    backgroundColor: "{colors.speaker-1-avatar}"
    textColor: "{colors.speaker-1}"
    rounded: "{rounded.full}"
    size: "26px"
---

# Design System: Squid Ink

## Overview

**Creative North Star: "The Press Sheet"**

This is a print desk rendered in a browser. The light theme is warm newsprint —
an off-white cream at `oklch(0.979 0.011 84)` that never reaches paper-white —
and the dark theme is the same sheet under a desk lamp, an espresso brown-black
at `oklch(0.185 0.014 48)` that never reaches pure black. Both themes carry a
low-chroma warm hue through every neutral, so the greys are never neutral greys;
they are aged paper and roasted ink. One colour is allowed to be loud: a deep
forest-green accent that reads as press ink on the light sheet and as fresh ink
under the lamp.

Nothing is rounded, nothing floats, and nothing is decorated. Structure is
carried entirely by hairline rules and by the flat tonal difference between six
named surfaces. The type does the hierarchy work: a serif for anything with a
name or a number in it, a grotesque for prose, and a monospace shrunk to 8.5px
and letterspaced into small-caps slugs for every label, timestamp and count.
Density is the point — this is a reading and scanning surface for someone who
already sat through the meeting, not a landing page trying to explain itself.

The system now covers two screens, and they are the same sheet at two
distances. **The Dashboard** is the contact sheet: a two-column shell over a
day-grouped list of rows, four aligned tracks per row, no cards and no panels.
**Note Detail** is the plate: a three-column reading surface with the note in
the middle and its source transcript beside it. The rails differ in width
(212px against 136px) and in job, but the ink, the rules, the type ladder and
the square corners are identical across both.

The one place the system permits softness is the human: speaker avatars are the
only circles in the product, and per-speaker hues (blue, green, amber) are the
only colours outside the accent family. People get rounded corners, and so does
the live-recording dot. Nothing else does.

**Key Characteristics:**

- Warm-neutral duotone: newsprint cream (light) / espresso (dark), never white, never black
- Zero border radius on every surface, control and container — circles only for people and for "live"
- Hairline rules and flat tonal layering instead of shadows
- One accent hue (forest green), used sparingly and always meaning "grounded in the source"
- Micro-typography: 8.5–10.5px letterspaced uppercase mono for all metadata
- Odd-number spacing rhythm (5 / 7 / 9 / 11 / 13 / 14 / 18 / 24 / 26px), tuned by eye rather than to a 4px grid
- Absence is a signal: a finished note shows no status pill and no counts, so anything in those tracks means "this row needs something"

### Naming

The product name is **Squid Ink**, locked 2026-09-07 (`docs/DECISIONS.md`
§ Locked decisions → Branding; `docs/ROADMAP.md` § 9). It may be used in
user-facing copy, page titles and application code. There is deliberately still
no wordmark, logotype or brand-colour obligation: the identity is the sheet, the
ink and the type, and the name sits inside that system rather than on top of it.

This section previously recorded the name as an open decision and forbade any
name string in code. That restriction was correct while naming was reopened
between 2026-08-30 and the lock, and it no longer applies.

## Colors

A warm duotone with one accent. Every token is defined twice in
`app/globals.css` — once on `:root` for light, once on `.dark` and again inside
`@media (prefers-color-scheme: dark) { :root:not(.light) }` — and exposed to
Tailwind through `@theme inline`. The frontmatter above carries the **light**
values as canonical; the dark counterparts are listed inline below.

### Primary

- **Press Green** (`oklch(0.452 0.148 146)` light / `oklch(0.82 0.15 140)` dark)
  — token `accent`. The only saturated colour in the interface. It marks the
  active transcript segment's left border, the record indicator, the persona-rail
  selection border, the dashboard's current nav item, the Record button fill, and
  every `focus-visible` outline in the product. It always means *this is
  anchored to the source recording, or you are here*.
- **Press Green Pressed** (`oklch(0.402 0.138 146)` / `oklch(0.86 0.15 142)`) —
  token `accent-pressed`. Hover and pressed fills, and bare citation timestamps.
- **Press Green Text** (`oklch(0.352 0.130 146)` / `oklch(0.86 0.15 142)`) —
  token `accent-text`. Green text sitting on a green tint, where the accent
  itself would not carry contrast — the citation chip, the Transcribing pill,
  the rail's account initials.
- **Bleached Green** (`oklch(0.978 0.024 140)` / `oklch(0.18 0.05 140)`) — token
  `on-accent`. The only text colour permitted on an accent fill.

### Secondary — the green wash family

- **Ink Wash** (`oklch(0.905 0.064 142)` / `oklch(0.30 0.06 140)`) — token
  `tint`. Citation chip background, the Transcribing pill's fill, the account
  initials mark in the dashboard rail.
- **Ink Wash Deep** (`oklch(0.858 0.098 142)` / `oklch(0.42 0.09 140)`) — token
  `tint-hover`. Citation hover and active, and the mid tier of the mic meter.
  **It is a fill and never a border** — see the Control Edge Rule.
- **Segment Wash** (`oklch(0.905 0.064 142)` / `oklch(0.26 0.045 140)`) — token
  `seg-wash`. Fill behind the currently selected transcript segment.
- **Waveform Green** (`oklch(0.800 0.052 142)` / `oklch(0.40 0.06 140)`) — token
  `waveform`. The 68 static waveform bars and the quietest mic-meter tier.

### Tertiary — speakers

Three fixed hues, assigned by first appearance in the transcript, never by any
digit parsed out of a diarization label. Each has a paired low-chroma avatar
background.

- **Speaker Blue** (`oklch(0.50 0.10 252)` / `oklch(0.78 0.09 252)`) on
  `speaker-1-avatar`.
- **Speaker Green** (`oklch(0.47 0.09 155)` / `oklch(0.78 0.08 155)`) on
  `speaker-2-avatar`.
- **Speaker Amber** (`oklch(0.48 0.09 55)` / `oklch(0.80 0.08 60)`) on
  `speaker-3-avatar`.

### Neutral — six surfaces, three rules, one control edge, five inks

Surfaces, lightest to heaviest in the light theme: **Newsprint** (`paper`,
`0.979`), **Dock Cream** (`dock`, `0.960`), **Raised Cream** (`raised`,
`0.960`), **Canvas** (`canvas`, `0.948`), **Rail Grey** (`rail`, `0.922`),
**Pane Grey** (`pane`, `0.922`). The dark theme deliberately re-orders these:
`rail` becomes the *darkest* surface (`0.155`) while `raised` becomes the
lightest (`0.235`), because depth reads inverted under a lamp.

Rules: **Rule** (`0.856` / `0.30`), **Rule 2** (`0.870` / `0.32`), **Rule 3**
(`0.898` / `0.27`) — three hairline weights for structural, secondary and
list-row dividers respectively. All three measure roughly 1.4–1.5:1 against the
sheets they sit on. That is deliberate: they are *texture*, not information.

**Control Edge** (`oklch(0.585 0.016 70)` / `oklch(0.550 0.014 78)`) — token
`control-edge`. A fourth, much stronger hairline, added 2026-09-05 for one job
only: the boundary of something you can operate. Measured against every sheet a
control sits on, worst case **3.34:1 light** (`rail` / `pane`) and **3.44:1
dark** (`raised`), clearing WCAG 1.4.11's 3:1 for a non-text control boundary.

Inks: **Ink** (`0.226` / `0.93`) for headings and primary text, **Ink 2**
(`0.300` / `0.88`) for transcript and chat prose, then **Muted** (`0.500`),
**Meta** (`0.530`), **Meta 3** (`0.455`), **Faint** (`0.660`) for the metadata
ladder. **Notice** (`0.415` / `0.78`) on **Notice BG** (`0.898` / `0.235`)
carries warnings without introducing an alert colour.

### Alert

- **Live Red** (`oklch(0.520 0.170 25)` light / `oklch(0.66 0.19 25)` dark) —
  token `live`. Reserved for the recording dot, the recorder error marker, and
  the Failed status pill — the three states that will not resolve on their own.
  The light value is derived, not lifted from a design file; recorded as such in
  `docs/KNOWN_GAPS.md`.

### Named Rules

**The One Ink Rule.** There is exactly one accent hue. A new colour is added
only when a state genuinely cannot be expressed in green, warm neutral, or a
speaker hue — which has happened once, for `live`. Do not introduce a blue for
links, a red for destructive actions, or an amber for warnings; `notice` on
`notice-bg` is the warning treatment. The accent is also not spent on passive
data: a finished note's action and span counts sit in `muted`, because a tally
nobody acts on must not compete with the Record button.

**The Control Edge Rule.** `control-edge` is the boundary of an **interactive**
control. `rule-2` is the edge of a **decorative** frame — a status pill, an
insight card, the transcript pane. Never swap one for the other, and never
"fix" either on a single component. In the accent family the same split holds:
`border-accent` is a control edge at 5.28:1 worst case light; `tint-hover` is a
fill and measures 1.15:1 against the `tint` it sits on, so a border drawn in it
is very nearly not drawn at all. Do not darken `--tint-hover` to fix a border —
it is the hover fill under the citation chip and `accent-text` sits on it.

**The No-Literal Rule.** `app/globals.css` is the only file in the repository
permitted to name a colour. Zero `oklch()`, hex, `rgb()` or `hsl()` may appear
in `components/` or `lib/`; a convention test fails the build if one does.
Runtime-varying colours (per-speaker) map through the static lookup in
`components/note-detail/speaker-colors.ts`, because Tailwind cannot build class
names at runtime.

**The Never-White Rule.** No surface is `#fff` and no ink is `#000`. Light
tops out at `0.979` lightness with `0.011` chroma; dark bottoms out at `0.185`
with `0.014` chroma. The warm hue (46–88°) is carried through every neutral.

**The Measured-Against-Its-Sheet Rule.** Contrast is measured against the
surface a thing actually sits on, never against `paper` alone — `rail` and
`raised` are the worst cases in the two themes and neither is `paper`. Verify
against the **built** CSS, not the source: Tailwind emits a hex fallback beside
the `oklch()`, and the fallback is what a browser without `lab()` renders. Two
tokens looking distinct in the light theme is not evidence they differ in dark;
`canvas` and `paper` resolve to the same value under the lamp, which is why
`canvas` is never a button fill.

## Typography

**Display Font:** Bitter (with Georgia, serif)
**Body Font:** Archivo (with system-ui, sans-serif)
**Label/Mono Font:** IBM Plex Mono (with ui-monospace, monospace)

All three load through `next/font/google` in `app/layout.tsx` with
`display: "swap"` and are exposed as CSS variables. Bitter carries weights
500/600/700; Archivo 400/500/600; Plex Mono 400/500/600.

**Character:** A slab-ish serif doing the naming, a tight grotesque doing the
reading, and a monospace shrunk past the point of comfort doing the filing. The
pairing is a newsroom masthead over wire copy over a printer's slug line. The
serif never appears in prose and the grotesque never appears in a label — the
split is absolute and is what keeps a very dense screen legible.

### Hierarchy

The full ramp, largest to smallest. Every size below is one that actually ships;
sizes are set as Tailwind arbitrary values in half-pixel steps because the ladder
was tuned by eye against the faces, not derived from a ratio.

- **Display** (Bitter 500, 29px, 1.14, -0.012em): the note title on Note Detail,
  once per screen. Uses `text-pretty`.
- **Page Title** (Bitter 600, 22px, 1.25, -0.01em): the Dashboard's "All notes"
  heading. One per screen, and the only 22px in the product.
- **Headline** (Bitter 600, 16px, 1.25): pane headers — "Transcript", the empty
  feed's "No notes yet".
- **Title** (Bitter 600, 15px, 1.25): the note title on a feed row. Larger than
  the lens tabs because it is the thing being scanned for.
- **Subtitle** (Bitter 600, 14px, 1.25): persona-rail lens tabs, speaker names
  in the per-speaker cards. Set with `text-sm`, the one place a Tailwind scale
  step is used instead of an arbitrary value.
- **Body** (Archivo 400, 14.5px, 1.66): summary prose. The most generous
  line-height in the system, because it is the one paragraph anyone reads
  straight through. Uses `text-pretty`.
- **Body Row** (Archivo 400, 13.5px, 1.5): action-item rows and the record
  pill's word "Record".
- **Body Dense** (Archivo 400, 13px, 1.56): transcript segments, chat exchange,
  the dashboard rail's nav items, the empty-feed explanation.
- **Body Compact** (Archivo 400, 12.5px, 1.5): the feed row's preview line, the
  rail's recent-note jump links, and the header's search placeholder. The
  smallest size the grotesque is allowed to take.
- **Caption** (Archivo 400, 12px, 1.5): the transcript segment's speaker name.
- **Body Tight** (Archivo 400, 11.5px, 1.35): quick-action buttons in the
  persona rail, the notice block.
- **Numeral** (Plex Mono 500, 16px, 1, -0.01em): the recorder's elapsed clock.
  The only large monospace in the product.
- **Stamp** (Plex Mono 400, 10.5px, tabular): the feed row's time-and-duration
  column. Not uppercase and not letterspaced — it is a figure, not a label.
- **Action** (Plex Mono 500, 10px, 0.06em, uppercase): operable mono controls —
  Record, Import audio, the in-flight readout — and citation chips.
- **Meta 2** (Plex Mono 400, 9.5px, 0.14em): speaker times, the feed footer,
  the record pill's shortcut hint.
- **Meta** (Plex Mono 400, 9px, 0.14em, uppercase): status pills, timestamps,
  turn counts, owner/due columns, the theme toggle, the rail's account address.
- **Label** (Plex Mono 400, 8.5px, 0.14–0.16em, uppercase): section rules
  ("SUMMARY", "ACTION ITEMS"), day headings in the feed, rail group headings,
  and the "Soon" badge on every unbuilt control.

### Named Rules

**The Two-Voice Rule.** Bitter names things; Archivo says things; Plex Mono
files things. A serif in a paragraph or a grotesque in a label is a mistake, not
a variation. No fourth face is added.

**The Slug Rule.** Every label under 11px is monospace, uppercase and
letterspaced at 0.06em or wider. Below 11px, letterspacing is what keeps the
glyphs apart; a tight 9px label is unreadable regardless of contrast.

**The Tabular Rule.** Any column of numbers — owner, due, talk time, filler
counts, elapsed clocks, note tallies — carries `tabular-nums`. Ragged numerals
in a scannable column defeat the column.

**The Legible-Even-When-Off Rule.** A disabled control may dim its **label**;
it may never dim the badge that explains why it is off. Measured 2026-09-07:
`text-faint` under `opacity-60` composited to 1.66:1 on `bg-rail`, which is
WCAG-exempt for an inactive control and still reads as a rendering fault when
five of six nav items look that way. The `opacity-60` therefore sits on the
label alone, and the "Soon" badge carries `muted` at full strength — 4.78:1
light / 6.29:1 dark. Never put an explanation in a `title` attribute on a
disabled element: browsers suppress its pointer events, so that tooltip never
renders.

## Layout

**Two screens, one shell language.** Both are `h-dvh` fixed grids that fill the
viewport; the page itself never scrolls vertically, and the interior regions do.

**Dashboard** (`app/page.tsx`) is `grid-cols-[212px_minmax(0,1fr)]`: a 212px
identity rail on `rail`, then a `paper` main column holding a fixed header, a
scrolling feed, and a footer. The feed row is its own four-track grid —
`grid-cols-[62px_minmax(0,1fr)_148px_96px]` with a 14px gap and a 24px gutter:
*when it happened, what it was, where it is in the pipeline, how much came out
of it.* Two of those tracks are routinely empty and hold their width anyway.

**Note Detail** (`note-detail-shell.tsx`) is
`grid-cols-[136px_minmax(0,1fr)_404px]`: persona rail, note, transcript pane.
The centre and right columns scroll independently. Gutters are asymmetric and
deliberate — the note column uses 26px, the transcript pane 18px, the rail
11–12px. Density increases as you move right, because the transcript is scanned
rather than read.

Spacing does not follow a 4px grid. The rhythm is an odd-number ladder —
5, 7, 9, 11, 13, 14, 15, 18, 22, 24, 26px — set by eye against the type sizes.
Tailwind arbitrary values (`pt-[15px]`, `gap-[9px]`) are used throughout rather
than rounding to the nearest scale step.

**The bottom-right corner belongs to the recorder.** The HUD is fixed there,
`z-50`, mounted once in the root layout so it survives navigation. Everything
else keeps `HUD_SAFE_MARGIN` (24px) away from it, read from one exported
constant rather than restated: the theme toggle sits bottom-**left** at that
inset with `z-10`, and any scrolling region whose bottom edge is the viewport
bottom ends `HUD_RESERVE` (72px) above it. Padding the content is not
sufficient — padding only moves the last row, and at any other scroll position
a row still passes underneath.

**Responsive behaviour is a floor, not a design.** One width is drawn. The
Dashboard is held at a 1280px minimum and the page scrolls sideways below that;
Note Detail is fixed-column at all widths. This is an interim guarantee that
content stays reachable rather than clipped, not a responsive pass.
`touch-action: manipulation` is set on buttons, inputs and tabs to kill the
300ms double-tap delay without disabling zoom.

**Scrollbars are part of the design.** `.scroll-thin` themes every scroll
container in **both** rendering engines, which are not alternatives: Firefox
implements only `scrollbar-width` / `scrollbar-color`, while Chromium and WebKit
also implement the pseudo-elements and let them win. The thumb is `faint` on a
transparent track, 9px wide, clipped inside a 2px transparent border, and
`::-webkit-scrollbar-button` is `display: none` so no OS arrows appear.

## Elevation & Depth

**This system has no shadow vocabulary.** Depth is tonal. Six named surface
tokens sit at different lightnesses and are separated by hairline rules; nothing
casts a shadow, nothing has a gradient, and nothing uses a blur or backdrop
filter.

There is exactly one exception, and it is the one element that genuinely floats
above the document: the recorder HUD pill carries
`box-shadow: 0 8px 24px var(--shadow-hud)`, where `--shadow-hud` is
`oklch(0.60 0.02 60 / 0.22)` in light (a warm, weak shadow suited to newsprint)
and `oklch(0.10 0.01 46 / 0.6)` in dark.

### Shadow Vocabulary

- **HUD lift** (`box-shadow: 0 8px 24px var(--shadow-hud)`): the recorder pill
  only. Not available to dialogs, popovers, cards or dropdowns.

### Named Rules

**The Flat Sheet Rule.** Surfaces are flat. If two regions need separating,
change the surface token or draw a hairline rule — never add a shadow. The HUD
is the single exception because it is the only element genuinely outside the
document plane.

**The Whitespace-Carries-The-Break Rule.** Because every rule token measures
under 1.5:1 and is texture rather than information, a boundary that must be
*seen* rather than read is carried by space. The feed's day heading takes 26px
of leading space so it beats the 22px pitch of the rows it groups, and a row
drops its bottom rule when it is last in a group. A hairline alone is not a
section break.

## Shapes

**Radius is zero.** Every button, input, card, chip, pill, tab, checkbox and
container has square corners. This is not a default that was never revisited;
it is the form language, and it is what makes hairline rules read as rules
rather than as outlines.

Two exceptions, both about people or life:

- **Speaker avatars** are `rounded-full` at 26px — the only circles in the
  interface. The dashboard rail's account mark is deliberately **not** one: it
  is a 26px square, because it files an account rather than showing a face.
- **The live recording dot** is `rounded-full` at 9px, in the HUD and in the
  header's in-flight readout. Its idle, paused, uploading and error counterparts
  are all 9px **squares**; the circle is what marks "live".

The 9px filled square is the system's universal state marker: it appears in the
status pill, the Record button, the Transcribe button, the audio player and the
HUD, and it always means the same thing — *this is the state of the thing beside
me.*

Borders are 1px hairlines in `rule` / `rule-2` / `rule-3` for structure and
`control-edge` for controls. Selection is a **2px left border**
(`border-l-2`) on the persona-rail tab, the dashboard's current nav item and the
active transcript segment — a printer's marginal rule, never an outline around
the whole element. Dividers inside a pill are 1px × 13–20px vertical spans, not
gaps.

The action-item checkbox is a bespoke 11px square: `appearance-none`, 1px
`faint` border, filling to `accent` on `:checked`.

## Components

### Buttons

- **Shape:** square (`0` radius), always.
- **Record (dashboard header):** `accent` fill, `on-accent` text, mono 10px /
  0.06em uppercase medium, 13px × 7px padding, with a 9px `on-accent` square
  marker. Hover goes to `accent-pressed`. **While a recording is in flight this
  button is replaced, not disabled** — by a read-only `role="status"` readout on
  a `control-edge` border carrying the live dot, the phase word, the elapsed
  clock in `tabular-nums`, and a pointer to where Stop lives. A greyed-out
  Record with no explanation is indistinguishable from a broken button.
- **Record pill (HUD):** `pane` background, 1px `control-edge`, 13px × 9px
  padding, 11px gap; a 9px accent square, "Record" in Bitter 600 at 13.5px, and
  the `⌘⇧R` shortcut in 9.5px mono `meta-4`.
- **Primary (Stop / Send / Transcribe):** `accent` fill or `raised` on a
  `control-edge` border, mono label at 9–10px / 0.06em uppercase, 8–13px × 5–7px
  padding.
- **Outline (Pause / Resume):** transparent on `pane` or `raised`, 1px
  `control-edge` — or `border-accent` when resuming, never `tint-hover` —
  `notice` / `accent-text` label, 8–9px × 5px.
- **Ghost (Discard / Dismiss):** no border, no fill, `rail-idle` label, 8px × 5px.
- **Quick action (persona rail):** `raised` fill, 1px `control-edge`, 8px × 6px,
  11.5px body text, left-aligned; hover lifts the fill to `paper`.
- **Pending ("Soon"):** the shape a planned-but-unbuilt control takes. 1px
  `rule-2` — **not** `control-edge`, because that token is the boundary of
  something you can operate and this is not — `cursor-not-allowed`, the label at
  `opacity-60`, and an 8.5px mono `muted` "Soon" badge at full strength pushed
  to the end with `ml-auto`. Used on Search, Import audio, Calendar,
  Collections, Sources and Settings.
- **Focus:** every interactive element carries
  `focus-visible:outline-2 outline-accent` with `outline-offset-1`, or
  `-outline-offset-2` where an element is flush to a container edge.
- **Disabled:** `disabled:text-faint` plus `disabled:cursor-not-allowed`;
  opacity is used only on a disabled control's label and on the login submit.

### Chips

- **Citation, filled:** `tint` background, `accent-text` label, mono 10px,
  5px × 1px padding, `mx-0.5`, `align-[1px]` so it sits on the prose baseline.
  Hover and `data-[active=true]` both go to `tint-hover`.
- **Citation, bare:** no fill; `accent-pressed` mono 10px with
  `hover:underline`. Used at the end of an action-item row where a filled chip
  would fight the row rule.
- Both carry `aria-pressed` and an `aria-label` naming the timestamp.

### Status pill (dashboard)

"Pill" is the name, not the shape: every edge is square and the marker is the
same 9px filled square used everywhere else. 1px `rule-2` frame — a decorative
frame, not a control edge — 7px × 2px padding, mono 9px / 0.14em uppercase.

- **Local:** `muted` frame and marker. The audio has not left the device.
- **Uploading:** `meta-3`.
- **Transcribing:** `tint` fill, `accent-text` label, `accent` marker.
- **Failed:** `live` frame, label and marker. The one status that will not
  change on its own, and the only one that earns a hue.
- **Completed:** **renders nothing.** A finished note is the resting state of
  the list, so a pill on almost every row is ink carrying no information. The
  column stays empty by default, which is what makes any pill in it mean "this
  note needs something".

Contrast was measured in-page in both themes: at 9px every label is small text,
so the bar is 4.5:1, not 3:1. `faint` (2.93:1 light / 3.10:1 dark) and `meta`
(4.37:1 dark) both failed and are not used here.

### Cards / Containers

- **Corner style:** square.
- **Per-speaker stat card:** `canvas` fill, 1px `rule-2` border, 11px × 10px
  padding, in a 3-column grid with a 9px gap.
- **Shadow strategy:** none. See Elevation & Depth.
- **Notice block:** `notice-bg` fill, `notice` text at 11.5px, 9px × 7px
  padding, no border.
- **The feed has no cards at all.** A day heading and a hairline are the only
  structure between rows.

### Inputs / Fields

- **Chat composer:** the border lives on the **wrapping form**, not the input —
  1px `control-edge` on `paper`, 10px × 8px padding, with
  `focus-within:border-accent`. The `<input>` itself is `bg-transparent` with
  `outline-none`, so focus is expressed on the container.
- **Placeholder:** `placeholder:text-placeholder`.
- **Checkbox:** 11px square, `appearance-none`, 1px `faint` border,
  `checked:bg-accent checked:border-accent`.
- **Login field:** 1px `control-edge` on `paper`, 12px × 8px padding.
  Deliberately plain — the designed auth surface is a separate pass.

### Navigation

- **Identity rail (dashboard):** a 212px `nav` on `rail`, right-bordered with
  `rule`, in three bands separated by `rule-3`. The head carries a 26px `tint`
  square holding two `accent-text` initials taken from the signed-in address —
  there is no display-name column, so the address is the identity — above that
  address in 9px mono. The nav band holds one live item ("All notes", a `Link`
  with `aria-current="page"`, `raised` fill, 2px `accent` left border, and a
  count with its own `aria-label` so it is not read as the tail of the item's
  name) and three Pending items. A scrolling jump list repeats at most **2 days
  × 5 notes** — it is a jump list, not a second copy of the feed. Settings sits
  at `mt-auto` above a `rule-3` top border.
- **Persona rail (Note Detail):** `role="tablist"` in a 136px column on `rail`,
  right-bordered with `rule`. Each tab is Bitter 600 at 14px, 11px × 8–9px
  padding, left-aligned, with a 2px left border. Selected: `accent` border,
  `paper` fill, `ink` text. Idle: transparent border, `rail-idle` text,
  `hover:bg-raised`. Group headings ("Lens", "Actions") are 8.5px mono at
  0.14em. A grounding footer sits at `mt-auto` above a `rule` top border.
- **Mobile treatment:** none defined; see Layout.

### Signature component — the feed row

A `Link`, not a div with a handler: the whole row is one target. Four tracks at
`62px / minmax(0,1fr) / 148px / 96px`, 14px gap, 24px gutter, 11px vertical
padding, a `rule-3` bottom border dropped on the last row of a group, and
`hover:bg-pane`. Track 1 is the time in 10.5px mono `meta-3` over the duration
in `muted`. Track 2 is the title in Bitter 600 at 15px, truncated, over an
optional 12.5px `muted` preview. Track 3 is the status pill. Track 4 is the
action and span counts in 9px mono `muted`, right-aligned.

**Tracks 3 and 4 are empty, not zeroed, on a healthy row** — no READY pill, no
"0 ACTIONS". Both keep their width so the four-track alignment never moves, and
their emptiness is the resting state that makes any mark in them meaningful.

### Signature component — the transcript segment

A `grid-cols-[26px_1fr]` row with a 2px left border, 9px × 10px vertical
padding, 14px left / 18px right padding. Idle the border is transparent; active
it becomes `accent` and the row fills with `seg-wash`. The 26px column holds the
circular speaker avatar; the fluid column holds the speaker name in that
speaker's hue at 12px, the timestamp in 9.5px mono `meta-4`, then the utterance
at 13px / 1.56 in `ink-2`. Clicking any citation chip anywhere in the note
scrolls this row to 56px below the pane header and marks it `aria-current`.

### Signature component — the recorder HUD

One pill, six mutually exclusive phases (idle, requesting, recording, paused,
stopping/uploading, error), each with its own border token, fill and 9px status
marker. The marker encodes state by *shape*: accent square (idle, uploading),
red circle (recording), hollow `faint` square with a 1.5px border (paused), red
square (error). The recording phase adds a seven-bar mic meter on a fixed
ladder — `[5,11,15,8,13,4,9]` px scaled by live level — tinted in three tiers
(`accent` / `tint-hover` / `waveform`) by bar height. Its `role="status"` and
`role="alert"` pills are not controls and keep `rule-2`.

**There is exactly one Stop.** The dashboard header's in-flight readout points
at it and does not duplicate it.

### Waveform

68 fixed-height bars, `1.5px` gap, 32px tall, in `waveform`, above a mono 9px
row showing `00:00`, the playhead in `accent-pressed`, and the duration. Heights
are precomputed constants — nothing in a render path calls `Math.random()` or
`Date.now()`.

## Do's and Don'ts

### Do:

- **Do** resolve every colour through a `var()` into `app/globals.css` and use
  the generated Tailwind utilities (`bg-paper`, `text-ink-2`, `border-rule`).
- **Do** define every new token twice — once on `:root`, once on `.dark` **and**
  inside the `@media (prefers-color-scheme: dark) { :root:not(.light) }` block.
  Skipping the media block breaks system-preference users; skipping `.dark`
  breaks the toggle.
- **Do** use `border-control-edge` for the boundary of anything operable and
  `border-rule-2` for a decorative frame, and keep the two apart.
- **Do** keep radius at `0` for every surface and control.
- **Do** use the 9px filled square as the state marker, and reserve the circle
  for a person's avatar and for "live".
- **Do** use mono, uppercase and ≥0.06em letterspacing for every label under
  11px.
- **Do** express selection as a 2px left border plus a wash fill.
- **Do** express focus as `outline-2 outline-accent` on `focus-visible`, offset
  `1` normally and `-2` when flush to a container edge.
- **Do** carry `tabular-nums` on any column of figures.
- **Do** leave a track empty rather than filling it with a zero or a
  normal-state label, and keep its width so the grid does not move.
- **Do** keep the "Soon" badge on a disabled control at full `muted`, dimming
  only the label.
- **Do** measure contrast against the surface a thing actually sits on, in both
  themes, against the built CSS.
- **Do** keep 24px clear of the bottom-right corner and end bottom-anchored
  scroll regions 72px above it, reading both from the exported HUD constants.
- **Do** map runtime-varying colours through a static lookup table, because
  Tailwind cannot build class names at runtime.
- **Do** use `text-pretty` on the title, the summary, takeaways and transcript
  prose.

### Don't:

- **Don't** write `oklch()`, hex, `rgb()` or `hsl()` anywhere in `components/`
  or `lib/`. A convention test fails the build if you do.
- **Don't** use `border-tint-hover` on a control — it measures 1.15:1 against
  the `tint` it sits on. Use `border-accent`. And don't darken `--tint-hover` to
  make it work; it is the citation chip's hover fill.
- **Don't** use `bg-canvas` as a control fill. In the dark theme it resolves to
  the same value as `paper`, so the control has no fill at all.
- **Don't** add a shadow. The HUD's `--shadow-hud` is the only one, and it is
  not available to other components.
- **Don't** add a border radius to anything that is not a person's avatar or the
  live-recording dot.
- **Don't** add a fourth typeface, or use Bitter for prose or Archivo for a
  label.
- **Don't** introduce a second accent hue, a link blue, a destructive red, or a
  warning amber. Use `accent`, a speaker hue, `live`, or `notice` on
  `notice-bg`.
- **Don't** spend the accent on a passive tally, a count, or anything the user
  cannot act on.
- **Don't** use pure white or pure black for any surface or ink.
- **Don't** put an explanation in a `title` attribute on a disabled control —
  browsers suppress its pointer events and the tooltip never renders. Use a
  visible badge.
- **Don't** show a control that looks live and does nothing, and don't grey out
  a control the user has just pressed without saying what happened instead.
- **Don't** render a UI region for a capability that does not exist yet — the
  dashboard's two columns are two columns because the drawn third held four
  widgets with no backend behind them.
- **Don't** rely on a hairline rule alone to carry a section break; every rule
  token is under 1.5:1 and is texture. Use space.
- **Don't** call `Math.random()` or `Date.now()` in a render path.
