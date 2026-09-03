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

The recorder does **not** select a persona at capture time — notes are created
persona-less and inherit the default, same as every other write path. That is a
build state, not an open question: see the addendum below, "Persona timing is
decided". Whoever adds persona-at-capture should put it in this store rather
than lifting `note-detail-shell.tsx`'s local state.

Provenance: **superseded 2026-08-31.** `DECISIONS.md` and `ROADMAP.md` were
knowledge files in the owner's Claude.ai planning Project and were not on disk
here, so anything this repo said about them was an unverifiable transcription.
They now live at `docs/DECISIONS.md` and `docs/ROADMAP.md`, and `docs/` is the
source of truth — the planning Project attaches them from here. Quote them
directly; a claim about their contents is now checkable rather than relayed.

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
2026-08-31. Still unbuilt: the remaining nine App Surfaces screens, RAG,
PWA setup, brand assets, and the composer's send path. **Transcription closed
too, in two steps:** the cron sweep on 2026-08-31 and the user-pressed
Transcribe action on 2026-09-01 — see the dated sections below. Read the dated
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

Both were knowledge files in the owner's Claude.ai planning Project when this
entry was written; they moved into the tree on 2026-08-31 and are now
`docs/ROADMAP.md` and `docs/DECISIONS.md`. Read directly on 2026-08-30 and
reconciled against what shipped. Nothing built here contradicts them. Four
things worth carrying forward:

- **`Persona.depth` exists but nothing consumes it.** ROADMAP §5 defines a
  Persona as three things: lens, **depth/goal (Brief / Dense / Exhaustive)**,
  and quick-actions.

  **RESOLVED 2026-08-30, partly.** `depth` is now a `PersonaDepth` field on the
  view type in `lib/notes/view-types.ts` and a checked `depth` column on
  `public.personas`. All four seeded personas carry `'dense'`, the column
  default — the pre-change constants encoded no depth, so none was invented.
  What is still owed is the *behaviour*: no UI control sets depth and nothing
  reads it. The shape is complete; the pipeline that would honour it does
  not exist yet.

  **Amended 2026-09-01.** The parenthesis here read "Exhaustive may route note
  generation to Gemini Pro rather than Flash". DECISIONS.md § "Structured note
  generation" closed that on 2026-09-01: single model, Gemini 3.7 Flash for all
  three depths, with depth carried by `thinking_level` plus a wider prompt
  scope. Depth is no longer a model-routing decision at all.

  **CLOSED 2026-09-02.** `lib/notegen/depth-policy.ts` consumes it.
  `planForDepth` maps Brief to `thinking_level: 'low'` and a
  decisions-and-actions scope, Dense to `'medium'` and a balanced scope, and
  Exhaustive to `'high'` and a cross-referencing scope — scope, not only
  length, per the decision above. `lib/notegen/notegen-ports.ts` reads the
  `depth` column per note through `resolvePersonaFor`, and
  `lib/notegen/gemini-client.ts` sends the level on the one
  `interactions.create` call. Proved live on 2026-09-02 by
  `scripts/verify-notegen-pipeline.mjs`, which read `depth=dense` off the
  owner's row and generated at `thinking_level: 'medium'`.

  **Two things this did NOT close. One has since closed; the other is still
  open, and is not a defect.**

  **Depth exposure — STILL OPEN.** No UI control sets depth, so every persona
  still carries the `'dense'` column default. Brief and Exhaustive are
  reachable today only by editing a row by hand, and live verification has
  therefore exercised Dense alone. ROADMAP §5 / Core UX/UI. Nothing below
  changes this: lens selection and depth selection are separate surfaces, and
  shipping the first did not ship the second.

  **Lens selection — CLOSED 2026-09-02, and not where this paragraph expected
  it.** The sentence this replaces said "the recorder still selects no persona
  at capture". The recorder still does not, and deliberately: capture stays one
  click, because a picker in front of an ambient recorder is a reason not to
  hit record. Selection moved to Note Detail instead, where the reader already
  is and where there is time to choose.

  `notes.persona_id` is a nullable uuid with a composite FK to
  `personas (id, user_id)`. `app/notes/actions/persona.ts` writes it behind a
  guarded UPDATE, and `lib/notegen/resolve-persona.ts` resolves it ahead of the
  `neutral-analyst` slug. The claim in `lib/notegen/notegen-ports.ts` returns
  `persona_id` from its own `RETURNING`, so generation reads the value its own
  row lock froze rather than a later one.

  So the other three framings in `lib/notegen/lens-prompts.ts` are no longer
  "shipped and unit-tested but unexercised end to end". Proved live by
  `scripts/verify-persona-selection.mjs`, which generated the same sales-call
  transcript twice. Sales Coach: *"The rep immediately conceded a 15% discount
  upon hearing the price objection without exploring the objection or defending
  value."* Neutral Analyst on the identical input: *"The Rep offered a
  potential 15% discount contingent on signing this quarter."* Second person
  and critical against third person and reportorial — the lens is doing work,
  which a row count could never have shown.

  **ACCEPTED, NOT PROVED: the `DEFAULT_PERSONA_FALLBACK` branch is
  unit-tested only.** Recorded 2026-09-02, deliberately, so that it does not
  quietly become "proved" in anybody's memory later.

  `resolvePersonaFor` returns `DEFAULT_PERSONA_FALLBACK` when a user owns no
  `neutral-analyst` row — an account created before the 2026-08-31
  provisioning trigger and deliberately not backfilled. There is a unit test
  for the resolution itself and another proving generation *completes* on the
  fallback rather than throwing. **Neither is a live proof.**

  Live proof requires an account with no `neutral-analyst` row.
  `scripts/verify-notegen-pipeline.mjs` signs in as `RLS_TEST_OWNER_EMAIL`,
  which is seeded and provisioned, so every run reports `source=row`.

  **Measured 2026-09-02, and it splits the gap in two.** Reading
  `auth.users` against `personas` gives:

      4tekguyz@gmail.com               0 persona rows,  0 notes
      admin@tekguyz.com                4 persona rows,  2 notes
      squid-ink-owner@example.test     4 persona rows,  2 notes
      squid-ink-intruder@example.test  1 persona row,   0 notes

  `4tekguyz@gmail.com` is genuinely unprovisioned, so it *would* take the
  fallback — but it owns **no notes at all**. That means:

  - **`resolvePersonaFor` returning the fallback is cheap to prove today.**
    It takes a user id, not a note. Call it with that account's id and assert
    `source === "fallback"`.

    **DONE 2026-09-02**, as Proof 6 of `scripts/verify-persona-selection.mjs`.
    It re-reads the persona count first — so this closing cannot survive the
    account being provisioned later — then calls `resolvePersonaFor` with that
    user id and gets `source=fallback`. It reads as `service_role`, which is
    both the only way to reach across accounts and the way the cron genuinely
    reaches this branch in production, so it is the real path rather than a
    contrivance. The same proof also covers the new precedence: a `persona_id`
    belonging to somebody else falls **through** to the same fallback rather
    than throwing.

  - **Generation *through* the fallback is still not proved**, because there
    is no note to generate from. Proving that end to end needs a note created
    for that account first, which is a deliberate act nobody has had reason to
    perform. **Still open.**

  One half is now verified and one is not. Do not let the first close stand in
  for the second — the whole reason this entry was written was to stop exactly
  that substitution.

  Same shape as the gap recorded further down this file for the shell's own
  use of that constant, and it should be closed at the same time.

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
  owed.

  **Confirmed against the file 2026-08-31**, once DECISIONS.md was in the tree.
  It says four (`docs/DECISIONS.md:210`), and the trigger seeds exactly four —
  Neutral Analyst, Sales Coach, Investor, Engineering Lead
  (`supabase/schemas/persona_provisioning.sql:36-43`). This closure no longer
  rests on a report of an edit; it rests on both files.

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

  **Upload code RESOLVED 2026-08-31. Playback UI RESOLVED 2026-08-31.**
  `lib/recorder/upload-audio.ts` uploads directly client-to-Storage at
  `{user_id}/{note_id}` with `upsert: true`, and `app/notes/actions/recording.ts`
  writes `audio_storage_path` (that file was `app/notes/actions.ts` until the
  2026-09-01 split by track). Proven end to end by four real browser recordings, not
  only by script — see the Recorder HUD section below.

  A recording can now be **played back in the app**. `lib/notes/audio-playback.ts`
  reads the object with the BROWSER Supabase client, so the same three policies
  authorise the read; existence is proved with `list()`, and the Blob is re-typed
  from the object's own metadata before an object URL is made, because
  `download()` labels every Blob `application/octet-stream`. That MIME rule was
  **moved, not copied**, into `lib/audio/mime-type.ts`; `gemini-client.ts`
  re-exports it so `app/api/cron/transcribe` was untouched, and the bucket name
  is still the one `AUDIO_BUCKET` constant. `components/note-detail/audio-player.tsx`
  renders play/pause, an mm:ss clock and a seek bar, all on system tokens with
  zero border radius — a native `<audio controls>` would have shipped
  untokenised browser chrome into both themes. Object URLs are revoked on
  unmount and on note change.

  Verified in a real browser on 2026-08-31 against note
  `c0ffee00-1111-4111-8111-0000000000aa`, seeded with a real 452 KB WAV and
  removed afterwards: `readyState` 4, `currentTime` advancing, `aria-pressed`
  flipping. **Nobody listened to it** — that a waveform decodes is machine-
  checkable, that it sounds right is not, and
  `docs/qa/recorder-manual-test-protocol.md` still owns that. Three states were
  exercised in the running app: audio present and playing, path present but
  object missing ("Audio unavailable", no throw), and a null path (no player at
  all). Still no DELETE policy, no export, and no waveform scrubber — ROADMAP §8
  keeps the scrubber behind speaker tags.

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

