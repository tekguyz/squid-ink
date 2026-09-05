# Conventions

**Last updated:** 2026-09-05
Update this line whenever this file changes — don't let it drift from reality.

## Stack

Next.js App Router with React Server Components, TypeScript, and Tailwind CSS v4.
Chosen because the design is a dense, mostly-static reading surface with three
small islands of interactivity — the App Router lets the page stay a server
component and pushes only the interactive shell to the client. Tailwind v4 is
used for its native CSS-variable `@theme`, which is what makes one token file
drive both themes without any component branching on theme.

## Pinned versions

Exact pins, no `^` or `~` ranges. Verified against the live npm registry
`latest` dist-tags (`npm view <pkg> dist-tags`) on 2026-08-30; `zustand`,
`fake-indexeddb` and `@google/genai` on 2026-08-31; `ai`, `@ai-sdk/anthropic`,
`@ai-sdk/react` and `zod` on 2026-09-04, all four still `latest` that day.

| Package | Version |
|---|---|
| next | 16.3.3 |
| react | 19.2.8 |
| react-dom | 19.2.8 |
| typescript | 7.0.2 |
| tailwindcss | 4.3.3 |
| @tailwindcss/postcss | 4.3.3 |
| @types/react | 19.2.18 |
| @types/react-dom | 19.2.5 |
| @types/node | 26.4.0 |
| vitest | 4.1.11 |
| @vitejs/plugin-react | 6.1.1 |
| @testing-library/react | 16.3.3 |
| @testing-library/user-event | 14.6.6 |
| @testing-library/jest-dom | 7.0.1 |
| jsdom | 30.0.1 |
| zustand | 5.0.15 |
| fake-indexeddb | 6.2.5 |
| @google/genai | 2.19.0 |
| ai | 7.0.92 |
| @ai-sdk/anthropic | 4.0.49 |
| @ai-sdk/react | 4.0.95 |
| zod | 4.5.4 |

Built and verified on Node v24.18.0 / npm 11.16.0.

When bumping any of these, check the registry again — do not take a version
from memory, and do not loosen a pin to a range.

## Colour

**Every colour is a `var()` into `app/globals.css`. Zero `oklch()`, hex, `rgb()`,
or `hsl()` anywhere in `components/` or `lib/`.**

`app/globals.css` is the only file that names a colour. It defines each token
twice — light on `:root`, dark on `.dark` and again inside
`@media (prefers-color-scheme: dark) { :root:not(.light) }` — and exposes them to
Tailwind through `@theme inline`. Components use the generated utilities
(`bg-paper`, `text-ink-2`, `border-rule`) and never know which theme is active.

Tailwind cannot build class names at runtime, so per-speaker colours map through
the static lookup in `components/note-detail/speaker-colors.ts`. Mock data carries
a token *name* (`speaker-1`), never a colour value.

The guard in `components/note-detail/__tests__/project-conventions.test.ts` fails
the build if a colour literal appears in `components/` or `lib/`.

**`canvas` is not a button fill.** In dark theme `--canvas` and `--paper`
resolve to the same value, so a control filled with `bg-canvas` on a `bg-paper`
sheet has no fill at all — measured 2026-09-01, and the reason `audio-player.tsx`
and `transcribe-button.tsx` both moved to `bg-raised`, which is what
DESIGN.md § Components → Buttons specifies anyway. Two tokens looking distinct
in light theme is not evidence they differ in dark; check both.

**Do not "fix" `border-rule-2` on one component.** Every framed surface in the
app draws its edge with it, at ~1.4:1 against the sheet. That number is
recorded, argued and left open in `docs/KNOWN_GAPS.md` § "Framed controls sit
at ~1.4:1" — raising it is an app-wide token decision, and a single button with
a heavier edge than everything around it is the worse outcome.

## Type

Three faces, no others:

- **Bitter** (`font-header`) — headers, names, numerals
- **Archivo** (`font-body`) — body prose and UI labels
- **IBM Plex Mono** (`font-mono`) — time, counts, metadata

Loaded via `next/font/google` in `app/layout.tsx`.

## File layout

Purpose-named, and **grouped by feature, at most one folder deep**. No FSD or
atomic layering, and no generic `parts/`, `utils/`, or `common/` dumping
ground — a file that has no better name than "utils" is a file whose
responsibility has not been decided yet.

`components/note-detail/` holds one file per piece of the screen. When a single
piece grows past about three files, it earns its own subfolder named after that
piece — `note-detail/transcript/`, not `note-detail/components/`. One level,
never two: the rule exists so a flat list stops growing without inventing a
hierarchy nobody can navigate.

Server Actions follow the same shape. `app/notes/actions/` holds one file per
track — `recording.ts` (createRecordedNote, markUploadFailed) and
`transcription.ts` (triggerTranscription). They were a single actions.ts file until
2026-09-01. It was split because the two are genuinely different tracks that
share nothing but the Supabase client, not because of the line count; the
ceiling is what made the split due, and the seam was already there.

Each file under `app/notes/actions/` needs its own `"use server"` — the
directive is per module, and a folder of actions has no shared entry point to
put it in. Type exports are fine alongside the async functions; they are erased
before Next sees them.

**Soft ceiling 250 lines, hard ceiling 400 — on SHIPPED files.** A file
approaching the ceiling gets a purpose-named extraction, never a raised
ceiling. The convention test enforces 400, and its `sourceFiles()` walk skips
`__tests__` entirely.

That exclusion is deliberate, not an oversight, and the reason is worth stating
because the ceiling reads like it applies to everything. A long source file is
coupled: line 300 cannot be read without holding the first 299 in your head,
which is the actual cost the ceiling exists to stop. A test file is a flat list
of independent cases — test 12 needs nothing from tests 1 through 11 — so its
length is quantity, not complexity, and splitting it buys nothing but churn.
`lib/recorder/__tests__/use-recorder.test.tsx` is 431 lines for that reason and
is fine. What is NOT fine in a test file is a shared harness that tests mutate
between them; that is coupling, and it earns a split whatever the line count.

## Data

Note Detail reads from Supabase. `lib/notes/get-note.ts` fetches the note, its
chunks and the user's personas through the server client and
`lib/notes/note-view-model.ts` shapes them into what the components render.
There is still no `fetch` and no API client — the Supabase SDK is the only data
path, and it is called from server components.

The view types the components consume live in `lib/notes/view-types.ts`.
`lib/notes/types.ts` holds the database row shapes that mirror
`supabase/schemas/*.sql`. The old mock types module under `lib/mock/` is gone.

