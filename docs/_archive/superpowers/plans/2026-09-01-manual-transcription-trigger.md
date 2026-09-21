# Manual Transcription Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a user press a button on Note Detail to transcribe one `'uploading'`
note on demand, reusing Track 3's pipeline, with no possibility of a duplicate or
wasted Gemini call.

**Architecture:** The per-row unit the cron sweep runs inline in its loop
(object-existence check -> atomic claim -> Gemini -> persist) is extracted to
`lib/transcription/transcribe-note.ts`. The Supabase implementation of
`SweepPorts` moves out of the cron route into `lib/transcription/supabase-ports.ts`
so both callers build ports the same way from a `SupabaseClient` — the sweep from
a secret-key client, a new Server Action from the authenticated cookie client.
The action claims synchronously (so the browser learns the outcome at once) and
runs the transcription in `after()`. A client component polls that one note's
status through the browser Supabase client and calls `router.refresh()` on a
terminal state.

**Tech Stack:** Next.js 16.3.3 App Router (`after` from `next/server`, Server
Functions), `@supabase/ssr` 0.12.5, `@supabase/supabase-js` 2.112.4, Tailwind v4
tokens, Vitest 4.1.11.

**Spec:** the prompt "Manual Transcription Trigger (Track 3, continued)", and
`docs/KNOWN_GAPS.md` § "The cron sweep is the ONLY transcription trigger".

## Global Constraints

- Every colour is a `var()` token. Zero `oklch()`/hex/`rgb()`/`hsl()` in `app/`,
  `components/`, `lib/`. Guard: `components/note-detail/__tests__/project-conventions.test.ts`.
- Soft ceiling 250 lines per file, hard ceiling 400 (the guard enforces 400).
- `SUPABASE_SECRET_KEY` stays readable from exactly one shipped file:
  `app/api/cron/transcribe/route.ts`.
- One claim implementation. Never a second
  `UPDATE ... WHERE processing_status = <expected> RETURNING id`.
- A zero-row claim must short-circuit before any Gemini call.
- No age/staleness check on the manual path.
- No retry affordance for `'failed'`. `'failed'` is terminal.
- No JSON API route for either read or write. Browser Supabase client for reads,
  Server Action for the mutation.
- No schema change. Confirmed live on 2026-09-01: `notes_processing_status_check`
  is `CHECK (processing_status = ANY (ARRAY['local','uploading','analyzing','completed','failed']))`.

### Deviation from the prompt's file fence, stated up front

The prompt lists `app/api/cron/transcribe/route.ts` under "do not modify", but
also requires **one claim implementation, two callers**. The claim lives inside
`portsFor()` in that route. Satisfying the stronger constraint requires the route
to import the extracted factory instead of defining it. The edit is limited to
deleting the moved definitions and adding one import; `maxDuration`,
`isAuthorized`, the `CRON_SECRET` gate and the `GET` handler body are unchanged.

---

### Task 1: Extract the Supabase ports factory out of the cron route

**Files:**
- Create: `lib/transcription/supabase-ports.ts`
- Modify: `app/api/cron/transcribe/route.ts`
- Test: `lib/transcription/__tests__/supabase-ports.test.ts`

**Interfaces:**
- Produces: `createTranscriptionPorts(db: SupabaseClient, geminiKey: string): SweepPorts`
  and `createTranscriptionStore(db: SupabaseClient): TranscriptionStore`.

- [ ] **Step 1:** Write `lib/transcription/__tests__/supabase-ports.test.ts` asserting
      that the path rule still throws on a malformed `audio_storage_path`, and that
      `claim` issues one `update().eq(id).eq(processing_status).select()` chain
      against a stub client and reports false on zero rows.
- [ ] **Step 2:** Run `npx vitest run lib/transcription/__tests__/supabase-ports.test.ts` — expect FAIL (module missing).
- [ ] **Step 3:** Move `storeFor`, `portsFor` and `objectRow` verbatim into the new
      file, renamed `createTranscriptionStore` / `createTranscriptionPorts`.
- [ ] **Step 4:** In `route.ts`, delete the moved code and import the factory.
- [ ] **Step 5:** Run `npx vitest run` and `npm run typecheck` — expect PASS.
- [ ] **Step 6:** Commit.

### Task 2: Extract the per-row claim+transcribe unit

**Files:**
- Create: `lib/transcription/transcribe-note.ts`
- Modify: `lib/transcription/sweep.ts`
- Test: `lib/transcription/__tests__/transcribe-note.test.ts`

**Interfaces:**
- Produces:
  - `type ClaimOutcome = "claimed" | "contended" | "waiting" | "no-object"`
  - `claimNoteForTranscription(ports, row, options): Promise<ClaimOutcome>` where
    `options` is `{ failOnMissingObject: boolean; ageMs?: number | null }`
  - `transcribeClaimedNote(ports, row): Promise<"transcribed" | "failed">`
  - `claimAndTranscribe(ports, row, options): Promise<ClaimOutcome | "transcribed" | "failed">`
- Consumes: `SweepPorts`, `UploadingRow` from `sweep.ts`.

