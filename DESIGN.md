---
name: "Unconfirmed — working name \"Squid Ink\", internal only"
description: "Bot-free AI meeting notepad. The product name is an open decision, not a brand commitment — see Overview → Naming."
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
  headline:
    fontFamily: "Bitter, Georgia, serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "normal"
  title:
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
  body-dense:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.56
    letterSpacing: "normal"
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "8.5px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.16em"
  meta:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "9px"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "0.14em"
  numeral:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.01em"
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
  gutter: "18px"
  pane-gutter: "26px"
components:
  button-record:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    padding: "9px 13px"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "5px 9px"
  button-primary-hover:
    backgroundColor: "{colors.accent-pressed}"
    textColor: "{colors.on-accent}"
  button-outline:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.notice}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "5px 8px"
  button-ghost:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.rail-idle}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "5px 8px"
  chip-citation:
    backgroundColor: "{colors.tint}"
    textColor: "{colors.accent-text}"
    typography: "{typography.meta}"
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
  tab-lens:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.rail-idle}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    padding: "8px 11px 9px"
  tab-lens-selected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  card-stat:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    padding: "10px 11px"
  avatar-speaker:
    backgroundColor: "{colors.speaker-1-avatar}"
    textColor: "{colors.speaker-1}"
    rounded: "{rounded.full}"
    size: "26px"
---

# Design System: Unconfirmed (working name "Squid Ink")

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

The one place the system permits softness is the human: speaker avatars are the
only circles in the product, and per-speaker hues (blue, green, amber) are the
only colours outside the accent family. People get rounded corners. Nothing else
does.

**Key Characteristics:**

- Warm-neutral duotone: newsprint cream (light) / espresso (dark), never white, never black
- Zero border radius on every surface, control and container — circles only for people
- Hairline rules and flat tonal layering instead of shadows
- One accent hue (forest green), used sparingly and always meaning "grounded in the source"
- Micro-typography: 8.5–10px letterspaced uppercase mono for all metadata
- Odd-number spacing rhythm (5 / 7 / 9 / 11 / 13 / 18 / 26px), tuned by eye rather than to a 4px grid

### Naming (open decision)

**The product name is unconfirmed.** "Squid Ink" is a working name used
internally only. It is recorded here as an open decision, **not** a confirmed
brand name, and it is **not** a brand commitment. No name string appears in
user-facing copy or in application code; the only exception is the
`package.json` `name` field. Until a name is confirmed, this design system
imposes no wordmark, no logotype, and no brand-colour obligation.

## Colors

A warm duotone with one accent. Every token is defined twice in
`app/globals.css` — once on `:root` for light, once on `.dark` and again inside
`@media (prefers-color-scheme: dark) { :root:not(.light) }` — and exposed to
Tailwind through `@theme inline`. The frontmatter above carries the **light**
values as canonical; the dark counterparts are listed inline below.

### Primary

- **Press Green** (`oklch(0.452 0.148 146)` light / `oklch(0.82 0.15 140)` dark)
  — token `accent`. The only saturated colour in the interface. It marks the
  active transcript segment's left border, the record indicator, the takeaway
  numerals, the persona-rail selection border, and the primary button fill. It
  always means *this is anchored to the source recording*.
- **Press Green Pressed** (`oklch(0.402 0.138 146)` / `oklch(0.86 0.15 142)`) —
  token `accent-pressed`. Active/pressed states and bare citation timestamps.
- **Press Green Text** (`oklch(0.352 0.130 146)` / `oklch(0.86 0.15 142)`) —
  token `accent-text`. Green text sitting on a green tint, where the accent
  itself would not carry contrast.
- **Bleached Green** (`oklch(0.978 0.024 140)` / `oklch(0.18 0.05 140)`) — token
  `on-accent`. The only text colour permitted on an accent fill.

### Secondary — the green wash family

- **Ink Wash** (`oklch(0.905 0.064 142)` / `oklch(0.30 0.06 140)`) — token
  `tint`. Inline citation chip background.
- **Ink Wash Deep** (`oklch(0.858 0.098 142)` / `oklch(0.42 0.09 140)`) — token
  `tint-hover`. Citation hover and active, and the mid tier of the mic meter.
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

