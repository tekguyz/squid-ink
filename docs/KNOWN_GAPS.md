# Known Gaps

## Missing design-reference files (recorded 2026-08-30)

The brief named three files to read. Only one was present.

| Named | Actual | Status |
|---|---|---|
| `Note_Detail_dc.html` | `Note Detail.dc.html` | Present, filename differs |
| `App_Surfaces_dc.html` | — | Missing |
| `support.js` | — | Missing |

Impact: none on this build. `Note Detail.dc.html` turn 3 contains the full
layout, the locked token spec (3c), the mock data, and the citation-click
behavior. `App_Surfaces_dc.html` was reference-only for shared-component
patterns; `support.js` was explicitly not to be shipped. Nothing was guessed at.

**RESOLVED 2026-08-30.** Both files were supplied after the build. `App Surfaces.dc.html`
holds ten surfaces (01 dashboard, 02 recorder, 02b record HUD, 03 personas,
04 auth, 05 onboarding, 06 settings, 07 collections, 08 share, 09 live assistant,
10 newsprint light). None was in scope and none was built — correct.
`support.js` is the canvas runtime and is gitignored, not shipped.

## State management — Zustand not used here (recorded 2026-08-30)

Zustand not invoked here — state is local to one component, no drawers/cross-route
state in this build. Revisit if a second stateful surface needs to share state.

`note-detail-shell.tsx` uses plain `useState` for its three pieces of state:
active segment, selected persona, composer draft.

**Amended 2026-08-30, after reading DECISIONS.md directly.** This was first
recorded as a divergence from a locked decision. It is not one. DECISIONS.md
§ State management enumerates Zustand's scope as "drawers, recorder HUD/dock
state, dashboard filters, split-screen/timeline toggles" — none of which exists
on this screen. Local `useState` is inside the locked decision, not beside it.

What *would* be a divergence, and is worth watching: if a future surface needs
the selected persona (the recorder HUD plausibly will), that state stops being
local and belongs in a Zustand store. Move it then; do not pre-build the store.

Provenance: `DECISIONS.md` and `ROADMAP.md` are knowledge files in the owner's
Claude.ai planning Project, not files in this repo. They are not on disk here and
cannot be verified by `check-docs.mjs` — anything this repo asserts about them is
a transcription and can go stale. Re-read them before relying on a quotation.

## Tokens not enumerated in 3c (recorded 2026-08-30)

