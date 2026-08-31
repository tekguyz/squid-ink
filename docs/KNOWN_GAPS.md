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

**Amended 2026-08-31.** One of the ten is now built: **02b record HUD**, in
scope and briefed. The remaining nine are still unbuilt and still out of scope.
What shipped is not all of 02b either — the expanded jot pane and drag/snap were
deliberately left out, and three HUD states are invented rather than drawn. Both
are recorded under the recorder section below. Do not read "02b is built" as
"02b is finished".

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

**RESOLVED 2026-08-31 — that second surface arrived.** `lib/recorder/recorder-store.ts`
is the first real Zustand store in this codebase, and it is exactly the case the
note above anticipated. It lives at **module scope**, not inside a provider, and
`components/recorder/recorder-dock.tsx` is mounted once in `app/layout.tsx`. That
placement is the whole feature: a store re-created per route would reset on the
first link click, which is precisely the "ambient, not calendar-gated" decision
failing.

Two tests defend it. `recorder-store.test.ts` asserts that importing the module
twice yields the same state. In the browser, the store was driven into its
`error` phase on `/`, then navigated to `/notes/[id]`: the error message itself
survived the navigation, which is state persisting rather than a component
remounting.

The persona question is still open and still not built. The recorder does **not**
select a persona at capture time — notes are created persona-less and inherit the
default, same as every other write path. Whoever adds persona-at-capture should
put it in this store rather than lifting `note-detail-shell.tsx`'s local state.

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

