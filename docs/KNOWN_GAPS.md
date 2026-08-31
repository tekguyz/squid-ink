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

- **`Persona.depth` exists but nothing consumes it.** ROADMAP §5 defines a
  Persona as three things: lens, **depth/goal (Brief / Dense / Exhaustive)**,
  and quick-actions.

  **RESOLVED 2026-08-30, partly.** `depth` is now a `PersonaDepth` field on the
  view type in `lib/notes/view-types.ts` and a checked `depth` column on
  `public.personas`. All four seeded personas carry `'dense'`, the column
  default — the pre-change constants encoded no depth, so none was invented.
  What is still owed is the *behaviour*: no UI control sets depth and no
  routing reads it (Exhaustive may route note generation to Gemini Pro rather
  than Flash). The shape is complete; the pipeline that would honour it does
  not exist yet.

- **Four personas exist, not five.** DECISIONS.md § "Already covered" said to
  fold framework-template naming "into the 5 built-in Personas". Both design
  files define exactly four — Neutral Analyst, Sales Coach, Investor,
  Engineering Lead — in the Note Detail data block and in App Surfaces
  surface 03. This build ships those four.

  **RESOLVED 2026-08-30.** The doc's figure was stale, not a missing fifth
  persona. DECISIONS.md was edited to say four and the owner reports the count
  as confirmed and locked. Four is now the only figure in play, and it matches
  both design files and the four seeded `public.personas` rows. No fifth
  persona is
  owed. DECISIONS.md is not in this repo — it lives in the owner's Claude.ai
  planning Project — so this closure rests on the owner's report of that edit,
  not on a file this audit can read.

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

- **Deleting a persona re-attributes its takeaways, it does not orphan them.**
  `note_chunks.persona_id` is `on delete set null`, and a null `persona_id`
  means "the default persona". Those two rules are each correct on their own,
  but together they mean deleting Sales Coach hands its three takeaways to
  Neutral Analyst, where they render as that lens's output. Nothing deletes a
  persona today. Whoever builds persona deletion has to decide: null the
  chunks and soft-delete them, or accept the re-attribution and say so in the
  delete confirmation.

- **Migration generation needs Docker, which is not installed.** `supabase db
  pull` and `supabase db dump` both build a shadow database in Docker and fail
  here (`LegacyImagePrepullError`). `db query`, `db advisors`, `migration new`,
  `migration list` and `migration repair` all work without it. The initial
  migration is therefore the verbatim concatenation of `supabase/schemas/*.sql`,
  verified byte-identical with `git hash-object`. That is provably equivalent
  for a from-empty schema.

  **Resolved for the second migration, 2026-08-30.**
  `20260830223821_personas_and_chunk_attribution.sql` is hand-authored: the
  whole of `personas.sql` (new, and idempotent throughout) plus only the
  `persona_id` column, foreign key and index lifted from `note_chunks.sql`.
  It was executed against the linked project before
  `migration repair --status applied`, the embedded `personas.sql` was
  machine-checked as byte-identical to the schema file, and the shape was
  read back from `pg_policies`, `pg_constraint`, `pg_indexes` and
  `information_schema.columns`. Every later migration needs the same
  treatment — there is still no `db diff`.

- **View types used to live in `lib/mock/types.ts`.** The frozen Note Detail
  components import `Note`, `Segment`, `Speaker` and friends from there, so
  `lib/notes/*` has to import them from the same path. Real code depends on a
  module named "mock". The fix is mechanical — move them to
  `lib/notes/view-types.ts` and update the component imports — but
  `components/` and `lib/mock/` were both frozen for that prompt.

  **Measured 2026-08-30 during the handoff audit:** `mockNote` now has no
  importer outside its own tests.

  **RESOLVED 2026-08-30.** `lib/mock/types.ts` moved wholesale to
  `lib/notes/view-types.ts` and was deleted; `DEFAULT_PERSONA_ID` now lives in
  `lib/notes/default-persona.ts`. `lib/mock/note.ts` remains only as a fixture
  for the component tests.
  `CLAUDE.md`'s "Data: mock only, no environment variables, no backend" rule was
  still asserting the pre-Supabase state and was corrected in the same audit.

