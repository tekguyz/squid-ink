---
paths:
  - "components/**"
  - "app/**"
  - "scripts/verify-layout.mjs"
---

# Screen-level layout proof

**Every other check in this repo is file-shaped; this class of defect is
screen-shaped.** `npm run test:unit` renders in jsdom, which has no layout engine, so
every rect there is zeros. `project-conventions.test.ts` reads source text.
The impeccable detector lints class strings. All three are correct and all
three are blind to two files that are each right alone and wrong on the same
pixels.

`scripts/verify-layout.mjs` is the check that is not. It drives the Chrome
already installed over the DevTools Protocol — **no new dependency**, using
Node's built-in `WebSocket` — signs in by password as the RLS fixture owner
(`@supabase/ssr` writes the cookies, the script hands them to Chrome), and
measures real boxes on `/` and a real note at 1440px and 1280px, in **both
themes**, six assertions each:

- no two fixed elements overlap,
- no fixed element covers flow text,
- every fixed element is inside the viewport,
- no horizontal page overflow,
- every scroll container is themed in **both** rendering engines
  (`scrollbar-width` AND `::-webkit-scrollbar`),
- no OS arrow buttons on any scrollbar.

**On the note route only, a seventh: every citation chip has a 24px tap
target** (issue #10, 2026-09-24). The chip grows its target with an invisible
`::before`, which no rect can see, so the probe hit-tests instead: a point
11.5px above, below, left and right of each chip's centre — half a pixel inside
a 24px box — must land on a chip.
A chip an overlay covers, or whose grown area a scroll container clips, is
skipped; zero chips measured is a failure, not a pass. A point landing on a
NEIGHBOUR chip on the next line counts as a hit and prints a `note:` line —
that overlap is allowed but visible. Proved red before the fix: 18px box,
2/4 misses.

It was proved to fail before it was trusted: restoring `theme-toggle.tsx` to
its original `right-3 bottom-3` turns 48 green into 40 green and 8 failures
naming both colliding elements. A layout assertion nobody has watched fail is
an assertion about a walk nobody watched — the same reasoning
`project-conventions.test.ts` states about its own file walk.

**Flow text is measured by what its scroll containers leave visible**, not by
its raw box (issue #5, 2026-09-23). A Dashboard row scrolled out of its list
still has a full bounding box, and used to "collide" with the HUD. Proved both
ways on a synthetic page in headless Chrome: rows scrolled off under a fixed
box — old probe 3 hits, new probe 0; visible rows under the same box — 2 hits
in both.

**When sign-in lands on no note link, the script prints the page URL and saves
its HTML to the OS temp dir** (issue #6, 2026-09-23). Read the dev server log
beside it: when the HTML is Next's error page, the cause is only in the log.
The file can hold the fixture owner's note text and is not deleted.

**Before it signs in, it measures the landing page** (issue #60): `/` with no
session at all five widths, both themes — the same assertions, plus the page
is the landing page and not a redirect, it offers no Record control, and its
specimen's citation chips (links there, not buttons) have 24px targets.

**Then it signs in again as a demo visitor** (issue #19) — anonymously, as
the demo button does — and measures `/`, demo note 1, `/personas`,
`/collections` and `/settings` with the same assertions, plus: the demo banner
is on the page, the document is no taller than the viewport (the banner sits
in flow and every signed-in screen is `h-app`), and every screen but
Collections shows `ink-disabled`. Proved red first: it caught the HUD's
turned-off Record painting its grey on a child span, and a `rule-strong` line
under the banner at 1.51:1 against `tint` in dark. Each run is one real visit.

Widths are `1440` and `1280` on every route. **Every signed-in route is also
measured at `1024`, `768` and `390`**: `/` since the Dashboard's stacked layout
shipped 2026-09-15, and the note, `/personas`, `/collections` (index and
detail) and `/settings` since issue #23. `NARROW_WIDTHS` in the script lists
them; a note and a collection are keyed by kind (`note`, `collection`) because
their URLs carry ids, and `narrowWidthsFor` maps a route to its list. The demo
pass uses the same map. Add a route there when its breakpoints ship, not
before.

**Two pane states on the note route (issue #23)**, driven by pressing the
same buttons a reader does, then put back — the choice is saved in the
browser, and every later route would inherit it:

- **1440px, both panes hidden.** Asserts both fold to 28px strips, then runs
  every assertion above in both themes.
- **768px, transcript overlay open.** Asserts the overlay is open, then runs
  every assertion — except that "no fixed element covers flow text" skips
  `#transcript-pane` in this one state, because the overlay covers the note by
  design. The script prints that exemption as a `note:` line with the count of
  lines it skipped. Overlap with the Record HUD and inside-the-viewport still
  run on the overlay. The chip tap-target check still runs on every chip the
  overlay leaves in view, but zero measured is not a failure here: the
  overlay may cover them all.

Proved red first (2026-09-27): the first run with these widths and states
failed 16 times — the Record HUD covered text on Personas at 768 and 390,
Settings at 768, and the note at 1440 with both panes hidden, because each
stacked or widened column ran under the HUD's strip; and the demo note at 390
measured no chip, because its chips sat below the fold. After the reserve
(`max-lg:pb-(--hud-reserve)`) and the chip scroll: 1335 green, 0 failed (1337 after review added the overlay chip check).

Next's dev-tools badge is a real fixed element in the bottom-left corner and
is excluded by name; it does not ship.

**Every route also gets four contrast assertions** (issues #22 and #65), from
`scripts/layout-contrast.mjs`: every visible, unselected, non-busy disabled control IS
`ink-disabled` and sits at 3.0–3.7:1 on its sheet; every `live-tint` fill
carries 4.5:1 text and a 3:1 frame; every `rule-strong` seam is 1.8–2.6:1 on
both sides; and every label painted in a metadata-ladder token (`muted`,
`meta*`) clears 4.5:1. Colours are read as painted pixels off a 1px canvas, so the
syntax Chrome computes (`lab()`, `oklch()`) does not matter. A route that is
known to show a token and measures none of it fails — `/` and the note at full
width must show `ink-disabled` and `rule-strong`, `/personas` `ink-disabled`,
and `/` a planted Failed pill. Proved red before the sweep: every disabled
control named as "not ink-disabled", and zero seams measured.
