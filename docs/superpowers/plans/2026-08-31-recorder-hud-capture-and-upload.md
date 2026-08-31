# Recorder HUD — System+Mic Capture, Direct-to-Storage Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Subagent cap for this track is 0 — do not dispatch subagents, and do not use a subagent to verify your own work.**

**Goal:** Ship a persistent Recorder HUD that captures system audio + mic from any
route, uploads the recording directly to the `audio-recordings` bucket at
`{user_id}/{note_id}`, and creates the `notes` row that Track 3 will pick up.

**Architecture:** A Zustand store mounted once at root-layout scope holds the
recorder phase, so navigation cannot reset it. Capture runs `getDisplayMedia`
(system/tab audio) and `getUserMedia` (mic) into a Web Audio graph whose
`MediaStreamAudioDestinationNode` feeds a single `MediaRecorder` — that
indirection is what makes mid-recording device handoff possible, because the
mic source node can be swapped without the recorder's stream ever changing.
The note id is generated client-side **before** upload so a retry lands on the
same object path (an upsert), and the recorded blob lives in IndexedDB keyed by
that id so it survives navigation and a failed upload. A single server action
creates the `notes` row at `processing_status = 'uploading'` the moment the
upload starts — the path is deterministic, so it is known before the first byte
moves, and `'analyzing'` is Track 3's to set, not this track's.

**Tech Stack:** Next.js 16.3.3 App Router (React Server Components + Server
Actions), React 19.2.8, TypeScript 7.0.2, Tailwind v4.3.3, Zustand 5.0.15,
Vitest 4.1.11 + @testing-library/react 16.3.3 + fake-indexeddb 6.2.5,
`@supabase/ssr` 0.12.5, `@supabase/supabase-js` 2.112.4, hosted Supabase
(project ref `pbwvvakzbrimmdntqxxn`), Postgres 17.

**Spec:** The user prompt "Recorder HUD — system+mic capture, direct-to-Storage
upload" (in-session). Supporting sources of truth read before planning:
`CLAUDE.md`, `docs/KNOWN_GAPS.md`, `supabase/schemas/notes.sql`,
`supabase/schemas/storage_audio.sql`, `design-reference/App Surfaces.dc.html`
surface **02b**, `scripts/verify-storage-rls.mjs`,
`node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`.

---

## Findings that fix decisions before any code is written

These were read, not remembered. They are load-bearing; do not re-derive them.

1. **No schema change is needed.** `supabase/schemas/notes.sql` already has
   `audio_storage_path text` and
   `processing_status text not null default 'local' check (processing_status in
   ('local', 'uploading', 'analyzing', 'completed'))`. DECISIONS.md's prose
   matches the live check constraint exactly. **Task 0 re-confirms this against
   the live catalog before anything depends on it.** If and only if that check
   fails does the conditional migration path in Task 12b open.

2. **The Storage path is `{user_id}/{note_id}`, no extension, no prefix.**
   All three policies in `supabase/schemas/storage_audio.sql` check
   `(storage.foldername(name))[1] = (select auth.uid())::text` with
   `bucket_id = 'audio-recordings'`. There is **no DELETE policy** — an
   authenticated user cannot remove an object. Any cleanup in a verification
   script must use the secret key, exactly as `verify-storage-rls.mjs` does.

3. **Never `download()` to confirm an upload.** Recorded in KNOWN_GAPS and
   reproduced during Track 1: Storage serves reads through a caching CDN and a
   `download()` immediately after an upsert returns the *pre-overwrite* body.
   Size/success verification comes from the `upload()` response or from
   `list()` metadata (`row.metadata.size`), never from downloaded bytes.

4. **`design-reference/support.js` is present on disk** (gitignored, 67.5 KB).
   It was not needed: surface 02b's markup is inline in
   `design-reference/App Surfaces.dc.html` lines 195–262. Nothing about the HUD
   was guessed at. The one thing 02b does **not** supply is a light-theme value
   for the red "recording" dot — see Global Constraint 6.

5. **Login is magic-link only** (`signInWithOtp`). The browser proof therefore
   signs in via `supabase.auth.admin.generateLink()` from a throwaway script and
   navigates to `/auth/confirm?token_hash=…&type=magiclink`, which
   `app/auth/confirm/route.ts` already handles. **No application code is
   changed to enable testing.**

6. **`git worktree` baseRef is `origin/main`, which was 4 commits behind local
   `main`.** The worktree at `.claude/worktrees/recorder-hud` has already been
   `git reset --hard main`, so Track 1 (storage bucket + notes list) is present.
   Baseline verified: **10 test files, 64 tests, 0 failures.** Do not re-branch.

---

## Global Constraints

Every task's requirements implicitly include this section.

1. **Exact version pins, no ranges.** New dependencies for this track, verified
   against the live npm registry on 2026-08-31 with `npm view <pkg> dist-tags`:
   `zustand` **5.0.15** (dependency), `fake-indexeddb` **6.2.5**
   (devDependency). Add both to the `CLAUDE.md` pin table.

2. **Every colour in `components/` and `lib/` is a `var()` token.** Zero
   `oklch()`, hex, `rgb()`, `hsl()`. `app/globals.css` is the only file that
   names a colour. The guard in
   `components/note-detail/__tests__/project-conventions.test.ts` scans
   `components` and `lib` recursively, so `components/recorder/` and
   `lib/recorder/` are already covered — no test change needed.

3. **Soft ceiling 250 lines per file, hard ceiling 400** (enforced by the same
   convention test). A file approaching the ceiling gets a purpose-named
   extraction, never a raised ceiling. No `utils/`, `common/`, or `parts/`.

4. **No product name anywhere in code.** User-facing copy stays generic. The
   `package.json` `name` field is the only exception.

5. **Three faces only:** `font-header` (Bitter), `font-body` (Archivo),
   `font-mono` (IBM Plex Mono).

6. **Two new tokens are required and one of them is derived.** Surface 02b uses
   `oklch(0.66 0.19 25)` for the live-recording dot and
   `0 8px 24px oklch(0.10 0.01 46 / 0.6)` for the HUD shadow. Neither has an
   existing token. Dark values are copied verbatim from the design; the
   **light-theme value for `--live` is derived**, because the design file
   contains no light-theme red at all (`grep` for hue-25 `oklch()` returns only
   dark-surface values). Derivation follows the existing accent pattern — dark
   accent is light (`0.82`), light accent is dark (`0.452`) — so `--live` light
   is `oklch(0.520 0.170 25)`. **This must be recorded in `docs/KNOWN_GAPS.md`
   as a derived value**, matching the existing "Tokens not enumerated in 3c"
   section.

7. **Never filter on `user_id` in application code.** RLS supplies it. The
   server action *sets* `user_id` from `auth.getUser()` on insert — that is
   supplying a value the RLS `with check` then validates, not filtering.

8. **Every Server Function verifies auth itself.** Next 16 docs, `mutating-data`:
   "Server Functions are reachable via direct POST requests, not just through
   your application's UI." Call `supabase.auth.getUser()` and throw when absent.

9. **Do not touch:** `lib/notes/list-notes.ts`, `lib/notes/get-note.ts`,
   `components/note-detail/*` (except running its test), `supabase/schemas/*.sql`
   (unless Task 12b opens), `supabase/config.toml`. **Never add `storage` to
   `[api] schemas`** — `anon` holds an unrevokable TRUNCATE on
   `storage.objects`, mitigated only by that schema being excluded from PostgREST.

10. **No custom echo/noise masking.** The mic constraint is exactly
    `{ echoCancellation: true }`. Do not add `noiseSuppression` or
    `autoGainControl` — ROADMAP §7 rejected extra masking as solving an
    already-disproven cost problem.

11. **Commit after every task.** Conventional-commit subjects matching the
    existing log style (`feat:`, `scripts:`, `docs:`, `db:`).