- **Three of four personas were hardcoded.**

  **RESOLVED 2026-08-30.** All four personas are rows in `public.personas`,
  owner-scoped under the same four-policy RLS pattern as `notes` and
  `note_chunks`. `note_chunks.persona_id` (nullable, `on delete set null`)
  attributes a takeaway to a lens; a null `persona_id` reads as the default
  persona, which is what keeps chunks written before the table rendering
  unchanged. `lib/notes/persona-presets.ts` is deleted.

- **Personas are not provisioned for new users.** There is no trigger on
  `auth.users` and no persona authoring UI, so a fresh account gets zero rows
  and falls back to the single `DEFAULT_PERSONA_FALLBACK` in
  `lib/notes/default-persona.ts` — one lens, no Sales Coach / Investor /
  Engineering Lead. Only the seed owner has the four. Provisioning belongs with
  the Personas UI (ROADMAP §5).

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
  substitutes for the other. Path B was run for the first time on 2026-08-30 —
  see "Magic-link callback shape" for the evidence. It is manual and has no
  script, so it will drift unless deliberately re-run after any change to
  `proxy.ts`, `lib/supabase/session.ts`, or `app/auth/confirm/route.ts`.

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

## Magic-link callback shape (recorded 2026-08-30)

`app/auth/confirm/route.ts` first shipped reading only `token_hash` + `type`,
which is what a custom `{{ .TokenHash }}` email template sends. Supabase's
**default** template sends the user to `/auth/v1/verify` on the Supabase host,
which verifies the token and redirects back with `?code=`. Every real magic
link therefore landed on `/login?error=missing_token`. Nothing caught it because
no real link had ever been clicked — earlier sessions already held a session
cookie.

**RESOLVED 2026-08-30** by `ddaef6b`. The route now exchanges `code` for a
session, keeps the `token_hash` path for a custom template, and stops reporting
Supabase's own error query string as a missing token.

**Path B measured 2026-08-30.** Run against the dev server in a cookie-less
browser, with a real magic link emailed to a fresh `admin+pathb@tekguyz.com`
account (auth user `7023f7cb-5a43-4580-88a0-4fe0c18072b6`, created by this
sign-in). Both branches of `ddaef6b` are now proven:

- Session-less `GET /` redirected to `/login?next=%2F` with zero cookies.
- `signInWithOtp` wrote three PKCE cookies, including
  `sb-<ref>-auth-token-code-verifier` (159 chars) — so the client is in PKCE
  mode and the returning link necessarily carries `?code=`.
- The default template's link hit `/auth/v1/verify` on the Supabase host and
  answered `303 See Other` with
  `Location: http://localhost:3000/auth/confirm?code=<uuid>&next=%2F`. This is
  the exact shape the pre-`ddaef6b` route could not read.
- `GET /auth/confirm?code=…` returned `307`, wrote
  `sb-<ref>-auth-token` (2931 chars), and landed on `/`. The decoded access
  token carried `email: admin+pathb@tekguyz.com`, `role: authenticated`,
  `aal1`, 60 minutes to expiry, with a refresh token present.
- A second, separate `GET /` returned `200` through `proxy.ts` with no
  redirect, so the cookie round-trips on a fresh request and `getUser()`
  revalidates it.
- The page rendered "No notes yet" — a genuine empty result for a user who
  owns no rows, not `permission denied`. RLS is enforced against the identity
  the app supplies, not just against `verify-rls.mjs`'s password-grant JWT.

Two things this run did **not** establish. The persona fallback was not
observed: with no note to render, `DEFAULT_PERSONA_FALLBACK` never executes,
so "a fresh account falls back to one lens" is still inferred from code rather
than measured. And the browser could not open the Supabase host directly, so
the `/auth/v1/verify` hop was performed with `curl` and its `Location` header
handed to the browser. Every cookie-bearing request was the browser's; the hop
that was proxied carries no cookies and is identical either way.

**New finding — links are being consumed before use.** The first link came
back `otp_expired` on its first fetch, having never been opened. Either the
recipient opened it or something in the mail path pre-fetched it. A security
scanner that pre-clicks links breaks magic-link sign-in for every user on that
mail host, and no amount of app-side code fixes it. Worth confirming before
magic-link is the only way in.