**RESOLVED 2026-09-01.** See the closing note below.

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

**RESOLVED 2026-09-01.** Owner-attributed to test procedure, not mail prefetch.
Repeated owner testing traced the `otp_expired`-before-open pattern to
multi-browser test handling — requesting a sign-in link in one browser session
and opening or re-sharing it in another, plus other test-procedure artifacts.
This is a distinct failure mode from mail-path prefetching, and is the same
class of error already documented in "Auth — verified 2026-08-30" (PKCE
code-verifier mismatch across browsers, though that entry's specific error was
`pkce_code_verifier_not_found`, not `otp_expired`). No corroborating sighting
of genuine mail-path prefetching exists. This gap is closed; magic-link is not
considered unreliable on this basis. Any future report of a link expiring
before being opened should first rule out cross-browser/cross-session link
handling before this theory is reopened.

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
at the time it lived in the owner's Claude.ai planning Project and not in the
repo, which is why `CLAUDE.md` and earlier entries here could cite a file that
`find` could not see. **That is no longer true: it moved to `docs/DECISIONS.md`
on 2026-08-31 and `find` sees it.** Its
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
`app/layout.tsx` mounts once. `app/notes/actions/recording.ts` writes the row
(`app/notes/actions.ts` until the 2026-09-01 split by track).
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

**Superseded in part, 2026-08-31.** Track 3 shipped, so `'analyzing'` and
`'completed'` are now written — by `app/api/cron/transcribe`, not by the
recorder. The recorder still writes only `'uploading'`, and the assertion in
`app/notes/__tests__/actions.test.ts` still holds. A note no longer "sits at
`'uploading'` forever": it advances on the next cron sweep, which on the Vercel
Hobby plan is **once a day** (see `docs/DEPLOYMENT.md`). The IndexedDB blob is
still discarded only on `'completed'`.

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

**RESOLVED (design) 2026-08-31, planning session. Not yet built — Track 3 owns
the implementation.** Reconciliation is **two-tier**, keyed on whether the
session survived the failure:

1. **In-session failure.** On a caught upload error, write
   `processing_status = 'failed'` immediately. No threshold and no waiting: the
   failure is already known to the client that caused it.
2. **Lost-session orphan.** Track 3, on meeting an `'uploading'` row older than
   **1 hour**, checks whether the object exists. Present → proceed, because the
   upload actually succeeded and only the client's write-back was lost. Absent →
   mark `'failed'`.

Both branches terminate at `'failed'` or `'completed'`. **IndexedDB blob cleanup
keys off that pair, never off `'uploading'` alone** — an `'uploading'` row is
still not a promise of audio, and deleting the blob while one is outstanding
would destroy the only copy.

**Resume-upload was considered and rejected.** It is the same one-click
recoverability already rejected for the in-session error state, so accepting it
here would reverse that decision by the back door rather than on its merits.

Two things the design assumed were left unverified, and both were measured on
2026-08-31 rather than assumed:

- **Tier 1 is NOT implemented.** `app/notes/actions.ts` writes
  `processing_status: 'uploading'` and nothing in `lib/recorder/` writes any
  other value — there is no `'failed'` write anywhere in the tree. Track 3 must
  add it; it cannot assume either state.