3c is the locked token spec, but the 3a/3b markup uses more steps than 3c lists.
Every value below is lifted **verbatim** from the 3a/3b markup or the design
file's own component data block — none is invented or interpolated — and each
sits inside a range 3c declares ("hue 80–88 for text", "Espresso — hue 46–50,
chroma 0.012–0.016", "Newsprint — hue 80–84, chroma 0.010–0.023").

Not in 3c:

- `--speaker-1/2/3` and their `-avatar` pairs — the three per-speaker tones
  (blue / green / amber). Source: the `tones` map in the design file's component
  script, not the token card.
- `--rule-3` (`oklch(0.898 0.019 82)` light, `oklch(0.27 0.015 48)` dark) — the
  lighter hairline used between action-item rows.
- `--rail`, `--pane`, `--dock` **dark** values — 3c lists four Espresso surfaces;
  3b uses three more (`0.155 0.013 46`, `0.215 0.015 50`, `0.165 0.013 48`).
- `--tint-hover` dark (`oklch(0.42 0.09 140)`) and `--seg-wash` dark
  (`oklch(0.26 0.045 140)`).
- The dark grey text steps `--meta`, `--meta-2`, `--meta-3`, `--meta-4`,
  `--meta-5`, `--muted`, `--faint`, `--placeholder`, `--rail-idle`, `--notice`.
  3c gives one dark ink value and a hue range; 3b uses ten steps within it.

**RECONCILED against App Surfaces 2026-08-30 — no drift found.**

Of the 64 colour values in `app/globals.css`, 50 appear verbatim in
`App Surfaces.dc.html`. Every grey step listed above is confirmed there, most of
them heavily used (`0.58 0.012 80` 40 times, `0.60 0.012 80` 35, `0.62 0.012 80`
34) — so they are real system tokens, not note-detail improvisation. The three
extra Espresso surfaces are confirmed too (`0.155 0.013 46` 9 uses,
`0.215 0.015 50` 13, `0.165 0.013 48` 6), as is `--rule-3` and dark
`--tint-hover`.

The 14 values that do *not* appear in App Surfaces are all expected to be
absent: seven come from 3c's own "Extended steps — note detail only" block
(cite chip hover and fill, waveform, ink 2/3, muted, faint), the dark segment
wash is note-detail only, and the six remaining are the per-speaker tones and
their avatar fills, which exist only where a transcript is shown.

All eight locked accents are present in App Surfaces, confirming 3c's claim that
the two documents match exactly.

This gap is closed. No token needs changing.

## Additions and decisions outside the design (recorded 2026-08-30)

- **Theme toggle** (`components/theme-toggle.tsx`) is not in the design file.
  Added at the user's request so both token sets can be checked without changing
  the OS setting. Fixed bottom-right, follows `prefers-color-scheme` until first
  use, then persists to `localStorage`.
- **Fluid layout.** The design is a fixed 1348x884 artboard. At the user's
  direction the page is full-viewport-height with the rail pinned at 136px and
  the transcript pane at 404px; the middle pane flexes. Pixel-faithful at 1348px
  wide. Below roughly 1100px the three columns get cramped — no responsive
  breakpoint was in scope for this build.
- **Citation chips are `<button>`, not `<span>`.** The design draws a span.
  A span is not keyboard-reachable and gives a screen reader no affordance, so
  the chip ships as a real button with `aria-pressed` and an accessible name
  ("Jump to transcript at 04:12"). Visual result is identical.
- **Speaker labels are always on.** The design has a `showSpeakerLabels` prop and
  a "labels unavailable" notice for recordings without diarisation. The notice is
  built and styled in `transcript-pane.tsx`, but nothing toggles it yet — it needs
  real transcription data, which is out of scope here.

  Confirmed correct against DECISIONS.md § Speaker diarization (read 2026-08-30):
  diarisation is "on by default, auto-disabled per-recording past ~28 minutes …
  **no manual toggle**". So this prop must stay data-driven and must never gain a
  UI control. The notice is the fallback state, not a user setting.
- **TypeScript 7.0.2** was pinned and typechecked clean. No fallback to 6.x was
  needed.

## Not built (out of scope for this build)

The other eight App Surfaces screens, Supabase/auth/any backend, real
transcription or RAG data, PWA setup, brand assets, and routing beyond
`/notes/[id]`. The composer accepts and clears input but sends nothing.

## Code-review findings not acted on (recorded 2026-08-30)

Reviewed against `web-design-guidelines` and `vercel-react-best-practices`.
Six findings were fixed (native `color-scheme` per theme, action-item label hit
target, `autocomplete`/`enterkeyhint` on the ask input, `text-pretty` on the
title, memoised waveform, theme-toggle first-paint label). Two were considered
and deliberately left:

- **State is not deep-linked.** The web guidelines ask that stateful UI —
  selected lens, expanded panels — live in the URL so it can be shared and
  restored. Selected persona and active transcript segment are `useState` only.
  Deferred because the plan pinned local state for this single screen; see the
  Zustand entry above. Worth revisiting together with that decision, not
  separately.
- **The transcript SEARCH control is inert.** It is drawn in the design and
  built here as a real focusable button, but has no handler — searching the
  transcript was not in scope. It should either be wired or removed before this
  screen ships to a user.

## Gaps found by reading ROADMAP.md and DECISIONS.md (recorded 2026-08-30)

Both are knowledge files in the owner's Claude.ai planning Project, not in this
repo. Read directly on 2026-08-30 and reconciled against what shipped. Nothing
built here contradicts them. Four things worth carrying forward:

- **`Persona` has no depth field.** ROADMAP §5 defines a Persona as three
  things: lens, **depth/goal (Brief / Dense / Exhaustive)**, and quick-actions.
  `lib/mock/types.ts` models only lens + quick-actions, because the Note Detail
  design surfaces only those. Depth is a real part of the type and will need
  adding — it also carries routing behaviour (Exhaustive may route note
  generation to Gemini Pro rather than Flash), so it is not purely cosmetic.
  Not a defect in this build; a known incompleteness in the shape.

- **Four personas exist, not five.** DECISIONS.md § "Already covered" says to
  fold framework-template naming "into the 5 built-in Personas". Both design
  files define exactly four — Neutral Analyst, Sales Coach, Investor,
  Engineering Lead — in the Note Detail data block and in App Surfaces
  surface 03. This build ships those four. **Owner's call:** either a fifth
  persona is unnamed and still owed, or the doc's figure is stale.

- **Quick actions match the spec exactly.** ROADMAP §5 names the built-in set to
  design against: *Extract decisions only*, *Timeline of blockers*, *Unanswered
  questions*, *Diff against last call*. Those are the four shipped under Neutral
  Analyst. The per-lens draft-follow-up actions (client email, Slack message,
  Jira ticket) are Core UX/UI and are not built.

- **Cross-note chat is correctly absent.** ROADMAP §4 promotes an "ask all
  notes" mode alongside the existing "Ask this note…" composer, in Core UX/UI.
  The composer here reads "Ask this note…" and has no scope toggle, which is the
  correct MVP state.

## Supabase persistence layer (recorded 2026-08-30)

Added by the prompt that introduced `notes`, `note_chunks`, RLS, auth, and the
real-data swap on `/notes/[id]`. Everything below was **deliberately not
started**, or is a known incompleteness in what shipped.

### Deferred, no consumer exists yet

- **Google OAuth, Drive, Calendar, Tasks — and any token-storage table.**
  Nothing Google-related was built. No `google_connections` table, no provider
  tokens stored, no connect flow. DECISIONS.md keeps Google as a separate
  "Connect Calendar/Drive" action in settings, never tied to login, and no
  surface consumes it yet. **Provider-token refresh behaviour is therefore
  unverified**: Supabase does not refresh Google provider tokens for you, so
  whoever builds this must handle refresh, expiry, and re-consent explicitly.

- **Audio Storage bucket.** `notes.audio_storage_path` ships as a nullable
  placeholder column and nothing writes to it. There is **no bucket, no Storage
  policies, no upload code, and no playback UI**. Build it when the in-line
  context timeline bar (ROADMAP §8, Advanced) is actually scheduled. Note when
  you do: Storage upsert needs INSERT + SELECT + UPDATE policies together —
  granting INSERT alone makes file replacement fail silently.

- **Google connection table.** Same reason as above. Deferred until a consumer
  exists rather than built speculatively.

### Incompleteness in what did ship

- **Migration generation needs Docker, which is not installed.** `supabase db
  pull` and `supabase db dump` both build a shadow database in Docker and fail
  here (`LegacyImagePrepullError`). `db query`, `db advisors`, `migration new`,
  `migration list` and `migration repair` all work without it. The initial
  migration is therefore the verbatim concatenation of `supabase/schemas/*.sql`,
  verified byte-identical with `git hash-object`. That is provably equivalent
  for a from-empty schema. **The second migration will not be** — it needs
  either Docker or a hand-authored file, plus the catalog-diff check in the
  plan's Task 4 Step 5.

- **View types still live in `lib/mock/types.ts`.** The frozen Note Detail
  components import `Note`, `Segment`, `Speaker` and friends from there, so
  `lib/notes/*` has to import them from the same path. Real code depends on a
  module named "mock". The fix is mechanical — move them to
  `lib/notes/view-types.ts` and update the component imports — but
  `components/` and `lib/mock/` were both frozen for that prompt.

- **Three of four personas are hardcoded.** Only `neutral-analyst` takeaways
  come from real `takeaway` chunks. Sales Coach, Investor and Engineering Lead
  live in `lib/notes/persona-presets.ts`. There is no `personas` table and no
  `persona_id` on `note_chunks`, so a takeaway cannot yet be attributed to a
  lens. Core UX/UI phase.

- **`waveform`, `playhead` and `sampleExchange` are constants, not data.** No
  column backs any of them. The timeline bar is Advanced-phase, playhead is
  client state, and the sample exchange is placeholder chat content.

- **Speaker stats are recomputed on every read.** By decision — no column. Cheap
  for one note; if the dashboard ever shows stats per row this becomes an N+1
  and should be materialised. Filler counts read `0` for the seeded note because
  its transcript genuinely contains no filler words; the mock's 11/6/4 were
  invented figures, not a target to match.

- **The client name was dropped from `meta`.** The mock rendered
  "Wed 26 Aug 2026 · 41 min · Northwind Health". No column holds a client or
  account name, so `meta` is now built from `created_at` and
  `audio_duration_seconds` only. Adding it back needs a schema decision, not a
  formatting change.

- **`scripts/verify-rls.mjs` is not part of `npm test`.** It needs network
  access and the secret key, so it stays a manually run script. Run it after any
  change to a policy, a grant, or the `user_id` column on either table.

- **RLS proof covers two paths, and both must be re-run together.** Path A
  (`scripts/verify-rls.mjs`) proves the database enforces RLS against a real
  password-grant JWT. Path B (a browser or cookie-jar request through
  `proxy.ts`) proves the app hands the database the right identity. Neither
  substitutes for the other.

- **`anon` holds no privileges on either table, by design.** The schema files
  `revoke all` before granting, because Supabase's project defaults hand `anon`
  and `authenticated` TRUNCATE, REFERENCES and TRIGGER on every new public
  table. TRUNCATE is not row-level, so RLS does not constrain it. If a future
  feature needs public reads, grant them explicitly rather than removing the
  revoke.

### Accepted advisor finding

- **`auth_leaked_password_protection` (WARN, security).** Supabase Auth can
  check passwords against HaveIBeenPwned; it is off on this project.
  **Accepted, for now.** The app has no password sign-in surface at all — auth
  is magic-link only, and the only passwords in existence belong to the two
  `@example.test` fixtures that `scripts/verify-rls.mjs` needs for its password
  grant. Enabling it is a one-toggle dashboard change (Authentication →
  Policies) and is worth doing before any real password flow ships. It was not
  changed here because it is a project-level account setting, not schema.

  All other advisor findings are `INFO`-level `unused_index` on indexes that
  exist for query shapes the app does not run yet (HNSW and GIN back retrieval,
  which is not built). Not removable without breaking the RAG design in
  ROADMAP §4.

### Deliberate deviations from the written plan

- **`lib/supabase/middleware.ts` shipped as `lib/supabase/session.ts`.** Renamed
  on purpose, not drift. Next.js 16 deprecates the root `middleware.ts`
  convention in favour of `proxy.ts` (with the export renamed from `middleware`
  to `proxy`), so the root file was migrated. Keeping a helper called
  "middleware" next to a `proxy.ts` that no longer uses that word would have
  been actively misleading. `session.ts` names what it does — refresh the auth
  session — and `updateSession` kept its name. Verified: `npm run build` lists
  the route as `ƒ Proxy (Middleware)`, so Next resolves the new convention.

- **`config.toml` uses an explicit ordered `schema_paths` list, not the glob**
  the plan showed. A glob sorts alphabetically, which would apply
  `note_chunks.sql` before `notes.sql` and break the foreign key.

- **`app/page.tsx` and `scripts/verify-rls.mjs` were added beyond the plan's
  file list.** The former because the root route hardcoded the mock slug
  `pilot-pricing-rollout`, which stops existing once note ids are database
  UUIDs; the latter because the RLS proof needs somewhere to live. The auth
  route files (`app/login/*`, `app/auth/confirm/route.ts`, `proxy.ts`) were
  likewise added — with RLS on, a session-less page renders nothing, so
  "auth wired in" is not true without them.