**Cleanup — DONE 2026-08-30.** Deleted by the owner in the dashboard; this
repo cannot verify it, so the closure rests on that report. Original decision
below, kept because it governs every future Path B run. The
`admin+pathb@tekguyz.com` auth user (`7023f7cb-5a43-4580-88a0-4fe0c18072b6`)
owns no rows, so nothing cascades. Removal is a dashboard action by the owner
(Authentication → Users → delete), not a scripted one — this repo's secret key
is confined to `scripts/verify-rls.mjs` and gains no account-deletion path.
Re-running Path B creates a new user each time; delete each one after the run
rather than accumulating them.

## Auth — verified 2026-08-30

**Path B of the RLS proof is proven end to end.** Not a synthetic session: a
real magic link, emailed to a fresh `admin+pathb@tekguyz.com` account (auth
user `7023f7cb-5a43-4580-88a0-4fe0c18072b6`), loaded in a browser that started
with zero cookies. Full request-by-request evidence is under "Magic-link
callback shape" above; the two branches measured were:

- **Success path.** `signInWithOtp` wrote the PKCE code-verifier cookie, the
  default template's link returned `303` to
  `/auth/confirm?code=<uuid>&next=%2F`, the route exchanged it for
  `sb-<ref>-auth-token` (2931 chars), and a *second, separate* `GET /` came
  back `200` through `proxy.ts` with no redirect. The decoded token carried
  `email: admin+pathb@tekguyz.com`, `role: authenticated`, `aal1`. The page
  rendered "No notes yet" — a genuine empty RLS result for a user who owns no
  rows, **not** `permission denied`. That is the point of Path B: it proves the
  app hands the database the right identity, which a password-grant JWT in
  `scripts/verify-rls.mjs` cannot.

- **`otp_expired` branch.** Measured against a real expired link, not a
  hand-built query string. `/auth/confirm?error=access_denied&error_code=
  otp_expired…` redirected to `/login?error=invalid_token` and rendered "That
  link did not work. Request a new one." Not `missing_token`. Both halves of
  `ddaef6b` are therefore verified.

**Still unmeasured: `DEFAULT_PERSONA_FALLBACK`.** The fresh account owns no
notes, so no note rendered, so the fallback never executed. "A fresh account
falls back to one lens, not four" remains read from code rather than observed.
Measuring it needs a user who owns a note but no personas — seed one, or
render the fallback from a route that does not require a note.

Path B is manual and has no script. It will go stale silently unless
deliberately re-run after any change to `proxy.ts`, `lib/supabase/session.ts`,
or `app/auth/confirm/route.ts`.

## Magic-link tokens are spent by a GET, before any human clicks (recorded 2026-08-30)

**Open. Not built.**

Observed in this session: the first link emailed to `admin+pathb@tekguyz.com`
came back `otp_expired` on its very first fetch, having never been opened by a
person. That is consistent with a mail-path security scanner prefetching links
in the message body — standard behaviour for several mail providers and
gateways.

The cause is structural, not a bug in this repo. `app/auth/confirm/route.ts`
runs `exchangeCodeForSession` on a `GET`, and the one-time token is consumed by
whoever issues that `GET` first. A scanner is indistinguishable from a user at
that point. No amount of error handling fixes it: by the time the human clicks,
the token is legitimately spent, and the app correctly reports an invalid link.

The fix is architectural. The `GET` must not exchange anything — it should
render an interstitial ("Continue signing in") whose button issues a `POST`
that performs the exchange. A prefetching scanner does not submit forms, so the
token survives to the human. Cost: one extra click on every sign-in, and a page
that has no design yet — the Auth surface (App Surfaces 04) is unbuilt, so this
should be decided together with that surface rather than bolted on now.

Worth confirming the diagnosis before building: send a link, do not open it,
and check whether it is already spent. One observation is a signal, not a
proof, and the recipient may simply have opened it.

Until this is fixed, magic-link is unreliable on any mail host that prefetches,
which is a poor property for the only way into the app.
