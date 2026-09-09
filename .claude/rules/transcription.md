---
paths:
  - "lib/transcription/**"
  - "lib/audio/**"
  - "app/api/cron/transcribe/**"
  - "app/notes/actions/transcription.ts"
  - "app/notes/actions/recording.ts"
  - "scripts/verify-transcription-pipeline.mjs"
  - "scripts/verify-manual-transcribe.mjs"
---

# Transcription

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