All four personas are rows in `public.personas`; there is no hardcoded persona
array. A new account gets its four rows from the database, not from app code:
`supabase/schemas/persona_provisioning.sql` puts a `security definer` trigger on
`auth.users` that inserts them. Accounts created before that trigger shipped
(2026-08-31) are deliberately not backfilled, which is why the fallback below is
still live code. `note_chunks.persona_id` attributes a takeaway to a lens, and a null
`persona_id` means the default persona — which is why chunks written before the
table existed still render under Neutral Analyst. `DEFAULT_PERSONA_ID` and the
one fallback persona for a user with no rows live in
`lib/notes/default-persona.ts`, which is client-safe by design: the shell is a
client component and must not pull in the server Supabase client.

**Which persona row a generation pipeline reads its config from — locked
2026-09-02, amended the same day when per-note selection shipped.**
`resolvePersonaFor` lives in `lib/notegen/resolve-persona.ts` (it moved out of
`notegen-ports.ts`, which re-exports it) and resolves in three steps:

1. **`notes.persona_id`, when the note carries one** — `id = <persona_id> and
   user_id = <note.user_id>`. Scoped by **both**, the same composite ownership
   `notes_persona_id_fkey` enforces, because neither a foreign key nor
   `service_role` is subject to RLS. Reports `source: "note"`.
2. **The slug**, when it does not, or when that id resolves to no row —
   `user_id = <note.user_id> and slug = 'neutral-analyst'`, the slug being
   `DEFAULT_PERSONA_ID`. Reports `source: "row"`.
3. **`DEFAULT_PERSONA_FALLBACK`** on zero rows. Reports `source: "fallback"`.

A set `persona_id` that resolves to nothing **falls through to step 2 rather
than throwing** — a lens deleted between selection and generation is a real
sequence, and refusing to generate over it is worse than generating under the
default.

Slug at step 2, not `name`: `unique (user_id, slug)` is the constraint
`personas.sql` declares and indexes, `name` carries neither, and that file's
own header says slug is the key chosen to survive a reseed. Never match
`personas.id` against `DEFAULT_PERSONA_ID` — the former is a per-user
`gen_random_uuid()` and the latter a slug string, so it is a type error rather
than a quiet miss. Step 1 matches on `id` because it has a real uuid to match.

**The client never sees a uuid.** `Persona.id` and `Note.personaId` are both
slugs; `note-view-model.ts` translates one way and
`app/notes/actions/persona.ts` the other. A uuid is per-user and does not
survive a reseed.

**`notes.persona_id`'s foreign key is declared in `personas.sql`, not
`notes.sql`.** `config.toml` applies `notes.sql` first, so a reference to
`public.personas` written there does not resolve on a fresh apply. The column
stays with its table; only the constraint waits. It is composite —
`(persona_id, user_id) references personas (id, user_id) on delete set null
(persona_id)` — for the reason `note_chunks.persona_id` is, and a cross-tenant
write was proved refused with `23503` on 2026-09-02.

Zero rows means an account created before the 2026-08-31 provisioning trigger
and deliberately not backfilled; it falls back to `DEFAULT_PERSONA_FALLBACK`.
Either path, a generated chunk still writes `note_chunks.persona_id = null`.
The resolved row supplies `name` and `depth` to the generator and is never
persisted onto the chunk, so the "null means default persona" convention above
is unchanged.

The cron path filters on `user_id` in application code. That is the one
deliberate exception to § Supabase → RLS rules' standing "queries never filter
on `user_id`", and it is not a lapse: cron runs as `service_role`, which
bypasses RLS entirely, so an unfiltered lookup can return another account's
row. The Server Action path filters identically — there RLS already scopes it,
so the filter is defence in depth and one shared query shape, not a
requirement.

`lib/mock/note.ts` is no longer rendered. `mockNote` has no importer outside
component tests, which use it as a fixture. Do not add new mock rows — new data
goes in the database.

Nothing calls `Math.random()` or `Date.now()` in a render path — the waveform bar
heights are precomputed constants.

## Recorder

The HUD is mounted once in `app/layout.tsx` and the Zustand store in
`lib/recorder/recorder-store.ts` lives at **module scope**. Neither may move
into a route or a provider — a store that resets on navigation defeats the
whole "ambient, not calendar-gated" decision. There is a test asserting that
importing the module twice yields the same state.

`getDisplayMedia` is called with `video: true` even though nothing records
video. Chromium does not offer tab or system audio for an audio-only display
request — the audio checkbox is simply not shown. The video track is stopped on
arrival.

`MediaRecorder` records the Web Audio destination node's stream, never the mic
stream. That indirection is what lets `replaceMic()` swap a microphone
mid-recording without ending the recording.

The mic constraint is exactly `{ echoCancellation: true }`. That is the
baseline `docs/ROADMAP.md` §8b names for the no-headphones echo case, and it is
the default.

`noiseSuppression` is **not forbidden.** ROADMAP §7 and `docs/DECISIONS.md`
§ Rejected both reject *custom edge-ML* noise masking, on cost grounds, and both
name browser `noiseSuppression: true` as the free equivalent to reach for **if
audio quality — not cost — ever becomes a measured problem.** Enable it for that
reason, with the measurement that prompted it. Do not enable it speculatively.

`autoGainControl` has no decision behind it in either direction. Leave it off
until one exists.

**Corrected 2026-08-31.** This paragraph read "Do not add `noiseSuppression` or
`autoGainControl` — ROADMAP §7 rejected extra masking", citing §7 for the
opposite of what §7 says. It survived because §7 was not in the tree and could
not be opened.

The Storage path is `{user_id}/{note_id}`: two segments, that order, no
extension. It is not a naming convention — it is what the three policies in
`storage_audio.sql` check. **Never confirm an upload with `download()`**;
Storage reads are CDN-cached and return the pre-overwrite body. Use the upload
response or `list()` metadata.

The notes row is written when the upload **starts**, at
`processing_status = 'uploading'`, because the path is deterministic. This track
never writes `'analyzing'` or `'completed'` — those are Track 3's. A failed
upload writes `'failed'` in-session through `markUploadFailed()` — tier 1,
shipped 2026-09-01 — and still leaves its audio in IndexedDB; **nothing
reconciles that pair**, so Track 3 must check the object exists before
transcribing.

**Corrected 2026-09-01.** This paragraph read "leaves a visible row … nothing
reconciles that pair yet", written when tier 1 did not exist. The row half is
now reconciled in milliseconds; the blob half is not.

Codec strings are feature-detected through `lib/recorder/codec.ts`. Never
hardcode one, and keep WebM ahead of MP4 — Chromium accepts both, so the order
decides what Chromium produces.

Deleting a test recording needs two clients: the **row** as the owner, the
**object** as the admin (storage ships no DELETE policy, and `service_role`
bypasses RLS). `scripts/verify-recorder-upload.mjs` does both correctly.