**Amended 2026-08-31.** This paragraph describes the Note Detail build only, and
three of its items have since closed: Supabase, auth and the `/login` +
`/auth/confirm` routes shipped on 2026-08-30, and surface 02b shipped on
2026-08-31. Still unbuilt: the remaining nine App Surfaces screens, transcription
and RAG, PWA setup, brand assets, and the composer's send path. Read the dated
sections below rather than this one — it is kept for the reasoning, not as a
current inventory.

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

  **RESOLVED 2026-08-31, for storage only.** `supabase/schemas/storage_audio.sql`
  creates the private `audio-recordings` bucket (`public = false`) and three
  per-operation policies on `storage.objects` — `audio_recordings_select_own`,
  `audio_recordings_insert_own`, `audio_recordings_update_own` — each
  `to authenticated`, each scoped to `bucket_id = 'audio-recordings'`, each
  checking `(storage.foldername(name))[1] = (select auth.uid())::text`.
  Ownership lives in the object path (`{user_id}/{note_id}`), not in `owner_id`:
  a client chooses its own destination path, so the policy checks the same thing
  it enforces. Same reasoning as the composite foreign key on
  `note_chunks.persona_id`. Shipped as migration `20260831054118_storage_audio`,
  byte-identical to the schema file
  (`eae888edabb0d63fe67a1e67060d14aa4a99025d`). The note above was followed
  exactly: INSERT + SELECT + UPDATE together, no DELETE.

  **The `revoke all` discipline does NOT transfer to the storage schema, and
  this was measured rather than assumed.** `storage.objects` and
  `storage.buckets` are owned by `supabase_storage_admin`, and `anon`,
  `authenticated` and `service_role` each already hold `DELETE, INSERT,
  REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` on both — every one of them
  granted by `supabase_storage_admin`. Postgres only lets a role revoke grants
  that role itself made, so `revoke all on storage.objects from anon` run as
  `postgres` raises **no error and changes nothing**; a probe confirmed the
  privilege was still present afterwards. The workaround does not exist either:
  `postgres` is not a member of `supabase_storage_admin`, and `set role` to
  `supabase_storage_admin`, `supabase_privileged_role` and `supabase_admin` all
  fail with `42501`. The dashboard SQL editor connects as this same `postgres`
  role, so there is no path from this project to those grants at all. The schema
  file therefore does not pretend to own them, and says so at length.

  What keeps `anon` out is **RLS, not grants**: `storage.objects` has
  `relrowsecurity = true`, and the three policies above are the only policies on
  it, all `to authenticated`. A role with no policy matches no rows.
  `verify-storage-rls.mjs` confirms `anon` is refused select, insert and list.
  The same holds for DELETE: `authenticated` has the privilege and it cannot be
  revoked from here, but with no DELETE policy it matches no rows, so no
  authenticated user can delete an object.

  **Still open — `anon` holds TRUNCATE on `storage.objects` and
  `storage.buckets`, and RLS does not constrain TRUNCATE.** It is not reachable
  today: `supabase/config.toml` exposes only `public` and `graphql_public` to the
  Data API, so PostgREST cannot address `storage.*` under any role, and the
  Storage API never issues TRUNCATE. It is recorded here rather than silently
  accepted, because the mitigation is a config setting somebody could widen
  later, not a permission. Revisit if `storage` is ever added to
  `[api] schemas`.

  `node scripts/verify-storage-rls.mjs` proves the rest with the two existing
  fixture accounts: the owner inserts, reads back and overwrites at their own
  path; both cross-tenant directions are refused for insert, update and select;
  `list()` returns genuinely empty for the wrong user against a prefix the admin
  client confirms holds an object, which is what separates a denial from a plain
  miss. Every probe object is removed in a `finally`. One wrinkle worth keeping:
  the overwrite is confirmed through the `storage.objects` row, not through
  `download()` — Storage serves reads via a caching CDN and a `download()` issued
  immediately after an upsert returns the *pre-overwrite* body. It did exactly
  that while the script was being written, and a content-based re-read would have
  been a false failure.

  **Still open: no upload code, no playback UI.** Nothing writes
  `notes.audio_storage_path` yet — that is Track 2 (Recorder HUD), which uploads
  directly client-to-Storage under these policies. Playback is later still. No
  DELETE policy was added, deliberately: object deletion is tied to a
  note-deletion feature that does not exist, and cleanup in the verification
  script runs through the secret key for exactly that reason.

  **Upload code RESOLVED 2026-08-31. Playback UI is still missing.**
  `lib/recorder/upload-audio.ts` uploads directly client-to-Storage at
  `{user_id}/{note_id}` with `upsert: true`, and `app/notes/actions.ts` writes
  `audio_storage_path`. Proven end to end by four real browser recordings, not
  only by script — see the Recorder HUD section below. There is still **no way to
  play a recording back in the app**; `docs/qa/recorder-manual-test-protocol.md`
  pulls objects with the secret key and `ffprobe` instead.

  One asymmetry worth writing down, because it bit this track: **removing a test
  recording needs two different clients.** The row is deleted as the OWNER —
  `notes.sql` grants `public.notes` to `authenticated` only, so the secret key is
  `service_role` and gets `permission denied for table notes`. The object is
  deleted as the ADMIN — `storage_audio.sql` ships no DELETE policy, so no
  authenticated user can touch it. The first draft of
  `scripts/verify-recorder-upload.mjs` used the admin client for both, printed
  success without checking the error, and leaked two rows into the live project
  before anyone noticed. It now deletes as owner and asserts the row is gone.

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

  **RESOLVED 2026-08-31 for new accounts.** `supabase/schemas/persona_provisioning.sql`
  adds `public.provision_default_personas()`, a `security definer` function
  owned by `postgres` with `search_path` pinned empty, and an `after insert`
  trigger on `auth.users` that calls it. It writes the same four rows the seed
  owner has, values copied verbatim out of `supabase/seed.sql`; `id` is left to
  `gen_random_uuid()` because seed.sql's pinned uuids would collide at the
  second signup. Shipped as migration `20260831043837_persona_provisioning`.
  RLS on `public.personas` is unchanged — the function bypasses it by
  ownership, not by a policy — and `node scripts/verify-persona-provisioning.mjs`
  proves it end to end: it creates a real account through the admin API, reads
  the four rows twice (as `postgres` for raw truth, and as the new account's own
  `authenticated` session for what a signup actually sees), then deletes the
  account and confirms the cascade left nothing.

  **Still open: existing accounts are not backfilled.** The trigger fires on
  INSERT only, by design. `4tekguyz@gmail.com` predates it and still owns zero
  personas, so `DEFAULT_PERSONA_FALLBACK` remains live for that account and is
  still the crash floor, not dead code. Backfilling is a separate decision, as
  is persona deletion (see the `on delete set null` gap above) and the Personas
  UI itself (App Surface 03, ROADMAP §5).

