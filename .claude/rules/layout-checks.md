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

Widths are `1440` and `1280` on every route. **`/` is also measured at `1024`,
`768` and `390`**, because the Dashboard's stacked layout shipped 2026-09-15;
`NARROW_WIDTHS` in the script lists which routes get narrow widths. No other
screen has breakpoint work, so add a route there when its breakpoints ship, not
before. Next's dev-tools badge is a real fixed element in the bottom-left corner
and is excluded by name; it does not ship.
