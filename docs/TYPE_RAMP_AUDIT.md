# Type ramp audit — every shipped font size, mapped

**Date:** 2026-09-07
**Scope:** `components/`, `lib/`, `app/` — `.ts` and `.tsx`, excluding `__tests__`.
**Method:** exhaustive regex sweep for `text-[Npx]` and the Tailwind scale steps
`text-xs` / `text-sm` / `text-base`. No sampling — all 79 sites are listed below.
**Status:** read-only audit. Nothing was changed. This is a proposal.

**Totals:** 16 distinct sizes, 79 usage sites, 26 source files.

---

## Which ramp this is measured against

Two different ramps exist and it matters which one the question is about.

- **The 7-size ramp** (8 named roles over 7 distinct sizes, `16px` appearing
  twice) is the one extracted **2026-08-31**, before the Dashboard existed. It
  is what this audit calls **the locked ramp**, and it is what the prompt refers
  to. It is at `git show HEAD~1:DESIGN.md`.
  Sizes: **29, 16, 14, 14.5, 13, 9, 8.5** — roles `display`, `headline`,
  `title`, `body`, `body-dense`, `meta`, `label`, plus `numeral` at 16.
- **The 16-size ramp** is what `DESIGN.md` carries **now**, after the
  2026-09-07 regeneration. It names all 16 shipped sizes as roles.

The regen moved the documentation *toward* the code. This audit asks the
opposite question — should the code move toward the documentation — so the
"already a named role?" column below is scored against the **7-size** ramp.

**The 9 sizes not in the locked ramp:** 22, 15, 13.5, 12.5, 12, 11.5, 10.5, 10,
9.5.

---

## The table

Disposition key: **KEEP** = a real role the 2026-08-31 ramp missed · **FOLD** =
drift, safe to collapse · **BLOCKED** = folding would move a measured constant ·
**SPLIT** = one size doing two unrelated jobs.

