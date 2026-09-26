# Product

<!-- impeccable:product-schema 1 -->

Confirmed with the founder 2026-09-25 (issue #44). Deeper records:
`docs/DECISIONS.md` (what is locked), `docs/ROADMAP.md` (scope),
`CONTEXT.md` (the words), GitHub Issues (what is open).

## Platform

web

## Users

**Primary: the founder and five to seven people they know personally**, using
it for their own real meetings. Every design choice serves this group first.
Squid Ink is a real application, built and held to the standard of one, even
while its users are few.

**Secondary: visitors to the demo**, reached from the Squid Ink case study on
tekguyz.com. They see the same app with sample data. They are served by the
real app working well, not by a separate showcase.

The job: sit in a meeting without taking notes, then leave with a structured
record — summary, takeaways, action items — that can be questioned later.

## Product Purpose

A bot-free AI meeting notepad. It records a meeting on the user's own device,
transcribes it, and turns the transcript into a structured note the user can
question. It exists to save its users hours of meeting work each week: nobody
writes notes, and the to-dos come out already listed.

It is a remake of the founder's earlier app (`tekguyz/crispy-bacon`). Only that
app's feature list and philosophy carry over; its code, look and brand do not.

Commercial future is undecided and not relevant now. It may gain clients; no
pricing is being designed.

## Positioning

In the same space as Granola, and meant to be better.

- **No bot joins the call.** Audio is captured in the browser from the system,
  the mic, or both.
- **Personas change what the note says, not only its length.** A persona
  bundles a lens (whose expertise frames the analysis) and a depth (Brief,
  Dense or Exhaustive, which changes scope), plus its quick actions.
- **Every claim can be traced.** Citations link a line in the note back to the
  transcript segment it came from.
- **Ask your notes.** Chat over one note or across all of them, using
  retrieval over stored chunks.

## Operating Context

Used on a desktop browser during and after live meetings. The record HUD
stays close while a meeting runs; the full app is where the note is read,
questioned and organised. Notes are grouped into collections, by hand or by
rules, and tagged.

Accounts are created by hand. Public signup is closed permanently
(`docs/DECISIONS.md` § Auth). Strangers see the app only through demo mode.

## Capabilities and Constraints

**Built:** recorder (system/mic), transcription with speaker labels, note
generation under a persona, citations, ask-your-notes chat, personas
(editable depth, quick actions, default lens), collections with auto-file
rules and needs-review, tags, settings, onboarding, email + password sign-in.

**Planned, not built:** calendar sync and import from Drive (connected later,
never at sign-in — `docs/ROADMAP.md`), share links with guest controls, a live assistant
(silent by default, speaks only when asked), speaker tags with real names,
action-item details, export, webhooks, an MCP bridge, PII redaction, a PWA
shell. Status lives in GitHub Issues, not here.

**Demo mode (issue #19):** sample meetings only, no live recording, chat
capped at 10 questions per visitor, everything else read-only. The write
blocks, chat caps and three demo notes exist; the `/demo` entry does not yet.

**Out of scope:** payments; teams, workspaces or seats (single-owner,
indefinitely); native desktop shells and OS-wide hotkeys; on-device
transcription.

**Words:** use the terms in `CONTEXT.md` — note, persona, lens, depth,
citation, collection. Never "meeting" for a note, never "template" for a
persona.

## Brand Commitments

- The name is **Squid Ink**, locked 2026-09-07.
- Philosophy carried from the earlier app: **dense over noisy, truth-first,
  no AI fluff.** Copy states what happened; it does not hype.
- Nothing of the earlier app's look, logo or copy carries over.
- The existing visual system is `DESIGN.md`. This file does not restate it.

## Evidence on Hand

- Three demo notes: `lib/demo/demo-note-1.json` (from a real clip,
  `lib/demo/demo-note-1.mp3`, run through the real pipeline),
  `demo-note-2.json`, `demo-note-3.json`.
- The design reference: `design-reference/App Surfaces.dc.html` and
  `design-reference/Note Detail.dc.html`.

**Absent, and must not be invented:** testimonials, user counts, measured
time saved, customer logos, press, pricing. "Saves hours a week" is the
founder's stated purpose, not a measured figure — never print it as one.

## Product Principles

1. **The founder's daily use comes first.** If it is good to use every day,
   the demo proves itself.
2. **Truth over polish.** Every generated claim should point back to its
   source. The product never overstates what it did.
3. **Dense, not noisy.** Show more that matters, not more decoration.
4. **A real application, at any size.** Security, accessibility and quality
   are not deferred because the user count is small.

## Accessibility & Inclusion

**WCAG 2.2 AA is the floor on every screen, in both themes.** It is a
minimum, never the target to stop at; aim higher wherever the design allows.

Colour tokens get a close check every time a theme, token or colour changes —
during the work and again when it is done. Contrast is measured against the
surface a thing actually sits on, in the built CSS
(`.claude/rules/design-tokens.md`). Keyboard use, focus visibility and 24px
minimum tap targets are part of the same floor.