- **The check constraint does not allow `'failed'`.** `supabase/schemas/notes.sql`
  line 15 reads `check (processing_status in ('local', 'uploading', 'analyzing',
  'completed'))`. Adding `'failed'` is a schema change. Bundle it into Track 3's
  migration, which already has to touch this constraint for `'analyzing'`.

**BUILT 2026-08-31, Track 3 — tier 2 only.** `lib/transcription/sweep.ts` now
does both halves of tier 2. An `'uploading'` row past one hour with **no object
at its path** is marked `'failed'`. An `'analyzing'` row past one hour — a
transcription function that died mid-flight — is marked `'failed'` by the
identical query shape against a different status value, deliberately not a
second mechanism.

Age alone never fails a row. An old `'uploading'` row whose object **is** present
is transcribed, because that is a lost client write-back rather than a lost
upload. The one-hour threshold exists only to avoid false-failing a slow-but-real
upload; object existence is the actual safety check, read from `list()` metadata
and never from `download()`.

`supabase/schemas/notes.sql` now allows `'failed'`, exactly as the note above
required. Verified by reading `pg_constraint` back from the live catalog.

**TIER 1 BUILT 2026-08-31.** `markUploadFailed(noteId)` — in `app/notes/actions.ts`
when it shipped, in `app/notes/actions/recording.ts` since the 2026-09-01 split —
writes `processing_status = 'failed'` through the **authenticated** server
client — never the secret key, which stays confined to
`app/api/cron/transcribe/route.ts`. It is called from the `catch` in
`stop()` in `lib/recorder/use-recorder.ts`, on the client's first knowledge of
the error. An in-session upload failure is now terminal within milliseconds
instead of waiting up to 24 h for the daily Hobby cron.

The write carries the **same atomic-claim guard as tier 2**:
`.eq('processing_status', 'uploading')`. Postgres row-locks the matched row, so
a duplicate call, or a race with a cron invocation that already advanced the row
to `'analyzing'` or `'completed'`, matches zero rows instead of dragging
finished work back to a terminal state. Zero rows matched is not an error. No
`user_id` filter — RLS supplies the owner, and an application filter would mask
an RLS failure rather than expose it. `'failed'` was confirmed present in
`notes_processing_status_check` by reading `pg_constraint` back from the live
catalog before the code was written; no schema change was needed.

**The catch was narrowed, because tier 1 has no evidence behind it.** Tier 2
fails a row only after confirming the object is absent; tier 1 fires purely on
"the client caught an error", and `'failed'` is terminal with no retry path.
Going in, the `try` in `stop()` spanned `getUserId()`, `createNote()`,
`uploadRecording()` **and** `store.getState().finish()` — four things, only one
of them the Storage transfer. Two changes fenced it:

1. `finish()` moved **out** of the `try`. A throw from a store update must never
   mark a note that uploaded fine as failed.
2. A `rowWritten` discriminator is set immediately after `createNote()`
   resolves. A throw from the session lookup or from the row write means there
   is no row to fail, and tier 1 does not fire.

One write per failed attempt, and no retry of the write itself. If it throws —
an offline client is the obvious case — it is logged and dropped, and tier 2
remains the net. A retry loop there would be a second reconciliation path for a
single failure. `store.getState().fail(...)` still runs first and unchanged, so
the HUD error pill behaves exactly as before.

**IndexedDB cleanup behaviour is unchanged by this.** Nothing on this path
touches `lib/recorder/audio-backup.ts`. The backup blob is still discarded only
on `'completed'`, so a row that now reaches `'failed'` in seconds rather than in
a day keeps its audio indefinitely — deliberately, since nothing can resume an
upload from it and deleting it would destroy the only copy.

**IndexedDB cleanup is still unbuilt.** The backup blob is discarded only on
`'completed'`. Rows that now reach `'failed'` keep their blob indefinitely, which
is the correct conservative choice — nothing can resume an upload from it, but
deleting it would destroy the only copy of the audio. The unbounded-growth
problem the original entry names is therefore **narrowed, not closed**.

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
mandatory, not optional; see "Cancelling the share picker kills the recording"
below for what that costs and why it is now an open question.

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

### Cancelling the share picker kills the recording — there is no mic-only path (recorded 2026-09-01)

The line under "Not built at all" above — "A mic-only mode — system+mic is
mandatory, not optional" — is accurate but too thin to plan against. It does not
say what happens when the user declines the system-audio prompt, and the answer
is worse than "no system audio".

**Measured in the code, 2026-09-01, after the owner reported it in a real
browser.** `startCapture()` in `lib/recorder/capture.ts:70` calls
`getDisplayMedia({ audio: true, video: true })` first, and **does not wrap it**.
Cancelling Chromium's share picker rejects with `NotAllowedError`, which escapes
to the single `catch` in `lib/recorder/use-recorder.ts:117`. That `catch` tears
the session down and puts the store in `error`. The `getUserMedia` mic prompt on
the next line **never runs**, so no microphone is opened and nothing is
recorded. The HUD shows the raw error message and, by the deliberate decision
recorded in `components/recorder/record-hud.tsx:25`, offers no retry — so a
cancelled picker is a dead end until the user starts over.

The ordering is deliberate and its comment says so: system audio goes first
because "its picker is the one the user is most likely to cancel", and failing
before the mic prompt means one fewer dialog to dismiss. That reasoning assumes
cancel means **abandon the recording**. The owner's reading is the opposite:
cancel means **record my microphone only**.

**The prior build had the fallback this one does not.** Reported by the owner
2026-09-01: earlier versions offered local recording as its own option, and a
cancelled system-audio prompt fell through to the microphone rather than
failing. Relayed, not verified against v1 source here.

**Why it matters, per the owner, 2026-09-01.** The app is primarily for
meetings, but local recording is a first-class case of equal value, not a
degraded one — an in-person meeting with no tab to share, or **Android, where
the OS exposes no system-audio capture at all** and the user may have no Windows
machine to fall back to. Under the current code every one of those users hits
the dead end above.

**This is not the local-first item ROADMAP §7 rejects.** §7 puts
"local-first/offline recording with on-device transcription" out of scope on the
grounds that it needs its own ASR and sync engine. A mic-only capture path needs
neither: the bytes still upload to Storage and Gemini still transcribes them.
Only the number of input tracks changes. Do not let the two be confused — the
rejection does not reach this.

