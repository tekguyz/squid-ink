---
paths:
  - "app/globals.css"
  - "components/**"
  - "lib/**"
  - "scripts/verify-layout.mjs"
---

# Colour tokens

The hard rule is in `CLAUDE.md` § Colour: **every colour is a `var()` into
`app/globals.css`; zero `oklch()`, hex, `rgb()` or `hsl()` anywhere in
`components/` or `lib/`.** This file is the detail behind it.

`app/globals.css` is the only file that names a colour. It defines each token
twice — light on `:root`, dark on `.dark` and again inside
`@media (prefers-color-scheme: dark) { :root:not(.light) }` — and exposes them to
Tailwind through `@theme inline`. Components use the generated utilities
(`bg-paper`, `text-ink-2`, `border-rule`) and never know which theme is active.

Tailwind cannot build class names at runtime, so per-speaker colours map through
the static lookup in `components/note-detail/speaker-colors.ts`. Mock data carries
a token *name* (`speaker-1`), never a colour value.

The guard in `components/note-detail/__tests__/project-conventions.test.ts` fails
the build if a colour literal appears in `components/` or `lib/`.

## `canvas` is not a button fill

In dark theme `--canvas` and `--paper` resolve to the same value, so a control
filled with `bg-canvas` on a `bg-paper` sheet has no fill at all — measured
2026-09-01, and the reason `audio-player.tsx` and `transcribe-button.tsx` both
moved to `bg-raised`, which is what DESIGN.md § Components → Buttons specifies
anyway. Two tokens looking distinct in light theme is not evidence they differ in
dark; check both.

## `--control-edge` vs `--rule-2`

**`--control-edge` is the boundary of an INTERACTIVE control; `--rule-2` is
the edge of a decorative frame. Do not use one for the other, and do not
"fix" either on a single component.** The split shipped 2026-09-05 and was the
second of the three options `docs/KNOWN_GAPS.md` § "Framed controls sit at
~1.4:1" laid out — the entry is now RESOLVED and carries the measurements.
`--control-edge` clears WCAG 1.4.11's 3:1 against **every sheet a control sits
on**, worst case 3.34:1 light (`rail`/`pane`) and 3.44:1 dark (`raised`);
`--rule-2` stays at ~1.4:1 on the insight cards, the status pills and the
transcript pane, deliberately.

Contrast is measured against the sheet a thing actually sits on, never against
`paper` alone — `rail` and `raised` are the worst cases in the two themes and
neither is `paper`. Verify against the **built** CSS, not the source: Tailwind
emits a hex fallback beside the `oklch()`, and the fallback is what a browser
without `lab()` renders.

`record-hud`'s `role="status"` and `role="alert"` pills are not controls and
keep `rule-2`.

## One focus idiom, inputs included

**Focus is a 2px `outline-accent` outline on `:focus-visible` — buttons and
inputs alike. Never a border colour change.** Issue #9, 2026-09-24: six framed
inputs (chat, the four collection fields, tag entry) showed focus as
`focus-within:border-accent` on a 1px frame, a weaker indicator than the
buttons' outline. A framed input keeps `outline-none` on the `<input>` and
draws the outline on its FRAME with
`has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-1 has-[input:focus-visible]:outline-accent`
— keyed to the input, not `focus-within`, so a mouse click on a button
inside the frame does not light the frame too. Every frame uses `outline-offset-1`; elsewhere the offset
varies by geometry (`-2` on buttons in a tight row, `4` on the seek bar),
the colour and width do not. `persona-step.tsx` uses the broader
`has-focus-visible:` on its radio cards, which is right there: the card holds
nothing else focusable. `project-conventions.test.ts` fails on any `focus-within:border-` and on
any `outline-none` file without the frame outline.

## The accent family splits the same way

**`border-accent` is a control edge; `bg-tint-hover` is a fill;
`border-tint-hover` is neither and is no longer used on a control.** Measured the
same day: `tint-hover` against the `tint` fill it sits on is 1.15:1 light, so the
hover border on the Transcribe and audio-player buttons was very nearly not
drawn. All three accent-edged controls — those two plus `record-hud`'s Resume —
now use `border-accent`, at 5.28:1 worst case light and 8.03:1 dark. **Do not
darken `--tint-hover` to "fix" a border**: it is the hover and active FILL under
`citation-chip` and `cite-runs`, and `accent-text` sits on it.