The reason for the row half changed on 2026-08-31 and the practice did not.
`service_role` used to hold **no grant at all** on `public.notes`, so an admin
delete failed outright; it now holds `select, insert, update, delete` for the
transcription cron. Deleting as the owner is still right, because it exercises
the RLS path a real user takes — but it is now a deliberate choice rather than
the only option, and a script that deletes as the admin will silently succeed
while proving nothing about RLS.

    node scripts/verify-recorder-upload.mjs   # live upload + note row proof
    node scripts/print-signin-link.mjs        # local sign-in link, magic-link only

Device handoff, real-world echo and Safari cannot be tested here. They have a
runnable checklist: `docs/qa/recorder-manual-test-protocol.md`. Check the
**bitrate** of every manual recording — a muted mic yields ~2 kbit/s and
otherwise looks like a complete success.

## Transcription

**`processing_status` IS the queue.** There is no job table. A row's own status
says whether it is waiting, in flight, done or dead, and the transitions are the
only coordination there is. A queue table would be a second source of truth that
can disagree with the first.

The claim is **one statement**: `UPDATE notes SET processing_status = <next>
WHERE id = <id> AND processing_status = <expected> RETURNING id`. Postgres
row-locks the matched row, so a concurrent invocation re-evaluates that `WHERE`
after the lock releases and matches nothing. No lock table, no read-then-write
window. A claim that returns zero rows lost the race and **must not spend a
Gemini call** — that is cost, not just correctness.

**Age never fails a row on its own. Object existence is the safety check.** The
one-hour threshold exists only to avoid false-failing a slow-but-real upload. An
`'uploading'` row older than an hour whose object *is* present gets transcribed,
because that is a lost client write-back, not a lost upload.

Existence is proved with `list()`. `download()` appears exactly once, purely to
move bytes to Gemini, and proves nothing — same CDN-staleness reason as the
recorder. Both share one `objectRow()` lookup in the route.

Staleness is measured on **`updated_at`, not `created_at`**. For `'uploading'`
it equals `created_at` at insert; for `'analyzing'` it is when the row was
claimed, which is exactly the crash window worth measuring. A retry upsert
restarting the clock is correct, not a bug.

Reconciliation is two-tier and **this track owns only tier 2**. Tier 1 — the
in-session `'failed'` write on a caught upload error — belongs to the recorder
and **shipped there on 2026-09-01** as `markUploadFailed()` in
`app/notes/actions/recording.ts`. The check constraint that unblocks it
shipped here.

Diarization is a pure function of duration in `diarization-policy.ts`: **28
minutes**, a deliberate two-minute margin under Gemini's 30-minute diarized cap,
because our duration is the recorder's elapsed clock rather than the decoded
length of the container Gemini receives. Past **60 minutes** we do not call at
all — no segmentation, no stitching, a clear log line instead.

Gemini specifics, all measured against the SDK's own `.d.ts` and the live API,
never from the published samples:

- **The two SDK surfaces disagree on casing.** `interactions.create` takes
  snake_case (`generation_config`, `transcription_config`, `diarization_mode`,
  `mime_type`); `files.upload` is the older Files API and takes camelCase
  (`mimeType`). The web sample writes `mime_type` in both, where the upload one
  is silently ignored. Do not "make these consistent".
- **Never send `custom_vocabulary`.** Gemini answers HTTP 400 when it
  accompanies diarization or timestamps.
- The top-level `diarization_mode` / `timestamp_granularities` are
  `@deprecated` in the SDK types; the live fields are nested inside `mode`.
- **The speaker label is an opaque cluster id.** A single-voice recording came
  back as `"spk:7"` — a colon, and a 7 that indexes nothing. Speakers are
  numbered by **first appearance**, never by digits parsed out of the label.
- **Storage `download()` types every Blob `application/octet-stream`**, which
  Gemini rejects with a 400. `resolveAudioMimeType()` prefers the object's own
  `list()` metadata and strips codec parameters. It **moved to
  `lib/audio/mime-type.ts` on 2026-09-01** when playback needed the same rule;
  `gemini-client.ts` re-exports it. Import it, never re-derive it — the browser
  playback path hits the identical 400.

Chunk writes precede the `'completed'` flip. A partial insert leaves the row at
`'analyzing'` and the staleness sweep fails it an hour later — **that existing
net is the rollback.** Do not add a transaction or a compensating write; a
second mechanism for one failure is a second thing to get wrong.

There is **no error-message column** and none should be added at single-owner
scale. Failures are read in the Vercel function log.

**`/api/cron` is in `PUBLIC_PREFIXES` in `lib/supabase/session.ts`, and must
stay there.** A cron invocation carries no cookies, so the session middleware
would redirect it to `/login` — and **Vercel cron does not follow redirects**,
so the sweep would silently never run while the job reported success. Public to
the middleware is not unauthenticated: the route's `CRON_SECRET` bearer check is
its authorization. An unset secret refuses everything rather than failing open.

`maxDuration = 300` and `MAX_TRANSCRIPTIONS_PER_RUN = 3` are sized to the
**Vercel Hobby** ceiling, where 300 s is both the default and the hard maximum
and a cron may fire only once per day. Re-measure the plan before raising
either — `docs/DEPLOYMENT.md` holds the numbers and how they were measured.

**Two triggers, one claim — added 2026-09-01.** The daily cron is no longer the
only way a note transcribes. `triggerTranscription(noteId)` in
`app/notes/actions/transcription.ts` is a Server Action the user reaches
through the
Transcribe button on Note Detail. It and the sweep both call
`claimNoteForTranscription` in `lib/transcription/transcribe-note.ts`, which is
the only place the guarded `UPDATE ... where processing_status = 'uploading'`
is written; `lib/transcription/supabase-ports.ts` holds the one Supabase
implementation of it, moved out of the cron route for exactly this reason. A
zero-row claim returns before any download and any Gemini call.

The manual path has **no age check** — staleness is a sweep-only concern and
reaches the shared unit only as `failOnMissingObject`, which the action always
passes `true`. Object existence still gates the call, still through `list()`.

**Secret-key usage did not change.** The action runs on the authenticated
cookie client and RLS supplies the owner; `app/api/cron/transcribe/route.ts` is
still the only shipped file that reads `SUPABASE_SECRET_KEY`, and
`project-conventions.test.ts` now fails the build if a second one appears.
There is **no retry for `'failed'`** — the button is absent from the DOM for
`'failed'` and `'completed'`, not disabled.

    npm run dev                                       # in one shell, then:
    node scripts/verify-transcription-pipeline.mjs    # live end-to-end proof
    node scripts/verify-manual-transcribe.mjs         # no dev server needed:
                                                      # double-spend proof,
                                                      # Gemini calls counted

That script drives the **real route over HTTP** rather than re-implementing the
sweep, synthesises its own speech with Windows SAPI so the transcript assertion
is against known words, and proves all four paths: the `CRON_SECRET` gate, a
recording reaching `'completed'`, a stale `'uploading'` orphan reaching
`'failed'`, and a stale `'analyzing'` row reaching `'failed'`.