- **The root route is a throwaway scaffold, not the Dashboard.** As of
  2026-08-31 `app/page.tsx` lists the signed-in user's notes newest-first as
  bare links, so Track 2 (Recorder HUD) and Track 3 (transcription) have
  somewhere to see that a note was created and open it. It had no design pass
  and is not App Surface 01 — that is Core UX/UI phase work which replaces this
  file wholesale. The file says so in a header comment; do not mistake it for a
  finished screen or iterate on it as one.

- **`lib/notes/get-latest-note-id.ts` is no longer called by application code.**
  The root route redirected to the newest note until 2026-08-31; listing them
  replaced that. The module and its three tests still pass and were left in
  place rather than deleted outside that change's stated file scope. Delete it,
  or give it a caller, when the real dashboard lands.

- **The colour-literal guard does not cover `app/`.**
  `components/note-detail/__tests__/project-conventions.test.ts` walks
  `components/` and `lib/` only (`const SCANNED = ["components", "lib"]`), so
  `app/page.tsx`, `app/login/`, `app/notes/[id]/` and `app/layout.tsx` are
  outside it. `app/globals.css` is *meant* to be outside — it is the one file
  that names colours — but the route files are unguarded by accident, not by
  design, and the guard passing says nothing about them. Widening `SCANNED` to
  include `app/` while excluding `globals.css` is a small change nobody has made
  yet.

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

**Also proven on Vercel, 2026-08-30.** The run above was against
`http://localhost:3000` — its own transcript records that `Location`. A separate
run was then measured against `https://squid-ink.vercel.app`, and the exchange
succeeded there too, with the server log reading `exchange OK`.

That second run cost a session of debugging, because the failures preceding it
looked like a regression and were not one. `app/auth/confirm/route.ts` was
byte-identical to the version that passed. The cause was procedural: the sign-in
was started in one browser and the emailed link opened in another. PKCE puts the
code verifier in a cookie, so the verifier and the click must share a browser.
Supabase returns `400 pkce_code_verifier_not_found`, whose own message names
this — "the auth flow was initiated in a different browser or device".

**Any future Path B run must use one browser start to finish.** Requesting the
link in one profile and opening it in another reproduces a failure that has
nothing to do with this repo.

`@supabase/ssr` 0.12.5 does not write one verifier cookie. The successful run
carried four, all under `sb-<ref>-auth-token`: two per-flow slots
(`-flow-<id>-code-verifier`, 159 chars each — one per pending sign-in), the
index (`-flows-code-verifier`, 102), and the fixed key (`-code-verifier`, 159).
Code that probes for a single guessed cookie name will be wrong.

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

**Still one observation, 2026-08-30.** A later run of failures looked like this
gap and was not. Those were `pkce_code_verifier_not_found` — a missing verifier
cookie, not a spent token — and a spent token returns a different error. So this
entry gains no corroboration from them and remains a single unconfirmed sighting.
The confirming test is unchanged: send a link, do not open it, then check whether
it is already spent.

## The repo has no record that it is deployed (recorded 2026-08-30)

**RESOLVED 2026-08-30** by `docs/DEPLOYMENT.md` — see the resolution below.

There is a live Vercel project, `tekguyz/squid-ink`, serving
`https://squid-ink.vercel.app` from `main` through a GitHub integration. It has
production deployments and two environment variables,
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

None of that is written down anywhere in this repo. There is no `.vercel`
directory, no `vercel.json`, and no deployment section in `CLAUDE.md` or
`README.md`. Until 2026-08-30 the handoff skill asserted outright that nothing
was deployed.