**It also collides with the PWA.** ROADMAP § 2's app-shell row and § 8's Core
UX/UI list both plan an installable PWA, and DECISIONS.md § PWA carries it. An Android install of that PWA cannot satisfy
a mandatory `getDisplayMedia` audio request. Either mic-only ships or the PWA is
desktop-only in practice; nothing currently records which.

Two ways out were identified, neither built and neither chosen:

- **Catch and fall through.** Wrap the `getDisplayMedia` call; on rejection,
  continue to `getUserMedia` and build the graph with the mic branch only. One
  code path, no new UI, but it makes an accidental cancel silently produce a
  meeting recording with no meeting audio in it — the same class of quiet
  failure as the muted-mic case above.
- **A deliberate mode chosen before recording starts.** The user picks
  "meeting" or "local" and only the matching prompts appear. Honest about what
  is being captured, and the only shape that works on Android, but it needs a
  design decision and HUD copy that surface 02b does not have.

**Owner's call, not a code decision.** Recorded here so the planning Project
briefs it rather than rediscovering it. `capture.ts` is written against an
injectable `CaptureDeps`, so either shape is testable without a browser.

**DECIDED 2026-09-01, by the owner: the mode is chosen before recording starts,
never by a failed prompt.** A cancelled picker must never silently become a
different kind of recording. Everything below follows from that.

**DECIDED 2026-09-01: Android selects local automatically, and shows no
choice.** Chrome on Android does not implement `getDisplayMedia` at all, so
there is nothing to offer. The rule is a **capability check, not a device
check** — `typeof navigator.mediaDevices?.getDisplayMedia === "function"` — so
no user-agent string is parsed and the branch flips on its own if Android ever
ships support. When it is false there is one mode, no picker, and the HUD says
so.

**NOT VERIFIED on a real device.** The absence above matches Chrome's
documented support and nothing here can test it — this machine has no Android
handset and jsdom has neither API. It belongs in
`docs/qa/recorder-manual-test-protocol.md` as a real-device check before it is
trusted, in the same class as device handoff, echo and Safari.

**Still open: how desktop displays the two modes.** The choice itself is
settled; only its presentation is not. Two shapes were named, neither chosen:

- **Two start controls** — "Record meeting" and "Record locally" — so the
  intent is picked by which control is pressed.
- **One record control plus a mode switch beside it**, remembering the last
  choice.

This is a design question, not an implementation one, and it is deliberately
left to a design pass rather than settled in this file. Surface 02b has copy
for neither, so whichever wins needs new copy as well as new controls.

## Transcription pipeline (recorded 2026-08-31)

What shipped: a `CRON_SECRET`-gated Vercel Cron sweep that claims `'uploading'`
rows atomically, transcribes them with Gemini 3.5 Transcribe, writes
`notes.raw_transcript` plus speaker-tagged `note_chunks`, and reconciles both
stale-row classes to `'failed'`. Proven end to end against the linked project by
`scripts/verify-transcription-pipeline.mjs`.

Below is what it deliberately does **not** do.

### No Realtime push — status changes appear on next page load only

**AMENDED 2026-09-03.** The symptom described below is closed; the gap in the
title is not. `components/note-detail/use-transcription-poll.ts` shipped
2026-09-01 — a **bounded poll**, 5 s interval with a 10-minute cap, watching one
row on the page the reader is already looking at, which refreshes the server
render when that note goes terminal. So a note that finishes while the page is
open now updates itself. Realtime is still absent, and the deferral reasoning
below still stands: a subscription is the right eventual shape, a poll of one
row is not, and neither changes the fact that the wait is dominated by the cron
schedule. What follows described the state before that poll existed.

A note that finishes transcribing while the page is open keeps showing its old
status until a navigation or a refresh. Supabase Realtime was explicitly out of
scope for this track, and this is a deferral rather than an oversight.

On the current cron schedule the wait dominates anyway (see below), so Realtime
would be polishing the wrong end of the latency. Revisit it together with the
schedule, not before.

### Transcription latency is bounded by the Vercel plan, not by the code

**Measured 2026-08-31:** the TEKGUYZ team is on Vercel's **Hobby** plan, where a
cron job may fire **once per day** — an expression more frequent than that fails
deployment outright — and a function is capped at **300 s**, which is both the
default and the hard maximum with no extension available.

So a recording can sit at `'uploading'` for up to 24 hours. `vercel.json` runs
the sweep at `0 7 * * *`, and Hobby may fire it anywhere inside that hour.

The workaround, and what the verification script uses, is that the route is
callable on demand:

    curl -H "Authorization: Bearer $CRON_SECRET" https://squid-ink.vercel.app/api/cron/transcribe

Moving to Pro makes the schedule a one-line change in `vercel.json` and lets
`maxDuration` and `MAX_TRANSCRIPTIONS_PER_RUN` rise together. Re-measure the plan
before changing either — `docs/DEPLOYMENT.md` holds the numbers and the command
that produced them.

### Framed controls sit at ~1.4:1 against the sheet (recorded 2026-09-01)

**Open. Deliberately not fixed, because the fix is an app-wide token change and
the owner has not been asked.**

Every framed surface in this app draws its 1px edge with `rule-2`. Measured
in-page on 2026-09-01, both themes, against the sheet behind it:

| | light | dark |
|---|---|---|
| `border-rule-2` vs `paper` | **1.40:1** | **1.47:1** |
| `border-rule` vs `paper` | ~1.45:1 | ~1.35:1 |

WCAG 1.4.11 asks 3:1 for "visual information **required** to identify user
interface components". Nothing here reaches it, and nothing in the existing
neutral palette does either short of `faint` (~2.4 / ~2.9) or `muted`
(~5.5 / ~5.9) — the latter being a visibly heavier line than the design draws
anywhere today.

**Why this is recorded rather than failed.** The word in 1.4.11 is *required*.
Each of these controls carries a text label well clear of 4.5:1 — the Transcribe
button's is 5.4:1, the audio player's the same, the pill labels 5.5–9.3:1 — so
the label, not the edge, is what identifies the control. On that reading the
success criterion is met and the 1.4:1 edge is a **discoverability** concern,
which is exactly how `/impeccable critique` raised it on 2026-09-01: in dark
theme the Transcribe button's fill was *identical* to the sheet, leaving the
hairline as the only evidence a control was there at all. That half was fixed
— `bg-canvas` → `bg-raised` in both `transcribe-button.tsx` and
`audio-player.tsx` — and the edge was left alone.

**Three ways out, none chosen, and the choice is the owner's:**

- **Raise `--rule-2` itself** in `app/globals.css`. One edit, reaches every
  framed surface at once, and changes the look of the whole application — the
  insight cards, the persona rail, the transcript pane. A DESIGN.md-level
  decision, not a component fix.