## Note generation

**`notegen_status` IS the queue**, exactly as `processing_status` is
transcription's, and for the same reason: a second table would be a second
source of truth. It is nullable with no default, and **null means "not
eligible yet"** — there is no `'pending'` string, because the column's
nullability already says it.

The claim is one statement with **two** conditions:

    UPDATE notes SET notegen_status = 'generating'
    WHERE id = <id> AND processing_status = 'completed'
      AND notegen_status IS NULL RETURNING id, persona_id

**`persona_id` rides out on that RETURNING — added 2026-09-02 — and it is not
a convenience.** A second `select` after the claim could read a write that
landed between the two, so the note would generate under a lens its owner had
already moved away from. The returned value is the one on the row this
statement row-locked, which is the only version that cannot change underneath
the generation it feeds. Never replace it with a follow-up read.

`claimForGeneration` therefore returns a **tagged union**, `ClaimResult`:
`{ status: "claimed"; personaId: string | null } | { status: "lost" }`, and
`claimNoteForGeneration` returns `ClaimResolution` in the same shape. Do not
collapse either into a nullable boolean — "claimed with no persona" and "lost
the race" are both falsy-adjacent, and a nullable return leaves them
distinguishable only by a caller checking `!== null` against two different
nullable things. This file's own history includes a data-loss bug from one
missing clause in this area.

The `processing_status` clause is load-bearing, not belt-and-braces. It is
what makes "cannot generate notes before a transcript exists" true **by
construction** rather than by caller discipline. A zero-row claim must not
spend a Gemini call, and that is proved by **counting calls** in
`scripts/verify-notegen-pipeline.mjs`, never by reading the code.

The blank-transcript guard runs **after** the claim, not before. Checking
first would leave the row eligible forever, so every sweep would re-examine it
and a handful of permanently blank rows could starve real work out of the
per-run cap. Claiming then failing is terminal and self-clearing, and it is
still before any model call — which is the guarantee that actually matters. It
also means a lost claim never reaches that branch, so a blank row this process
does not own can never be failed over the winner's `'generating'`.

**Age alone IS terminal here**, unlike transcription. There, age could not
fail a row on its own because an upload might still be arriving and object
existence was the real check. Nothing is still arriving here — the transcript
was written onto the row before it ever became eligible.

`lib/notegen/sweep.ts` owns `notegen_status` and nothing else. Its stale
pass is the same query *shape* as `lib/transcription/sweep.ts`'s
stale-`'analyzing'` pass, deliberately reimplemented rather than reached
across for. **Do not edit `lib/transcription/sweep.ts` to handle this
column.**

**Two triggers, one claim.** `claimAndGenerate` in
`lib/notegen/generate-note.ts` is the shared unit;
`lib/notegen/notegen-ports.ts` holds the one Supabase implementation of the
claim. The cron route calls it through `notegenSweep` as a second phase, and
`app/notes/actions/transcription.ts` calls it once inside its existing
`after()` block. If they race, the loser takes a contended zero-row claim.

**One clock, two phases.** `notegenSweep` takes `deadlineAt` as a
parameter rather than computing a budget. The route reads one `startedAt`
and hands phase two `startedAt + RUN_BUDGET_MS` — imported read-only from
the transcription sweep, not redeclared. Two 240 s budgets under Hobby's 300 s
hard ceiling is a run killed mid-write.

**One deferred client, hoisted.** The manual path builds
`createDeferredClient(...)` once inside `after()` and passes the same
instance to both port factories. A second construction is a second client that
can refresh, and a refresh after the response has been sent rotates the user's
refresh token into a cookie write that is silently dropped — the bug
`lib/supabase/deferred-client.ts` documents and that was fixed on
2026-09-01. That path also **re-reads the note row**: `raw_transcript` is
what transcription has just written, so the row carried in from the claim
predates it.

`MAX_NOTEGEN_PER_RUN = 5`, above transcription's 3, because a text-only call
on roughly 12,000 tokens returns in seconds where an audio transcription takes
minutes. The cap bounds cost; the shared budget bounds wall-clock. The cap
counts **model attempts**, so a contended claim and a blank transcript spend
no slot.

Gemini specifics, all read from `genai.d.ts` at the pinned 2.19.0 and from
the live models endpoint on 2026-09-02, never from samples:

- **`response_format` is TOP LEVEL on `interactions.create`**, not inside
  `generation_config`. Shape is
  `{ type: "text", mime_type: "application/json", schema }`. The sibling
  top-level `response_mime_type` is `@deprecated` — do not send it.
- **`generation_config.thinking_level` takes the lowercase union**
  `"minimal" | "low" | "medium" | "high"`. The SCREAMING_CASE
  `ThinkingLevel` enum belongs to the camelCase `models.generateContent`
  surface and is a 400 here. `depth-policy.ts` owns the mapping and a test
  asserts the casing.
- **`gemini-3.7-flash`, `inputTokenLimit` 1,048,576.** A 60-minute
  transcript — the ceiling `diarization-policy.ts` enforces upstream — is
  near 12,000 tokens. Context is not a constraint and no chunking path is owed.
- **Text only.** This pipeline never fetches, re-sends or sees the audio.

**Which lens a note generates under is chosen on Note Detail, and freezes
wider than you would guess — shipped 2026-09-02.** `app/notes/actions/persona.ts`
writes `notes.persona_id` behind

    UPDATE notes SET persona_id = <uuid>
    WHERE id = <id> AND processing_status IN ('local','uploading')
      AND notegen_status IS NULL RETURNING id

The `processing_status` clause is the load-bearing one. Pressing Transcribe
moves the row to `'analyzing'` while `notegen_status` stays **null for the
whole transcription**, because generation only claims afterwards inside
`after()`. Guarding on `notegen_status` alone would leave a minutes-long window
in which the rail shows one lens and generation picks up another. The rail's
`disabled` attribute is UX; **this guard is the enforcement**, because a Server
Action is a public HTTP endpoint. `seedNotePersona` adds `persona_id IS NULL`
so a seed can never overwrite a real choice.

Seeding on mount is a **real write, not a visual default** — the rail must
never highlight a lens the database does not hold. A frozen note is never
seeded: writing a lens onto one that already generated under a different lens
would make the rail lie. The user's last choice is remembered as a **slug** in
Auth user metadata (`updateUser({ data: { last_persona_id } })`), not a table;
one preference field does not earn a schema addition. Only an explicit choice
writes it — seeding does not.

Regeneration stays rejected (`docs/DECISIONS.md` § Personas, 2026-08-30). The
lock is what makes that true in the UI rather than merely unimplemented.

