# Phone layout for All notes and Note — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Below 768px, All notes and Note get a designed phone layout (option A, "app shell with a dock", picked by the founder 2026-10-05), replacing the stacked fallback.

**Architecture:** Every change is a `max-md:` variant or an element shown only below `md`, so 768px and up is byte-for-byte the same layout. The page stays one viewport tall with inner scrolling (`h-app`), so the recorder corner rule holds unchanged. The app nav moves into a native `popover` menu opened from a one-row masthead; the note's transcript strip becomes a button in the bottom reserve band; the chat composer folds to one line until it has focus.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, Vitest + Testing Library, `scripts/verify-layout.mjs` (Chrome over CDP).

**Spec:** issue tekguyz/squid-ink#91 (Done-when list) plus the option-A choice recorded in this file's header. `DESIGN.md` and `.claude/rules/layout-checks.md` are binding.

## Global Constraints

- Change only the phone layout (`< 768px`). No new features. Desktop (≥ 768px) must not change.
- Every colour through a token utility; zero colour literals in `components/` or `lib/`.
- No shadow, no radius, no new typeface, no new colour token.
- Recorder corner: `HUD_RESERVE` (72px) and `HUD_SAFE_MARGIN` (24px) still hold; any scroll region ending at the viewport bottom ends 72px above it.
- Phone type floor: every mono label is at least **11px** with `0.1em` tracking below `md`. Archivo never below 13px on a phone.
- Tap targets at least 24px (WCAG 2.2 AA floor), 44px where the row allows it.
- Shipped file ceiling 400 lines (soft 250).
- Sample data stays sample. Never alter a picture after capture.

## Review Focus

1. **A note with a long title at 390px** — the masthead and meta must not overflow sideways; title wraps. Pinned by verify-layout's "no horizontal overflow" at 390 and 540 on the demo note.
2. **Menu open, then navigate** — the popover must not stay open over the next screen. Native popover closes on light-dismiss; the next screen is a new render. Checked by hand in the browser pane.
3. **Saved "transcript hidden" choice from desktop, then a phone** — `in-data-[pane-transcript=hidden]` must not add a second 72px band on a phone. Pinned by restricting that padding to `md:`; checked at 390 in the browser pane.
4. **Chat with history on a phone** — the answer list must not eat the note. Capped at `25dvh` below md.
5. **A note still unlocked (lens selectable) on a phone** — lens tabs stay operable in the one-row scroller. Existing `persona-rail.test.tsx` keeps covering selection.

---

### Task 1: The phone menu

**Files:**
- Create: `components/phone-menu.tsx`
- Test: `components/__tests__/phone-menu.test.tsx`

**Interfaces:**
- Produces: `PhoneMenu({ id, children }: { id: string; children: ReactNode })` — a `md:hidden` "Menu" button with `popoverTarget={id}` plus a `popover` sheet holding `children`, fixed under a 48px masthead (`top: calc(var(--demo-banner-h,0px) + 48px)`), ending `HUD_RESERVE` above the bottom.

- [ ] **Step 1: failing test** — renders a button named "Menu" whose `popovertarget` equals the id of an element carrying the `popover` attribute, and that element contains the children.
- [ ] **Step 2:** `npx vitest run components/__tests__/phone-menu.test.tsx` → FAIL (module missing).
- [ ] **Step 3: implement.** No `display` class on the popover element itself (Tailwind `flex` would override the UA `display:none` of a closed popover); the inner wrapper carries layout. Sheet: `bg-rail border-b border-rule-strong`, full width, `max-h` to the reserve, `overflow-y-auto scroll-thin`. Button: mono 11px uppercase, `border-control-edge`, 32px tall, focus outline accent.
- [ ] **Step 4:** test passes.
- [ ] **Step 5:** commit.

### Task 2: All notes below 768px