### Neutral — six surfaces, three rules, five inks

Surfaces, lightest to heaviest in the light theme: **Newsprint** (`paper`,
`0.979`), **Dock Cream** (`dock`, `0.960`), **Raised Cream** (`raised`,
`0.960`), **Canvas** (`canvas`, `0.948`), **Rail Grey** (`rail`, `0.922`),
**Pane Grey** (`pane`, `0.922`). The dark theme deliberately re-orders these:
`rail` becomes the *darkest* surface (`0.155`) while `raised` becomes the
lightest (`0.235`), because depth reads inverted under a lamp.

Rules: **Rule** (`0.856` / `0.30`), **Rule 2** (`0.870` / `0.32`), **Rule 3**
(`0.898` / `0.27`) — three hairline weights for structural, secondary and
list-row dividers respectively.

Inks: **Ink** (`0.226` / `0.93`) for headings and primary text, **Ink 2**
(`0.300` / `0.88`) for transcript and chat prose, then **Muted** (`0.500`),
**Meta** (`0.530`), **Faint** (`0.660`) for the metadata ladder. **Notice**
(`0.415` / `0.78`) on **Notice BG** (`0.898` / `0.235`) carries warnings without
introducing an alert colour.

### Alert

- **Live Red** (`oklch(0.520 0.170 25)` light / `oklch(0.66 0.19 25)` dark) —
  token `live`. Reserved for the recording dot and the recorder error marker.
  The light value is derived, not lifted from a design file; recorded as such in
  `docs/KNOWN_GAPS.md`.

### Named Rules

**The One Ink Rule.** There is exactly one accent hue. A new colour is added
only when a state genuinely cannot be expressed in green, warm neutral, or a
speaker hue — which has happened once, for `live`. Do not introduce a blue for
links, a red for destructive actions, or an amber for warnings; `notice` on
`notice-bg` is the warning treatment.

**The No-Literal Rule.** `app/globals.css` is the only file in the repository
permitted to name a colour. Zero `oklch()`, hex, `rgb()` or `hsl()` may appear
in `components/` or `lib/`; a convention test fails the build if one does.
Runtime-varying colours (per-speaker) map through the static lookup in
`components/note-detail/speaker-colors.ts`, because Tailwind cannot build class
names at runtime.

**The Never-White Rule.** No surface is `#fff` and no ink is `#000`. Light
tops out at `0.979` lightness with `0.011` chroma; dark bottoms out at `0.185`
with `0.014` chroma. The warm hue (62–88°) is carried through every neutral.

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

- **Display** (Bitter 500, 29px, 1.14, -0.012em): the note title, once per
  screen. Uses `text-pretty`.
- **Headline** (Bitter 600, 16px, 1.25): pane headers — "Transcript".
- **Title** (Bitter 600, 14px, 1.25): persona-rail lens tabs, speaker names in
  the per-speaker cards, and the record pill's word "Record" (13.5px).
- **Body** (Archivo 400, 14.5px, 1.66): summary prose. The most generous
  line-height in the system, because it is the one paragraph anyone reads
  straight through. Uses `text-pretty`.
- **Body Dense** (Archivo 400, 13px, 1.55–1.56): transcript segments, chat
  exchange, action-item rows (13.5px), quick-action buttons (11.5px).
- **Label** (Plex Mono 400, 8.5px, 0.16em, uppercase): section rules
  ("SUMMARY", "ACTION ITEMS") and rail group headings, at 0.14em.
- **Meta** (Plex Mono 400, 9–10px, 0.06–0.14em, often uppercase): timestamps,
  turn counts, owner/due columns, citation chips (10px), speaker times (9.5px),
  the grounding footer.
- **Numeral** (Plex Mono 500, 16px, -0.01em): the recorder's elapsed clock. The
  only large monospace in the product.

### Named Rules

**The Two-Voice Rule.** Bitter names things; Archivo says things; Plex Mono
files things. A serif in a paragraph or a grotesque in a label is a mistake, not
a variation. No fourth face is added.

**The Slug Rule.** Every label under 11px is monospace, uppercase and
letterspaced at 0.06em or wider. Below 11px, letterspacing is what keeps the
glyphs apart; a tight 9px label is unreadable regardless of contrast.