## Three single-job tokens (issue #22, 2026-09-26)

Each is a lightness step inside an existing family, and each has ONE job. Do
not reuse one for anything else. All numbers below were measured by
`scripts/verify-layout.mjs` (via `scripts/layout-contrast.mjs`) in real
Chrome, against the BUILT CSS and the sheet each element really sits on, in
both themes. The script prints them as `note:` lines and asserts the bands.

**`--ink-disabled`** — the label of a disabled or `aria-disabled` control.
Nothing else. Never an `opacity-*` fade, never `faint` or `muted` standing in:
`project-conventions.test.ts` fails on `disabled:`/`aria-disabled:` with any
of those (proved red on 7 files first). A disabled control's frame drops
from `control-edge` to `rule-2`; a filled button that is unavailable drops to
`bg-raised`. A BUSY button (`aria-busy`, just pressed) is not unavailable: it
keeps its fill. A disabled control that is **selected**
(`aria-selected`/`aria-pressed`/`aria-checked`) keeps its selected look — it
reports an answer. The "Soon" badge stays full `muted`. 3.08–3.67:1 light,
3.03–3.55:1 dark (worst case dark is `raised`, e.g. an unavailable filled
button; the shipped routes measured 3.17–3.54); asserted 3.0–3.7:1. WCAG exempts inactive controls,
so this band is a design choice: readable, visibly below `muted`, plainly off.

**`--live-tint`** — the fill of the Failed status pill. Nothing else; the
frame, label and marker stay `live`. `live` on it: 4.93:1 light, 4.78:1 dark
as Chrome paints it (WCAG 1.4.3 for 9px text). The `DERIVED` annotation in
`globals.css` holds the oklch computation, 4.92 light, which
`check-docs.mjs` recomputes. The `live` frame: at least 4.78:1
against the fill and the row. The fixture owner has no Failed note, so the
layout script plants one — the shipped classes — in a real Dashboard row.
The HUD's `role="alert"` error pill is not a status pill and keeps `bg-pane`.

**`--rule-strong`** — a structural seam, nothing else: rail to main (every
screen's rail), main to side pane (note transcript pane, collection rule
panel), page and pane header bottoms, and the top of a dock or footer bar.
Row dividers, table rows, card frames and pill frames keep
`rule`/`rule-2`/`rule-3`. Measured 1.91–2.27:1 light, 1.98–2.20:1 dark, on
both sides of each seam; asserted 1.8–2.6:1 — above `rule` (~1.46), below
`--control-edge` (~3.3), so a seam never reads as a control. No WCAG bar
applies.

`--ink-disabled` and `--rule-strong` carry no WCAG criterion the `DERIVED`
annotation can name, so their values sit in `check-docs.mjs`'s `DERIVED` map
and in `docs/KNOWN_GAPS.md` § "Token gaps from Dashboard critique". Change a
value and all three places move together.

## The metadata ladder clears 4.5:1 everywhere (issue #65, 2026-09-26)

`muted`, `meta`, `meta-2`, `meta-3`, `meta-4` and `meta-5` colour 8.5–10px
mono labels, so every one owes WCAG 1.4.3's 4.5:1 on **every** sheet it can
sit on, in both themes. Before #65, light `meta*` (0.530) measured 4.20:1 on
`rail`/`pane` and dark `meta` (0.58) 3.90:1 on `raised`. Now light `meta`,
`meta-2`, `meta-4`, `meta-5` are 0.505 (DERIVED, 4.68:1 against `rail`) and
dark `meta` and `meta-4` take `meta-2`'s design value 0.62 (4.59:1 against
`raised`). `scripts/layout-contrast.mjs` measures every visible element that
paints its own text in a ladder token, against its real background, on every
route in both themes, and fails under 4.5:1 — proved red on `main` first.
Measured after: 4.66–6.88:1 light, 4.58–7.22:1 dark. **Do not lighten a
ladder token to "restore the step"** without re-running that check.