Lens framings are a **static lookup keyed by slug** in
`lib/notegen/lens-prompts.ts`, not a column — the same category as
`components/note-detail/speaker-colors.ts`, not the same category as the
deleted `persona-presets.ts`. An unrecognised slug falls back to neutral
rather than throwing. Which persona row supplies `name` and `depth` is
settled in § Data above; do not re-derive that rule here.

Generated chunks always write `persona_id: null` and `embedding: null`. The
embedding stays null only until the embedding phase runs, which since
2026-09-03 is the very next step in the same `after()` chain — § Embeddings
below. This pipeline still writes null and must keep doing so: null is what
puts the chunk on the embedding queue.
Chunk writes precede the `'completed'` flip, and the staleness sweep is the
rollback — no transaction, no compensating write.

**The delete scope must match the insert scope, and `persona_id IS NULL` is
what makes that true.** `deleteGeneratedChunks` filters on three things:
`note_id`, `chunk_type` in the three generated types, and `persona_id IS
NULL`. The third was missing until 2026-09-02 and the omission was a data-loss
bug, not a tidiness one: this pipeline only ever *writes* default-lens rows, so
a delete without that clause is wider than the insert and takes out every
lens-attributed takeaway on the note. Those rows cannot be rewritten — nothing
sets a persona at capture — so the Sales Coach, Investor and Engineering Lead
rails would have rendered empty. The seeded note carries nine of them, three
per lens. Two tests in `notegen-ports.test.ts` pin the clause, and both were
confirmed to fail without it.

**First run replaces the seed note's hand-written takeaways.** The claim guard
matches every already-`'completed'` note, and the delete-then-insert is
idempotency rather than cleanup. This is designed behaviour: those seed rows
were a fixture standing in for this pipeline.

    node scripts/verify-notegen-pipeline.mjs   # no dev server needed:
                                               # five proofs, Gemini calls
                                               # counted, rows deleted as owner
    node scripts/verify-persona-selection.mjs  # no dev server needed:
                                               # six proofs — seeding, the
                                               # guarded write, the frozen
                                               # refusal, and the SAME
                                               # transcript generated under
                                               # two lenses so the framings
                                               # can be read side by side

## Embeddings

**`note_chunks.embedding IS NULL` IS the queue**, the same rule as
`processing_status` and `notegen_status` — at **chunk** grain, because
embeddings are per chunk, not per note. There is no new status column and no
job table. `lib/rag/sweep.ts` owns this column and nothing else; do not edit
`lib/transcription/sweep.ts` or `lib/notegen/sweep.ts` to handle it.

**There is deliberately NO claim.** The inline trigger and the cron sweep may
both reach one note, and the loser costs a duplicate **Voyage call**, never a
duplicate **write** — the per-row guard
`update(embedding) ... eq(id) ... is(embedding, null)` in
`lib/rag/supabase-ports.ts` is atomic. That is the whole difference from the
other two pipelines: their claim exists because a lost race would cost a Gemini
call. At $0.06/M tokens against a 200-million-token free allowance a Voyage
call is a rounding error. **Do not add a note-level lock.**

**The model is `voyage-4`, not `voyage-3-large`.** Changed 2026-09-03 on cost:
the older model is Voyage's legacy tier at $0.18/M with no free allowance. The
two are otherwise identical for our purposes. Vendor specifics, all read from
the live docs that day, never from memory:

- `POST https://api.voyageai.com/v1/embeddings`, `Authorization: Bearer`.
- **`input_type` is always `"document"`.** Voyage is asymmetric; the retrieval
  side owes `"query"` on the question. Sending the wrong one degrades ranking
  silently rather than erroring.
- **`output_dimension: 1024` and `output_dtype: "float"` are PINNED on every
  call.** The column is a fixed `extensions.vector(1024)`. `voyage-4` also
  offers 2048/512/256 and five dtypes; a moved default would start writing
  vectors the column refuses, or integers it silently accepts as nonsense.
- Caps: **1,000 texts and 320,000 tokens per request**; `VOYAGE_MAX_BATCH_TEXTS`
  is 128 and `VOYAGE_MAX_BATCH_TOKENS` 100,000, both well under.
- **The rate limit depends on billing, and this account is now billed.** Tier 1
  for `voyage-4` is 2,000 RPM / 8,000,000 TPM, but only with a payment method
  on file. Without one Voyage holds the account at **3 RPM / 10,000 TPM** and
  says so in the 429 body — measured 2026-09-03. A card went on file the same
  day and the lift was measured, not assumed: 30 concurrent requests all
  returned 200 in 0.62 s. See `docs/KNOWN_GAPS.md` § "The Voyage account was on
  the unbilled tier", RESOLVED. Re-measure with a burst before trusting the
  headroom again — spread-out calls cannot tell the two tiers apart.
- The vector crosses PostgREST as `JSON.stringify(vector)` — pgvector's own
  text input format. A raw array serialises as a JSON array, a different type.
- **`VoyageError` uses plain fields, not constructor parameter properties.**
  `scripts/verify-embeddings-pipeline.mjs` loads the shipped module through
  Node's strip-only type stripping, which rejects `readonly kind:` in a
  parameter list. Keep every shipped module a verify script imports loadable
  that way.

**Only a chunk that fails ON ITS OWN is charged an attempt.** A `429`/`5xx`/
network failure is transient and increments nothing; a `401`/`403` aborts the
run rather than burning every chunk's counter; only a `400`/`422` counts.

**The one-at-a-time fallback fires on a CONTENT error only, never a transient
one — corrected 2026-09-03 in code review.** Retrying each member alone is how
one poison chunk is isolated so it cannot spend its siblings' attempts, and a
`400` is the only error that says nothing about *which* text was at fault. A
`429` says nothing about any text at all, so calling each member alone cannot
produce a different answer — it turns one rejected request into `1 + N`
rejected requests aimed at the limit that just rejected it. On the unbilled
3 RPM tier this account was held at that day, that was ~101 requests per long
note. A transient batch now defers
whole, every member still eligible, counters untouched; a test pins the call
count at one. Three charged attempts and the chunk is left null
permanently. **Nothing retries it, but since 2026-09-05 something reports it:**
`app/api/cron/transcribe/route.ts` runs one read-only count after its three
phases and adds `stuckChunks: { count, chunks }` to its JSON response — the key
present ONLY when the count is above zero, so a healthy run's body is unchanged.
See `docs/KNOWN_GAPS.md` § "An unembeddable chunk gives up silently", RESOLVED,
for the filter's TEXT-typed equality and the direction the cap may move.

Attempts live in `note_chunks.metadata`, **merged, never overwritten** — a
`transcript_segment` row carries `speaker`, `ts_start`, `ts_end` and `seq` in
that same object. PostgREST cannot send `metadata || jsonb_build_object(...)`,
so `withEmbedAttempt()` merges the object the listing query already returned and
the guarded UPDATE writes the merged whole.