**Files:**
- Modify: `app/page.tsx` (rail `max-md:hidden`; pass the menu to the header; footer label 11px)
- Modify: `components/dashboard/dashboard-header.tsx` (`menu?: ReactNode` slot; below md: one 48px row — title, count, Menu; search and the Record group hidden — the HUD's Record is on screen)
- Modify: `components/dashboard/identity-rail.tsx` (`max-md:hidden`)
- Modify: `components/dashboard/note-row.tsx` (below md: one column — title wraps to two lines, preview one line at 13px, then one mono meta line `05:43 · 3 MIN   2 ACTIONS · 7 SPANS`)
- Modify: `components/dashboard/note-feed.tsx` (day heading 11px below md, 16px gutter)
- Test: `components/dashboard/__tests__/dashboard-header.test.tsx`

**Interfaces:**
- Consumes: `PhoneMenu` (Task 1), `AppNav`, `TagFilter`.
- Produces: `DashboardHeader({ menu, notesCount }: { menu?: ReactNode; notesCount?: number })`.

- [ ] **Step 1: failing test** — `DashboardHeader` renders whatever is passed as `menu`, and shows `notesCount` with an `aria-label` of "3 notes".
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement** the classes above. The menu holds `<AppNav current=… notesCount=…/>` and `<TagFilter …/>`, so the tag filter stays reachable.
- [ ] **Step 4:** `npx vitest run components/dashboard app/__tests__` → PASS.
- [ ] **Step 5:** commit.

### Task 3: Note below 768px

**Files:**
- Modify: `components/note-detail/persona-rail.tsx` (below md: a 48px masthead — "‹ All notes" link and `PhoneMenu` with `AppNav` — replaces the nav row; the lens tabs and the quick actions share ONE horizontal scroller, led by a "Lens" slug; desktop structure untouched via `md:contents`)
- Modify: `components/note-detail/note-detail-shell.tsx` (phone grid `grid-cols-1 grid-rows-[auto_minmax(0,1fr)_var(--hud-reserve)]`; the transcript wrapper becomes the bottom band; main's reserve padding only from `md`; tags + collection + demo line in one wrapping row; 16px gutters)
- Modify: `components/note-detail/panes/pane-toggle.tsx` (`PaneStrip` below md: horizontal button "Transcript" at the band's left, chevron pointing up; the HUD owns the right)
- Modify: `components/note-detail/note-header.tsx`, `section-rule.tsx`, `takeaways-section.tsx` (11px slugs, 16px gutter)
- Modify: `components/note-detail/chat/chat-panel.tsx`, `scope-toggle.tsx`, `demo-questions.tsx` (below md: input plus Ask on one line; scope toggle and lens label appear on `focus-within`; history capped at `25dvh`; 11px slugs)
- Modify: `components/tags/tag-entry.tsx`, `components/collections/collection-picker.tsx`, `components/demo/demo-mode.tsx` (11px below md, no own gutter below md)
- Test: `components/note-detail/__tests__/persona-rail.test.tsx`

**Interfaces:**
- Consumes: `PhoneMenu` (Task 1), `AppNav`, `HUD_RESERVE_VAR`.

- [ ] **Step 1: failing test** — `PersonaRail` renders a link "Back to all notes" to `/` and a "Menu" button.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement** the classes above.
- [ ] **Step 4:** `npx vitest run components/note-detail components/tags components/collections` → PASS.
- [ ] **Step 5:** commit.

### Task 4: The layout proof learns 540

**Files:**
- Modify: `scripts/verify-layout.mjs` (add 540 to `"/"` and `note` in `NARROW_WIDTHS`; in the demo pass, at 540×675 on demo note 1, assert the h1, the summary and the first takeaway are inside the note's visible scroll box before any scroll)
- Modify: `.claude/rules/layout-checks.md` (say so)

- [ ] **Step 1:** add the assertion; run against `main`'s layout first (stash the UI) → expect it to FAIL (the pinned chat cuts the summary today).
- [ ] **Step 2:** run on the branch → PASS, exit 0.
- [ ] **Step 3:** commit.

### Task 5: DESIGN.md and comments

**Files:**
- Modify: `DESIGN.md` § Layout "Responsive behaviour" — All notes and Note now have a designed phone layout; describe masthead, menu, dock band, one-line Ask, phone type floor. Keep the floor paragraph for Personas, Collections, Settings.
- Modify: header comment in `app/page.tsx`.

- [ ] **Step 1:** write; `node scripts/check-docs.mjs` → 0.
- [ ] **Step 2:** commit.

### Task 6: Verify and open the PR

- [ ] `npm run typecheck`, `npm run test:unit` once.
- [ ] `node scripts/verify-layout.mjs` exits 0.
- [ ] Browser pane at 390, 540 and 1440, light and dark, All notes and a note; 540×675 shows title, summary, first takeaway.
- [ ] `impeccable detect --json` over the changed files.
- [ ] Push (not auto-deploy: a branch), open one PR naming issue #91.

### Task 7 (after merge): retake the social pictures

- [ ] `node C:/Projects/claude-config/tools/capture/capture.mjs squid-ink --out <scratch>`; copy only `*-feed-*` and `*-stories-*` into `showcase/` and `muse-outbox/work-pack/pictures/ai-meeting-notes/feed/` and `stories/`; update the AI Meeting Notes rows in `muse-outbox/work-pack/projects.md` (drop "prefer the Stories one") and the squid-ink row in `claude-config/tools/capture/README.md`.