12. **`CLAUDE.md` carries a `next dev`-generated block** ("This is NOT the
    Next.js you know"). Running `npm run dev` re-adds it. Commit it with the
    work rather than fighting it.

---

## File Structure

**Create — `lib/recorder/` (all framework-free and unit-tested):**

| File | Responsibility | Est. lines |
|---|---|---|
| `recorder-store.ts` | Zustand store: phase machine, elapsed, level, noteId, error | ~170 |
| `format-elapsed.ts` | `formatElapsed(ms)` → `"12:41"` / `"1:02:03"` | ~25 |
| `codec.ts` | `pickMimeType(isSupported)` over an ordered candidate list | ~70 |
| `audio-backup.ts` | IndexedDB put/get/delete/list for the recorded blob | ~130 |
| `device-handoff.ts` | `watchAudioInputs()` — `devicechange` → lost-mic callback | ~90 |
| `capture.ts` | `startCapture()` — display+mic → Web Audio mix → one stream | ~200 |
| `upload-audio.ts` | `recordingPath()` + `uploadRecording()` with `list()` size proof | ~90 |
| `use-recorder.ts` | React hook: the orchestration glue, injectable deps | ~210 |

**Create — `components/recorder/`:**

| File | Responsibility | Est. lines |
|---|---|---|
| `record-hud.tsx` | The dock pill. Pure presentation over store + callbacks | ~200 |
| `hud-level-bars.tsx` | The 7-bar mic level meter from surface 02b | ~45 |
| `recorder-dock.tsx` | Client island: route gate + `useRecorder()` + renders HUD | ~60 |

**Create — other:**

- `app/notes/actions.ts` — `createRecordedNote()` server action.
- `scripts/verify-recorder-upload.mjs` — live end-to-end proof of the object
  path + note row against the hosted project, cleaned up in a `finally`.
- `scripts/print-signin-link.mjs` — throwaway: prints a `/auth/confirm` URL for
  the browser proof. Committed because the next track will need it too.
- `docs/qa/recorder-manual-test-protocol.md` — the runnable checklist.

**Modify:**

- `app/globals.css` — add `--live` and `--shadow-hud` in all three theme blocks
  plus `@theme inline`.
- `app/layout.tsx` — mount `<RecorderDock />`. Layout stays a server component.
- `package.json` — the two pins.
- `CLAUDE.md` — pin table rows + a short `## Recorder` conventions section.
- `docs/KNOWN_GAPS.md` — what shipped, what is still open.

**Tests (mirroring the existing `__tests__` convention):**

- `lib/recorder/__tests__/recorder-store.test.ts`
- `lib/recorder/__tests__/format-elapsed.test.ts`
- `lib/recorder/__tests__/codec.test.ts`
- `lib/recorder/__tests__/audio-backup.test.ts`
- `lib/recorder/__tests__/device-handoff.test.ts`
- `lib/recorder/__tests__/capture.test.ts`
- `lib/recorder/__tests__/upload-audio.test.ts`
- `lib/recorder/__tests__/use-recorder.test.tsx`
- `app/notes/__tests__/actions.test.ts`
- `components/recorder/__tests__/record-hud.test.tsx`

---

## Interfaces — the contract every task shares

Copy these signatures exactly. A later task that renames one of these is a bug.

```ts
// lib/recorder/recorder-store.ts
export type RecorderPhase =
  | "idle"        // nothing running
  | "requesting"  // permission prompts are up
  | "recording"
  | "paused"
  | "stopping"    // MediaRecorder flushing its last chunk
  | "uploading"   // blob is in IndexedDB, going to Storage
  | "error";      // something failed; noteId is kept so a retry reuses the path

export interface RecorderState {
  phase: RecorderPhase;
  noteId: string | null;
  elapsedMs: number;
  level: number;            // 0..1, mic only
  mimeType: string | null;
  errorMessage: string | null;
  requestStart(noteId: string): void;
  confirmStart(mimeType: string): void;
  pause(): void;
  resume(): void;
  beginStop(): void;
  beginUpload(): void;
  finish(): void;
  fail(message: string): void;
  discard(): void;
  tick(deltaMs: number): void;
  setLevel(level: number): void;
}
export const useRecorderStore: import("zustand").UseBoundStore<
  import("zustand").StoreApi<RecorderState>
>;

// lib/recorder/format-elapsed.ts
export function formatElapsed(ms: number): string;

// lib/recorder/codec.ts
export const CODEC_CANDIDATES: readonly string[];
export function pickMimeType(isSupported: (type: string) => boolean): string | null;

// lib/recorder/audio-backup.ts
export interface BackupRecord {
  noteId: string;
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
  savedAtMs: number;
}
export function saveBackup(record: BackupRecord): Promise<void>;
export function loadBackup(noteId: string): Promise<BackupRecord | null>;
export function listBackups(): Promise<BackupRecord[]>;
export function discardBackup(noteId: string): Promise<void>;

// lib/recorder/device-handoff.ts
export interface MediaDevicesLike {
  addEventListener(type: "devicechange", listener: () => void): void;
  removeEventListener(type: "devicechange", listener: () => void): void;
  enumerateDevices(): Promise<Pick<MediaDeviceInfo, "kind" | "deviceId">[]>;
}
export function watchAudioInputs(options: {
  mediaDevices: MediaDevicesLike;
  currentDeviceId: () => string | undefined;
  onDeviceLost: () => void;
}): () => void;   // returns an unsubscribe

// lib/recorder/capture.ts
export interface CaptureDeps {
  getDisplayMedia(c: DisplayMediaStreamOptions): Promise<MediaStream>;
  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>;
  createAudioContext(): AudioContext;
}
export interface CaptureHandles {
  stream: MediaStream;          // the MIXED stream handed to MediaRecorder
  analyser: AnalyserNode;
  micDeviceId(): string | undefined;
  replaceMic(): Promise<void>;  // re-acquire the mic without disturbing `stream`
  stop(): void;                 // stops every track and closes the context
}
export function startCapture(deps?: Partial<CaptureDeps>): Promise<CaptureHandles>;

// lib/recorder/upload-audio.ts
export interface StorageBucketLike {
  upload(path: string, body: Blob, opts: { contentType: string; upsert: boolean }):
    Promise<{ data: { path: string } | null; error: { message: string } | null }>;
  list(prefix: string, opts?: { search?: string }):
    Promise<{ data: { name: string; metadata?: { size?: number } }[] | null;
              error: { message: string } | null }>;
}
export const AUDIO_BUCKET = "audio-recordings";
export function recordingPath(userId: string, noteId: string): string;
export function uploadRecording(args: {
  bucket: StorageBucketLike;
  userId: string;
  noteId: string;
  blob: Blob;
  contentType: string;
}): Promise<{ path: string; sizeBytes: number }>;

// app/notes/actions.ts
export function createRecordedNote(input: {
  noteId: string;
  audioStoragePath: string;
  durationSeconds: number;
}): Promise<{ id: string }>;

// lib/recorder/use-recorder.ts
export interface RecorderDeps {
  capture: typeof import("./capture").startCapture;
  createRecorder(stream: MediaStream, mimeType: string): MediaRecorder;
  isTypeSupported(type: string): boolean;
  newNoteId(): string;
  now(): number;
  getUserId(): Promise<string>;
  bucket(): StorageBucketLike;
  createNote: typeof import("@/app/notes/actions").createRecordedNote;
}
export interface RecorderControls {
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  discard(): Promise<void>;
}
export function useRecorder(deps?: Partial<RecorderDeps>): RecorderControls;

// components/recorder/record-hud.tsx
export function RecordHud(props: { controls: RecorderControls }): React.ReactElement | null;
// components/recorder/hud-level-bars.tsx
export function HudLevelBars(props: { level: number }): React.ReactElement;
// components/recorder/recorder-dock.tsx
export function RecorderDock(): React.ReactElement | null;
```

---

## Task 0: Confirm the live schema, then add pins and tokens

Nothing later is allowed to assume the schema. This task proves it.

**Files:**
- Modify: `package.json`
- Modify: `app/globals.css`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Read the live check constraint back from the catalog.** Inline
  `db query` is for `select` verification only — that is exactly this.

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.notes'::regclass and contype = 'c';"
```

Expected: a row whose definition contains
`processing_status = ANY (ARRAY['local'::text, 'uploading'::text, 'analyzing'::text, 'completed'::text])`.

- [ ] **Step 2: Confirm the columns this track writes exist with the right types.**

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='notes' and column_name in ('id','user_id','audio_storage_path','audio_duration_seconds','processing_status') order by column_name;"
```

Expected: `audio_storage_path text YES`, `audio_duration_seconds integer YES`,
`id uuid NO`, `processing_status text NO`, `user_id uuid NO`.

**If either step disagrees with `supabase/schemas/notes.sql`, STOP and open
Task 12b before writing any code that depends on the column.** Paste both
outputs into the final report either way.

- [ ] **Step 3: Install the two pinned dependencies.**

```bash
npm install --save-exact zustand@5.0.15
```

```bash
npm install --save-exact --save-dev fake-indexeddb@6.2.5
```

- [ ] **Step 4: Verify the pins landed exact (no `^`, no `~`).**

```bash
node -e "const p=require('./package.json');console.log(p.dependencies.zustand, p.devDependencies['fake-indexeddb'])"
```

Expected: `5.0.15 6.2.5`

- [ ] **Step 5: Add the two new tokens to `app/globals.css`.**

Add to the `@theme inline` block, immediately after `--color-waveform`:

```css
  --color-live: var(--live);
```

Add to the `:root` (light) block, after `--waveform`:

```css
  /* Live-recording indicator. DERIVED, not from the design file: surface 02b
     is dark-only and the file contains no light-theme red at all. Follows the
     accent pattern — dark accent is light (0.82), light accent is dark (0.452)
     — so the dark 0.66 becomes 0.520 here. Recorded in docs/KNOWN_GAPS.md. */
  --live: oklch(0.520 0.170 25);
  /* HUD drop shadow colour. Design 02b uses the same value in both the idle
     and recording pills. Light theme needs a lighter, warmer shadow than the
     dark theme's near-black. */
  --shadow-hud: oklch(0.60 0.02 60 / 0.22);
```

Add the same two names to **both** the `.dark` block and the
`@media (prefers-color-scheme: dark) { :root:not(.light) }` block, after
`--waveform`, with the design's verbatim dark values:

```css
  --live: oklch(0.66 0.19 25);
  --shadow-hud: oklch(0.10 0.01 46 / 0.6);
```

- [ ] **Step 6: Add the pin-table rows to `CLAUDE.md`.**

In the `## Pinned versions` table, after the `jsdom | 30.0.1` row:

```
| zustand | 5.0.15 |
| fake-indexeddb | 6.2.5 |
```

Then change the sentence above the table from `on 2026-08-30.` to
`on 2026-08-30; zustand and fake-indexeddb on 2026-08-31.`

- [ ] **Step 7: Prove the build still compiles and the convention guard is green.**

```bash
npm run build
```

Expected: build succeeds.

```bash
npx vitest run components/note-detail/__tests__/project-conventions.test.ts
```

Expected: 3 passed.

- [ ] **Step 8: Commit.**

```bash
git add package.json package-lock.json app/globals.css CLAUDE.md
git commit -m "chore: pin zustand and fake-indexeddb, add live and shadow-hud tokens"
```

---

## Task 1: Elapsed-time formatting

The smallest real unit. Starts the TDD rhythm and removes a formatting concern
from the store and the component.

**Files:**
- Create: `lib/recorder/format-elapsed.ts`
- Test: `lib/recorder/__tests__/format-elapsed.test.ts`

**Interfaces:**
- Produces: `formatElapsed(ms: number): string`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { formatElapsed } from "@/lib/recorder/format-elapsed";

describe("formatElapsed", () => {
  it("renders zero as 0:00", () => {
    expect(formatElapsed(0)).toBe("0:00");
  });

  it("pads seconds but not the leading minute", () => {
    expect(formatElapsed(9_000)).toBe("0:09");
    expect(formatElapsed(61_000)).toBe("1:01");
  });

  it("matches the design's 12:41 shape", () => {
    expect(formatElapsed(12 * 60_000 + 41_000)).toBe("12:41");
  });

  it("grows an hours field past 60 minutes, zero-padding minutes", () => {
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
  });

  it("truncates rather than rounds, so the clock never shows a second early", () => {
    expect(formatElapsed(1_999)).toBe("0:01");
  });

  it("treats negative input as zero rather than rendering a minus sign", () => {
    expect(formatElapsed(-5_000)).toBe("0:00");
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
npx vitest run lib/recorder/__tests__/format-elapsed.test.ts
```

Expected: FAIL — cannot resolve `@/lib/recorder/format-elapsed`.

- [ ] **Step 3: Implement it.**

```ts
/** Elapsed recording time in the shape surface 02b renders: "12:41", and
 *  "1:02:03" once a recording passes an hour. Truncates rather than rounds —
 *  a clock that reaches 0:01 at 500 ms reads as broken. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  const ss = String(seconds).padStart(2, "0");
  if (hours === 0) return `${minutes}:${ss}`;
  return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
npx vitest run lib/recorder/__tests__/format-elapsed.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Commit.**

```bash
git add lib/recorder/format-elapsed.ts lib/recorder/__tests__/format-elapsed.test.ts
git commit -m "feat: elapsed-time formatting for the recorder HUD"
```

---

## Task 2: The Zustand recorder store

The state machine. This is the piece the whole track is really testing: a store
that lives at layout scope and does not reset on navigation.

**Files:**
- Create: `lib/recorder/recorder-store.ts`
- Test: `lib/recorder/__tests__/recorder-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `RecorderPhase`, `RecorderState`, `useRecorderStore` (see the
  Interfaces section — copy the shape exactly).

**Design rule for this task:** every illegal transition is a **no-op, never a
throw**. A stray `pause()` from a keyboard shortcut fired one tick late must not
crash the HUD that is mounted on every route in the app.

- [ ] **Step 1: Write the failing test.**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useRecorderStore } from "@/lib/recorder/recorder-store";

const state = () => useRecorderStore.getState();
const NOTE = "11111111-2222-3333-4444-555555555555";

/** Drive the store to a live recording, the starting point for most cases. */
function toRecording() {
  state().requestStart(NOTE);
  state().confirmStart("audio/webm;codecs=opus");
}

describe("recorder store", () => {
  beforeEach(() => {
    state().discard();
  });

  it("starts idle with nothing held", () => {
    expect(state().phase).toBe("idle");
    expect(state().noteId).toBeNull();
    expect(state().elapsedMs).toBe(0);
    expect(state().level).toBe(0);
    expect(state().mimeType).toBeNull();
    expect(state().errorMessage).toBeNull();
  });

  it("holds the note id from the moment permission is requested", () => {
    state().requestStart(NOTE);
    expect(state().phase).toBe("requesting");
    expect(state().noteId).toBe(NOTE);
  });

  it("records the negotiated mime type when capture confirms", () => {
    toRecording();
    expect(state().phase).toBe("recording");
    expect(state().mimeType).toBe("audio/webm;codecs=opus");
  });

  it("accrues elapsed time only while recording", () => {
    toRecording();
    state().tick(1000);
    expect(state().elapsedMs).toBe(1000);

    state().pause();
    state().tick(5000);
    expect(state().elapsedMs).toBe(1000);

    state().resume();
    state().tick(500);
    expect(state().elapsedMs).toBe(1500);
  });

  it("clamps the level to 0..1", () => {
    toRecording();
    state().setLevel(2.5);
    expect(state().level).toBe(1);
    state().setLevel(-3);
    expect(state().level).toBe(0);
  });

  it("walks stop -> upload -> finish back to a clean idle", () => {
    toRecording();
    state().tick(1000);
    state().beginStop();
    expect(state().phase).toBe("stopping");
    state().beginUpload();
    expect(state().phase).toBe("uploading");
    state().finish();
    expect(state().phase).toBe("idle");
    expect(state().noteId).toBeNull();
    expect(state().elapsedMs).toBe(0);
  });

  it("keeps the note id after a failure so a retry reuses the same object path", () => {
    toRecording();
    state().beginStop();
    state().beginUpload();
    state().fail("network died");
    expect(state().phase).toBe("error");
    expect(state().noteId).toBe(NOTE);
    expect(state().errorMessage).toBe("network died");
  });

  it("lets a failed upload be retried without a new note id", () => {
    toRecording();
    state().beginStop();
    state().beginUpload();
    state().fail("network died");
    state().beginUpload();
    expect(state().phase).toBe("uploading");
    expect(state().noteId).toBe(NOTE);
    expect(state().errorMessage).toBeNull();
  });

  it("discards everything from any phase", () => {
    toRecording();
    state().tick(9000);
    state().setLevel(0.8);
    state().discard();
    expect(state().phase).toBe("idle");
    expect(state().noteId).toBeNull();
    expect(state().elapsedMs).toBe(0);
    expect(state().level).toBe(0);
    expect(state().mimeType).toBeNull();
  });

  it("ignores illegal transitions instead of throwing", () => {
    expect(() => state().pause()).not.toThrow();
    expect(state().phase).toBe("idle");

    expect(() => state().confirmStart("audio/webm")).not.toThrow();
    expect(state().phase).toBe("idle");

    toRecording();
    expect(() => state().resume()).not.toThrow();
    expect(state().phase).toBe("recording");

    expect(() => state().finish()).not.toThrow();
    expect(state().phase).toBe("recording");
  });

  it("refuses a second start while a recording is live", () => {
    toRecording();
    state().requestStart("99999999-9999-9999-9999-999999999999");
    expect(state().phase).toBe("recording");
    expect(state().noteId).toBe(NOTE);
  });

  it("can start again from the error phase", () => {
    toRecording();
    state().fail("boom");
    state().requestStart("99999999-9999-9999-9999-999999999999");
    expect(state().phase).toBe("requesting");
    expect(state().noteId).toBe("99999999-9999-9999-9999-999999999999");
    expect(state().errorMessage).toBeNull();
  });

  it("is one module-level store, so importing it twice is the same state", async () => {
    toRecording();
    const again = await import("@/lib/recorder/recorder-store");
    expect(again.useRecorderStore.getState().phase).toBe("recording");
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
npx vitest run lib/recorder/__tests__/recorder-store.test.ts
```

Expected: FAIL — cannot resolve `@/lib/recorder/recorder-store`.

- [ ] **Step 3: Implement the store.**

```ts
import { create } from "zustand";

/**
 * Recorder state, held once at module scope.
 *
 * This is the first real consumer of Zustand in this codebase, and it is here
 * for one reason: DECISIONS.md scopes Zustand to "recorder HUD/dock state", and
 * the HUD is mounted in the root layout so it survives every navigation. A
 * `useState` in a route-level component would be torn down by the first link
 * click, which is exactly the "ambient, not calendar-gated" requirement failing.
 *
 * The store lives at MODULE scope, not inside a provider that a route could
 * re-mount. Importing this module twice yields the same state — there is a test
 * for that, because it is the property the whole track rests on.
 *
 * Every illegal transition is a no-op, never a throw. The HUD renders on every
 * route in the app; a stray event from a keyboard shortcut arriving one tick
 * late must not take the whole page down with it.
 */
export type RecorderPhase =
  | "idle"
  | "requesting"
  | "recording"
  | "paused"
  | "stopping"
  | "uploading"
  | "error";

export interface RecorderState {
  phase: RecorderPhase;
  /** Generated before capture starts, because it names the Storage object.
   *  Kept through `error` so a retry upserts the same path. */
  noteId: string | null;
  elapsedMs: number;
  /** Mic level, 0..1. System audio is deliberately excluded — the meter
   *  answers "is my microphone working", which is the question a user has. */
  level: number;
  mimeType: string | null;
  errorMessage: string | null;

  requestStart(noteId: string): void;
  confirmStart(mimeType: string): void;
  pause(): void;
  resume(): void;
  beginStop(): void;
  beginUpload(): void;
  finish(): void;
  fail(message: string): void;
  discard(): void;
  tick(deltaMs: number): void;
  setLevel(level: number): void;
}

const CLEAN = {
  phase: "idle",
  noteId: null,
  elapsedMs: 0,
  level: 0,
  mimeType: null,
  errorMessage: null,
} satisfies Omit<
  RecorderState,
  | "requestStart" | "confirmStart" | "pause" | "resume" | "beginStop"
  | "beginUpload" | "finish" | "fail" | "discard" | "tick" | "setLevel"
>;

export const useRecorderStore = create<RecorderState>((set) => ({
  ...CLEAN,

  requestStart: (noteId) =>
    set((s) =>
      s.phase === "idle" || s.phase === "error"
        ? { ...CLEAN, phase: "requesting", noteId }
        : s,
    ),

  confirmStart: (mimeType) =>
    set((s) => (s.phase === "requesting" ? { phase: "recording", mimeType } : s)),

  pause: () => set((s) => (s.phase === "recording" ? { phase: "paused" } : s)),

  resume: () => set((s) => (s.phase === "paused" ? { phase: "recording" } : s)),

  beginStop: () =>
    set((s) =>
      s.phase === "recording" || s.phase === "paused"
        ? { phase: "stopping", level: 0 }
        : s,
    ),

  // Reachable from `stopping` on the happy path, and from `error` on a retry —
  // which is the whole reason noteId survives a failure.
  beginUpload: () =>
    set((s) =>
      s.phase === "stopping" || s.phase === "error"
        ? { phase: "uploading", errorMessage: null }
        : s,
    ),

  finish: () => set((s) => (s.phase === "uploading" ? { ...CLEAN } : s)),

  fail: (message) => set({ phase: "error", errorMessage: message, level: 0 }),

  discard: () => set({ ...CLEAN }),

  tick: (deltaMs) =>
    set((s) => (s.phase === "recording" ? { elapsedMs: s.elapsedMs + deltaMs } : s)),

  setLevel: (level) => set({ level: Math.min(1, Math.max(0, level)) }),
}));
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
npx vitest run lib/recorder/__tests__/recorder-store.test.ts
```

Expected: 13 passed.

- [ ] **Step 5: Commit.**

```bash
git add lib/recorder/recorder-store.ts lib/recorder/__tests__/recorder-store.test.ts
git commit -m "feat: Zustand recorder store at module scope"
```

---

## Task 3: Codec feature detection

**Files:**
- Create: `lib/recorder/codec.ts`
- Test: `lib/recorder/__tests__/codec.test.ts`

**Interfaces:**
- Produces: `CODEC_CANDIDATES`, `pickMimeType(isSupported)`.

**Why `isSupported` is a parameter:** `MediaRecorder` does not exist in jsdom.
Injecting the predicate is what makes the ordering logic testable at all, and it
is also what lets Task 12 probe a real browser with the same list.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it, vi } from "vitest";
import { CODEC_CANDIDATES, pickMimeType } from "@/lib/recorder/codec";

const only = (...supported: string[]) => (type: string) => supported.includes(type);

describe("pickMimeType", () => {
  it("prefers Opus in WebM when Chromium offers it", () => {
    expect(pickMimeType(only("audio/webm;codecs=opus", "audio/webm"))).toBe(
      "audio/webm;codecs=opus",
    );
  });

  it("falls back to bare WebM when the codec-qualified string is refused", () => {
    expect(pickMimeType(only("audio/webm"))).toBe("audio/webm");
  });

  it("picks AAC in MP4 for Safari, which supports no WebM at all", () => {
    expect(pickMimeType(only("audio/mp4;codecs=mp4a.40.2", "audio/mp4"))).toBe(
      "audio/mp4;codecs=mp4a.40.2",
    );
  });

  it("falls back to bare MP4 when Safari refuses the codec-qualified string", () => {
    expect(pickMimeType(only("audio/mp4"))).toBe("audio/mp4");
  });

  it("returns null rather than guessing when nothing is supported", () => {
    expect(pickMimeType(() => false)).toBeNull();
  });

  it("asks about every candidate in order and stops at the first yes", () => {
    const isSupported = vi.fn((t: string) => t === "audio/webm");
    pickMimeType(isSupported);
    expect(isSupported.mock.calls.map(([t]) => t)).toEqual([
      "audio/webm;codecs=opus",
      "audio/webm",
    ]);
  });

  it("lists WebM before MP4 so Chromium never lands on the Safari string", () => {
    const webm = CODEC_CANDIDATES.findIndex((c) => c.startsWith("audio/webm"));
    const mp4 = CODEC_CANDIDATES.findIndex((c) => c.startsWith("audio/mp4"));
    expect(webm).toBeGreaterThanOrEqual(0);
    expect(mp4).toBeGreaterThan(webm);
  });

  it("never hardcodes a single string", () => {
    expect(CODEC_CANDIDATES.length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
npx vitest run lib/recorder/__tests__/codec.test.ts
```

Expected: FAIL — cannot resolve `@/lib/recorder/codec`.

- [ ] **Step 3: Implement it.**

```ts
/**
 * Container/codec negotiation for MediaRecorder.
 *
 * Ordered most- to least-preferred. Nothing here is hardcoded to one browser:
 * the caller passes `MediaRecorder.isTypeSupported`, and the first string it
 * accepts wins.
 *
 *   - Chromium supports the WebM/Opus pair. Opus is the right default: it is
 *     the best speech codec at low bitrate, which is what a meeting recording
 *     is made of.
 *   - Safari supports no WebM at all and answers only to audio/mp4 (AAC-LC,
 *     RFC 6381 code mp4a.40.2). WebM is listed first precisely so Chromium
 *     never reaches the MP4 entries.
 *   - The bare container strings are the fallbacks for browsers that refuse a
 *     codecs= parameter they otherwise honour.
 *
 * A null return is a real answer, not an error to swallow: the caller must
 * surface "this browser cannot record" rather than pick a string blind.
 */
export const CODEC_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

export function pickMimeType(isSupported: (type: string) => boolean): string | null {
  for (const candidate of CODEC_CANDIDATES) {
    if (isSupported(candidate)) return candidate;
  }
  return null;
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
npx vitest run lib/recorder/__tests__/codec.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Commit.**

```bash
git add lib/recorder/codec.ts lib/recorder/__tests__/codec.test.ts
git commit -m "feat: feature-detect the MediaRecorder container and codec"
```

---

## Task 4: The local backup buffer (IndexedDB)

ROADMAP §8b, light version: the recorded blob must survive navigation, and must
not be discarded until `processing_status` reaches `completed`.

**Files:**
- Create: `lib/recorder/audio-backup.ts`
- Test: `lib/recorder/__tests__/audio-backup.test.ts`
- Modify: `vitest.setup.ts`

**Interfaces:**
- Produces: `BackupRecord`, `saveBackup`, `loadBackup`, `listBackups`,
  `discardBackup` (see the Interfaces section).

**Why IndexedDB and not `localStorage` or a module variable:** a module-level
variable is torn down by a full page load, and `localStorage` cannot hold a
`Blob`. IndexedDB is the only browser store that survives navigation *and*
holds binary. This is a spec constraint, not a preference.

- [ ] **Step 1: Register `fake-indexeddb` in the test setup.**

`vitest.setup.ts` currently holds a single import. Replace its contents with:

```ts
import "@testing-library/jest-dom/vitest";
// jsdom ships no IndexedDB. The recorder's local backup buffer is required to
// survive navigation, so it cannot be faked with a module-level variable —
// which means the tests need a real IndexedDB implementation, not a stub.
import "fake-indexeddb/auto";
```

Check the existing file first and keep whatever import is already there:

```bash
cat vitest.setup.ts
```

- [ ] **Step 2: Write the failing test.**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  discardBackup,
  listBackups,
  loadBackup,
  saveBackup,
} from "@/lib/recorder/audio-backup";

const NOTE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OTHER = "11111111-2222-3333-4444-555555555555";

const record = (noteId: string, text = "audio bytes") => ({
  noteId,
  blob: new Blob([text], { type: "audio/webm" }),
  mimeType: "audio/webm;codecs=opus",
  durationSeconds: 42,
  savedAtMs: 1_700_000_000_000,
});

describe("audio backup buffer", () => {
  beforeEach(async () => {
    for (const existing of await listBackups()) {
      await discardBackup(existing.noteId);
    }
  });

  it("returns null for a note it has never seen", async () => {
    expect(await loadBackup(NOTE)).toBeNull();
  });

  it("stores a blob and reads back the same bytes", async () => {
    await saveBackup(record(NOTE));
    const found = await loadBackup(NOTE);
    expect(found).not.toBeNull();
    expect(await found!.blob.text()).toBe("audio bytes");
    expect(found!.mimeType).toBe("audio/webm;codecs=opus");
    expect(found!.durationSeconds).toBe(42);
  });

  it("survives a fresh module instance, which is what surviving navigation means", async () => {
    await saveBackup(record(NOTE));
    const reimported = await import("@/lib/recorder/audio-backup?fresh=1");
    const found = await reimported.loadBackup(NOTE);
    expect(await found!.blob.text()).toBe("audio bytes");
  });

  it("keys by note id, so two recordings do not collide", async () => {
    await saveBackup(record(NOTE, "first"));
    await saveBackup(record(OTHER, "second"));
    expect(await (await loadBackup(NOTE))!.blob.text()).toBe("first");
    expect(await (await loadBackup(OTHER))!.blob.text()).toBe("second");
    expect((await listBackups()).length).toBe(2);
  });

  it("replaces in place when the same note is saved twice", async () => {
    await saveBackup(record(NOTE, "first"));
    await saveBackup(record(NOTE, "retake"));
    expect((await listBackups()).length).toBe(1);
    expect(await (await loadBackup(NOTE))!.blob.text()).toBe("retake");
  });

  it("discards only the note it is asked about", async () => {
    await saveBackup(record(NOTE));
    await saveBackup(record(OTHER));
    await discardBackup(NOTE);
    expect(await loadBackup(NOTE)).toBeNull();
    expect(await loadBackup(OTHER)).not.toBeNull();
  });

  it("discarding something absent is not an error", async () => {
    await expect(discardBackup("no-such-note")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it and watch it fail.**

```bash
npx vitest run lib/recorder/__tests__/audio-backup.test.ts
```

Expected: FAIL — cannot resolve `@/lib/recorder/audio-backup`.

- [ ] **Step 4: Implement it.**

```ts
/**
 * The local backup buffer, light version (ROADMAP §8b).
 *
 * The recorded blob is written here the moment MediaRecorder stops, BEFORE the
 * upload is attempted, and is discarded only once the note's
 * processing_status reaches 'completed'. Track 3 does not exist yet, so in this
 * track the blob legitimately persists after a successful upload. That is the
 * rule working, not a leak.
 *
 * IndexedDB, deliberately. A module-level variable dies on a full page load and
 * localStorage cannot hold a Blob; IndexedDB is the only browser store that
 * both survives navigation and holds binary.
 *
 * This is NOT the full encrypted 48-hour buffer from the Core UX/UI phase.
 * Nothing here is encrypted and nothing expires on a timer.
 */
const DB_NAME = "recorder-backup";
const DB_VERSION = 1;
const STORE = "recordings";

export interface BackupRecord {
  noteId: string;
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
  savedAtMs: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "noteId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Runs one request inside its own transaction and closes the connection.
 *  A long-lived connection would block the upgrade path on the next version. */
async function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveBackup(record: BackupRecord): Promise<void> {
  await run("readwrite", (store) => store.put(record));
}

export async function loadBackup(noteId: string): Promise<BackupRecord | null> {
  const found = await run<BackupRecord | undefined>("readonly", (store) =>
    store.get(noteId),
  );
  return found ?? null;
}

export async function listBackups(): Promise<BackupRecord[]> {
  return run<BackupRecord[]>("readonly", (store) => store.getAll());
}

/** Deleting a key that is not there is a success in IndexedDB, and that is the
 *  behaviour we want: a double-discard must not blow up the caller. */
export async function discardBackup(noteId: string): Promise<void> {
  await run("readwrite", (store) => store.delete(noteId));
}
```

- [ ] **Step 5: Run it and watch it pass.**

```bash
npx vitest run lib/recorder/__tests__/audio-backup.test.ts
```

Expected: 7 passed. If the `?fresh=1` import specifier is rejected by the
resolver, replace that one test with `vi.resetModules()` followed by a plain
`await import("@/lib/recorder/audio-backup")` — the property under test is that
the *data* outlives the module, not the specifier syntax.

- [ ] **Step 6: Confirm the rest of the suite still passes with the new setup file.**

```bash
npm test
```

Expected: 64 prior tests plus this task's, all passing.

- [ ] **Step 7: Commit.**

```bash
git add lib/recorder/audio-backup.ts lib/recorder/__tests__/audio-backup.test.ts vitest.setup.ts
git commit -m "feat: IndexedDB backup buffer for the recorded blob"
```

---

## Task 5: Device-change watching

ROADMAP §8b calls device handoff "a common real scenario, not an edge case."
This task isolates the *detection* so it is testable without hardware; Task 6
owns the *repair*.

**Files:**
- Create: `lib/recorder/device-handoff.ts`
- Test: `lib/recorder/__tests__/device-handoff.test.ts`

**Interfaces:**
- Produces: `MediaDevicesLike`, `watchAudioInputs(options): () => void`.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it, vi } from "vitest";
import { watchAudioInputs, type MediaDevicesLike } from "@/lib/recorder/device-handoff";

/** A stand-in for navigator.mediaDevices with a hand-fired devicechange. */
function fakeMediaDevices(devices: { kind: string; deviceId: string }[]) {
  const listeners = new Set<() => void>();
  const api: MediaDevicesLike & {
    fire(): Promise<void>;
    set(next: { kind: string; deviceId: string }[]): void;
    listenerCount(): number;
  } = {
    addEventListener: (_t, l) => void listeners.add(l),
    removeEventListener: (_t, l) => void listeners.delete(l),
    enumerateDevices: async () => devices as never,
    set: (next) => {
      devices = next;
    },
    listenerCount: () => listeners.size,
    fire: async () => {
      for (const l of listeners) l();
      // let the listener's own await enumerateDevices() settle
      await Promise.resolve();
      await Promise.resolve();
    },
  };
  return api;
}

const MIC = { kind: "audioinput", deviceId: "mic-a" };
const OTHER_MIC = { kind: "audioinput", deviceId: "mic-b" };
const SPEAKER = { kind: "audiooutput", deviceId: "spk-a" };

describe("watchAudioInputs", () => {
  it("subscribes to devicechange", () => {
    const md = fakeMediaDevices([MIC]);
    watchAudioInputs({ mediaDevices: md, currentDeviceId: () => "mic-a", onDeviceLost: vi.fn() });
    expect(md.listenerCount()).toBe(1);
  });

  it("stays quiet when the current mic is still present", async () => {
    const md = fakeMediaDevices([MIC, OTHER_MIC]);
    const onDeviceLost = vi.fn();
    watchAudioInputs({ mediaDevices: md, currentDeviceId: () => "mic-a", onDeviceLost });
    await md.fire();
    expect(onDeviceLost).not.toHaveBeenCalled();
  });

  it("reports the loss when the current mic disappears", async () => {
    const md = fakeMediaDevices([MIC, OTHER_MIC]);
    const onDeviceLost = vi.fn();
    watchAudioInputs({ mediaDevices: md, currentDeviceId: () => "mic-a", onDeviceLost });
    md.set([OTHER_MIC]);
    await md.fire();
    expect(onDeviceLost).toHaveBeenCalledTimes(1);
  });

  it("ignores output devices — unplugging a speaker is not losing a mic", async () => {
    const md = fakeMediaDevices([MIC, SPEAKER]);
    const onDeviceLost = vi.fn();
    watchAudioInputs({ mediaDevices: md, currentDeviceId: () => "mic-a", onDeviceLost });
    md.set([MIC]);
    await md.fire();
    expect(onDeviceLost).not.toHaveBeenCalled();
  });

  it("stays quiet when the current device id is unknown, rather than firing on every change", async () => {
    const md = fakeMediaDevices([MIC]);
    const onDeviceLost = vi.fn();
    watchAudioInputs({ mediaDevices: md, currentDeviceId: () => undefined, onDeviceLost });
    md.set([]);
    await md.fire();
    expect(onDeviceLost).not.toHaveBeenCalled();
  });

  it("re-reads the current device id on every event, so a repaired mic is tracked", async () => {
    const md = fakeMediaDevices([MIC, OTHER_MIC]);
    const onDeviceLost = vi.fn();
    let current = "mic-a";
    watchAudioInputs({ mediaDevices: md, currentDeviceId: () => current, onDeviceLost });

    md.set([OTHER_MIC]);
    await md.fire();
    expect(onDeviceLost).toHaveBeenCalledTimes(1);

    current = "mic-b";
    await md.fire();
    expect(onDeviceLost).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes when the returned function is called", () => {
    const md = fakeMediaDevices([MIC]);
    const stop = watchAudioInputs({
      mediaDevices: md,
      currentDeviceId: () => "mic-a",
      onDeviceLost: vi.fn(),
    });
    stop();
    expect(md.listenerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
npx vitest run lib/recorder/__tests__/device-handoff.test.ts
```

Expected: FAIL — cannot resolve `@/lib/recorder/device-handoff`.

- [ ] **Step 3: Implement it.**

```ts
/**
 * Watches for the microphone being pulled out from under a live recording.
 *
 * Headphones going on or coming off mid-meeting is ordinary, not an edge case
 * (ROADMAP §8b). The browser does not tell you WHICH device went away — it
 * fires a bare `devicechange` — so the check is: enumerate again, and see
 * whether the id we are recording from is still in the list.
 *
 * Detection only. The repair (re-acquire and splice into the running Web Audio
 * graph) belongs to capture.ts, because that is where the graph lives.
 *
 * `mediaDevices` is a parameter so this is testable without hardware, and
 * `currentDeviceId` is a getter rather than a value so a mic replaced during
 * the recording is tracked from then on instead of the watcher firing forever
 * against a stale id.
 */
export interface MediaDevicesLike {
  addEventListener(type: "devicechange", listener: () => void): void;
  removeEventListener(type: "devicechange", listener: () => void): void;
  enumerateDevices(): Promise<Pick<MediaDeviceInfo, "kind" | "deviceId">[]>;
}

export function watchAudioInputs(options: {
  mediaDevices: MediaDevicesLike;
  currentDeviceId: () => string | undefined;
  onDeviceLost: () => void;
}): () => void {
  const { mediaDevices, currentDeviceId, onDeviceLost } = options;

  const listener = () => {
    void (async () => {
      const wanted = currentDeviceId();
      // No id means we never learned which mic this is. Firing here would
      // restart the capture on every unrelated device change, which is worse
      // than doing nothing.
      if (!wanted) return;

      const devices = await mediaDevices.enumerateDevices();
      const stillThere = devices.some(
        (d) => d.kind === "audioinput" && d.deviceId === wanted,
      );
      if (!stillThere) onDeviceLost();
    })();
  };

  mediaDevices.addEventListener("devicechange", listener);
  return () => mediaDevices.removeEventListener("devicechange", listener);
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
npx vitest run lib/recorder/__tests__/device-handoff.test.ts
```

Expected: 7 passed.

- [ ] **Step 5: Commit.**

```bash
git add lib/recorder/device-handoff.ts lib/recorder/__tests__/device-handoff.test.ts
git commit -m "feat: detect a microphone lost mid-recording"
```

---

## Task 6: Capture — system + mic mixed into one stream

**Files:**
- Create: `lib/recorder/capture.ts`
- Test: `lib/recorder/__tests__/capture.test.ts`

**Interfaces:**
- Consumes: `watchAudioInputs` from Task 5.
- Produces: `CaptureDeps`, `CaptureHandles`, `startCapture(deps?)`.

**The two non-obvious rules this task exists to encode:**

1. **`getDisplayMedia` must ask for `video: true`.** Chromium will not offer
   tab or system audio for an audio-only display request. The video track is
   stopped immediately after acquisition — it is a permission-dialog tax, not
   something we record.
2. **`MediaRecorder` is given the destination node's stream, never the mic
   stream.** That indirection is the entire reason `replaceMic()` can work: the
   mic source node is disconnected and a new one wired to the same gain node,
   and the recorder's stream never changes, so the recording does not drop.

- [ ] **Step 1: Write the failing test.**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { startCapture } from "@/lib/recorder/capture";

/** Minimal fakes. jsdom has neither getDisplayMedia nor Web Audio. */
function fakeTrack(kind: string, deviceId?: string) {
  return {
    kind,
    stop: vi.fn(),
    getSettings: () => ({ deviceId }),
  };
}
function fakeStream(tracks: ReturnType<typeof fakeTrack>[]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
  } as unknown as MediaStream;
}
function fakeNode() {
  return { connect: vi.fn(), disconnect: vi.fn() };
}
function fakeContext() {
  const destination = { stream: fakeStream([fakeTrack("audio", "mixed")]) };
  return {
    destination,
    close: vi.fn(async () => {}),
    createMediaStreamDestination: vi.fn(() => destination),
    createMediaStreamSource: vi.fn(() => fakeNode()),
    createGain: vi.fn(() => ({ ...fakeNode(), gain: { value: 1 } })),
    createAnalyser: vi.fn(() => ({ ...fakeNode(), fftSize: 0 })),
  };
}

function deps(overrides: Record<string, unknown> = {}) {
  const micTrack = fakeTrack("audio", "mic-a");
  const sysAudio = fakeTrack("audio", "tab-a");
  const sysVideo = fakeTrack("video");
  const ctx = fakeContext();
  return {
    micTrack,
    sysVideo,
    ctx,
    value: {
      getUserMedia: vi.fn(async () => fakeStream([micTrack])),
      getDisplayMedia: vi.fn(async () => fakeStream([sysAudio, sysVideo])),
      createAudioContext: () => ctx as unknown as AudioContext,
      ...overrides,
    },
  };
}

describe("startCapture", () => {
  it("asks for the mic with echoCancellation and nothing else", async () => {
    const d = deps();
    await startCapture(d.value);
    expect(d.value.getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true },
    });
  });

  it("asks getDisplayMedia for video, because Chromium withholds tab audio otherwise", async () => {
    const d = deps();
    await startCapture(d.value);
    const [constraints] = d.value.getDisplayMedia.mock.calls[0];
    expect(constraints.audio).toBe(true);
    expect(constraints.video).toBe(true);
  });

  it("stops the display video track immediately — we record audio only", async () => {
    const d = deps();
    await startCapture(d.value);
    expect(d.sysVideo.stop).toHaveBeenCalled();
  });

  it("hands back the mixed destination stream, not the mic stream", async () => {
    const d = deps();
    const handles = await startCapture(d.value);
    expect(handles.stream).toBe(d.ctx.destination.stream);
  });

  it("wires both sources into the graph", async () => {
    const d = deps();
    await startCapture(d.value);
    expect(d.ctx.createMediaStreamSource).toHaveBeenCalledTimes(2);
  });

  it("exposes the mic device id for the device watcher", async () => {
    const d = deps();
    const handles = await startCapture(d.value);
    expect(handles.micDeviceId()).toBe("mic-a");
  });

  it("replaceMic swaps the source without changing the recorder's stream", async () => {
    const d = deps();
    const handles = await startCapture(d.value);
    const before = handles.stream;

    const newMic = fakeTrack("audio", "mic-b");
    d.value.getUserMedia.mockResolvedValueOnce(fakeStream([newMic]));
    await handles.replaceMic();

    expect(d.micTrack.stop).toHaveBeenCalled();
    expect(handles.micDeviceId()).toBe("mic-b");
    expect(handles.stream).toBe(before);
    expect(d.ctx.createMediaStreamSource).toHaveBeenCalledTimes(3);
  });

  it("stop() stops every track and closes the context", async () => {
    const d = deps();
    const handles = await startCapture(d.value);
    handles.stop();
    expect(d.micTrack.stop).toHaveBeenCalled();
    expect(d.ctx.close).toHaveBeenCalled();
  });

  it("releases the display stream when the mic prompt is refused", async () => {
    const d = deps({
      getUserMedia: vi.fn(async () => {
        throw new Error("NotAllowedError");
      }),
    });
    await expect(startCapture(d.value)).rejects.toThrow();
    expect(d.sysVideo.stop).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
npx vitest run lib/recorder/__tests__/capture.test.ts
```

Expected: FAIL — cannot resolve `@/lib/recorder/capture`.

- [ ] **Step 3: Implement it.**

```ts
/**
 * System audio + microphone, mixed into one stream for one MediaRecorder.
 *
 * Two rules are encoded here that are not obvious from the API surface:
 *
 * 1. getDisplayMedia is asked for `video: true` even though this feature
 *    records no video. Chromium does not offer tab or system audio for an
 *    audio-only display request — the audio checkbox simply is not shown. The
 *    video track is stopped the moment it arrives. It is a permission-dialog
 *    tax, not something we keep.
 *
 * 2. MediaRecorder is handed the destination node's stream, never the mic
 *    stream. Everything downstream depends on that indirection: replaceMic()
 *    can disconnect the old mic source and wire a new one to the same gain
 *    node, and the recorder's stream object never changes, so a mic swapped
 *    mid-meeting does not end the recording.
 *
 * The mic constraint is exactly { echoCancellation: true }. No noiseSuppression
 * and no autoGainControl — ROADMAP §7 rejected extra masking, and adding
 * constraints "while we are here" is how a locked decision quietly rots.
 */
export interface CaptureDeps {
  getDisplayMedia(constraints: DisplayMediaStreamOptions): Promise<MediaStream>;
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createAudioContext(): AudioContext;
}

export interface CaptureHandles {
  /** The MIXED stream. This is what MediaRecorder records. */
  stream: MediaStream;
  analyser: AnalyserNode;
  micDeviceId(): string | undefined;
  replaceMic(): Promise<void>;
  stop(): void;
}

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true },
};

function browserDeps(): CaptureDeps {
  return {
    getDisplayMedia: (c) => navigator.mediaDevices.getDisplayMedia(c),
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    createAudioContext: () => new AudioContext(),
  };
}

function stopAll(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

export async function startCapture(
  overrides: Partial<CaptureDeps> = {},
): Promise<CaptureHandles> {
  const deps = { ...browserDeps(), ...overrides };

  // System audio first: its picker is the one the user is most likely to
  // cancel, and failing before the mic prompt means one fewer dialog to
  // dismiss on the way out.
  const systemStream = await deps.getDisplayMedia({ audio: true, video: true });
  for (const track of systemStream.getVideoTracks()) track.stop();

  let micStream: MediaStream;
  try {
    micStream = await deps.getUserMedia(MIC_CONSTRAINTS);
  } catch (error) {
    // Do not leave the screen-share indicator running because the second
    // prompt was refused.
    stopAll(systemStream);
    throw error;
  }

  const context = deps.createAudioContext();
  const destination = context.createMediaStreamDestination();

  const micGain = context.createGain();
  micGain.connect(destination);

  const systemGain = context.createGain();
  systemGain.connect(destination);
  context.createMediaStreamSource(systemStream).connect(systemGain);

  // The meter answers "is my microphone working", so it hangs off the mic
  // branch rather than the mix — system audio alone must not make it look live.
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  micGain.connect(analyser);

  let micSource = context.createMediaStreamSource(micStream);
  micSource.connect(micGain);

  const currentMicId = () => micStream.getAudioTracks()[0]?.getSettings().deviceId;

  return {
    stream: destination.stream,
    analyser,
    micDeviceId: currentMicId,

    async replaceMic() {
      const next = await deps.getUserMedia(MIC_CONSTRAINTS);
      micSource.disconnect();
      stopAll(micStream);
      micStream = next;
      micSource = context.createMediaStreamSource(micStream);
      micSource.connect(micGain);
    },

    stop() {
      stopAll(micStream);
      stopAll(systemStream);
      void context.close();
    },
  };
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
npx vitest run lib/recorder/__tests__/capture.test.ts
```

Expected: 9 passed.

- [ ] **Step 5: Commit.**

```bash
git add lib/recorder/capture.ts lib/recorder/__tests__/capture.test.ts
git commit -m "feat: mix system audio and mic into one recordable stream"
```

---

## Task 7: Direct-to-Storage upload

**Files:**
- Create: `lib/recorder/upload-audio.ts`
- Test: `lib/recorder/__tests__/upload-audio.test.ts`

**Interfaces:**
- Produces: `AUDIO_BUCKET`, `recordingPath`, `StorageBucketLike`,
  `uploadRecording(args)`.

**The two rules under test:**

1. The path is exactly `${userId}/${noteId}` — two segments, that order, no
   prefix, no extension. Anything else is refused by
   `audio_recordings_insert_own` as a permission error that reads like a
   generic failure.
2. Size verification comes from `list()` metadata. **A `download()` here would
   be CDN-cached and could report the pre-overwrite body** — reproduced during
   Track 1 and recorded in KNOWN_GAPS.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  AUDIO_BUCKET,
  recordingPath,
  uploadRecording,
} from "@/lib/recorder/upload-audio";

const USER = "8f1c2a3b-0000-4444-8888-aaaaaaaaaaaa";
const NOTE = "11111111-2222-3333-4444-555555555555";

function bucket(over: Partial<Record<string, unknown>> = {}) {
  return {
    upload: vi.fn(async () => ({ data: { path: `${USER}/${NOTE}` }, error: null })),
    list: vi.fn(async () => ({
      data: [{ name: NOTE, metadata: { size: 1234 } }],
      error: null,
    })),
    ...over,
  };
}

describe("recordingPath", () => {
  it("is exactly {user_id}/{note_id} — the shape the RLS policy checks", () => {
    expect(recordingPath(USER, NOTE)).toBe(`${USER}/${NOTE}`);
  });

  it("puts the user id in the first folder segment", () => {
    expect(recordingPath(USER, NOTE).split("/")[0]).toBe(USER);
  });

  it("adds no extension, so the object name is the bare note id", () => {
    expect(recordingPath(USER, NOTE).split("/")[1]).toBe(NOTE);
  });

  it("names the bucket the Track 1 policies were written for", () => {
    expect(AUDIO_BUCKET).toBe("audio-recordings");
  });
});

describe("uploadRecording", () => {
  const blob = new Blob(["x".repeat(1234)], { type: "audio/webm" });

  it("uploads to the owner-scoped path with upsert on", async () => {
    const b = bucket();
    await uploadRecording({
      bucket: b as never,
      userId: USER,
      noteId: NOTE,
      blob,
      contentType: "audio/webm;codecs=opus",
    });
    expect(b.upload).toHaveBeenCalledWith(`${USER}/${NOTE}`, blob, {
      contentType: "audio/webm;codecs=opus",
      upsert: true,
    });
  });

  it("reports the size from list() metadata", async () => {
    const result = await uploadRecording({
      bucket: bucket() as never,
      userId: USER,
      noteId: NOTE,
      blob,
      contentType: "audio/webm",
    });
    expect(result).toEqual({ path: `${USER}/${NOTE}`, sizeBytes: 1234 });
  });

  it("never calls download — a read straight after an upsert is CDN-stale", async () => {
    const download = vi.fn();
    await uploadRecording({
      bucket: bucket({ download }) as never,
      userId: USER,
      noteId: NOTE,
      blob,
      contentType: "audio/webm",
    });
    expect(download).not.toHaveBeenCalled();
  });

  it("throws with the Storage message when the upload is refused", async () => {
    const b = bucket({
      upload: vi.fn(async () => ({ data: null, error: { message: "new row violates row-level security policy" } })),
    });
    await expect(
      uploadRecording({
        bucket: b as never,
        userId: USER,
        noteId: NOTE,
        blob,
        contentType: "audio/webm",
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it("throws when the object cannot be found in the listing afterwards", async () => {
    const b = bucket({ list: vi.fn(async () => ({ data: [], error: null })) });
    await expect(
      uploadRecording({
        bucket: b as never,
        userId: USER,
        noteId: NOTE,
        blob,
        contentType: "audio/webm",
      }),
    ).rejects.toThrow(/not visible/i);
  });

  it("lists inside the user's own prefix, never the bucket root", async () => {
    const b = bucket();
    await uploadRecording({
      bucket: b as never,
      userId: USER,
      noteId: NOTE,
      blob,
      contentType: "audio/webm",
    });
    expect(b.list).toHaveBeenCalledWith(USER, { search: NOTE });
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
npx vitest run lib/recorder/__tests__/upload-audio.test.ts
```

Expected: FAIL — cannot resolve `@/lib/recorder/upload-audio`.

- [ ] **Step 3: Implement it.**

```ts
/**
 * Direct client-to-Storage upload. No signed URL, no server relay — the
 * decided architecture, and the three policies in
 * supabase/schemas/storage_audio.sql are what make it safe.
 *
 * The path is not a naming convention. All three policies check
 *
 *   (storage.foldername(name))[1] = (select auth.uid())::text
 *
 * so the first path segment IS the authorization check. A prefix, a reordered
 * pair, or a different id is refused by RLS as a permission error that reads
 * like a generic failure. Two segments, that order, no extension.
 *
 * upsert is on because a retried upload after an interrupted recording is a
 * normal recorder scenario, and Track 1 shipped the UPDATE policy for exactly
 * that case (INSERT alone makes replacement fail silently).
 *
 * Success and size are read from the upload response and from list(), never
 * from download(). Storage serves object reads through a caching CDN, and a
 * download() issued straight after an upsert returns the PRE-overwrite body —
 * observed on this project during Track 1 (docs/KNOWN_GAPS.md).
 */
export const AUDIO_BUCKET = "audio-recordings";

export interface StorageBucketLike {
  upload(
    path: string,
    body: Blob,
    options: { contentType: string; upsert: boolean },
  ): Promise<{ data: { path: string } | null; error: { message: string } | null }>;
  list(
    prefix: string,
    options?: { search?: string },
  ): Promise<{
    data: { name: string; metadata?: { size?: number } }[] | null;
    error: { message: string } | null;
  }>;
}

export function recordingPath(userId: string, noteId: string): string {
  return `${userId}/${noteId}`;
}

export async function uploadRecording(args: {
  bucket: StorageBucketLike;
  userId: string;
  noteId: string;
  blob: Blob;
  contentType: string;
}): Promise<{ path: string; sizeBytes: number }> {
  const { bucket, userId, noteId, blob, contentType } = args;
  const path = recordingPath(userId, noteId);

  const { error } = await bucket.upload(path, blob, { contentType, upsert: true });
  if (error) throw new Error(`Audio upload failed: ${error.message}`);

  // list() reads storage.objects itself and runs under the SELECT policy, so
  // a row coming back is proof the object landed under this user's prefix.
  const listing = await bucket.list(userId, { search: noteId });
  if (listing.error) {
    throw new Error(`Audio upload could not be confirmed: ${listing.error.message}`);
  }

  const row = listing.data?.find((object) => object.name === noteId);
  if (!row) {
    throw new Error(`Audio upload finished but the object is not visible at ${path}`);
  }

  return { path, sizeBytes: row.metadata?.size ?? 0 };
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
npx vitest run lib/recorder/__tests__/upload-audio.test.ts
```

Expected: 10 passed.

- [ ] **Step 5: Commit.**

```bash
git add lib/recorder/upload-audio.ts lib/recorder/__tests__/upload-audio.test.ts
git commit -m "feat: direct-to-Storage upload at the owner-scoped path"
```

---

## Task 8: The note-creation server action

**Files:**
- Create: `app/notes/actions.ts`
- Test: `app/notes/__tests__/actions.test.ts`
- Modify: `vitest.config.mts` (only if `app/**/__tests__` is not already matched
  — check first; the current `include` is `["**/__tests__/**/*.test.{ts,tsx}"]`,
  which already covers it, so **expect no change**)

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`.
- Produces: `createRecordedNote(input): Promise<{ id: string }>`.

**Decisions locked into this task:**

- **`processing_status` is set to `'uploading'`, and the row is created when the
  upload STARTS, not after it succeeds.** The scope fence puts
  "`processing_status` ever reaching `analyzing`/`completed`" in Track 3, so this
  track must not write `'analyzing'` at all — not even as a handoff value.
  `'uploading'` is literally true at the moment the row is written, and it stays
  true until Track 3 moves it.
  This is possible because the Storage path is deterministic: the note id is
  generated on the client before capture, so `{user_id}/{note_id}` is known
  before the first byte moves and `audio_storage_path` can be written up front.
  **The consequence is deliberate:** a failed upload leaves a row sitting at
  `'uploading'` with its audio still in IndexedDB. That is a visible, recoverable
  state — the note shows up in `/`, the blob is on disk, and a retry upserts both
  the same row and the same object. An invisible failure would be worse.
  **Nothing in this track ever moves the value off `'uploading'`.**
- **`user_id` comes from `auth.getUser()`, and the action throws without a
  user.** Next 16's own docs warn Server Functions are reachable by direct POST.
  This supplies the insert value that `notes_insert_own`'s `with check` then
  validates. It is not a `user_id` filter.
- **`upsert` on the primary key**, so a retried action after a network blip
  does not fail on a duplicate id.

- [ ] **Step 1: Write the failing test.**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const getUser = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({ upsert }),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

const USER = "8f1c2a3b-0000-4444-8888-aaaaaaaaaaaa";
const NOTE = "11111111-2222-3333-4444-555555555555";

const input = {
  noteId: NOTE,
  audioStoragePath: `${USER}/${NOTE}`,
  durationSeconds: 754,
};

async function subject() {
  return (await import("@/app/notes/actions")).createRecordedNote;
}

describe("createRecordedNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
    upsert.mockResolvedValue({ error: null });
  });

  it("refuses to write anything when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect((await subject())(input)).rejects.toThrow(/not signed in/i);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("writes the row with the id the object was uploaded under", async () => {
    await (await subject())(input);
    const [row] = upsert.mock.calls[0];
    expect(row.id).toBe(NOTE);
    expect(row.audio_storage_path).toBe(`${USER}/${NOTE}`);
  });

  it("sets user_id from the verified session, not from the caller's input", async () => {
    await (await subject())({ ...input, userId: "someone-else" } as never);
    expect(upsert.mock.calls[0][0].user_id).toBe(USER);
  });

  it("records the duration as whole seconds, matching the integer column", async () => {
    await (await subject())({ ...input, durationSeconds: 754.87 });
    expect(upsert.mock.calls[0][0].audio_duration_seconds).toBe(754);
  });

  it("lands on uploading — the row is written as the upload starts", async () => {
    await (await subject())(input);
    expect(upsert.mock.calls[0][0].processing_status).toBe("uploading");
  });

  it("never writes analyzing or completed — those belong to Track 3", async () => {
    await (await subject())(input);
    expect(["analyzing", "completed"]).not.toContain(
      upsert.mock.calls[0][0].processing_status,
    );
  });

  it("upserts on the primary key so a retried action is not a duplicate error", async () => {
    await (await subject())(input);
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: "id" });
  });

  it("revalidates the root route so the new note shows in the list", async () => {
    await (await subject())(input);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("returns the note id", async () => {
    expect(await (await subject())(input)).toEqual({ id: NOTE });
  });

  it("surfaces a database error rather than reporting success", async () => {
    upsert.mockResolvedValue({ error: { message: "violates row-level security policy" } });
    await expect((await subject())(input)).rejects.toThrow(/row-level security/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
npx vitest run app/notes/__tests__/actions.test.ts
```

Expected: FAIL — cannot resolve `@/app/notes/actions`.

- [ ] **Step 3: Implement it.**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Creates the notes row for a recording, called as the upload STARTS.
 *
 * processing_status is 'uploading', and this track never writes anything else.
 * 'analyzing' and 'completed' belong to Track 3's transcription pipeline and are
 * explicitly outside this track's scope — writing 'analyzing' here would claim a
 * pass that nothing performs.
 *
 * Writing the row before the bytes land is possible because the Storage path is
 * deterministic: the note id is generated on the client before capture begins,
 * so {user_id}/{note_id} is known up front and audio_storage_path can be filled
 * in immediately.
 *
 * A failed upload therefore leaves a row at 'uploading' whose object is missing.
 * That is the intended outcome, not a leak: the note is visible in the list, the
 * audio is still in IndexedDB, and a retry upserts the same row and the same
 * object. The same id also makes this action safely retryable — it upserts
 * rather than failing on a duplicate key.
 *
 * Auth is checked here, not assumed. Next.js's own docs are explicit that
 * Server Functions are reachable by direct POST, not just through the UI. The
 * user id is read from the verified session and never taken from the argument;
 * RLS's `with check` on notes_insert_own then validates the value we supply.
 * That is supplying an owner, not filtering by one.
 */
export async function createRecordedNote(input: {
  noteId: string;
  audioStoragePath: string;
  durationSeconds: number;
}): Promise<{ id: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Cannot create a note: not signed in.");

  const { error } = await supabase.from("notes").upsert(
    {
      id: input.noteId,
      user_id: user.id,
      audio_storage_path: input.audioStoragePath,
      // The column is integer; a fractional duration would be silently
      // truncated by Postgres, so truncate deliberately and visibly.
      audio_duration_seconds: Math.floor(input.durationSeconds),
      processing_status: "uploading",
    },
    { onConflict: "id" },
  );

  if (error) throw new Error(`Failed to create note: ${error.message}`);

  revalidatePath("/");
  return { id: input.noteId };
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
npx vitest run app/notes/__tests__/actions.test.ts
```

Expected: 10 passed.

- [ ] **Step 5: Commit.**

```bash
git add app/notes/actions.ts app/notes/__tests__/actions.test.ts
git commit -m "feat: server action creating the notes row at upload start"
```

---

## Task 9: The orchestration hook

The glue. Everything hard already has its own tested module; this hook wires
them and owns the timers.

**Files:**
- Create: `lib/recorder/use-recorder.ts`
- Test: `lib/recorder/__tests__/use-recorder.test.tsx`

**Interfaces:**
- Consumes: `useRecorderStore`, `startCapture`, `pickMimeType`,
  `watchAudioInputs`, `saveBackup`/`discardBackup`, `recordingPath`,
  `uploadRecording`, `createRecordedNote`.
- Produces: `RecorderDeps`, `RecorderControls`, `useRecorder(deps?)`.

**Order of operations on stop — this order is the spec:**
1. `MediaRecorder.stop()`, wait for the final `dataavailable` and `stop`.
2. Assemble the Blob.
3. **`saveBackup()` first** — before the network is touched, so a failed upload
   still leaves the audio recoverable.
4. `store.beginUpload()`.
5. `getUserId()`, then build the path with `recordingPath(userId, noteId)`. The
   path is deterministic, which is what makes step 6 possible.
6. **`createRecordedNote()` — the row is written BEFORE the bytes move**, at
   `processing_status = 'uploading'`, which is true at that instant and stays
   true until Track 3 moves it.
7. `uploadRecording()`.
8. `store.finish()`. **The backup is NOT discarded** — that waits for
   `processing_status === 'completed'`, which Track 3 owns.

**What a failed upload leaves behind, deliberately:** a note row at
`'uploading'` with no object, and the blob still in IndexedDB. The note is
visible in `/`, the audio is recoverable, and a retry upserts the same row and
the same object path. This is the reason the note id is generated before capture
rather than after.

- [ ] **Step 1: Write the failing test.**

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRecorder } from "@/lib/recorder/use-recorder";
import { useRecorderStore } from "@/lib/recorder/recorder-store";
import { listBackups, discardBackup } from "@/lib/recorder/audio-backup";

const USER = "8f1c2a3b-0000-4444-8888-aaaaaaaaaaaa";
const NOTE = "11111111-2222-3333-4444-555555555555";

/** A MediaRecorder stand-in with hand-fired events. */
function fakeMediaRecorder() {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  return {
    state: "inactive",
    start: vi.fn(function (this: never) {}),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      (listeners[type] ??= []).push(fn);
    },
    emit(type: string, event: unknown) {
      for (const fn of listeners[type] ?? []) fn(event);
    },
  };
}

function makeDeps() {
  const recorder = fakeMediaRecorder();
  const captureHandles = {
    stream: {} as MediaStream,
    analyser: { fftSize: 0, frequencyBinCount: 4, getByteTimeDomainData: vi.fn() },
    micDeviceId: () => "mic-a",
    replaceMic: vi.fn(async () => {}),
    stop: vi.fn(),
  };
  const createNote = vi.fn(async () => ({ id: NOTE }));
  const bucketApi = {
    upload: vi.fn(async () => ({ data: { path: `${USER}/${NOTE}` }, error: null })),
    list: vi.fn(async () => ({ data: [{ name: NOTE, metadata: { size: 9 } }], error: null })),
  };
  return {
    recorder,
    captureHandles,
    createNote,
    bucketApi,
    deps: {
      capture: vi.fn(async () => captureHandles as never),
      createRecorder: () => recorder as never,
      isTypeSupported: (t: string) => t === "audio/webm;codecs=opus",
      newNoteId: () => NOTE,
      now: (() => { let t = 0; return () => (t += 1000); })(),
      getUserId: async () => USER,
      bucket: () => bucketApi as never,
      createNote,
    },
  };
}

/** Drive a full recording to the point where the blob exists. */
async function recordAndStop(result: { current: ReturnType<typeof useRecorder> }, d: ReturnType<typeof makeDeps>) {
  await act(async () => { await result.current.start(); });
  await act(async () => {
    d.recorder.emit("dataavailable", { data: new Blob(["audio"], { type: "audio/webm" }) });
  });
  await act(async () => {
    const done = result.current.stop();
    d.recorder.emit("stop", {});
    await done;
  });
}

describe("useRecorder", () => {
  beforeEach(async () => {
    useRecorderStore.getState().discard();
    for (const b of await listBackups()) await discardBackup(b.noteId);
    vi.clearAllMocks();
  });

  it("moves the store to recording and records the negotiated mime type", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await act(async () => { await result.current.start(); });
    expect(useRecorderStore.getState().phase).toBe("recording");
    expect(useRecorderStore.getState().mimeType).toBe("audio/webm;codecs=opus");
    expect(d.recorder.start).toHaveBeenCalled();
  });

  it("fails cleanly when the browser supports no candidate container", async () => {
    const d = makeDeps();
    const { result } = renderHook(() =>
      useRecorder({ ...d.deps, isTypeSupported: () => false } as never),
    );
    await act(async () => { await result.current.start(); });
    expect(useRecorderStore.getState().phase).toBe("error");
    expect(d.deps.capture).not.toHaveBeenCalled();
  });

  it("fails cleanly when a permission prompt is refused", async () => {
    const d = makeDeps();
    const { result } = renderHook(() =>
      useRecorder({ ...d.deps, capture: async () => { throw new Error("NotAllowedError"); } } as never),
    );
    await act(async () => { await result.current.start(); });
    expect(useRecorderStore.getState().phase).toBe("error");
    expect(useRecorderStore.getState().errorMessage).toMatch(/NotAllowed/);
  });

  it("pauses and resumes both the recorder and the store", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await act(async () => { await result.current.start(); });
    act(() => result.current.pause());
    expect(useRecorderStore.getState().phase).toBe("paused");
    expect(d.recorder.pause).toHaveBeenCalled();
    act(() => result.current.resume());
    expect(useRecorderStore.getState().phase).toBe("recording");
    expect(d.recorder.resume).toHaveBeenCalled();
  });

  it("saves the blob to IndexedDB BEFORE it touches the network", async () => {
    const d = makeDeps();
    const order: string[] = [];
    d.bucketApi.upload.mockImplementation(async () => {
      order.push("upload");
      return { data: { path: `${USER}/${NOTE}` }, error: null };
    });
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    const backups = await listBackups();
    expect(backups.map((b) => b.noteId)).toContain(NOTE);
    expect(order).toEqual(["upload"]);
  });

  it("creates the note row BEFORE it uploads, and uploads to {user_id}/{note_id}", async () => {
    const d = makeDeps();
    const order: string[] = [];
    d.createNote.mockImplementation(async () => {
      order.push("createNote");
      return { id: NOTE };
    });
    d.bucketApi.upload.mockImplementation(async () => {
      order.push("upload");
      return { data: { path: `${USER}/${NOTE}` }, error: null };
    });

    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(order).toEqual(["createNote", "upload"]));

    expect(d.bucketApi.upload.mock.calls[0][0]).toBe(`${USER}/${NOTE}`);
    expect(d.createNote.mock.calls[0][0]).toMatchObject({
      noteId: NOTE,
      audioStoragePath: `${USER}/${NOTE}`,
    });
  });

  it("returns to idle once the upload lands", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(useRecorderStore.getState().phase).toBe("idle"));
  });

  it("writes the row at 'uploading' and never at 'analyzing'", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(d.createNote).toHaveBeenCalled());
    // The status itself is the action's business (Task 8 asserts it); what this
    // hook must not do is pass one in and quietly override the action.
    expect(d.createNote.mock.calls[0][0]).not.toHaveProperty("processingStatus");
  });

  it("KEEPS the backup after a successful upload — only 'completed' discards it", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(useRecorderStore.getState().phase).toBe("idle"));
    expect((await listBackups()).map((b) => b.noteId)).toContain(NOTE);
  });

  it("keeps the blob and the note id when the upload fails, so a retry reuses the path", async () => {
    const d = makeDeps();
    d.bucketApi.upload.mockResolvedValue({ data: null, error: { message: "offline" } });
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(useRecorderStore.getState().phase).toBe("error"));
    expect(useRecorderStore.getState().noteId).toBe(NOTE);
    expect((await listBackups()).map((b) => b.noteId)).toContain(NOTE);
    // The row WAS written — it is created as the upload starts, so a failed
    // upload leaves a visible note at 'uploading' with its audio recoverable.
    // That is the point of writing it first.
    expect(d.createNote).toHaveBeenCalledTimes(1);
  });

  it("does not upload at all when the note row cannot be written", async () => {
    const d = makeDeps();
    d.createNote.mockRejectedValue(new Error("row-level security"));
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(useRecorderStore.getState().phase).toBe("error"));
    expect(d.bucketApi.upload).not.toHaveBeenCalled();
    expect((await listBackups()).map((b) => b.noteId)).toContain(NOTE);
  });

  it("re-acquires the mic when the device watcher reports it lost", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await act(async () => { await result.current.start(); });
    await act(async () => {
      navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(d.captureHandles.replaceMic).toHaveBeenCalled());
    expect(useRecorderStore.getState().phase).toBe("recording");
  });

  it("discard() stops capture, clears the store and drops the blob", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.discard(); });
    expect(d.captureHandles.stop).toHaveBeenCalled();
    expect(useRecorderStore.getState().phase).toBe("idle");
    expect(await listBackups()).toEqual([]);
  });
});
```

> **Note on the `devicechange` test:** jsdom has no `navigator.mediaDevices`.
> Add this to the top of the test file, before the `describe`:
>
> ```ts
> const listeners = new Set<EventListener>();
> Object.defineProperty(navigator, "mediaDevices", {
>   configurable: true,
>   value: {
>     addEventListener: (_t: string, l: EventListener) => void listeners.add(l),
>     removeEventListener: (_t: string, l: EventListener) => void listeners.delete(l),
>     dispatchEvent: (e: Event) => { for (const l of listeners) l(e); return true; },
>     enumerateDevices: async () => [{ kind: "audioinput", deviceId: "mic-b" }],
>   },
> });
> ```
>
> The enumerated list deliberately omits `mic-a`, which is what
> `captureHandles.micDeviceId()` returns — so the watcher sees the loss.

- [ ] **Step 2: Run it and watch it fail.**

```bash
npx vitest run lib/recorder/__tests__/use-recorder.test.tsx
```

Expected: FAIL — cannot resolve `@/lib/recorder/use-recorder`.

- [ ] **Step 3: Implement it.**

```ts
"use client";

import { useCallback, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { createRecordedNote } from "@/app/notes/actions";
import { discardBackup, saveBackup } from "@/lib/recorder/audio-backup";
import { pickMimeType } from "@/lib/recorder/codec";
import { startCapture, type CaptureHandles } from "@/lib/recorder/capture";
import { watchAudioInputs } from "@/lib/recorder/device-handoff";
import {
  AUDIO_BUCKET,
  recordingPath,
  uploadRecording,
  type StorageBucketLike,
} from "@/lib/recorder/upload-audio";
import { useRecorderStore } from "@/lib/recorder/recorder-store";

/** How often the clock and the level meter refresh. 200 ms is fast enough to
 *  read as live and slow enough not to re-render the HUD on every frame. */
const TICK_MS = 200;

export interface RecorderDeps {
  capture: typeof startCapture;
  createRecorder(stream: MediaStream, mimeType: string): MediaRecorder;
  isTypeSupported(type: string): boolean;
  newNoteId(): string;
  now(): number;
  getUserId(): Promise<string>;
  bucket(): StorageBucketLike;
  createNote: typeof createRecordedNote;
}

export interface RecorderControls {
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  discard(): Promise<void>;
}

function browserDeps(): RecorderDeps {
  return {
    capture: startCapture,
    createRecorder: (stream, mimeType) => new MediaRecorder(stream, { mimeType }),
    isTypeSupported: (type) => MediaRecorder.isTypeSupported(type),
    newNoteId: () => crypto.randomUUID(),
    now: () => performance.now(),
    getUserId: async () => {
      const { data } = await createClient().auth.getUser();
      if (!data.user) throw new Error("Cannot record: not signed in.");
      return data.user.id;
    },
    bucket: () => createClient().storage.from(AUDIO_BUCKET) as unknown as StorageBucketLike,
    createNote: createRecordedNote,
  };
}

/** Peak amplitude of the current buffer, 0..1. */
function readLevel(analyser: AnalyserNode): number {
  const buffer = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(buffer);
  let peak = 0;
  for (const sample of buffer) peak = Math.max(peak, Math.abs(sample - 128) / 128);
  return peak;
}

/**
 * Wires the recorder store to the browser media APIs, Storage and the note
 * action. Every hard part lives in its own tested module; this is the glue and
 * the timers.
 *
 * `deps` exists so the whole flow can be driven in tests with fakes — jsdom has
 * no MediaRecorder, no getDisplayMedia and no Web Audio.
 */
export function useRecorder(overrides: Partial<RecorderDeps> = {}): RecorderControls {
  const depsRef = useRef<RecorderDeps>({ ...browserDeps(), ...overrides });
  depsRef.current = { ...browserDeps(), ...overrides };

  const capture = useRef<CaptureHandles | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const unwatch = useRef<(() => void) | null>(null);
  const lastTick = useRef(0);

  const store = useRecorderStore;

  // One interval drives both the clock and the level meter. It reads the store
  // rather than closing over it, so it never holds a stale phase.
  useEffect(() => {
    const id = setInterval(() => {
      const state = store.getState();
      if (state.phase !== "recording") return;
      const now = depsRef.current.now();
      const delta = lastTick.current === 0 ? TICK_MS : now - lastTick.current;
      lastTick.current = now;
      state.tick(delta);
      if (capture.current) state.setLevel(readLevel(capture.current.analyser));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [store]);

  const teardown = useCallback(() => {
    unwatch.current?.();
    unwatch.current = null;
    capture.current?.stop();
    capture.current = null;
    recorder.current = null;
    lastTick.current = 0;
  }, []);

  const start = useCallback(async () => {
    const deps = depsRef.current;
    const state = store.getState();

    const mimeType = pickMimeType(deps.isTypeSupported);
    if (!mimeType) {
      state.fail("This browser cannot record audio.");
      return;
    }

    const noteId = deps.newNoteId();
    state.requestStart(noteId);

    try {
      const handles = await deps.capture();
      capture.current = handles;
      chunks.current = [];

      const media = deps.createRecorder(handles.stream, mimeType);
      media.addEventListener("dataavailable", (event) => {
        const blob = (event as BlobEvent).data;
        if (blob && blob.size > 0) chunks.current.push(blob);
      });
      recorder.current = media;
      media.start(1000);

      // Restart the affected track cleanly rather than dropping the recording.
      // The MediaRecorder is attached to the mixed destination stream, which
      // replaceMic() does not touch, so recording continues across the swap.
      unwatch.current = watchAudioInputs({
        mediaDevices: navigator.mediaDevices,
        currentDeviceId: () => handles.micDeviceId(),
        onDeviceLost: () => {
          void handles.replaceMic().catch((error: unknown) => {
            store.getState().fail(`Microphone lost: ${String(error)}`);
          });
        },
      });

      lastTick.current = 0;
      state.confirmStart(mimeType);
    } catch (error) {
      teardown();
      store.getState().fail(error instanceof Error ? error.message : String(error));
    }
  }, [store, teardown]);

  const pause = useCallback(() => {
    recorder.current?.pause();
    store.getState().pause();
  }, [store]);

  const resume = useCallback(() => {
    recorder.current?.resume();
    lastTick.current = 0;
    store.getState().resume();
  }, [store]);

  const stop = useCallback(async () => {
    const deps = depsRef.current;
    const state = store.getState();
    const noteId = state.noteId;
    const mimeType = state.mimeType ?? "audio/webm";
    const durationSeconds = state.elapsedMs / 1000;
    if (!noteId) return;

    state.beginStop();

    const media = recorder.current;
    if (media) {
      await new Promise<void>((resolve) => {
        media.addEventListener("stop", () => resolve());
        media.stop();
      });
    }
    teardown();

    const blob = new Blob(chunks.current, { type: mimeType });

    // Backup BEFORE the network. A failed upload must leave recoverable audio.
    await saveBackup({
      noteId,
      blob,
      mimeType,
      durationSeconds,
      savedAtMs: deps.now(),
    });

    store.getState().beginUpload();

    try {
      const userId = await deps.getUserId();
      // Deterministic, so the row can name the object before the object exists.
      const path = recordingPath(userId, noteId);

      // The row is written BEFORE the bytes move, at processing_status
      // 'uploading' — true at this instant, and left for Track 3 to advance.
      // A failed upload therefore leaves a visible note whose audio is still in
      // IndexedDB, rather than a silent loss.
      await deps.createNote({ noteId, audioStoragePath: path, durationSeconds });

      await uploadRecording({
        bucket: deps.bucket(),
        userId,
        noteId,
        blob,
        contentType: mimeType,
      });

      // The backup is deliberately NOT discarded here. It waits for
      // processing_status === 'completed', which Track 3 owns.
      store.getState().finish();
    } catch (error) {
      store.getState().fail(error instanceof Error ? error.message : String(error));
    }
  }, [store, teardown]);

  const discard = useCallback(async () => {
    const noteId = store.getState().noteId;
    recorder.current?.stop();
    teardown();
    chunks.current = [];
    if (noteId) await discardBackup(noteId);
    store.getState().discard();
  }, [store, teardown]);

  return { start, pause, resume, stop, discard };
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
npx vitest run lib/recorder/__tests__/use-recorder.test.tsx
```

Expected: 13 passed. If a test hangs on the `stop` promise, the fake recorder's
`stop` event is being emitted before the listener attaches — move the
`d.recorder.emit("stop", {})` inside a `queueMicrotask` in the helper.

- [ ] **Step 5: Commit.**

```bash
git add lib/recorder/use-recorder.ts lib/recorder/__tests__/use-recorder.test.tsx
git commit -m "feat: orchestrate capture, backup, upload and note creation"
```

---

## Task 10: The HUD component

**Files:**
- Create: `components/recorder/hud-level-bars.tsx`
- Create: `components/recorder/record-hud.tsx`
- Test: `components/recorder/__tests__/record-hud.test.tsx`

**Interfaces:**
- Consumes: `useRecorderStore`, `formatElapsed`, `RecorderControls`.
- Produces: `HudLevelBars`, `RecordHud`.

**Design source, verbatim from surface 02b** (`App Surfaces.dc.html` 195–262):

| State | Content | Design colour → token |
|---|---|---|
| Idle | ▪ square, **Record**, `⌘⇧R` | `bg-pane`, `border-rule`, square `bg-accent`, shortcut `text-meta-4` |
| Recording | ● dot, `12:41`, 7 level bars, divider, **Pause**, **Stop**, `⌃` | dot `bg-live`, border `border-rule-2`, Pause `border-rule-2 text-notice`, Stop `bg-accent text-on-accent`, caret `text-meta-2`, divider `bg-rule` |
| Paused | □ outline, `12:41`, **Paused**, divider, **Resume**, **Discard** | `bg-paper`, `border-rule-3`, outline `border-faint`, time `text-muted`, label `text-meta-4`, Resume `border-tint-hover text-accent-text`, Discard `text-rail-idle` |

Copy is verbatim from the design: `Record`, `Pause`, `Stop`, `Paused`,
`Resume`, `Discard`, `⌘⇧R`, and the caption
`DRAG ANYWHERE · SNAPS TO THE NEAREST CORNER · NEVER OVER A SHARED SCREEN`.

**Deliberately NOT built here, and recorded in KNOWN_GAPS in Task 13:**

- The **expanded jot pane** (02b's fourth state). It writes "rough notes", and
  no column or table exists for them — `notes.raw_transcript` is the transcript,
  not the user's notes. Building the UI without a home for its data would be
  guessing at a schema decision this track does not own.
- **Drag and snap-to-corner.** The caption is rendered because it is the
  design's copy, but the HUD is fixed bottom-right. Not in the scope fence.
- **`OPEN FULL PANE`.** Surface 02, the full recorder, is out of scope.
- **`CHANGE PERSONA` / persona at capture time.** Explicitly out of scope.

`⌘⇧R` **is** wired — the design renders the shortcut as a promise, and a
label for a key that does nothing is a lie in the UI.

- [ ] **Step 1: Write the failing test.**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordHud } from "@/components/recorder/record-hud";
import { useRecorderStore } from "@/lib/recorder/recorder-store";

const NOTE = "11111111-2222-3333-4444-555555555555";

const controls = () => ({
  start: vi.fn(async () => {}),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(async () => {}),
  discard: vi.fn(async () => {}),
});

const state = () => useRecorderStore.getState();

function toRecording() {
  state().requestStart(NOTE);
  state().confirmStart("audio/webm;codecs=opus");
}

describe("RecordHud", () => {
  beforeEach(() => state().discard());

  it("offers Record with the shortcut when idle", () => {
    render(<RecordHud controls={controls()} />);
    expect(screen.getByRole("button", { name: /record/i })).toBeInTheDocument();
    expect(screen.getByText("⌘⇧R")).toBeInTheDocument();
  });

  it("starts capture when Record is pressed", async () => {
    const c = controls();
    render(<RecordHud controls={c} />);
    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    expect(c.start).toHaveBeenCalled();
  });

  it("shows the elapsed clock, Pause and Stop while recording", () => {
    toRecording();
    state().tick(12 * 60_000 + 41_000);
    render(<RecordHud controls={controls()} />);
    expect(screen.getByText("12:41")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^stop$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /record/i })).not.toBeInTheDocument();
  });

  it("announces that it is capturing system audio and mic", () => {
    toRecording();
    render(<RecordHud controls={controls()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/recording/i);
  });

  it("pauses through the controls", async () => {
    toRecording();
    const c = controls();
    render(<RecordHud controls={c} />);
    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(c.pause).toHaveBeenCalled();
  });

  it("offers Resume and Discard when paused, and keeps the clock", () => {
    toRecording();
    state().tick(61_000);
    state().pause();
    render(<RecordHud controls={controls()} />);
    expect(screen.getByText("1:01")).toBeInTheDocument();
    expect(screen.getByText(/^Paused$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /discard/i })).toBeInTheDocument();
  });

  it("resumes and discards through the controls", async () => {
    toRecording();
    state().pause();
    const c = controls();
    render(<RecordHud controls={c} />);
    await userEvent.click(screen.getByRole("button", { name: /resume/i }));
    expect(c.resume).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(c.discard).toHaveBeenCalled();
  });

  it("shows an uploading state with no controls to press", () => {
    toRecording();
    state().beginStop();
    state().beginUpload();
    render(<RecordHud controls={controls()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/uploading/i);
    expect(screen.queryByRole("button", { name: /stop/i })).not.toBeInTheDocument();
  });

  it("surfaces the error message and offers a retry", () => {
    toRecording();
    state().fail("Audio upload failed: offline");
    render(<RecordHud controls={controls()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/offline/);
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  it("starts recording on the ⌘⇧R / Ctrl+Shift+R shortcut", async () => {
    const c = controls();
    render(<RecordHud controls={c} />);
    await userEvent.keyboard("{Control>}{Shift>}R{/Shift}{/Control}");
    expect(c.start).toHaveBeenCalled();
  });

  it("renders the design's drag caption while recording", () => {
    toRecording();
    render(<RecordHud controls={controls()} />);
    expect(screen.getByText(/SNAPS TO THE NEAREST CORNER/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
npx vitest run components/recorder/__tests__/record-hud.test.tsx
```

Expected: FAIL — cannot resolve `@/components/recorder/record-hud`.

- [ ] **Step 3: Implement the level bars.**

```tsx
"use client";

/** The seven-bar mic meter from surface 02b. Bar heights are a fixed ladder
 *  scaled by the live level — nothing here calls Math.random(), which the
 *  project forbids in a render path. */
const LADDER = [5, 11, 15, 8, 13, 4, 9] as const;

/** Three colour tiers, tallest loudest, matching the design's three greens. */
function tone(height: number): string {
  if (height >= 13) return "bg-accent";
  if (height >= 8) return "bg-tint-hover";
  return "bg-waveform";
}

export function HudLevelBars({ level }: { level: number }) {
  const scale = 0.25 + Math.min(1, Math.max(0, level)) * 0.75;
  return (
    <span aria-hidden="true" className="flex h-[15px] items-end gap-[2px]">
      {LADDER.map((height, index) => (
        <span
          key={index}
          className={`w-[2px] ${tone(height)}`}
          style={{ height: `${Math.max(2, Math.round(height * scale))}px` }}
        />
      ))}
    </span>
  );
}
```

- [ ] **Step 4: Implement the HUD.**

```tsx
"use client";

import { useEffect } from "react";
import { HudLevelBars } from "@/components/recorder/hud-level-bars";
import { formatElapsed } from "@/lib/recorder/format-elapsed";
import { useRecorderStore } from "@/lib/recorder/recorder-store";
import type { RecorderControls } from "@/lib/recorder/use-recorder";

/**
 * The record HUD, App Surfaces surface 02b.
 *
 * Locked design, implemented not invented: layout, states and copy are taken
 * from the design file. Every colour is a token — `bg-live` and `--shadow-hud`
 * were added to app/globals.css in this track because 02b uses a red and a
 * shadow that had no token yet.
 *
 * Not built here, deliberately (docs/KNOWN_GAPS.md): 02b's expanded jot pane
 * has no schema home for "rough notes"; drag/snap-to-corner and OPEN FULL PANE
 * are outside this track's scope fence. The drag caption is still rendered
 * because it is the design's copy.
 */
const PILL =
  "pointer-events-auto flex items-center shadow-[0_8px_24px_var(--shadow-hud)]";
const MONO_ACTION =
  "font-mono text-[9px] tracking-[0.06em] uppercase cursor-pointer";

export function RecordHud({ controls }: { controls: RecorderControls }) {
  const phase = useRecorderStore((s) => s.phase);
  const elapsedMs = useRecorderStore((s) => s.elapsedMs);
  const level = useRecorderStore((s) => s.level);
  const errorMessage = useRecorderStore((s) => s.errorMessage);

  // ⌘⇧R / Ctrl+Shift+R. The design renders the shortcut as a promise; a label
  // for a key that does nothing is a lie in the UI.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "r") return;
      if (useRecorderStore.getState().phase !== "idle") return;
      event.preventDefault();
      void controls.start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controls]);

  const elapsed = formatElapsed(elapsedMs);

  return (
    <div className="pointer-events-none fixed right-6 bottom-6 z-50 flex flex-col items-end gap-[9px]">
      {phase === "idle" ? (
        <button
          type="button"
          onClick={() => void controls.start()}
          className={`${PILL} bg-pane border-rule gap-[11px] border px-[13px] py-[9px]`}
        >
          <span aria-hidden="true" className="bg-accent h-[9px] w-[9px]" />
          <span className="font-header text-ink text-[13.5px] font-semibold">Record</span>
          <span className="font-mono text-meta-4 pl-[2px] text-[9.5px]">⌘⇧R</span>
        </button>
      ) : null}

      {phase === "requesting" ? (
        <div role="status" className={`${PILL} bg-pane border-rule gap-[11px] border px-[13px] py-[9px]`}>
          <span className="font-mono text-meta-4 text-[9.5px] tracking-[0.1em] uppercase">
            Waiting for permission
          </span>
        </div>
      ) : null}

      {phase === "recording" ? (
        <>
          <div
            role="status"
            className={`${PILL} bg-pane border-rule-2 gap-[13px] border py-[9px] pr-[11px] pl-[13px]`}
          >
            <span aria-hidden="true" className="bg-live h-[9px] w-[9px] rounded-full" />
            <span className="sr-only">Recording system audio and microphone</span>
            <span className="font-mono text-ink text-[16px] font-medium tracking-[-0.01em]">
              {elapsed}
            </span>
            <HudLevelBars level={level} />
            <span aria-hidden="true" className="bg-rule h-[20px] w-px" />
            <button
              type="button"
              onClick={controls.pause}
              className={`${MONO_ACTION} border-rule-2 text-notice border px-[8px] py-[5px]`}
            >
              Pause
            </button>
            <button
              type="button"
              onClick={() => void controls.stop()}
              className={`${MONO_ACTION} bg-accent text-on-accent px-[9px] py-[5px] font-medium`}
            >
              Stop
            </button>
          </div>
          <p className="font-mono text-faint text-[9px] tracking-[0.04em]">
            DRAG ANYWHERE · SNAPS TO THE NEAREST CORNER · NEVER OVER A SHARED SCREEN
          </p>
        </>
      ) : null}

      {phase === "paused" ? (
        <div
          role="status"
          className={`${PILL} bg-paper border-rule-3 gap-[13px] border py-[9px] pr-[11px] pl-[13px]`}
        >
          <span aria-hidden="true" className="border-faint h-[9px] w-[9px] border-[1.5px]" />
          <span className="font-mono text-muted text-[16px] font-medium tracking-[-0.01em]">
            {elapsed}
          </span>
          <span className="font-mono text-meta-4 text-[9px] tracking-[0.1em] uppercase">
            Paused
          </span>
          <span aria-hidden="true" className="bg-rule-3 h-[20px] w-px" />
          <button
            type="button"
            onClick={controls.resume}
            className={`${MONO_ACTION} border-tint-hover text-accent-text border px-[9px] py-[5px]`}
          >
            Resume
          </button>
          <button
            type="button"
            onClick={() => void controls.discard()}
            className={`${MONO_ACTION} text-rail-idle px-[8px] py-[5px]`}
          >
            Discard
          </button>
        </div>
      ) : null}

      {phase === "stopping" || phase === "uploading" ? (
        <div role="status" className={`${PILL} bg-pane border-rule gap-[11px] border px-[13px] py-[9px]`}>
          <span aria-hidden="true" className="bg-accent h-[9px] w-[9px]" />
          <span className="font-mono text-notice text-[9.5px] tracking-[0.1em] uppercase">
            {phase === "stopping" ? "Finishing" : "Uploading"}
          </span>
        </div>
      ) : null}

      {phase === "error" ? (
        <div
          role="alert"
          className={`${PILL} bg-pane border-rule-2 max-w-sm gap-[11px] border px-[13px] py-[9px]`}
        >
          <span aria-hidden="true" className="bg-live h-[9px] w-[9px]" />
          <span className="font-body text-ink-2 text-[12px]">{errorMessage}</span>
          <button
            type="button"
            onClick={() => void controls.start()}
            className={`${MONO_ACTION} border-rule-2 text-notice border px-[8px] py-[5px]`}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => void controls.discard()}
            className={`${MONO_ACTION} text-rail-idle px-[8px] py-[5px]`}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Run it and watch it pass.**

```bash
npx vitest run components/recorder/__tests__/record-hud.test.tsx
```

Expected: 11 passed.

- [ ] **Step 6: Run the convention guard against the new directories and paste the output.**

```bash
npx vitest run components/note-detail/__tests__/project-conventions.test.ts
```

Expected: 3 passed. A failure here means a raw `oklch()` reached
`components/recorder/` or `lib/recorder/` — fix the colour, never the test.

- [ ] **Step 7: Commit.**

```bash
git add components/recorder lib/recorder
git commit -m "feat: record HUD implementing App Surfaces 02b"
```

---

## Task 11: Mount the HUD at layout scope

The task that actually delivers "ambient, not calendar-gated."

**Files:**
- Create: `components/recorder/recorder-dock.tsx`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `useRecorder`, `RecordHud`.
- Produces: `RecorderDock`.

**Constraint:** `app/layout.tsx` stays a **server component**. The dock is an
isolated client island. Adding `"use client"` to the layout would push the whole
tree to the client and is not on the table.

- [ ] **Step 1: Write the dock.**

```tsx
"use client";

import { usePathname } from "next/navigation";
import { RecordHud } from "@/components/recorder/record-hud";
import { useRecorder } from "@/lib/recorder/use-recorder";

/** Routes reachable without a session. Mirrors PUBLIC_PREFIXES in
 *  lib/supabase/session.ts — a HUD on the sign-in page would offer a recording
 *  that has nowhere to go. */
const HIDDEN_PREFIXES = ["/login", "/auth"];

/**
 * The client island mounted in the root layout.
 *
 * This file is the whole point of the track: because it is rendered by
 * app/layout.tsx and the store lives at module scope, the recorder survives
 * every navigation. Nothing re-creates the store per route, and there is no
 * provider a route change could remount.
 */
export function RecorderDock() {
  const pathname = usePathname();
  const controls = useRecorder();

  const hidden = HIDDEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (hidden) return null;

  return <RecordHud controls={controls} />;
}
```

- [ ] **Step 2: Mount it in `app/layout.tsx`.**

Add the import beside the existing ones:

```tsx
import { RecorderDock } from "@/components/recorder/recorder-dock";
```

Change the `<body>` line from:

```tsx
      <body className="bg-canvas text-ink font-body antialiased">{children}</body>
```

to:

```tsx
      <body className="bg-canvas text-ink font-body antialiased">
        {children}
        {/* Mounted here, not per route: the HUD has to survive navigation, and
            the recorder store lives at module scope so it never resets. The
            layout stays a server component — this is an isolated client
            island, not a reason to convert the shell. */}
        <RecorderDock />
      </body>
```

- [ ] **Step 3: Typecheck and build.**

```bash
npm run typecheck
```

Expected: clean.

```bash
npm run build
```

Expected: build succeeds, and `/` and `/notes/[id]` still render.

- [ ] **Step 4: Run the whole suite.**

```bash
npm test
```

Expected: the 64 baseline tests plus every test added in Tasks 1–10, zero
failures.

- [ ] **Step 5: Commit.**

```bash
git add components/recorder/recorder-dock.tsx app/layout.tsx
git commit -m "feat: mount the recorder HUD at root-layout scope"
```

---

## Task 12: Live proof against the hosted project

Two scripts. Neither replaces the other, and the report must say which proved
what.

**Files:**
- Create: `scripts/verify-recorder-upload.mjs`
- Create: `scripts/print-signin-link.mjs`
- Modify: `package.json` (no new script entries — these are run with `node`,
  matching the existing `verify-*.mjs` convention. **Skip this modify.**)

- [ ] **Step 1: Write the sign-in link printer.**

Login is magic-link only, so the browser proof needs a link that has not already
been spent. `generateLink` mints one without sending mail.

```js
/**
 * Prints a one-time sign-in URL for the RLS fixture owner.
 *
 * Login is magic-link only (signInWithOtp), and docs/KNOWN_GAPS.md records that
 * emailed links are spent by a GET before a human clicks them. generateLink
 * mints the token without sending mail, so the browser can be signed in for a
 * local verification pass without changing a line of application code.
 *
 * Local verification only. Never wire this into the app.
 * Run with: node scripts/print-signin-link.mjs [http://localhost:3000]
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const origin = process.argv[2] ?? "http://localhost:3000";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: env.RLS_TEST_OWNER_EMAIL,
});
if (error) throw error;

console.log(`user id : ${data.user.id}`);
console.log(
  `sign in : ${origin}/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=%2F`,
);
```

- [ ] **Step 2: Write the end-to-end upload proof.**

This proves the exact object path and the note row against the live project,
using the same two-segment path shape the app builds. It cleans up in a
`finally` with the secret key, because there is no DELETE policy.

```js
/**
 * End-to-end proof of the Track 2 write path against the hosted project:
 * a real blob lands at {user_id}/{note_id} in audio-recordings, and a notes row
 * is created pointing at it.
 *
 * Same proof discipline as verify-storage-rls.mjs: the fixture owner signs in
 * for real, the returned JWT is attached to a PUBLISHABLE-key client, and the
 * role claim is checked before any result is trusted. The secret key creates
 * nothing the proof depends on -- it is used only for cleanup, because
 * storage_audio.sql deliberately ships no DELETE policy.
 *
 * The object is NEVER verified with download(). Storage serves reads through a
 * caching CDN and a download() straight after an upsert returns the
 * pre-overwrite body (docs/KNOWN_GAPS.md). Size comes from list() metadata.
 *
 * NOT COVERED HERE: the browser HUD, the cookie plumbing through proxy.ts, and
 * real MediaRecorder capture. Those are the browser pass and the manual
 * protocol. Neither substitutes for the other.
 *
 * Run with: node scripts/verify-recorder-upload.mjs
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "audio-recordings";
const AUDIO = "fake opus payload, long enough to have a distinctive length";

function loadEnv(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}

function roleClaim(jwt) {
  return JSON.parse(
    Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"),
  ).role;
}

let failed = false;
function check(label, ok, detail) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failed = true;
}

const env = loadEnv(".env.local");
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const admin = createClient(url, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const anon = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
  email: env.RLS_TEST_OWNER_EMAIL,
  password: env.RLS_TEST_OWNER_PASSWORD,
});
if (signInError) throw signInError;

const token = signIn.session.access_token;
const role = roleClaim(token);
if (role !== "authenticated") {
  throw new Error(`refusing to trust a result from role "${role}"`);
}

const owner = createClient(url, publishableKey, {
  global: { headers: { Authorization: `Bearer ${token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});

const userId = signIn.user.id;
const noteId = randomUUID();
// The exact shape lib/recorder/upload-audio.ts builds. Two segments, that
// order, no extension -- the first segment IS the RLS check.
const path = `${userId}/${noteId}`;
const blob = new Blob([AUDIO], { type: "audio/webm" });

console.log(`bucket  : ${BUCKET}`);
console.log(`user id : ${userId}  role=${role}`);
console.log(`note id : ${noteId}`);
console.log(`path    : ${path}`);
console.log("");

try {
  console.log("--- upload at {user_id}/{note_id} ---");
  const up = await owner.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "audio/webm;codecs=opus", upsert: true });
  check("upload accepted", !up.error, `error=${JSON.stringify(up.error?.message ?? null)}`);
  check("upload reports the path we asked for", up.data?.path === path, `path=${up.data?.path}`);

  // Size from list() metadata, never download().
  const listing = await owner.storage.from(BUCKET).list(userId, { search: noteId });
  const row = listing.data?.find((o) => o.name === noteId);
  check("object is visible to its owner via list()", Boolean(row), `rows=${listing.data?.length ?? 0}`);
  check(
    "recorded size matches the bytes uploaded",
    row?.metadata?.size === AUDIO.length,
    `size=${row?.metadata?.size} expected=${AUDIO.length}`,
  );
  console.log("");

  console.log("--- retry to the same path is an upsert, not a second object ---");
  const again = await owner.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "audio/webm;codecs=opus", upsert: true });
  check("retry accepted", !again.error, `error=${JSON.stringify(again.error?.message ?? null)}`);
  const after = await owner.storage.from(BUCKET).list(userId, { search: noteId });
  check("still exactly one object", (after.data?.length ?? 0) === 1, `rows=${after.data?.length ?? 0}`);
  console.log("");

  console.log("--- notes row ---");
  const ins = await owner.from("notes").upsert(
    {
      id: noteId,
      user_id: userId,
      audio_storage_path: path,
      audio_duration_seconds: 12,
      processing_status: "uploading",
    },
    { onConflict: "id" },
  );
  check("insert accepted under RLS", !ins.error, `error=${JSON.stringify(ins.error?.message ?? null)}`);

  // No user_id filter -- RLS supplies it, exactly as list-notes.ts does.
  const { data: notes, error: readError } = await owner
    .from("notes")
    .select("id, audio_storage_path, processing_status, audio_duration_seconds")
    .eq("id", noteId);
  check("row reads back", !readError && notes?.length === 1, `error=${JSON.stringify(readError?.message ?? null)}`);
  check("audio_storage_path points at the object", notes?.[0]?.audio_storage_path === path, `got=${notes?.[0]?.audio_storage_path}`);
  check("processing_status is uploading, not analyzing", notes?.[0]?.processing_status === "uploading", `got=${notes?.[0]?.processing_status}`);
  console.log("");

  console.log("--- the note appears in the same query the / list runs ---");
  const feed = await owner
    .from("notes")
    .select("id, title, created_at")
    .order("created_at", { ascending: false });
  check("new note is in the feed", Boolean(feed.data?.some((n) => n.id === noteId)), `rows=${feed.data?.length ?? 0}`);
  console.log("");
} finally {
  console.log("--- cleanup ---");
  // No DELETE policy exists by design, so removal is the admin client's job.
  const { data: removed } = await admin.storage.from(BUCKET).remove([path]);
  console.log(`  removed ${removed?.length ?? 0} object(s)`);
  const { error: delError } = await admin.from("notes").delete().eq("id", noteId);
  console.log(`  removed note row  error=${JSON.stringify(delError?.message ?? null)}`);
  console.log("");
}

console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
```

- [ ] **Step 3: Run it. Paste the full output into the final report.**

```bash
node scripts/verify-recorder-upload.mjs
```

Expected: `PASS`, with a real `path` line and a real `size=` line.

- [ ] **Step 4: Re-run both Track 1 proofs — no regression.**

```bash
node scripts/verify-rls.mjs
```

```bash
node scripts/verify-storage-rls.mjs
```

Expected: `PASS` from both. Paste both.

- [ ] **Step 5: Browser pass — codec strings and cross-route HUD persistence.**

Start the dev server through the preview tool (never `npm run dev` in Bash):
`preview_start` with `{ name: "note-detail" }` from `.claude/launch.json`.

Then, in order:

  a. `node scripts/print-signin-link.mjs http://localhost:3000` and navigate to
     the printed URL. Confirm you land on `/` and not `/login`.

  b. **Codec proof.** Run in the page console:

```js
["audio/webm;codecs=opus","audio/webm","audio/mp4;codecs=mp4a.40.2","audio/mp4","audio/ogg;codecs=opus"].map(t => `${t} → ${MediaRecorder.isTypeSupported(t)}`)
```

  Record the exact result and the browser's `navigator.userAgent`. This is the
  "run in this environment" half of the reporting contract; Safari's strings
  stay implemented-but-unverified and must be labelled as such.

  c. **Cross-route HUD persistence.** Confirm the idle pill is present on `/`
     (`read_page`, then a screenshot). Click through to a `/notes/[id]` route.
     Confirm the pill is still there. Navigate back. Screenshot both.

  d. **Local backup survives navigation.** In the page console, seed a backup
     through the real module path and then navigate and read it back:

```js
await (async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open("recorder-backup", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("recordings", { keyPath: "noteId" });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = db.transaction("recordings", "readwrite");
  tx.objectStore("recordings").put({ noteId: "nav-probe", blob: new Blob(["x"]), mimeType: "audio/webm", durationSeconds: 1, savedAtMs: 0 });
  return new Promise(res => tx.oncomplete = () => res("seeded"));
})()
```

  Navigate to another route, then read it back:

```js
await new Promise((res, rej) => {
  const r = indexedDB.open("recorder-backup", 1);
  r.onsuccess = () => {
    const g = r.result.transaction("recordings", "readonly").objectStore("recordings").get("nav-probe");
    g.onsuccess = () => res(g.result ? "SURVIVED" : "GONE");
  };
  r.onerror = () => rej(r.error);
})
```

  Expected: `"SURVIVED"`. Then delete the probe.

  e. **If** the environment's browser will grant `getDisplayMedia` without a
     picker, drive a real short recording and confirm the note lands in `/`. If
     it will not (the picker needs a human, and Chrome flags are not settable
     here), **say so plainly in the report** and point at Task 12 step 3 plus
     the manual protocol as the substitutes. Do not claim a capture that did
     not happen.

- [ ] **Step 6: Commit the scripts.**

```bash
git add scripts/verify-recorder-upload.mjs scripts/print-signin-link.mjs
git commit -m "scripts: prove the recorder write path and mint local sign-in links"
```

---

## Task 12b: CONDITIONAL — only if Task 0 found the schema wrong

**Skip this entire task if Task 0 steps 1 and 2 matched
`supabase/schemas/notes.sql`.** Based on reading the file, they will.

If they did not, follow the exact discipline of the last three migrations. Do
not fold it in silently — the final report must call it out as a schema change.

- [ ] **Step 1:** Edit `supabase/schemas/notes.sql`. Never paste DDL inline.
- [ ] **Step 2:** Apply the whole file (every statement is idempotent):

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn --file supabase/schemas/notes.sql
```

- [ ] **Step 3:** `npx supabase migration new <name>`, then fill it by hand with
  only the changed statements. Never call `apply_migration` while iterating.
- [ ] **Step 4:** `npx supabase migration repair --status applied <version>`,
  then `npx supabase migration list --linked`.
- [ ] **Step 5:** Verify with `git hash-object` that the migration matches what
  was applied, and read the live catalog back (`pg_constraint`,
  `information_schema.columns`) — `db diff` is unavailable without Docker.
- [ ] **Step 6:** `npx supabase db advisors --linked --project-ref pbwvvakzbrimmdntqxxn --type all --level info`
- [ ] **Step 7:** Commit with a `db:` subject and paste every hash into the report.

---

## Task 13: The manual QA protocol

**Files:**
- Create: `docs/qa/recorder-manual-test-protocol.md`

This exists because device handoff, real-world echo, and Safari cannot be
automated here. It must be runnable by somebody who did not write the code:
numbered steps, explicit expected results, no "test this" hand-waving.

- [ ] **Step 1: Write the document.**

````markdown
# Recorder — Manual Test Protocol

Three things this app has to get right cannot be proved by `npm test` or by any
script in `scripts/`: swapping headphones mid-recording, echo with no
headphones, and Safari. This is the checklist that covers them.

Run the whole thing after any change to `lib/recorder/` or
`components/recorder/`. It takes about 20 minutes.

## Before you start

1. `node scripts/print-signin-link.mjs http://localhost:3000`
2. Start the dev server and open the printed URL. You should land on `/`,
   signed in, with the **Record** pill docked bottom-right.
3. Have ready: wired or Bluetooth headphones with a microphone, a second
   audio input if you have one, and a browser tab that plays sound (any video).

Record the browser name and full version for every section you run. A pass on
Chrome 141 says nothing about Safari 18.

---

## Section A — Device handoff mid-recording

**Why:** ROADMAP §8b calls this "a common real scenario, not an edge case."
Someone puts headphones on halfway through a meeting; the recording must
continue, not die.

| # | Do this | Expect |
|---|---|---|
| A1 | Play audio in another tab. Click **Record**. | Two prompts: screen/tab picker, then microphone. |
| A2 | In the picker, choose the tab that is playing audio and **tick "Share tab audio"**. | Capture starts. |
| A3 | Watch the HUD for 10 seconds while speaking. | The clock counts up. The level bars move **when you speak**, not when only the tab plays. |
| A4 | With the recording still running, **plug in headphones with a mic** (or connect Bluetooth ones). | The clock **does not reset** and **does not stop**. The pill stays in its recording state. |
| A5 | Speak again for 10 seconds. | The level bars move again. There may be a sub-second dropout at the moment of the swap — that is expected and acceptable. |
| A6 | **Unplug the headphones.** | Same as A4: recording continues, clock keeps counting. |
| A7 | Speak for 10 more seconds, then click **Stop**. | The pill shows "Uploading", then returns to the **Record** idle pill. |
| A8 | Navigate to `/`. | A new note is in the list. |
| A9 | Open the note. | It opens without error. **No transcript** — that is Track 3 and is correct here. |

**Fail conditions:** the recording ends at A4 or A6; the clock resets; the level
bars stay dead after A5; the HUD lands in the error state.

---

## Section B — Echo with no headphones

**Why:** the only echo control this app has is the `echoCancellation: true`
mic constraint. ROADMAP §7 and DECISIONS.md explicitly rejected adding anything
on top of it. This section checks the baseline is doing its job — it is not a
prompt to add more masking.

| # | Do this | Expect |
|---|---|---|
| B1 | **Take headphones off.** Use laptop speakers and the built-in mic. | — |
| B2 | Play a video with clear speech in another tab, at normal listening volume. | — |
| B3 | Click **Record**, share that tab **with audio**, allow the mic. | Recording starts. |
| B4 | Stay silent for 20 seconds while the video plays. | Level bars stay low. Some movement is normal — the mic does hear the speakers. |
| B5 | Talk over the video for 20 seconds. | Level bars clearly rise above the B4 level. |
| B6 | **Stop.** Note the note id from the URL after opening it from `/`. | Upload completes. |
| B7 | Download the object with the secret key and listen to it. See "Listening to a recording" below. | Your voice is clearly audible. The tab audio is audible. **You do not hear a doubled/echoing copy of the tab audio** — one clean pass through, not two offset ones. |

**Fail condition:** B7 has an obvious slap-back echo of the tab audio. If it
does, the finding is "echoCancellation is not being applied" — check the
constraint in `lib/recorder/capture.ts` is exactly `{ echoCancellation: true }`
and that the mic is a real device, not a virtual loopback. **Do not "fix" this
by adding noise suppression or custom masking.** That is a locked decision.

---

## Section C — Safari

**Why:** Safari supports no WebM at all. `lib/recorder/codec.ts` lists
`audio/mp4;codecs=mp4a.40.2` and `audio/mp4` for it. Those strings were
implemented from the spec and are **unverified until this section is run.**

| # | Do this | Expect |
|---|---|---|
| C1 | Open the app in Safari. Sign in with a fresh link from `print-signin-link.mjs`. | The **Record** pill appears. |
| C2 | In Safari's Web Inspector console, run:<br>`["audio/webm;codecs=opus","audio/webm","audio/mp4;codecs=mp4a.40.2","audio/mp4","audio/ogg;codecs=opus"].map(t => t + " → " + MediaRecorder.isTypeSupported(t))` | Record the exact output. At least one `audio/mp4` entry should be `true`. Every `audio/webm` entry is expected to be `false`. |
| C3 | If **every** entry is `false`, stop and file it. | The HUD should show "This browser cannot record audio." rather than crashing. |
| C4 | Click **Record**. | Safari prompts for screen/tab sharing and then the mic. **Safari's picker may not offer tab audio at all** — if so, record that fact; it is a Safari platform limit, not a bug in this code. |
| C5 | Record 15 seconds of speech, then **Stop**. | Upload completes, the HUD returns to idle. |
| C6 | Go to `/`. | The new note is listed. |
| C7 | Download the object and check its container. See below. | The file is an MP4/AAC audio file, not WebM. |

**Record for the report:** Safari version, the full C2 output, whether C4
offered tab audio, and the container from C7.

---

## Section D — The local backup buffer

**Why:** ROADMAP §8b, light version. The blob must not be lost by a navigation
and must not be discarded before `processing_status` reaches `completed`.

| # | Do this | Expect |
|---|---|---|
| D1 | Start a recording. While it runs, click through to a different route and back. | The HUD keeps counting. The clock does not reset. |
| D2 | **Stop.** Wait for the idle pill. | Upload completes. |
| D3 | Open DevTools → Application → IndexedDB → `recorder-backup` → `recordings`. | **A row is still there** for the note you just made. |
| D4 | Reload the page. Look again. | The row is still there. |

**This is correct, not a leak.** Track 3 does not exist, so no note ever reaches
`completed`, so nothing is ever discarded. When Track 3 ships, D3 becomes
"the row is gone once the note reads `completed`."

---

## Section E — Retry after a failed upload

**Why:** a retry to the same `{user_id}/{note_id}` path is an upsert, which is
why `storage_audio.sql` ships an UPDATE policy.

| # | Do this | Expect |
|---|---|---|
| E1 | Start a recording. Let it run 15 seconds. | — |
| E2 | In DevTools → Network, switch to **Offline**. Click **Stop**. | The HUD shows an error with a **Try again** button. |
| E3 | Check IndexedDB as in D3. | The blob is there. |
| E4 | Switch Network back to **Online**. Go to `/`. | **A note IS in the list.** The row is written as the upload starts, so it exists even though the upload failed. This is intended. |
| E5 | Confirm the row's status:<br>`node -e "..."` or the Supabase dashboard, `select processing_status, audio_storage_path from notes order by created_at desc limit 1;` | `uploading`, with an `audio_storage_path` that points at an object **that is not there**. |
| E6 | Confirm the object really is absent, using `list()` and not `download()` (a download after a failed write can still be served from CDN cache). | Empty listing for that note id under your user prefix. |
| E7 | Click **Try again**. | It records again from scratch — this track retries by re-recording, not by resuming an upload. Note the behaviour; resume-upload is not built. |

**Do not file E4/E5 as a bug.** A row at `uploading` with a missing object is
the designed failure state: the note stays visible and the audio stays
recoverable. Track 3 must check the object exists before transcribing.

---

## Listening to a recording

There is no playback UI yet, and no DELETE policy, so use the secret key:

```bash
node -e "const{readFileSync,writeFileSync}=require('fs');const e=Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));const{createClient}=require('@supabase/supabase-js');const a=createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SECRET_KEY);a.storage.from('audio-recordings').download(process.argv[1]).then(async r=>{if(r.error)throw r.error;writeFileSync('recording.bin',Buffer.from(await r.data.arrayBuffer()));console.log('wrote recording.bin')})" "<user_id>/<note_id>"
```

Then check the container and play it:

```bash
ffprobe recording.bin
```

`recording.bin` is gitignored by the `*.bin` pattern — confirm before you run
this, and delete it afterwards either way.

---

## Reporting a run

Paste into the PR or the track report:

- Browser names and full versions for every section run.
- The exact `isTypeSupported` output from C2 (and its Chromium equivalent).
- Which sections passed, which failed, which were **not run** and why.
- Any section skipped because hardware was unavailable — say so; a skipped
  section is not a passed one.
````

- [ ] **Step 2: Confirm `*.bin` is actually gitignored, since the doc claims it.**

```bash
git check-ignore -v recording.bin || echo "NOT IGNORED — add *.bin to .gitignore"
```

If it is not ignored, add `*.bin` to `.gitignore` and commit that too.

- [ ] **Step 3: Commit.**

```bash
git add docs/qa/recorder-manual-test-protocol.md
git commit -m "docs: runnable manual QA protocol for the recorder"
```

---

## Task 14: Record what shipped and what is still open

**Files:**
- Modify: `docs/KNOWN_GAPS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a `## Recorder HUD` section to `docs/KNOWN_GAPS.md`.**

Follow the file's existing voice — long-form, states the reasoning, and
distinguishes measured from assumed. It must cover, each as its own bullet:

  * **Shipped.** The Zustand store at module scope, the HUD mounted in
    `app/layout.tsx`, capture via `getDisplayMedia` + `getUserMedia` mixed
    through Web Audio, codec feature detection, direct upload to
    `{user_id}/{note_id}`, `createRecordedNote`, the IndexedDB backup buffer,
    `devicechange` handling.
  * **Amends the "State management — Zustand not used here" section
    (line ~24).** That section said "Revisit if a second stateful surface needs
    to share state." This is that surface. Add a "**RESOLVED 2026-08-31**"
    paragraph there too, in the same style as the other resolutions in the file.
  * **Amends the "Audio Storage bucket" resolution (line ~194).** It says "Still
    open: no upload code, no playback UI. Nothing writes
    `notes.audio_storage_path` yet — that is Track 2." Upload code now exists.
    **Playback UI still does not.**
  * **`--live` light-theme value is DERIVED, not from the design.** The design
    file is dark-only for the recording red; the light value
    `oklch(0.520 0.170 25)` follows the accent pattern. Same treatment as the
    existing "Tokens not enumerated in 3c" section.
  * **`processing_status` is set to `'uploading'` and never moves.** The row is
    written as the upload STARTS, not after it succeeds — possible because the
    note id, and therefore the object path, is generated before capture begins.
    State that this track never writes `'analyzing'` or `'completed'` at all:
    the scope fence assigns both to Track 3, so writing `'analyzing'` as a
    handoff value would claim a model pass that nothing performs.
  * **A failed upload deliberately leaves a row at `'uploading'` with no
    object.** Record this as an intended state, not a leak: the note is visible
    in `/`, the blob is still in IndexedDB, and a retry upserts both the same
    row and the same object path. The alternative — writing the row only after a
    successful upload — was rejected because it makes a failure invisible.
    **Whoever builds Track 3 must not assume an `'uploading'` row has an object
    behind it.** Check the object exists before dispatching a transcription.
  * **The IndexedDB blob is never discarded in this track**, by design, because
    nothing reaches `completed`.
  * **Not built from surface 02b:** the expanded jot pane (no schema home for
    "rough notes"), drag/snap-to-corner (caption rendered, behaviour not built),
    `OPEN FULL PANE` (surface 02), `CHANGE PERSONA` at capture time.
  * **Not built at all:** the full encrypted 48-hour backup buffer (Core UX/UI
    phase), transcription (Track 3), playback, note deletion, resume-upload
    after a failure (the retry re-records).
  * **Safari is implemented but unverified**, unless Section C of the manual
    protocol was actually run — in which case paste what it returned.
  * **`getDisplayMedia` asks for `video: true`** and stops the track
    immediately, because Chromium withholds tab audio otherwise. Worth recording
    so nobody "cleans it up" later.

- [ ] **Step 2: Add a short `## Recorder` section to `CLAUDE.md`,** after
  `## Data`. Keep it to the rules a future contributor would otherwise get
  wrong:

```markdown
## Recorder

The HUD is mounted once in `app/layout.tsx` and the Zustand store in
`lib/recorder/recorder-store.ts` lives at **module scope**. Neither is allowed
to move into a route or a provider — a store that resets on navigation defeats
the whole "ambient, not calendar-gated" decision, and there is a test asserting
that importing the module twice yields the same state.

`getDisplayMedia` is called with `video: true` even though nothing records
video. Chromium does not offer tab or system audio for an audio-only display
request. The video track is stopped on arrival.

`MediaRecorder` records the Web Audio destination node's stream, never the mic
stream. That indirection is what lets `replaceMic()` swap a microphone
mid-recording without ending the recording.

The mic constraint is exactly `{ echoCancellation: true }`. Do not add
`noiseSuppression` or `autoGainControl` — ROADMAP §7 rejected extra masking.

The Storage path is `{user_id}/{note_id}`: two segments, that order, no
extension. It is not a naming convention — it is what the three policies in
`storage_audio.sql` check. Never confirm an upload with `download()`; Storage
reads are CDN-cached and return the pre-overwrite body. Use the upload response
or `list()` metadata.

Codec strings are feature-detected through `lib/recorder/codec.ts`. Never
hardcode one.

    node scripts/verify-recorder-upload.mjs   # live upload + note row proof
    node scripts/print-signin-link.mjs        # local sign-in link, magic-link only

Device handoff, real-world echo and Safari cannot be tested here. They have a
runnable checklist: `docs/qa/recorder-manual-test-protocol.md`.
```

- [ ] **Step 3: Commit.**

```bash
git add docs/KNOWN_GAPS.md CLAUDE.md
git commit -m "docs: record what the recorder track shipped and what is still open"
```

---

## Task 15: Final verification gate

Nothing is claimed complete until every command below has been run and its
output pasted. **REQUIRED SUB-SKILL: superpowers:verification-before-completion.**

- [ ] **Step 1:** `npm run typecheck` — expect clean.
- [ ] **Step 2:** `npm run build` — expect success.
- [ ] **Step 3:** `npm test` — expect **64 baseline tests plus this track's,
  zero failures**. State the before and after counts explicitly.
- [ ] **Step 4:** `npx vitest run components/note-detail/__tests__/project-conventions.test.ts`
  — paste the output. This is the guard over `components/recorder/` and
  `lib/recorder/`.
- [ ] **Step 5:** `node scripts/verify-rls.mjs` — expect `PASS`.
- [ ] **Step 6:** `node scripts/verify-storage-rls.mjs` — expect `PASS`.
- [ ] **Step 7:** `node scripts/verify-recorder-upload.mjs` — expect `PASS`.
- [ ] **Step 8:** `git status --short` — expect clean, except for the
  `next dev`-generated block in `CLAUDE.md` if the dev server ran. Commit that
  with the work rather than leaving it uncommitted.
- [ ] **Step 9:** **REQUIRED SUB-SKILL: superpowers:requesting-code-review.**
- [ ] **Step 10:** **REQUIRED SUB-SKILL: superpowers:finishing-a-development-branch.**

---

## Self-review against the spec

| Spec requirement | Task |
|---|---|
| Zustand store: idle/recording/paused, elapsed, mic level, note id, upload status | 2 |
| Persistent HUD mounted at root layout, survives navigation on every route | 11, proven in 12 step 5c |
| `getDisplayMedia` + `getUserMedia` mixed via Web Audio into one `MediaRecorder` | 6, 9 |
| Codec feature detection; real strings confirmed for Chromium; Safari implemented + documented | 3, 12 step 5b, 13 §C |
| Direct upload to `audio-recordings` at `{user_id}/{note_id}` | 7, 12 |
| Server action creating the `notes` row at `'uploading'`, schema read first | 0, 8 |
| `processing_status` never reaches `analyzing`/`completed` in this track | 8 (asserted), 9, 12 |
| Local backup in IndexedDB, discarded only at `completed` | 4, 9, proven in 12 step 5d and 13 §D |
| `devicechange` handling, restart cleanly, don't drop the recording | 5, 6, 9 |
| `echoCancellation: true` only | 6, 13 §B |
| Written runnable manual QA protocol: handoff, echo, Safari | 13 |
| Read surface 02b before writing markup | Done pre-plan; encoded in Task 10 |
| Read `storage_audio.sql` and `notes.sql` first | Done pre-plan; re-proved live in Task 0 |
| Never `download()` after an upload | 7 (tested), 12 |
| Don't add `storage` to `config.toml` `[api] schemas` | Global Constraint 9 |
| Store at layout scope, not per route | 2, 11 |
| Blob in IndexedDB, not component state or a module variable | 4 |
| Feature-detect codecs, don't hardcode | 3 |
| Every colour a token in `components/recorder/` | 0, 10 step 6 |
| Never filter by `user_id` in the action | 8 |
| All builds/tests/scripts pass, no regression from 64 tests | 15 |
| Conditional schema change handled with full migration discipline | 0, 12b |
| KNOWN_GAPS updated | 14 |

**Out-of-scope items confirmed NOT planned:** transcription trigger, Gemini
call, any transition to `completed`, the 48h encrypted buffer, calendar-gating,
pre-meeting prep, restyling the notes list, persona selection at capture, a
mic-only mode.