The eligibility filter enumerates attempt values (`in.(0,1,2)`) rather than
comparing them. PostgREST reads `metadata->>embed_attempts` as **text**, so
`lt.3` would be a lexicographic comparison — right for one digit, wrong the
moment the cap reaches ten. The list is generated from `MAX_EMBED_ATTEMPTS`.

**Blank content is terminal, not skipped.** A whitespace chunk is taken straight
to the attempt cap with no Voyage call. Skipping would leave it eligible
forever and a handful could starve real work out of the per-run cap — the same
reasoning as note generation's blank-transcript guard.

`VOYAGE_API_KEY` is **server-only** and read in exactly three shipped files —
`app/notes/actions/transcription.ts`, `app/api/cron/transcribe/route.ts` and
`app/api/chat/route.ts`, which embeds the QUESTION at `input_type: "query"`
(§ Chat).
`lib/rag/*` reads no environment variable at all; the caller supplies the key,
which is what keeps it out of every client component's import graph.
`project-conventions.test.ts` fails the build if either stops being true. An
unset key **skips** rather than throws in both places: the cron sweep is also
the backfill, so nothing is lost but latency.

**Three phases, one clock.** The cron route reads one `startedAt` and hands
`startedAt + RUN_BUDGET_MS` to phase two and phase three alike. Embedding runs
last because it is the only phase with a standing backstop.
`MAX_EMBED_NOTES_PER_RUN = 10` bounds cost; the shared budget bounds wall-clock.
The cap counts **notes**, because a note is the batching unit, and it is sized
against the write-back — one guarded UPDATE per chunk, since PostgREST cannot
set a different value per row in one statement — not against the Voyage call,
which is fast.

`note_chunks_pending_embedding_idx` is a **partial** index on `(created_at)
where embedding is null` — the sweep's query, and nothing else. It shrinks
towards empty as the table fills, which is the opposite of what a full index
would do here. `EXPLAIN` against the live project confirms the planner uses it.

    node scripts/verify-embeddings-pipeline.mjs   # no dev server needed:
                                                  # six proofs, Voyage calls
                                                  # counted, cosine ranking
                                                  # measured, the 3-attempt cap
                                                  # exercised with a healthy
                                                  # sibling alongside it.
                                                  # Paces itself 21 s apart for
                                                  # a throttled account. A card
                                                  # is on file as of 2026-09-03,
                                                  # so run it with
                                                  # VOYAGE_MIN_CALL_INTERVAL_MS=0
                                                  # -- seconds, not minutes.
                                                  # Keep the default: it is what
                                                  # makes the script runnable on
                                                  # an account throttled again.

## Chat

**Retrieval splits by SCOPE, and single-note chat uses none of it.** A meeting
transcript is small against Claude's context window, so the this-note path
feeds the raw transcript plus this note's generated chunks straight in, behind
one 5-minute cache breakpoint. Cross-note is the only retrieval consumer.

**The single-note path never reads `notegen_status`, and that absence is the
feature.** `buildTranscriptBlock` in `lib/chat/context.ts` includes generated
notes when they exist and omits them when they do not — there is no branch,
which is what makes "chat works the instant transcription finishes" true by
construction rather than by discipline. Proved in a browser on 2026-09-03
against a note at `'generating'` and one at `'failed'`; both answered. A test
asserts the block never contains the words notegen, generating or failed.

**The cached block must stay byte-stable across turns.** Prompt caching is a
prefix match, so one timestamp, turn counter or random id in that block leaves
`cache_read_input_tokens` at zero forever while everything still looks
correct. A test asserts two calls produce an identical string.

**And it must sit AHEAD of the history, not after it — found in code review
2026-09-03.** Byte stability is necessary and NOT sufficient: caching
matches a prefix from the start of the request, so a block placed after the
conversation diverges from turn 1's prefix the moment a second turn exists,
and the cache never reads. The transcript therefore leads `messages` as its
own user block and the history follows; the provider merges consecutive
same-role messages, so it coalesces with the first question. A route test
asserts the ordering, because the byte-stability test passes either way and
would have let this ship.

**MEASURED 2026-09-03, and the numbers are in the log on purpose.** The route
prints `[chat] scope=… in=… cacheRead=… cacheWrite=… out=…` on every turn.
A 5,700-token transcript gave `cacheWrite=7483` on turn 1 and
`cacheRead=7483` on turn 2 — the whole prefix served from cache. Keep the log
line: the cache can stop hitting from a change nowhere near the route, and
nothing fails when it does. Only the bill moves.

**A short note will never cache, and that is correct.** Anthropic declines to
cache a prefix under roughly 1,024 tokens and says nothing about it. A
six-line transcript measured `in=554 cacheWrite=0` — there is nothing worth
saving there, so this is not a bug and must not be "fixed". It does mean a
small fixture cannot prove the cache works; measure with a realistic
transcript or you are testing nothing. The breakpoint
is `providerOptions.anthropic.cacheControl: { type: "ephemeral" }`, whose
default TTL is the 5 minutes this design wants — read from the AI SDK's
Anthropic provider docs on 2026-09-03, not assumed.

**`search_note_chunks` is NOT `security definer`, and app code adds no
`user_id` filter around it.** RLS on `notes` and `note_chunks` does the
owner-scoping; a redundant filter would mask an RLS failure instead of
exposing it. `prosecdef = false` was read back from `pg_proc`.

**`set search_path = ''` costs two things that do not announce themselves.**
The linter wants it; both consequences are silent:

- `<=>` lives in `extensions`, so an empty search path cannot resolve it.
  Write `operator(extensions.<=>)`.
- `'english'::regconfig` resolves through the search path too. Write
  `'pg_catalog.english'::regconfig` — the same OID
  `note_chunks_content_fts_idx` was built with, so the gin index still
  matches. Getting this wrong does **not** error; it sequential-scans every
  chunk ever written. `EXPLAIN` confirmed a Bitmap Index Scan on 2026-09-03,
  and the planner normalises the qualified form straight back to
  `'english'::regconfig`. Re-run the `EXPLAIN` rather than trusting this line.

The candidate pool is **one clause** — `created_at > now() - interval '90
days' order by created_at desc limit 25` — which naturally yields whichever
bound is smaller. The result cap is 25 post-RRF, unconditionally, and it is
stated twice on purpose: the SQL `limit 25` is the real bound, and
`MAX_SEARCH_RESULTS` in `lib/rag/search-tool.ts` holds if that function is
ever edited. `scripts/verify-chat-search.mjs` proves both pool bounds
separately, because a change that broke one while leaving the other would
pass a combined test.

**History is re-read from `chat_messages` every turn, never taken from the
request body.** `useChat` posts its whole message array; the route reads only
the newest text and the scope out of it. That is what makes the 20-turn bound
structural rather than cooperative — a forged 500-turn payload cannot walk
past `trimHistory` because `trimHistory` never sees it. A route test pins it.