- [ ] **Step 1:** Write tests: object present -> claim `'uploading'->'analyzing'` ->
      `"claimed"`; claim lost -> `"contended"` and `transcribe` never called;
      object absent with `failOnMissingObject: false` -> `"waiting"`, no claim;
      object absent with `failOnMissingObject: true` -> claim `'uploading'->'failed'`
      -> `"no-object"`, `transcribe` never called.
- [ ] **Step 2:** Run the test file — expect FAIL.
- [ ] **Step 3:** Implement, moving `transcribeOne` from `sweep.ts` unchanged.
- [ ] **Step 4:** Rewrite the sweep's uploading loop to call `claimAndTranscribe`,
      passing `failOnMissingObject: stale` and `ageMs`.
- [ ] **Step 5:** Run `npx vitest run lib/transcription` — every existing sweep test
      must still pass unchanged.
- [ ] **Step 6:** Commit.

### Task 3: Carry `processing_status` into the view types

**Files:**
- Modify: `lib/notes/view-types.ts`, `lib/notes/types.ts`,
  `lib/notes/note-view-model.ts`, `lib/notes/list-notes.ts`
- Test: `lib/notes/__tests__/note-view-model.test.ts`, `lib/notes/__tests__/list-notes.test.ts`

`ProcessingStatus` moves to `view-types.ts` — components must not import from
`types.ts`, and `types.ts` already imports from `view-types.ts`, so moving it the
other way would make the cycle real rather than type-only. `types.ts` re-exports it.

- [ ] **Step 1:** Add assertions that `buildNoteViewModel` returns
      `processingStatus` and `listNotes` returns it per row.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expect PASS. Commit.

### Task 4: The Server Action

**Files:**
- Modify: `app/notes/actions.ts`
- Test: `app/notes/__tests__/actions.test.ts`

**Interfaces:**
- Produces: `type TranscriptionTrigger = "started" | "not-claimed" | "no-audio" | "not-found"`
  and `triggerTranscription(noteId: string): Promise<TranscriptionTrigger>`.

- [ ] **Step 1:** Tests: not signed in -> throws; row not visible -> `"not-found"`;
      claim lost -> `"not-claimed"` and nothing scheduled; object missing ->
      `"no-audio"` and no Gemini call; happy -> `"started"` and the transcription
      is scheduled through `after`.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement with `createClient()` (authenticated, cookie-based),
      `createTranscriptionPorts`, `claimNoteForTranscription`, then
      `after(() => transcribeClaimedNote(...))`.
- [ ] **Step 4:** Run — expect PASS. Commit.

### Task 5: The status read

**Files:**
- Create: `lib/notes/transcription-status.ts`
- Test: `lib/notes/__tests__/transcription-status.test.ts`

**Interfaces:**
- Produces: `readProcessingStatus(noteId: string, reader?: StatusReader): Promise<ProcessingStatus | null>`

- [ ] **Step 1:** Test: returns the status; returns null when RLS hides the row;
      throws on a transport error. **Step 2:** FAIL. **Step 3:** Implement,
      mirroring `audio-playback.ts` (browser client, injectable seam).
      **Step 4:** PASS. Commit.

### Task 6: The button

**Files:**
- Create: `components/note-detail/transcribe-button.tsx`
- Modify: `components/note-detail/note-detail-shell.tsx`
- Test: `components/note-detail/__tests__/transcribe-button.test.tsx`

- [ ] **Step 1:** Tests: absent from the DOM for `'completed'`, `'failed'` and
      `'local'`; present and enabled for `'uploading'`; disabled and polling on
      mount for `'analyzing'`; polling stops on unmount; `router.refresh()` fires
      on a terminal status; the neutral message appears past the cap.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. Commit.

### Task 7: The dashboard pill

**Files:**
- Create: `components/dashboard/status-pill.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1:** Implement (static markup — TDD is scoped away from it per the
      spec). **Step 2:** `npx vitest run components` — the convention guard must
      cover the new file. **Step 3:** Commit.

### Task 8: The concurrency proof

**Files:**
- Create: `scripts/verify-manual-transcribe.mjs`

Node 24.18 strips TypeScript natively, and a `module.register()` resolve hook maps
`@/` to the repo root — so the script imports the SHIPPED function rather than
re-implementing it. `ports.transcribe` is wrapped in a counter, so "no second
Gemini call" is measured, not asserted.

- [ ] **Step 1:** Write it: synthesise SAPI speech, upload, insert an `'uploading'`
      row, call `claimAndTranscribe` -> `'completed'`; then fire two concurrent
      `claimNoteForTranscription` calls at a second fresh row and assert exactly
      one returns `"claimed"`; then call again on the completed row and assert
      `"contended"` with the Gemini counter unchanged. **Step 2:** Run it.
      **Step 3:** Commit.

### Task 9: Docs

**Files:** `docs/KNOWN_GAPS.md`, `CLAUDE.md`

- [ ] Resolve the gap entry in place, dated 2026-09-01, naming which of the two
      documented options shipped. Add a short § Transcription paragraph to
      `CLAUDE.md` naming the Server Action, the shared claim function, and that
      secret-key usage is unchanged. Commit.