| Size | Sites | Files | In locked ramp? | Disposition | Reasoning |
|---|---|---|---|---|---|
| **29px** | 1 | 1 | ✅ `display` | KEEP | One per screen by definition. A single site is the correct count for a page title, not drift. |
| **22px** | 1 | 1 | ❌ | KEEP — 8th role (`page-title`) | Same "one per screen" logic on the second screen. It is a nav-level heading, not content, so it cannot fold into `display` at 29. |
| **16px** | 4 | 3 | ✅ `headline` + `numeral` | KEEP (both) | One size, two faces, two roles already named: Bitter 600 headings and Plex Mono 500 elapsed clock. No action. |
| **15px** | 2 | 2 | ❌ | SPLIT → KEEP one, review one | The feed-row title is load-bearing (it is the feed's scan target) and earns a role. The takeaways numeral sharing the size is coincidence, not a role. |
| **14.5px** | 1 | 1 | ✅ `body` | KEEP | Single site but it is *the* body role — the one paragraph read end to end. Count is not evidence of drift here. |
| **14px** | 5 | 3 | ✅ `title` | KEEP, with a face bug | The only size written as a Tailwind scale step (`text-sm`). Two of the five sites inherit a face the ramp does not pair with 14px. See Finding 2. |
| **13.5px** | 2 | 2 | ❌ | 1 FOLD, 1 BLOCKED | Two faces, two jobs, half a pixel from documented sizes. One is cheap to fold; the other is baked into a measured layout constant. |
| **13px** | 6 | 5 | ✅ `body-dense` | KEEP | Broad, consistent, one face, one job. The healthiest size in the system. |
| **12.5px** | 4 | 3 | ❌ | KEEP — 9th role (`body-compact`) | All four sites are Dashboard, all Archivo, all the same job: secondary text under a title. A real role the old ramp could not have known about. |
| **12px** | 2 | 2 | ❌ | FOLD → 12.5 or 13 | Two sites, two files, two different faces, no shared job. Textbook drift. |
| **11.5px** | 6 | 5 | ❌ | KEEP — role, and a duplication finding | Four of the six sites are the *same* notice block copy-pasted into four files. The size is load-bearing; the block should be a component. |
| **10.5px** | 1 | 1 | ❌ | **FOLD → 10px** | One site, mono, tabular, half a pixel from a size used 7 times. The single safest fold in the audit. |
| **10px** | 7 | 6 | ❌ | KEEP — real role (`action`) | Seven sites, six files, one consistent job: operable mono controls and citation chips. Removing this would push work onto 9px, which is already overloaded. |
| **9.5px** | 7 | 5 | ❌ | KEEP — real role (`meta-2`) | Broad and consistent. Overlaps 9px in *job*, but see Finding 3 before considering a merge. |
| **9px** | 23 | 15 | ✅ `meta` | KEEP | The most-used size in the product by a factor of three. Untouchable. |
| **8.5px** | 7 | 5 | ✅ `label` | KEEP | Consistent, though the role carries two tracking values (0.14em ×5, 0.16em ×2). |

**Net effect if every recommendation lands: 16 sizes → 13.**
If only the unambiguously safe fold lands: **16 → 15.**

---

## Flag: narrow vs. broad usage

The prompt asked for this split explicitly.

**Used in only 1–2 places (7 sizes).** Narrow use is *not* by itself evidence of
drift — four of these seven are structurally single-instance:

| Size | Sites | Verdict |
|---|---|---|
| 29px | 1 | Load-bearing — one page title per screen |
| 22px | 1 | Load-bearing — one page title per screen |
| 14.5px | 1 | Load-bearing — the single body-prose role |
| 10.5px | 1 | **Drift** — safe to fold |
| 15px | 2 | Mixed — one load-bearing, one arguable |
| 13.5px | 2 | Mixed — one foldable, one blocked |
| 12px | 2 | **Drift** — safe to fold |

**Used broadly (9 sizes).** All are load-bearing. Six of them are *not* in the
locked ramp, which is the audit's headline result: **the ramp was under-specified,
not the code over-grown.**

| Size | Sites | Files | In locked ramp? |
|---|---|---|---|
| 9px | 23 | 15 | ✅ |
| 10px | 7 | 6 | ❌ |
| 9.5px | 7 | 5 | ❌ |
| 8.5px | 7 | 5 | ✅ |
| 13px | 6 | 5 | ✅ |
| 11.5px | 6 | 5 | ❌ |
| 14px | 5 | 3 | ✅ |
| 16px | 4 | 3 | ✅ |
| 12.5px | 4 | 3 | ❌ |

---

## Findings that are not size counts

### Finding 1 — `13.5px` in the HUD is welded to a measured constant

`components/recorder/record-hud.tsx:74` sets the word "Record" at 13.5px Bitter.
`components/recorder/hud-safe-margin.ts` derives `HUD_RESERVE` from it in prose:

> 24px of margin plus a 40px idle pill is 64px … the pill measures 39.85px in
> the browser (9px marker, 9px padding, a **13.5px Bitter line**)

`HUD_RESERVE` is read by `app/page.tsx:80` to size the feed footer, and
`scripts/verify-layout.mjs` asserts no fixed element covers flow text. Changing
13.5 → 14 grows the pill, eats the 8px clearance the constant was chosen to
protect, and **the layout script may still pass** because 8px of slack absorbs
it. This is exactly the class of change the prompt warns about: no gate catches
it. **Do not fold this one without re-measuring the pill in a browser.**

The other 13.5px site — `action-items-table.tsx:25`, Archivo body text in a table
row — has no such coupling and folds to 13px (`body-dense`) cleanly.

### Finding 2 — three sites use a face/size pair no role describes

All three come from Tailwind scale steps inheriting a face from a parent rather
than declaring one. They are invisible to a size-only sweep of the ramp.

| Site | Renders as | Nearest role | Problem |
|---|---|---|---|
| `speaker-insights.tsx:10` | **Plex Mono 14px** (inherits `font-mono` from the parent `div` at line 30) | `numeral` is mono **16px** | A mono numeral at a size no role names. Reads as a shrunk `numeral`. |
| `takeaways-section.tsx:29` | **Archivo 14px** (inherits `font-body` from `<body>`) | `body` is Archivo **14.5px** | Takeaway prose is 0.5px under the documented body size. |
| `transcript-segment.tsx:29` | **Archivo 12px** (inherits `font-body`) | nothing at 12px in the locked ramp | The speaker name — see Finding 4. |

The pattern, not the pixels, is the defect: **`text-sm` / `text-xs` / `text-base`
are the only sizes in the codebase that do not state their own size in the class
list**, and two of the seven inherit a face the author probably did not intend.
Recommend converting all seven scale-step sites to arbitrary values regardless of
what happens to the ramp — that change is size-preserving and therefore carries
none of the contrast risk the rest of this document is about.

### Finding 3 — 9.5px and 9px do the same job, and merging them is not safe

Both are Plex Mono metadata. `9.5px` (7 sites) and `9px` (23 sites) are close
enough that a reviewer will eventually propose merging them. Do not, without
measurement: `components/dashboard/status-pill.tsx` records an in-page contrast
pass in its own header —

> at 9px every label is small text, so the bar is WCAG 1.4.3 AA's 4.5:1 — not
> the 3:1 large-text bar. `faint` came in at 2.93:1 light / 3.10:1 dark and
> `meta` at 4.37:1 dark; both failed and both are replaced

Those measurements were taken at 9px. Pushing seven more sites down to 9px puts
them under that same stricter bar, and three of them (`record-hud.tsx:82`, `:93`,
`:169`) use `meta-4` and `notice`, which were **not** in that measurement set.
Merging up (9 → 9.5) is the cheaper direction if a merge is ever wanted, and it
touches 23 sites.

### Finding 4 — the transcript speaker name is the least-defended size

`transcript-segment.tsx:29` is Archivo 12px, set via `text-xs`, in a per-speaker
hue. It is one of only two 12px sites, it is the sole size in that component that
is not an arbitrary value, and the speaker hues were contrast-tuned as *colors*
without a size pass. If any single site should be re-measured before it is
touched, it is this one — it combines the drift-shaped size, the inherited face
and the only non-neutral text color in the note body.

### Finding 5 — the notice block is duplicated four times

Same size, same padding, same tokens, four files:

- `transcribe-button.tsx:93` — `bg-notice-bg px-[9px] py-[7px] text-[11.5px] text-notice`
- `transcript-pane.tsx:38` — identical
- `chat/chat-message.tsx:68` — identical
- `chat/chat-panel.tsx:178` — identical

11.5px is a real role and should stay. But four copies of one visual pattern is
the reason 11.5px *looks* like a broadly-used size, and a fifth copy will be
written the next time someone needs a notice. Out of scope here; worth its own
extraction.

---

## Full usage index — every site

### 29px — 1 site · role `display` ✅

- `components/note-detail/note-header.tsx:7` — `<h1>` note title, Bitter 500, `leading-[1.14] tracking-[-0.012em]`

### 22px — 1 site · **not in locked ramp**

- `components/dashboard/dashboard-header.tsx:75` — `<h1>` "All notes", Bitter 600, `tracking-[-0.01em]`

### 16px — 4 sites · roles `headline` + `numeral` ✅

- `components/dashboard/note-feed.tsx:29` — "No notes yet" empty state, Bitter 600
- `components/note-detail/transcript-pane.tsx:25` — `<h2>` "Transcript", Bitter 600 *(via `text-base`)*
- `components/recorder/record-hud.tsx:107` — elapsed clock, recording phase, Plex Mono 500
- `components/recorder/record-hud.tsx:139` — elapsed clock, paused phase, Plex Mono 500

### 15px — 2 sites · **not in locked ramp**

- `components/dashboard/note-row.tsx:55` — feed row note title, Bitter 600, truncated
- `components/note-detail/takeaways-section.tsx:26` — takeaway ordinal in `accent`, Bitter 600, in a `w-4` track

### 14.5px — 1 site · role `body` ✅

- `components/note-detail/summary-section.tsx:21` — summary prose, `leading-[1.66] text-pretty`

### 14px — 5 sites · role `title` ✅ · all via `text-sm`

- `components/note-detail/persona-rail.tsx:61` — lens tab label, Bitter 600, `leading-[1.25]`
- `components/note-detail/persona-rail.tsx:80` — lens tab placeholder, Bitter 600
- `components/note-detail/speaker-insights.tsx:26` — speaker name in speaker hue, Bitter 600
- `components/note-detail/speaker-insights.tsx:10` — stat value — **inherits Plex Mono**, see Finding 2
- `components/note-detail/takeaways-section.tsx:29` — takeaway text — **inherits Archivo**, see Finding 2

### 13.5px — 2 sites · **not in locked ramp**

- `components/note-detail/action-items-table.tsx:25` — action-item row, Archivo — *foldable to 13*
- `components/recorder/record-hud.tsx:74` — "Record" word, Bitter 600 — **BLOCKED**, see Finding 1

### 13px — 6 sites · role `body-dense` ✅

- `components/dashboard/identity-rail.tsx:24` — `NAV_ITEM` shared class, Archivo
- `components/dashboard/note-feed.tsx:30` — empty-state explanation, Archivo, `max-w-[46ch]`
- `components/note-detail/transcript-segment.tsx:35` — utterance text, `leading-[1.56] text-pretty`
- `components/note-detail/chat/chat-message.tsx:47` — user turn text
- `components/note-detail/chat/chat-message.tsx:57` — assistant turn text, `leading-[1.55]`
- `components/note-detail/chat/chat-panel.tsx:201` — composer `<input>`

### 12.5px — 4 sites · **not in locked ramp** · all Dashboard, all Archivo

- `components/dashboard/dashboard-header.tsx:86` — search placeholder text (disabled control)
- `components/dashboard/identity-rail.tsx:131` — recent-note jump link
- `components/dashboard/identity-rail.tsx:149` — Settings pending item
- `components/dashboard/note-row.tsx:59` — feed row preview line

### 12px — 2 sites · **not in locked ramp**

- `components/note-detail/transcript-segment.tsx:29` — speaker name in speaker hue *(via `text-xs`, inherits Archivo)*
- `components/recorder/record-hud.tsx:181` — error phase message, Archivo, `leading-[1.5]`

### 11.5px — 6 sites · **not in locked ramp**

- `components/note-detail/persona-rail.tsx:90` — quick-action button, `leading-[1.35]`
- `components/note-detail/transcribe-button.tsx:93` — notice block *(duplicate 1 of 4)*
- `components/note-detail/transcript-pane.tsx:38` — notice block *(duplicate 2 of 4)*
- `components/note-detail/chat/chat-message.tsx:68` — notice block *(duplicate 3 of 4)*
- `components/note-detail/chat/chat-panel.tsx:178` — notice block *(duplicate 4 of 4)*
- `components/note-detail/transcript-pane.tsx:98` — pane footer note, Archivo, `leading-[1.5]`

### 10.5px — 1 site · **not in locked ramp** · **fold candidate**

- `components/dashboard/note-row.tsx:44` — feed row time and duration, Plex Mono, `tabular-nums`

### 10px — 7 sites · **not in locked ramp**

- `components/dashboard/dashboard-header.tsx:51` — `MONO_ACTION` shared class, `tracking-[0.06em] uppercase`
- `components/dashboard/identity-rail.tsx:90` — account initials mark, Plex Mono on `bg-tint`
- `components/note-detail/action-items-table.tsx:35` — owner column, `tabular-nums`
- `components/note-detail/action-items-table.tsx:36` — due column, `tabular-nums`
- `components/note-detail/audio-player.tsx:72` — `CLOCK` shared class, `tracking-[0.04em]`
- `components/note-detail/citation-chip.tsx:14` — filled citation chip
- `components/note-detail/chat/cite-runs.tsx:47` — inline citation run

### 9.5px — 7 sites · **not in locked ramp**

- `app/page.tsx:79` — feed footer "End of feed · N notes", `tracking-[0.14em] tabular-nums uppercase`
- `components/dashboard/identity-rail.tsx:27` — `COUNT` shared class, `tabular-nums`
- `components/note-detail/speaker-avatar.tsx:8` — avatar initials, in a 26px circle
- `components/note-detail/transcript-segment.tsx:33` — segment timestamp, `meta-4`
- `components/recorder/record-hud.tsx:82` — `⌘⇧R` shortcut hint, hover-revealed
- `components/recorder/record-hud.tsx:93` — requesting-phase label, `tracking-[0.1em] uppercase`
- `components/recorder/record-hud.tsx:169` — uploading-phase label, `tracking-[0.1em] uppercase`

### 9px — 23 sites · role `meta` ✅

- `components/theme-toggle.tsx:54` — toggle label, `tracking-[0.14em] uppercase`
- `components/dashboard/identity-rail.tsx:95` — signed-in email address, truncated
- `components/dashboard/note-row.tsx:36` — `COUNT` shared class, `tracking-[0.06em] tabular-nums uppercase`
- `components/dashboard/status-pill.tsx:38` — `PILL` shared class, `tracking-[0.14em] uppercase`
- `components/note-detail/audio-player.tsx:46` — control button class, `tracking-[0.06em] uppercase`
- `components/note-detail/audio-player.tsx:75` — waveform footer row, `tracking-[0.14em] uppercase`
- `components/note-detail/note-header.tsx:4` — note eyebrow metadata, `tracking-[0.14em] uppercase`
- `components/note-detail/persona-rail.tsx:103` — grounding footer, `leading-[1.7]`
- `components/note-detail/speaker-insights.tsx:30` — stat labels row, `meta-5`
- `components/note-detail/transcribe-button.tsx:73` — button label, `tracking-[0.06em] uppercase`
- `components/note-detail/transcript-pane.tsx:26` — pane header meta, `meta-2`
- `components/note-detail/transcript-pane.tsx:31` — pane header action, `meta-2`
- `components/note-detail/waveform.tsx:21` — waveform time row, `meta-4`
- `components/note-detail/chat/chat-message.tsx:46` — "YOU" speaker tag
- `components/note-detail/chat/chat-message.tsx:56` — "NOTE" speaker tag, `accent`
- `components/note-detail/chat/chat-panel.tsx:168` — status line, `empty:hidden`
- `components/note-detail/chat/chat-panel.tsx:204` — composer prefix, `accent`
- `components/note-detail/chat/chat-panel.tsx:210` — send button, `accent-pressed`
- `components/note-detail/chat/chat-panel.tsx:217` — `role="alert"` error line, `notice`
- `components/note-detail/chat/scope-toggle.tsx:68` — scope tab label, `tracking-[0.06em] uppercase`
- `components/recorder/record-hud.tsx:38` — `MONO_ACTION` shared class, `tracking-[0.06em] uppercase`
- `components/recorder/record-hud.tsx:127` — paused-phase hint, `faint`, `tracking-[0.04em]`
- `components/recorder/record-hud.tsx:142` — paused-phase label, `tracking-[0.1em] uppercase`

### 8.5px — 7 sites · role `label` ✅

- `components/dashboard/dashboard-header.tsx:49` — `SOON_BADGE` shared class, `tracking-[0.14em]`
- `components/dashboard/identity-rail.tsx:26` — `GROUP_HEADING` shared class, `tracking-[0.14em]`
- `components/dashboard/identity-rail.tsx:62` — "Soon" badge on a pending nav item, `tracking-[0.14em]`
- `components/dashboard/identity-rail.tsx:152` — "Soon" badge on Settings, `tracking-[0.14em]`
- `components/dashboard/note-feed.tsx:43` — feed day heading, `tracking-[0.16em]`
- `components/note-detail/persona-rail.tsx:23` — rail group heading, `tracking-[0.14em]`
- `components/note-detail/section-rule.tsx:5` — `<h2>` section rule label, `tracking-[0.16em]`

---

## Recommended order of work, if this is actioned

Cheapest and least risky first. Each step is independently shippable.

1. **Convert the 7 scale-step sites to arbitrary values.** Size-preserving, so
   zero contrast and zero layout risk. Fixes Finding 2's invisibility and makes
   every future sweep of this kind complete. Do this even if nothing else lands.
2. **Fold 10.5px → 10px** (1 site, `note-row.tsx:44`). Mono, tabular, half a
   pixel, no inherited face, no measured constant. The only unambiguous fold.
3. **Fold 12px → 12.5px** (2 sites). Re-measure `transcript-segment.tsx:29`'s
   speaker hue at the new size first — see Finding 4.
4. **Fold `action-items-table.tsx:25` 13.5px → 13px** (1 site). Leave
   `record-hud.tsx:74` alone.
5. **Accept 22, 15, 12.5, 11.5, 10, 9.5 as real roles.** They are already named
   in the regenerated `DESIGN.md`. Nothing to do but stop treating them as drift.
6. **Do not touch 9.5 / 9.** See Finding 3.

None of the above is a design-judgment pass. Steps 3 and 4 change rendered text
size and should be looked at in a browser in both themes before merging —
`npm test`, `tsc`, `npm run build` and `scripts/verify-layout.mjs` will all pass
either way.