**The two ceilings, in cheapest-first order.** 4,000 characters (a string
compare) then 20 user messages per rolling 60 seconds (one `count` against
`chat_messages`, RLS-scoped, no `user_id` filter). Both run before any
embedding and any model call. **Do not add a rate-limit table** — the table
this feature already creates answers the question.

**The user's turn is persisted BEFORE the model call, and rolled back if that
call fails — added 2026-09-04.** The ordering is not incidental: the rate
limit above counts rows in `chat_messages`, so a question that is not a row is
a question that is not counted. The cost is that a failed model call used to
leave the question in the thread forever, re-sent as history on every later
turn — found in production when a malformed `ANTHROPIC_WORKSPACE_ID` 400'd
three turns in a row.

`insertUserMessage` therefore returns the new row's id, and
`consumeStream`'s `onError` deletes **that id**, never "the newest row" — a
concurrent turn could have written one. The `answered` flag, set at the top of
`onFinish`, is what stops the rollback firing on a stream that died after text
arrived: deleting a question under a persisted answer trades one orphan for a
worse one. **Do not move the insert after the model call** to avoid needing
the rollback; that silently un-gates the rate limit. Four tests in
`route-gates.test.ts` pin all of it, and the rate-limit consequence is recorded
in `docs/KNOWN_GAPS.md`.

**`note_chunks.embedding IS NULL` is still the embedding queue and nothing
here touches it.** Chat is read-only against `note_chunks`.

Gemini is not involved. Claude specifics, all measured against the live API on
2026-09-03 rather than recalled:

- **The model id is `claude-sonnet-5`**, exact, no date suffix.
- **Sonnet 5 removed `budget_tokens` and answers 400 if it is sent.** Use
  `thinking: { type: "adaptive" }`. A route test asserts the string never
  appears.
