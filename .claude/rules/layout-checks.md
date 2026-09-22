---
paths:
  - "components/**"
  - "app/**"
  - "scripts/verify-layout.mjs"
---

# Screen-level layout proof

**Every other check in this repo is file-shaped; this class of defect is
screen-shaped.** `npm test` renders in jsdom, which has no layout engine, so
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

It was proved to fail before it was trusted: restoring `theme-toggle.tsx` to
its original `right-3 bottom-3` turns 48 green into 40 green and 8 failures
naming both colliding elements. A layout assertion nobody has watched fail is
an assertion about a walk nobody watched — the same reasoning
`project-conventions.test.ts` states about its own file walk.

Widths are `1440` and `1280` on every route. **`/` is also measured at `1024`,
`768` and `390`**, because the Dashboard's stacked layout shipped 2026-09-15;
`NARROW_WIDTHS` in the script lists which routes get narrow widths. No other
screen has breakpoint work, so add a route there when its breakpoints ship, not
before. Next's dev-tools badge is a real fixed element in the bottom-left corner
and is excluded by name; it does not ship.