This is how the magic-link debugging session started from a false premise. A
passing localhost run and a failing production run were compared as if they were
the same environment, because nothing in the repo said a second environment
existed.

Two facts worth recording before they are lost again. The Supabase Site URL is
`https://squid-ink.vercel.app` exactly, and both
`https://squid-ink.vercel.app/auth/confirm` and
`http://localhost:3000/auth/confirm` are in the Redirect URL allowlist. This was
measured, not read from the dashboard: `GET /auth/v1/verify` with a junk token
honours an allowlisted `redirect_to` and falls back to the Site URL otherwise, so
sending three probes reveals both settings without a login.

**RESOLVED 2026-08-30** by `docs/DEPLOYMENT.md`, which is now the source of
truth for redirect and hosting config. It records the measured Site URL, the
corrected redirect allowlist, the Vercel project and environment variables, and —
the part that actually prevents a repeat — the `curl` recipes that re-measure all
of it without a dashboard login. DECISIONS.md § Deployment is trimmed to a
pointer at it.

**Amended 2026-08-30, after reading DECISIONS.md directly.** The file exists —
it lives in the owner's Claude.ai planning Project, not in the repo, which is why
`CLAUDE.md` and earlier entries here can cite a file that `find` cannot see. Its
§ Deployment is accurate and already records the Vercel URL, the two environment
variables, the Supabase Site URL and the redirect allowlist, and it flags its own
untracked state as an open item. So the config was written down; it was just
written down somewhere a session working in this repo cannot reach. That was the
gap, and `docs/DEPLOYMENT.md` is the in-repo home it needed.

### The redirect allowlist does not cover Vercel's own deployment URLs

The allowlist is `https://squid-ink.vercel.app/**`,
`https://squid-ink-*.vercel.app/**`, `http://localhost:3000/**`. Vercel names
this project's per-deployment URLs from the **package** name, so they read
`https://squid-<hash>-tekguyz.vercel.app` — `squid-`, not `squid-ink-`. They do
not match the pattern. Measured:

| Origin | Supabase honours it? |
|---|---|
| `squid-ink.vercel.app` | yes (Site URL) |
| `squid-ink-tekguyz.vercel.app` | yes |
| `squid-ink-git-main-tekguyz.vercel.app` | yes |
| `squid-h1qvo55b6-tekguyz.vercel.app` | **no — falls back to the Site URL** |

That fallback is silent. Signing in on a raw deployment URL sends
`emailRedirectTo` for that origin, Supabase quietly substitutes
`https://squid-ink.vercel.app`, and the returning link therefore lands on a
different origin from the one that holds the PKCE verifier cookie. The result is
`400 pkce_code_verifier_not_found` — the same error a two-browser sign-in
produces, from an entirely different cause. Server logs confirm the raw
deployment host was being browsed during the 2026-08-30 failures, so this may
have produced some of them.

**RESOLVED 2026-08-30.** `https://squid-*-tekguyz.vercel.app/**` was added to
the Redirect URL allowlist by the owner. Re-probed: both deployment URLs above
are now honoured, and a junk domain still falls back to the Site URL, so the
pattern did not widen the allowlist past Vercel's own hosts. A real magic-link
sign-in then succeeded on the un-instrumented build — `GET /auth/confirm`
followed by `GET /`, not `/login`.

One limit on that proof: the successful sign-in ran on
`https://squid-ink.vercel.app`, which was already allowlisted before the change.
So the deployment-URL path is verified by probe, not by a clicked link. Anyone
relying on it should sign in through a deployment URL once and confirm.

Note for future runs: the allowlist is written against the **package** name, and
the deployment prefix is derived from it. Renaming the npm package, or the Vercel
project, silently breaks this pattern again with no error message anywhere.

## Recorder HUD — system+mic capture, direct-to-Storage upload (recorded 2026-08-31)

### What shipped

