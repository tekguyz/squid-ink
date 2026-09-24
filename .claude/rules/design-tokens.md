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