**The Tabular Rule.** Any column of numbers — owner, due, talk time, filler
counts — carries `tabular-nums`. Ragged numerals in a scannable column defeat
the column.

## Layout

The Note Detail screen is a fixed three-column grid filling the viewport:
`grid-cols-[136px_minmax(0,1fr)_404px]` at `h-dvh`. Left is the persona rail
(fixed 136px), centre is the note (fluid, `minmax(0,1fr)` so long words cannot
blow out the track), right is the transcript pane (fixed 404px). The centre and
right columns scroll independently; the page itself never scrolls.

Gutters are asymmetric and deliberate: the note column uses a 26px gutter, the
transcript pane 18px, and the rail 11–12px. Density increases as you move right,
because the transcript is scanned rather than read.

Spacing does not follow a 4px grid. The rhythm is an odd-number ladder —
5, 7, 9, 11, 13, 15, 18, 22, 26px — set by eye against the type sizes. Tailwind
arbitrary values (`pt-[15px]`, `gap-[9px]`) are used throughout rather than
rounding to the nearest scale step.

The recorder HUD is fixed at `right-6 bottom-6` with `z-50`, above everything,
mounted once in the root layout so it survives navigation. The theme toggle sits
at `right-3 bottom-3` with `z-10`, deliberately beneath the HUD.

There is currently **no responsive treatment**: the grid is fixed-column at all
widths and the product assumes a desktop viewport. `touch-action: manipulation`
is set on buttons, inputs and tabs to kill the 300ms double-tap delay without
disabling zoom.

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

## Shapes

**Radius is zero.** Every button, input, card, chip, pill, tab, checkbox and
container has square corners. This is not a default that was never revisited;
it is the form language, and it is what makes hairline rules read as rules
rather than as outlines.

Two exceptions, both about people or life:

- **Speaker avatars** are `rounded-full` at 26px — the only circles in the
  interface.
- **The live recording dot** is `rounded-full` at 9px. Its idle, paused and
  uploading counterparts are all 9px **squares**; the circle is what marks
  "live".

Borders are 1px hairlines in `rule` / `rule-2` / `rule-3`. Selection is a **2px
left border** (`border-l-2`) on the persona-rail tab and the active transcript
segment — a printer's marginal rule, never an outline around the whole element.
Dividers inside the HUD are 1px × 20px vertical spans, not gaps.

The action-item checkbox is a bespoke 11px square: `appearance-none`, 1px
`faint` border, filling to `accent` on `:checked`.

## Components

### Buttons

- **Shape:** square (`0` radius), always.
- **Record pill:** `pane` background, 1px `rule` border, 13px × 9px padding,
  11px gap; a 9px accent square, "Record" in Bitter 600 at 13.5px, and the
  `⌘⇧R` shortcut in 9.5px mono `meta-4`.
- **Primary (Stop / Send link):** `accent` fill, `on-accent` text, mono label at
  9px / 0.06em uppercase, 9px × 5px padding, no border.
- **Outline (Pause / Resume):** transparent on `pane`, 1px `rule-2` (or
  `tint-hover` when resuming), `notice` / `accent-text` label, 8–9px × 5px.
- **Ghost (Discard / Dismiss):** no border, no fill, `rail-idle` label, 8px × 5px.
- **Quick action (rail):** `raised` fill, 1px `rule-2`, 8px × 6px, 11.5px body
  text, left-aligned; hover lifts the fill to `paper`.
- **Focus:** every interactive element carries
  `focus-visible:outline-2 focus-visible:outline-offset-1 outline-accent`.
  Inset variants (`-outline-offset-2`) are used where an element is flush to a
  container edge.
- **Disabled:** `disabled:text-faint` plus `disabled:cursor-not-allowed`;
  opacity is used only on the login submit (`disabled:opacity-60`).

### Chips

- **Citation, filled:** `tint` background, `accent-text` label, mono 10px,
  5px × 1px padding, `mx-0.5`, `align-[1px]` so it sits on the prose baseline.
  Hover and `data-[active=true]` both go to `tint-hover`.
- **Citation, bare:** no fill; `accent-pressed` mono 10px with
  `hover:underline`. Used at the end of an action-item row where a filled chip
  would fight the row rule.