`lib/recorder/` holds the capture path, one purpose-named file each:
`recorder-store.ts` (Zustand, module scope), `format-elapsed.ts`, `codec.ts`,
`audio-backup.ts` (IndexedDB), `device-handoff.ts`, `capture.ts`,
`upload-audio.ts`, `use-recorder.ts` (orchestration). `components/recorder/`
holds `record-hud.tsx`, `hud-level-bars.tsx` and `recorder-dock.tsx`, which
`app/layout.tsx` mounts once. `app/notes/actions.ts` writes the row.
`scripts/verify-recorder-upload.mjs` and `scripts/print-signin-link.mjs` prove
and support it. The suite went from 64 tests to **165 across 20 files**
(measured 2026-08-31 with `npm test`, after the post-merge refactor added one
more than the 164 first recorded here).

**No schema change was needed, and that was verified rather than assumed.** The
live check constraint was read back from `pg_constraint` before any code
depended on it: `processing_status` already allows
`('local','uploading','analyzing','completed')`, and `audio_storage_path text`
and `audio_duration_seconds integer` already existed. No migration ships here.

### `processing_status` is `'uploading'`, written before the bytes move

The row is created as the upload **starts**, not after it succeeds. That is
possible because the Storage path is deterministic: the note id is generated on
the client before capture begins, so `{user_id}/{note_id}` is known up front.

**This track never writes `'analyzing'` or `'completed'`.** Both belong to Track
3, and writing `'analyzing'` as a handoff value would claim a model pass that
nothing performs. `app/notes/__tests__/actions.test.ts` asserts it explicitly.
Every note this track creates therefore sits at `'uploading'` forever, and its
IndexedDB blob is correctly never discarded, because discard is gated on
`'completed'`.

Confirmed by four real browser recordings on 2026-08-31: in every one the notes
row's `created_at` precedes the storage object's by 0.45–1.1 s.

### A failed upload strands TWO things, with no reconciliation path

The largest thing this track leaves open, and a direct consequence of the
ordering above:

1. a `notes` row at `'uploading'` whose `audio_storage_path` points at an object
   that does not exist, and
2. an IndexedDB `recorder-backup` entry holding the only copy of the audio.

Nothing reconciles them. There is no retry (deliberately — the requirement was
that a failure be *visible*, not one-click recoverable), no sweeper, no expiry,
and no UI that lists orphans. The user sees an untitled note that will never
process, with no way to act on it, and **IndexedDB grows without bound for
anyone who records offline.**

Two decisions are owed:

- **Track 3 must check the object actually exists before dispatching a
  transcription.** An `'uploading'` row is not a promise of audio.
- Something must own reconciliation — a resume-upload path that reads the
  IndexedDB blob for an `'uploading'` row, or an expiry that fails the row and
  frees the blob.

The alternative ordering (write the row only after a successful upload) was
considered and rejected: it makes the failure invisible and loses the recording
with no trace.

### Three HUD states are INVENTED, not from the design

Verified by reading `design-reference/App Surfaces.dc.html`, not from memory.
Surface 02b defines exactly four state labels — `Idle · docked bottom-right,
above every app`, `Recording · collapsed`, `Paused · capture held, nothing
discarded`, `Expanded · jot without leaving what you're doing`. Searching the
**entire** file for `error`, `retry`, `try again`, `upload failed` and `dismiss`
returns one hit: the word "dismissible" in surface 09's label, a different
surface.

So the design has no error state, no permission-pending state and no upload
state anywhere. Three pills were invented to fill that gap:

| Pill | Copy | Source |
|---|---|---|
| idle / recording / paused | as designed | **02b, verbatim** |
| `requesting` | "Waiting for permission" | **invented** |
| `stopping` / `uploading` | "Finishing" / "Uploading" | **invented** |
| `error` | message + "The recording is kept on this device." + Dismiss | **invented** |

They reuse only 02b's pill geometry and tokens. They are necessary — a permission
prompt takes real seconds, and a failed upload must be visible — but they have
had **no design pass and should be treated as placeholder** when the Core UX/UI
phase reaches the recorder.