- **Give interactive controls their own boundary token**, leaving decorative
  frames on `rule-2`. Defensible — a control and a container are not the same
  object — but it is a new token plus a sweep of every button in the tree
  (`transcribe-button`, `audio-player`, `persona-rail`, `theme-toggle`,
  `record-hud`), and half-applying it is worse than not starting.
- **Leave it.** The labels carry identification, the fills now carry presence,
  and the hairline stays the quiet line the design was drawn with.

Do **not** fix this for one component in isolation. A single button with a
heavier edge than everything around it is a worse outcome than the measurement
that prompted it.

### RESOLVED 2026-09-01 — the cron sweep is no longer the only transcription trigger

**Shipped: the second of the two options below — a deliberate "Transcribe"
action the user presses.** The first option, a route the recorder calls on
stop, was *not* built: the owner has said immediate transcription is not
required, and no automatic trigger was added anywhere. There is also
deliberately **no retry for a `'failed'` note** — `'failed'` stays terminal,
and `components/note-detail/transcribe-button.tsx` returns `null` rather than a
disabled control so there is no element to re-enable.

What shipped, and where:

- `triggerTranscription(noteId)` in `app/notes/actions/transcription.ts` — a
  Server Action,
  not a route. It runs as the signed-in user through the cookie client; RLS
  confines it to that user's own note, so a request for somebody else's row
  returns zero claimed rows exactly as a status mismatch does.
  `app/api/cron/transcribe/route.ts` is still the only shipped file that reads
  `SUPABASE_SECRET_KEY`, and a convention test now asserts that.
- `claimNoteForTranscription` in `lib/transcription/transcribe-note.ts` — the
  per-row unit extracted out of the sweep's loop. **One claim implementation,
  two callers.** A zero-row claim short-circuits before any download and before
  any Gemini call, which was verified by counting the calls rather than by
  reading the code.
- `lib/transcription/supabase-ports.ts` — the Supabase `SweepPorts` factory,
  moved out of the cron route so both callers build the claim from the same
  code. The route's `CRON_SECRET` gate, `maxDuration` and `GET` body are
  unchanged; it still runs daily and is still the net.
- `components/dashboard/status-pill.tsx` on `app/page.tsx` — the list showed a
  title and a date, so an `'uploading'` or `'failed'` note looked exactly like
  a finished one.

Two things deliberately NOT built: Supabase Realtime, and any age check on the
manual path. The button polls one row for at most ten minutes after the user's
own click (or on finding the note already `'analyzing'`, since the cron or
another tab may have claimed it) and then stops with a neutral message. The
sweep's one-hour staleness threshold exists so unattended reconciliation does
not false-fail an upload still in flight; a user pressing a button has already
decided the note is ready, so the manual path claims by id with no age gate —
object existence is still what actually guards the Gemini call.

`MAX_TRANSCRIPTIONS_PER_RUN = 3` is unchanged and no longer reads as a quota:
it bounds one unattended sweep inside the 300 s function ceiling, and a user
who wants a note now presses the button.

**AMENDED 2026-09-01, later the same day.** The action above shipped with a
defect in exactly the part this entry called deliberate: it answered the
browser on the claim and finished in `after()`, but the deferred half kept
using the cookie client. @supabase/auth-js refreshes an expired access token
inside `__loadSession` whatever `autoRefreshToken` says — the option governs
only the background timer — and a refresh ROTATES the refresh token. The
replacement cookies went to the `setAll` in `lib/supabase/server.ts`, which is
wrapped in a try/catch precisely because a write is impossible once the
response has been sent. So the rotation succeeded server-side and was discarded
browser-side: the user's cookie kept a refresh token GoTrue then revoked, and
their next request signed them out with nothing in any log. Reachable whenever
the token was near expiry at the moment the button was pressed, because the
proxy refreshes an already-expired token rather than a nearly-expired one.

Fixed by removing the need for a refresh rather than suppressing it. The access
token is read while the request is still open, right after `getUser()` has
revalidated it, and the deferred half runs on a token-only client —
`lib/supabase/deferred-client.ts`. An access token is good for an hour and
`after()` is capped at 300 s, so the deferred work never reaches expiry. Same
user, same RLS, same publishable key; `app/api/cron/transcribe/route.ts` is
still the only shipped file reading `SUPABASE_SECRET_KEY`.

**RE-VERIFIED 2026-09-01, after the deferred-client fix above.**
`node scripts/verify-manual-transcribe.mjs` re-run against the live project and
the real Gemini API, because the fix changed code in the claim path and the
unit suite exercises that path only with fakes. PASS, exit 0, and the number
that matters is the Gemini counter: **exactly one call across all four
scenarios.**

    Proof 1 — the shared function takes an 'uploading' row to 'completed'
      ok    claimAndTranscribe reports 'transcribed'  got=transcribed
      ok    exactly one Gemini call was made  calls=1
      ok    the transcript contains a word we synthesised
    Proof 2a — a second press on a finished note claims nothing
      ok    the repeat attempt reports 'contended'  before=1 after=1
    Proof 2b — two CONCURRENT claims, one row, one winner
      ok    outcomes: ["claimed","contended"]
      ok    NO Gemini call was made by the claim step at all  before=1 after=1
    Proof 2c — the loser cannot transcribe by trying again
      ok    the Gemini counter still did not move  before=1 after=1

**What this run does NOT cover, stated so it is not mistaken for full
coverage.** The script builds its own owner client at
`scripts/verify-manual-transcribe.mjs:168` — publishable key, a real signed-in
session — and calls `claimAndTranscribe` directly. It never calls
`triggerTranscription`, never enters `after()`, and never constructs
`createDeferredClient`. So the atomic claim and the no-double-spend guarantee
are proven against live Postgres and live Gemini; **the deferred client itself
is covered only by unit tests and by the fact that the shape it produces —
publishable key plus a user JWT, no cookies — is the same shape this script
signs in with.** Proving the rotation fix end to end needs a browser session
crossing token expiry inside `after()`, which nothing here automates.