- **Pass a stop condition, or the tool loop never answers.** `stopWhen:
  isStepCount(5)`. Without one the run halts after the tool call and no
  text is ever written.

  **Corrected 2026-09-03, in code review.** This read "the step-loop helper
  is `isStepCount(n)`, NOT `stepCountIs(n)` — the older name does not exist
  in `ai` 7.x". It does exist: `index.d.ts` exports `isStepCount as
  stepCountIs`, so the two are the same function and either name works. The
  claim was written from the docs' prose rather than from the installed
  `.d.ts`, which is exactly what § Transcription's own rule forbids.
- **`sendReasoning: false` must be passed EXPLICITLY** to
  `toUIMessageStream`. It **defaults to `true`** in `ai` 7.0.92 —
  `node_modules/ai/dist/index.js:7932` — so omitting it opts IN and
  forwards reasoning deltas to the browser. A test pins the explicit
  `false`.

  **Corrected 2026-09-03, in code review.** This read "`sendReasoning` must
  stay unset … leaving the flag off keeps chain-of-thought off the wire",
  which is the opposite of what the installed version does. The test
  asserted the same mistake and therefore forbade the fix. Layers 1 and 3
  (the renderer ignores `reasoning` parts; Sonnet 5 defaults
  `thinking.display` to `"omitted"`) held throughout, so nothing leaked —
  but an inverted defence-in-depth layer is worse than a missing one,
  because it is believed.
- **An identity-linked API key needs `anthropic-workspace-id` on every
  request** or the API answers 400. `ANTHROPIC_WORKSPACE_ID` is sent only when
  set, because a plain workspace-scoped key must not send it. Confirmed by the
  response echoing the header back.

**Citations key on WHERE the cited content lives, not on `chunk_type`.**
`[[cite:t<seq>]]` is a transcript segment on the page being viewed and scrolls
to it; `[[cite:c<n>]]` is result n from a tool call, usually another note, and
**navigates**. Chunk type only chooses the label. The chunk-type axis was
rejected because it has no answer for a `transcript_segment` chunk returned by
the search tool — "jump to its timestamp" would land on the wrong recording's
timeline.

**An unresolvable marker warns and drops, and a message that loses ALL of its
citations must not render as grounded.** Silent is right for a malformed
marker and wrong when the cause is a deleted chunk or a removed note. A
partially-resolving message is deliberately not flagged — a warning on a
mostly-sourced answer trains the warning to be ignored. `parse-citations.ts`
builds its regex per call, not at module scope: a `/g` regex carries
`lastIndex` and this runs on every streamed token.

`ANTHROPIC_API_KEY` and `ANTHROPIC_WORKSPACE_ID` are **server-only** and read
in exactly one shipped file, `app/api/chat/route.ts`, which is also
`VOYAGE_API_KEY`'s third and last reader. `project-conventions.test.ts` fails
the build if any of that stops being true, and separately if any server key
ever gains a `NEXT_PUBLIC_` prefix.

    node scripts/verify-chat-rls.mjs                  # five proofs: two-user
                                                      # RLS, the forged
                                                      # user_id, the with-check
                                                      # handoff, and a cited
                                                      # note deleted under a
                                                      # live citation
    VOYAGE_MIN_CALL_INTERVAL_MS=0 \
      node scripts/verify-chat-search.mjs             # six proofs: both chunk
                                                      # types, the 25-cap
                                                      # biting, BOTH pool
                                                      # bounds, Voyage calls
                                                      # counted


## Naming

The application has no confirmed public name. **Do not put a name string —
working or otherwise — anywhere in code.** User-facing copy stays generic
("your notes", page titles with no brand). The only exception is the
`package.json` `name` field.

## Supabase

Hosted project only. There is no local stack — **Docker is not installed on
this machine**, and `supabase db pull` / `supabase db dump` both fail without
it because they build a shadow database. Everything below runs against the
linked project through the management API, needing neither Docker nor the
database password.

### Pinned versions

Exact pins, verified against the live npm registry on 2026-08-30.

| Package | Version |
|---|---|
| @supabase/ssr | 0.12.5 |
| @supabase/supabase-js | 2.112.4 |
| supabase (CLI, installed) | 2.115.0 |

`@supabase/ssr` 0.12.5 takes the `getAll` / `setAll` cookie API. The
`get` / `set` / `remove` form is deprecated and will be removed.

### Declarative schema workflow

`supabase/schemas/*.sql` is the source of truth. `config.toml` lists them in
dependency order — **not** a glob, which would sort `note_chunks.sql` before
`notes.sql` and break the foreign key. The order is `notes.sql`,
`personas.sql`, `note_chunks.sql`, `persona_provisioning.sql`,
`storage_audio.sql`: personas needs `set_updated_at()` from notes, note_chunks
carries a foreign key to personas, and persona_provisioning's trigger writes
into personas. `storage_audio.sql` depends on none of them and sits last.
Read the list out of `config.toml` rather than from here.

**Schema-file-first, no exceptions.** Never paste DDL into `db query` as an
inline argument. Edit the `.sql` file, then apply that exact file. Every
statement is idempotent, so iterating means re-running the whole file. Inline
`db query` is for `select` verification only.

    npx supabase db query --linked --project-ref <ref> --file supabase/schemas/notes.sql
    npx supabase db advisors --linked --project-ref <ref> --type all --level info

Never call `apply_migration` while iterating — it writes a migration history
entry on every call and blocks further diffing.

When the shape is final: `supabase migration new <name>`, fill it with `cat`
of the schema files in order, `supabase migration repair --status applied`,
then confirm with `supabase migration list --linked`. Verify with
`git hash-object` that the migration and the concatenated schema files match,
and read the live catalog back — `pg_policies`, `pg_indexes`,
`information_schema.columns`, `pg_constraint` — since `db diff` is unavailable.

### RLS rules

Four per-operation policies per table — select, insert, update, delete. Never
one blanket `for all`.

- Predicate is always `(select auth.uid()) = user_id`, wrapped. Bare
  `auth.uid()` is re-evaluated per row.
- Every policy carries `to authenticated` **and** an ownership predicate.
  `to authenticated` alone is authentication without authorization.
- UPDATE needs both `using` and `with check`. Without `with check` a user can
  reassign `user_id` and hand their row to somebody else.
- Grants are separate from RLS. This project was created with "Automatically
  expose new tables" off, so each table grants `authenticated` explicitly.
  Schema files `revoke all` first: the project defaults hand `anon` and
  `authenticated` TRUNCATE, which is not row-level and which RLS does not
  constrain. `anon` is granted nothing.
- Queries never filter on `user_id` in application code. RLS supplies it, and
  a redundant filter would mask an RLS failure instead of exposing it.
- A foreign key between two user-owned tables is composite, carrying
  `user_id`: `note_chunks.persona_id` references `personas (id, user_id)`,
  not `personas (id)`. Foreign keys are validated as the referenced table's
  owner and are **not** subject to RLS, so a single-column reference lets one
  user point their row at another user's row. The referenced table needs a
  matching `unique (id, user_id)` for this. `on delete set null` then names
  the nullable column — `on delete set null (persona_id)`, Postgres 15 and
  later — or it would try to null `user_id` too.

### Deployment

`main` auto-deploys to Vercel (`tekguyz/squid-ink`, `https://squid-ink.vercel.app`).
Vercel's own link and config files are absent from the tree, so this is
invisible from the repo — **`docs/DEPLOYMENT.md` is the source of truth** for the Supabase Site URL,
the redirect allowlist, the Vercel environment variables, and the `curl` recipes
that re-measure them without a dashboard. Read it before changing anything about
auth redirects, and never test sign-in on a raw deployment URL without checking
that file first.

### Keys

Publishable key only in app code, via `NEXT_PUBLIC_SUPABASE_*`. Never give the
secret key a `NEXT_PUBLIC_` prefix — Next.js ships every such variable to the
browser.

The secret key bypasses RLS. **Exactly one file in shipped application code
reads it:** `app/api/cron/transcribe/route.ts`, from the Vercel environment.
That is the amendment this project made on 2026-08-31, and it is deliberate: a
cron invocation carries no user session and therefore no RLS identity, so it
must read and write rows belonging to whichever user recorded them. The route
refuses every request that does not carry `Authorization: Bearer $CRON_SECRET`
before it touches the database or the Gemini API.

**Nine local-only** scripts also read it from the gitignored `.env.local` —
`verify-rls.mjs`, `verify-storage-rls.mjs`, `verify-recorder-upload.mjs`,
`verify-persona-provisioning.mjs`, `verify-transcription-pipeline.mjs`,
`verify-manual-transcribe.mjs`, `verify-notegen-pipeline.mjs`,
`verify-persona-selection.mjs` and `print-signin-link.mjs`. None ships.

**Corrected 2026-09-03**, measured with the second grep below. This read "Six"
and named six, having missed the four scripts added between 2026-09-01 and
2026-09-02. The paragraph already said a new script moves this number; it did,
four times, and nothing moved it. An earlier version of this section claimed
"exactly one place, `scripts/verify-rls.mjs`", which was already wrong when
written; the greps below are the check that settles it. Run them rather than
trusting the counts here — a new script moves the second number.

    grep -rn "SUPABASE_SECRET_KEY" --include=*.ts --include=*.tsx app lib components
    grep -rln "SUPABASE_SECRET_KEY" scripts

`service_role` is granted `select, insert, update, delete` on `public.notes`
and `public.note_chunks`, and nothing else — see the grant blocks in both
schema files. Before 2026-08-31 it held only `REFERENCES, TRIGGER, TRUNCATE`,
so every cron read failed with `permission denied for table notes`. A grant is
not a policy: `service_role` already bypasses RLS, what it lacked was
reachability.

### Proving RLS

`node scripts/verify-rls.mjs` after any change to a policy, a grant, or a
`user_id` column. It signs in two real users and runs the identical query as
each; the second must get a genuine empty result, not `permission denied`.
That proves the database. It does **not** prove the app's cookie plumbing —
that needs a request through `proxy.ts` with a real session. Run both.

## Commands

    npm run dev        # dev server
    npm run build      # production build
    npm run typecheck  # tsc --noEmit
    npm test           # vitest run
    node scripts/verify-rls.mjs   # two-user RLS proof, needs .env.local
    node scripts/verify-persona-provisioning.mjs   # signup-trigger proof, needs .env.local
    node scripts/verify-transcription-pipeline.mjs # live transcription proof, needs `npm run dev`
    node scripts/verify-embeddings-pipeline.mjs    # live embeddings proof, needs .env.local
                                                   # (VOYAGE_API_KEY); paces itself, minutes
    node scripts/verify-layout.mjs                 # screen-level layout proof, needs
                                                   # `npm run dev` and .env.local

## Layout

**Every other check in this repo is file-shaped; this class of defect is
screen-shaped.** `npm test` renders in jsdom, which has no layout engine, so
every rect there is zeros. `project-conventions.test.ts` reads source text.
The impeccable detector lints class strings. All three are correct and all
three are blind to two files that are each right alone and wrong on the same
pixels.

`scripts/verify-layout.mjs` is the check that is not. It drives the Chrome
already installed over the DevTools Protocol — **no new dependency**, using
Node's built-in `WebSocket` — signs in through the same `generateLink` path
`print-signin-link.mjs` documents, and measures real boxes on `/` and a real
note at 1440px and 1280px, in **both themes**, six assertions each:

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

Widths are `1440` and `1280` only, because no responsive breakpoint work has
shipped. Add widths when breakpoints do, not before. Next's dev-tools badge is
a real fixed element in the bottom-left corner and is excluded by name; it
does not ship.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