### `--live` light-theme value is derived, not from the design

02b is a dark-only surface and the design file contains no light-theme red at
all. `--live` dark is `oklch(0.66 0.19 25)`, lifted verbatim. `--live` light is
`oklch(0.520 0.170 25)`, **derived** by following the existing accent pattern
where the dark token is light and the light token is dark. Same status as the
values in "Tokens not enumerated in 3c" above: it works, it has not been
approved by a designer. `--shadow-hud` light is derived the same way.

### The backup buffer stores bytes, not a Blob

`audio-backup.ts` stores an `ArrayBuffer` plus a mime type and reconstructs the
Blob on read. Two reasons, and the first is not merely a test concern:
Blob-in-IndexedDB is the historically flaky path (Safari has shipped versions
that hand back something unusable), and `fake-indexeddb` cannot structured-clone
a jsdom Blob at all — it returns an empty object and the bytes vanish silently.
Storing a Blob would leave this data-loss guard with no test that its contents
survive. Measured, not assumed: an `ArrayBuffer` round-trips exactly.

### Not built from surface 02b

- **The expanded jot pane.** It renders "rough notes", and no column or table
  exists for them — `notes.raw_transcript` is the transcript, not the user's
  notes. Building the UI without a home for its data would be guessing at a
  schema decision this track does not own.
- **Drag and snap-to-corner.** The caption is rendered because it is the
  design's copy; the dock is fixed bottom-right.
- **`OPEN FULL PANE`** (surface 02) and **`CHANGE PERSONA`** at capture time.

### Not built at all

The full encrypted 48-hour backup buffer (Core UX/UI phase — only the light
version ships here, unencrypted, no expiry). Transcription and every
`processing_status` transition past `'uploading'` (Track 3). Playback. Note
deletion. Resume-upload after a failure. A mic-only mode — system+mic is
mandatory, not optional.

### Verified in a real browser, and what that did not cover

Chrome 148 / Windows 11, `MediaRecorder.isTypeSupported`:

    audio/webm;codecs=opus      ->  true      <- selected
    audio/webm                  ->  true
    audio/mp4;codecs=mp4a.40.2  ->  true
    audio/mp4                   ->  true
    audio/ogg;codecs=opus       ->  false

Chromium accepts the MP4 strings too, so the WebM-first order in
`CODEC_CANDIDATES` is **load-bearing** — reorder it and Chromium starts
producing MP4. **Safari's strings are implemented but unverified**; Section C of
`docs/qa/recorder-manual-test-protocol.md` is the only thing that will settle
them.

Four real recordings, and the bitrate is the finding worth keeping:

| Condition | Duration | Size | Bitrate |
|---|---|---|---|
| Mic muted, silent tab | 29 s | 7,441 B | 2.1 kbit/s |
| Mic muted, silent tab | 29 s | 7,469 B | 2.1 kbit/s |
| Mic live, speech | 26 s | 98,963 B | 30.5 kbit/s |
| Mic live + tab audio | 43 s | 700,869 B | 130 kbit/s |

**A muted mic produces a file that looks like a successful recording.** Opus
compresses near-silence to ~2 kbit/s, the HUD goes green, the note appears, the
object lands. Only the bitrate distinguishes it from a real capture. This is the
easiest failure in the feature to miss, and every QA section now ends with that
check.

Not covered by any of the above: **device handoff, real-world echo, and Safari.**
None is automatable here. They have a runnable checklist, and a skipped section
is not a passed one.

### `getDisplayMedia` asks for video on purpose

`capture.ts` requests `{ audio: true, video: true }` and stops the video track
the moment it arrives. Chromium does not offer tab or system audio for an
audio-only display request — the audio checkbox simply is not shown. It is a
permission-dialog tax, not something recorded. Do not "clean this up."

Related: `MediaRecorder` is given the Web Audio destination node's stream, never
the mic stream. That indirection is the only reason `replaceMic()` can swap a
microphone mid-recording without ending the recording.