Proof: `node scripts/verify-manual-transcribe.mjs` (imports the shipped claim
through a Node resolve hook and counts Gemini calls across a repeat press, two
concurrent claims and a losing caller's retry). End to end in a browser on
2026-09-01: note `e6bb9163-4d68-42a3-b85b-9cf5f88f444b`, recorded through the
recorder, `'uploading'` -> `'completed'`, transcript rendered after
`router.refresh()`.

**The original entry, kept for the record (recorded 2026-08-31).** Nothing in
the application called `/api/cron/transcribe`; stopping a recording uploaded
the audio, wrote the note row at `'uploading'`, and stopped there. That
inverted the design of the v1 app (Crispy Bacon), where `geminiService.ts` ran
in the browser and transcription began when the recording ended, and v1's
cron-equivalent was only a health check for stuck notes. **This build shipped
the net and not the main path**, so the net was doing the main job. Two ways
out were recorded, and the owner chose the second:

- A per-note route the recorder calls on stop. **Not built.**
- A deliberate "Transcribe" action the user presses. **Built, 2026-09-01.**

### CLOSED 2026-09-01 — the transcript pane explained itself

`components/note-detail/transcript-pane.tsx` renders a `TranscriptEmptyState`
whenever `note.segments` is empty, whatever the status. One line of prose keyed
off `processingStatus` says which of the five situations this is: not uploaded,
waiting, being transcribed now, transcribed but silent, or a last attempt that
did not finish. `WHY` is typed `Record<ProcessingStatus, string>`, so a new
status is a compile error rather than a blank pane.

The copy and the shape came from the deleted branch preserved as the tag
`archive/on-demand-transcription` (`1bac5a4`). The re-site dropped that
branch's Transcribe button on purpose — the button stays on the shell's meta
line in `note-detail-shell.tsx`, and duplicating it was the reason the branch
was not merged. `components/note-detail/__tests__/transcript-pane-empty-state.test.tsx`
asserts all five strings plus the `'completed'`-with-segments case, which must
still render the transcript.

### Nothing renders a live transcript while recording (recorded 2026-08-31)

There is no Web Speech API usage anywhere — `grep -rni "SpeechRecognition"`
over `app/`, `components/` and `lib/` returns nothing. `record-hud.tsx` shows
elapsed time, level bars and status copy only. v1 did have one
(`components/features/studio/MainEditor.tsx`, "Live transcript/notes area"),
which is a plausible source of the expectation that this build has it.

Whether this build wants one is undecided, and it is a separate question from
the trigger above: a browser live transcript is display only and would not feed
the Gemini pass.

### Recordings past Gemini's caps fail outright, and 28–60 min degrades silently-ish

Two distinct behaviours, both deliberate, and the second is the one likely to
surprise someone:

- **Over 60 minutes**: no Gemini call is made at all. The row goes straight to
  `'failed'` with a log line naming the duration. There is no segmentation and no
  stitching; ROADMAP defers both at single-owner scale.
- **Between 28 and 60 minutes**: the recording still transcribes, but **plain —
  no speaker labels and no timestamps.** Gemini drops its own cap from 60 to 30
  minutes the moment either feature is requested, so a long recording can have a
  transcript or it can have speakers, not both. The transcript pane renders one
  untimed block for these.

Nothing in the UI distinguishes a plain transcript from a diarized one. The
`notes.diarization_enabled` column records what actually happened (not what was
requested), so the information exists — it is simply not surfaced.

### Persona timing is decided — do not reopen it (addendum 2026-08-31)

**RESOLVED 2026-08-30** in `DECISIONS.md` § Personas, per the owner: a persona is
attributed **after the fact** through `note_chunks.persona_id`, and regeneration
was **considered and rejected**. Persona edits apply to new notes only; changing
a persona never re-runs Gemini over audio that has already been transcribed.

This matches what shipped. Nothing needs to change.

Recorded here because the decision lived only in `DECISIONS.md`, which is a
Claude.ai Project file and not in this tree, while this repo still carried
"the persona question is still open" (§ State management) and a handoff listed
persona timing under "needs the user". A decision written in one place and
contradicted in another gets relitigated by whichever session reads the other
one. It is not open.

**Persona SELECTION shipped 2026-09-02, and this paragraph no longer applies
as written.** It used to read: "Still genuinely unbuilt, and separate from the
above: persona **selection at capture time** in the recorder, and the
persona/depth routing for `summary`, `takeaway` and `action_item` chunks."

Both halves are now built, and the first shipped somewhere else than this
sentence assumed.

**Not at capture time, and not in the recorder.** A picker in front of an
ambient recorder is a reason not to hit record, and the recorder being one
click is the point of it. Selection lives on Note Detail, where the reader
already is and where there is time to choose. A note is still created with
`persona_id` null.

`notes.persona_id` is a nullable uuid with a composite FK to
`personas (id, user_id)` — composite for the reason `note_chunks.persona_id`
is, since a foreign key is validated as the referenced table's owner and is
not subject to RLS. The rail seeds it on mount as a real write, so the
highlighted lens is never something the database does not hold, and the user's
last choice is remembered in Auth user metadata as a **slug**.

**Routing is the same claim, not a second one.** `resolvePersonaFor` in
`lib/notegen/resolve-persona.ts` reads `notes.persona_id` first and falls back
to the `neutral-analyst` slug, and the lens it returns supplies the framing for
all three generated chunk types in one Gemini call — summary, takeaway and
action item are not routed separately.

**The lens locks once generation is committed to, which is what keeps
regeneration rejected.** The condition is deliberately wider than
`notegen_status IS NOT NULL`: pressing Transcribe leaves `notegen_status` null
for the whole transcription, because generation only claims afterwards, so
locking on that column alone would leave a minutes-long window in which the
rail shows one lens and generation could still pick up another. Enforced by the
guarded UPDATE in `app/notes/actions/persona.ts`, not by the disabled button —
a Server Action is a public HTTP endpoint.

Still open, and NOT closed by any of the above: **depth exposure.** No UI
control sets `personas.depth`. See the depth-policy entry earlier in this file;
the two are separate surfaces and shipping lens selection did not ship depth
selection.

Provenance: the quotation above was relayed by the owner on 2026-08-31, before
`DECISIONS.md` was in the tree. It is now at `docs/DECISIONS.md` § Personas and
can be read directly rather than trusted as a transcription.

### The mic-constraint rule cites a decision that does not say what it claims (recorded 2026-08-31)

`CLAUDE.md:131` and `lib/recorder/capture.ts:19` both justify the mic constraint
the same way: *"Do not add `noiseSuppression` or `autoGainControl` — ROADMAP §7
rejected extra masking."*

**ROADMAP §7 does not reject that.** Now that the file is in the tree it can be
read: §7 rejects **"Custom edge-ML background-noise masking"**, on cost grounds
($0.15/mo total audio spend, §8a), and in the same bullet names browser
`noiseSuppression: true` as *"the free equivalent if audio quality, not cost,
ever becomes the actual issue."* `DECISIONS.md` § Rejected says the same thing
in the same words about "Sub-Hz Background Noise Masking".

So the two source documents treat browser `noiseSuppression` as the **available
fallback**, and the repo cites them as having **forbidden** it. That is the
opposite reading.

**Nothing has been changed.** The shipped constraint is
`{ echoCancellation: true }`, which matches §8b's stated baseline, and the rule
may well still be the right call — a minimal constraint set is defensible on its
own merits. What is wrong is the authority claimed for it, in two places, one of
which is a convention file that governs new code.

**RESOLVED 2026-08-31.** The owner's call: follow the roadmap. Both sites now
say what ROADMAP §7 and DECISIONS.md § Rejected actually say — the constraint
stays `{ echoCancellation: true }` by default, `noiseSuppression` is available
if audio **quality**, not cost, becomes a *measured* problem, and enabling it
needs that measurement rather than a hunch. `autoGainControl` is recorded as
having no decision behind it in either direction, which is the honest state; it
had been carried along in a sentence whose authority covered only noise masking.

**No behaviour changed.** `MIC_CONSTRAINTS` in `lib/recorder/capture.ts` is
byte-identical. This was a wrong justification, not a wrong default, and the
default was right by accident of matching §8b.

This is the first contradiction the 2026-08-31 docs move made findable, and it
had survived two files and a code comment. It is the argument for `check-docs.mjs`
learning to compare these documents mechanically.

### No structured note generation and no embeddings

**HALF RESOLVED 2026-09-02.** Structured note generation shipped
(`lib/notegen/*`, merged `475728c`); the embeddings half below is unchanged and
still open. Read the two halves separately — this section was written when
neither existed.

**Note generation — closed.** The depth/persona routing decision this section
said "has not been made" was made on 2026-09-01 (`docs/DECISIONS.md`
§ "Structured note generation": one model, Gemini 3.7 Flash, depth as
`thinking_level` plus a prompt scope) and implemented on 2026-09-02.
`notegen_status` is its own queue on `notes`, claimed with the same one-statement
guarded UPDATE as transcription, and it writes `summary`, `takeaway` and
`action_item` chunks. Per-note lens selection followed the same day. So the
stated consequence — "a freshly transcribed note renders its transcript pane and
nothing else" — **no longer holds**, and the seeded note's hand-written
takeaways are replaced by the pipeline's own on its first run, which is designed
behaviour rather than a regression.

**Embeddings — CLOSED 2026-09-03.** `note_chunks.embedding` is populated. The
chunk's own `embedding IS NULL` is the queue — no new status column, no job
table, the same "a row's own state is the queue" rule as `processing_status`
and `notegen_status`, at chunk grain. `lib/rag/*` batches a note's pending
chunks through Voyage **`voyage-4`** (`input_type: "document"`,
`output_dimension: 1024`, `output_dtype: "float"`, all pinned) and writes each
vector back under a per-row guarded `UPDATE ... WHERE id = $1 AND embedding IS
NULL`. Two triggers: the end of the existing `after()` chain in
`app/notes/actions/transcription.ts`, and phase three of
`app/api/cron/transcribe/route.ts`, which is also the backfill for every chunk
written before this shipped. A new partial index,
`note_chunks_pending_embedding_idx`, keeps the sweep's "which chunks have no
vector" question off a sequential scan; `EXPLAIN` was read back from the live
project and the planner picks it.

The hnsw index over the column is no longer empty: 33 of the table's 121 chunks
carried real vectors when this was written, proved by
`node scripts/verify-embeddings-pipeline.mjs`.

**No retrieval path reads it yet** — hybrid vector + full-text search via
reciprocal rank fusion is still a Core UX/UI item in `docs/ROADMAP.md` §4, and
that is what the embeddings now exist for. Two things below it are worth
reading before that work starts: the new "unembeddable chunk" gap immediately
following, and the free-tier rate limit recorded with it.

### An unembeddable chunk gives up silently, and nothing says so

**Opened 2026-09-03, with the embeddings pipeline.**

A chunk that fails to embed three times is left with `embedding` null
permanently. `lib/rag/embed-note.ts` counts the attempts in
`note_chunks.metadata.embed_attempts` and the eligibility filter in
`lib/rag/supabase-ports.ts` stops listing it at three, so it is never retried
again — by the inline trigger or by the cron sweep.

**Nothing reports this.** There is no error column at single-owner scale
(§ Transcription made that choice and this pipeline follows it), so the only
trace is one `[embed]` line in the Vercel function log at the moment the third
attempt fails, and `metadata.embed_error` on the row itself. The log rotates.
Nobody is paged, no dashboard turns red, and the note renders completely
normally — the chunk is simply invisible to a retrieval path that does not
exist yet.

The failure is therefore **silent and permanent**, and it will only be
discovered when hybrid retrieval ships and somebody notices a specific
takeaway is never returned. The cap itself is right: three attempts on a chunk
that Voyage rejects for its content is enough, and retrying forever would spend
real money on a text that will never embed. Transient failures — rate limits,
5xx, network — deliberately do **not** increment the counter, so this only ever
catches genuinely unembeddable content. That distinction was exercised for real
on 2026-09-03, not just unit-tested; see the rate-limit note below.

**The measurement that would close it** is one query, which nothing runs today:

```sql
select id, note_id, metadata->>'embed_error' as reason
from public.note_chunks
where embedding is null and (metadata->>'embed_attempts')::int >= 3;
```

The honest options are (a) surface that count in the cron route's JSON response
so a failing run is visible where the sweep report already is, (b) add the
error column this project has twice decided not to add, or (c) accept it until
retrieval ships and the absence becomes visible on its own. **(c) is what is
accepted today**, deliberately, because at one user with a handful of notes the
query above is a thirty-second manual check and the pipeline has no
observability budget of its own. Revisit at the same moment hybrid retrieval
lands — that is when a missing chunk starts to cost an answer.

### The Voyage account is on the unbilled tier: 3 RPM, not 2,000

**Measured 2026-09-03**, from a live 429 body during the first run of
`scripts/verify-embeddings-pipeline.mjs`. Voyage's published tier-1 limits for
`voyage-4` are 2,000 requests and 8,000,000 tokens per minute, but those apply
only once a payment method is on file. Without one the account is held at
**3 RPM and 10,000 TPM**, and the 429 says so in its response body.

**Corrected 2026-09-03, the same day, in code review.** This read "the pipeline
is correct under this and nothing needs changing in `lib/rag`", and the
production estimate below said "up to 10 requests". Both were wrong by about
two orders of magnitude. `embedChunks` fell through to its one-at-a-time
fallback on **every** non-fatal batch error, so a 429 on a 100-chunk note
produced 1 + 100 requests, all of them doomed, aimed at the very limit that had
just rejected the batch. A transient error now defers the whole batch and
`continue`s, and the individual fallback means what its comment always claimed:
isolating one poison chunk out of a **content** error. A test pins the call
count at one.

The classification itself was right all along, and is what kept this from being
a data problem rather than only a cost-and-volume one: a 429 is `transient`, so
the chunk's attempt counter is untouched, the row stays eligible, and the next
sweep retries it. Six chunks took that path in the first run and embedded
cleanly in the second. **The "up to 10 requests" figure below is accurate as of
the fix**, one batch per note; it was not before. The only accommodation is in
the harness — `scripts/verify-embeddings-pipeline.mjs` spaces its calls 21 s
apart so its proofs have something to observe, and that spacing is switched off
with `VOYAGE_MIN_CALL_INTERVAL_MS=0`.

**What it costs in production:** the daily cron sweep embeds up to
`MAX_EMBED_NOTES_PER_RUN = 10` notes, which is up to 10 requests, and 3 RPM
means roughly two thirds of them 429 and defer to the following day. The
backlog still clears — it just clears slowly, and the log fills with transient
lines that look alarming and are not. **Adding a payment method removes this
entirely**; `voyage-4` carries 200 million free tokens per account, so a card
on file is not the same as a bill. That is the one-line fix and it is the
owner's call, not a code change.

Deliberately **not** doing: a retry-with-backoff inside a single run. It would
spend the shared 300 s Vercel budget waiting, it would make the free tier look
survivable when the real answer is a billing setting, and this project's
standing rule is not to add mitigation speculatively.

### The migration chain can no longer rebuild the database — CLOSED 2026-09-03

**Opened 2026-09-03, closed the same day.**

`supabase/schemas/*.sql` is the source of truth and the live project matches it.
`supabase/migrations/` did **not**. Two pieces of applied DDL were never written
into the chain:

- **`notes.persona_id`**, its composite foreign key and its index — shipped
  2026-09-02 with per-note persona selection.
- **`note_chunks_pending_embedding_idx`**, the partial index — shipped
  2026-09-03 with the embeddings pipeline.

Both were applied correctly, through `db query --file` on the schema file. What
was skipped is § Declarative schema workflow's *last* step.

**Closed by `20260903115017_reconcile_persona_id_and_embedding_index.sql`.** The
drift was measured before anything was written: every column, index, constraint
and policy in the live catalog was listed and checked against the concatenated
chain, and the difference was exactly `notes.persona_id`, `notes_persona_id_fkey`,
`notes_persona_id_idx` and `note_chunks_pending_embedding_idx` — nothing else.

The migration is the **verbatim concatenation of all five files in
`config.toml`'s `schema_paths` order**, not a curated subset. That is the
deliberate correction to `20260902053323`, whose partial concat is what made
this drift silent: nothing compared it to anything. A full trailing snapshot
restores the `git hash-object` check as a real test — the file below its
22-line header must hash-equal `cat` of the five schema files, and did
(`04dc4bfe7a82d9f99e9915ad1ca163358973852a`). Every statement in those files is
idempotent, so the migration is a no-op against a matching database and a full
build against a fresh one.

**The live database was not touched.** It was already correct. `migration
repair --status applied` recorded the file against history; `migration list
--linked` shows all eight local and remote versions matching. The 75-object
catalog listing was re-read afterwards and diffed against the pre-change
listing: identical.

**What keeps this closed:** the next migration is a full schema concat too, or
the hash check has nothing to compare and the drift goes quiet again.

### The verification script cannot run unattended

`scripts/verify-transcription-pipeline.mjs` needs `npm run dev` already running
in another shell, and it synthesises its speech fixture with **Windows SAPI**
(`System.Speech.Synthesis`). On a non-Windows machine, or where SAPI is
unavailable, it exits with an instruction to set `TRANSCRIBE_TEST_AUDIO` to a
`.wav` of someone speaking. It is not wired into `npm test` and should not be —
it spends real Gemini quota on every run.

### `service_role` gained table grants, and that is a real privilege change

`service_role` now holds `select, insert, update, delete` on `public.notes` and
`public.note_chunks`. Before 2026-08-31 it held only `REFERENCES, TRIGGER,
TRUNCATE`, and every cron read failed with `permission denied for table notes`.

This is a **grant**, not a policy: `service_role` already bypassed RLS, it simply
could not reach the tables. The same change also revoked its stray `TRUNCATE`,
which is not row-level and which RLS does not constrain.

The exposure is unchanged in kind — anyone holding the secret key could already
read everything — but it is now genuinely reachable, so the key matters more than
it did. It lives in exactly one shipped file (`app/api/cron/transcribe/route.ts`)
and in the gitignored `.env.local`. `node scripts/verify-rls.mjs` was re-run after
the change and still passes: the intruder gets a genuine empty result, not
`permission denied`.

### A narrow window can leave transcript chunks under a `'failed'` note

`lib/transcription/persist-result.ts` writes chunks, then flips the note to
`'completed'`. If the chunk insert succeeds and the completing UPDATE then
throws or loses its claim, `transcribeOne` catches and marks the note
`'failed'` — with its transcript segments already in `note_chunks`.

`'failed'` is terminal and there is no retry, so the delete-then-insert
idempotency at the top of `persistTranscription` never gets a chance to clean
up. The note would render a populated transcript pane with no `raw_transcript`.

Left as-is deliberately. Fixing it means either a transaction or a compensating
delete, and both are the "second mechanism for one failure" that the ordering
was chosen to avoid. The window requires the completing UPDATE specifically to
fail after a successful insert, which nothing observed has done.

### The `MAX_TRANSCRIPTIONS_PER_RUN` cap bounds attempts, not wall-clock

`sweep.ts` counts transcription **attempts** against the cap, so three failing
Gemini calls end the run just as three successful ones do. What it cannot do is
bound how long any single attempt takes: `RUN_BUDGET_MS` (240 s) is checked
*before* claiming a row, not during a call, so an attempt starting at 239 s can
still run past the 300 s function ceiling and be killed mid-flight.

That is survivable — the row is left at `'analyzing'` and the staleness sweep
marks it `'failed'` on a later tick — but on the Hobby daily schedule "a later
tick" is up to 24 hours. A per-call timeout on the Gemini request would close
it properly.