- Both carry `aria-pressed` and an `aria-label` naming the timestamp.

### Cards / Containers

- **Corner style:** square.
- **Per-speaker stat card:** `canvas` fill, 1px `rule-2` border, 11px × 10px
  padding, in a 3-column grid with a 9px gap.
- **Shadow strategy:** none. See Elevation & Depth.
- **Notice block:** `notice-bg` fill, `notice` text at 11.5px, 9px × 7px
  padding, no border.

### Inputs / Fields

- **Chat composer:** the border lives on the **wrapping form**, not the input —
  1px `rule` on `paper`, 10px × 8px padding, with `focus-within:border-accent`.
  The `<input>` itself is `bg-transparent` with `outline-none`, so focus is
  expressed on the container.
- **Placeholder:** `placeholder:text-placeholder`.
- **Checkbox:** 11px square, `appearance-none`, 1px `faint` border,
  `checked:bg-accent checked:border-accent`.
- **Login field:** 1px `rule` on `paper`, 12px × 8px padding. Deliberately plain
  — the designed auth surface is a separate pass.

### Navigation

- **Persona rail (lens tabs):** `role="tablist"` in a 136px column on `rail`,
  right-bordered with `rule`. Each tab is Bitter 600 at 14px, 11px × 8–9px
  padding, left-aligned, with a 2px left border. Selected: `accent` border,
  `paper` fill, `ink` text. Idle: transparent border, `rail-idle` text,
  `hover:bg-raised`. Group headings ("Lens", "Actions") are 8.5px mono at
  0.14em. A grounding footer sits at `mt-auto` above a `rule` top border.
- **Mobile treatment:** none defined; see Layout.

### Signature component — the transcript segment

The clearest expression of the system. A `grid-cols-[26px_1fr]` row with a 2px
left border, 9px × 10px vertical padding, 14px left / 18px right padding. Idle
the border is transparent; active it becomes `accent` and the row fills with
`seg-wash`. The 26px column holds the circular speaker avatar; the fluid column
holds the speaker name in that speaker's hue at 12px, the timestamp in 9.5px
mono `meta-4`, then the utterance at 13px / 1.56 in `ink-2`. Clicking any
citation chip anywhere in the note scrolls this row to 56px below the pane
header and marks it `aria-current`.

### Signature component — the recorder HUD

One pill, six mutually exclusive phases (idle, requesting, recording, paused,
stopping/uploading, error), each with its own border token, fill and 9px status
marker. The marker encodes state by *shape*: accent square (idle, uploading),
red circle (recording), hollow `faint` square with a 1.5px border (paused), red
square (error). The recording phase adds a seven-bar mic meter on a fixed
ladder — `[5,11,15,8,13,4,9]` px scaled by live level — tinted in three tiers
(`accent` / `tint-hover` / `waveform`) by bar height.

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
- **Do** keep radius at `0` for every surface and control.
- **Do** use mono, uppercase and ≥0.06em letterspacing for every label under
  11px.
- **Do** express selection as a 2px left border plus a wash fill.
- **Do** express focus as `outline-2 outline-offset-1 outline-accent` on
  `focus-visible`.
- **Do** carry `tabular-nums` on any column of figures.
- **Do** map runtime-varying colours through a static lookup table, because
  Tailwind cannot build class names at runtime.
- **Do** use `text-pretty` on the title, the summary, takeaways and transcript
  prose.

### Don't:

- **Don't** write `oklch()`, hex, `rgb()` or `hsl()` anywhere in `components/`
  or `lib/`. A convention test fails the build if you do.
- **Don't** add a shadow. The HUD's `--shadow-hud` is the only one, and it is
  not available to other components.
- **Don't** add a border radius to anything that is not a person's avatar or the
  live-recording dot.
- **Don't** add a fourth typeface, or use Bitter for prose or Archivo for a
  label.
- **Don't** introduce a second accent hue, a link blue, a destructive red, or a
  warning amber. Use `accent`, a speaker hue, or `notice` on `notice-bg`.
- **Don't** use pure white or pure black for any surface or ink.
- **Don't** call `Math.random()` or `Date.now()` in a render path.
- **Don't** put a product name — working or otherwise — in user-facing copy or
  application code. The name is an open decision; see Overview → Naming.
