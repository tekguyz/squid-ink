# Transcription Pipeline (Track 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `CRON_SECRET`-gated Vercel Cron sweep that transcribes recordings sitting at `processing_status = 'uploading'` with Gemini 3.5 Transcribe, writes `notes.raw_transcript` plus speaker-tagged `note_chunks`, and reconciles both stale-row classes to `'failed'` — using `processing_status` itself as the only queue.

**Architecture:** One route handler builds the real ports (secret-key Supabase client, Gemini transcriber) and hands them to a pure-ish `sweep()` that owns all branching. Every side effect the sweep performs is an injected function, so the whole state machine — atomic claim, object-existence check, staleness thresholds, per-run caps — is unit-testable with no network and no database. Gemini's wire format is confined to `gemini-client.ts`; everything downstream sees `TranscriptionResult`.

**Tech Stack:** Next.js 16.3.3 App Router route handler (Node runtime, the default), `@supabase/supabase-js` 2.112.4 with the secret key, `@google/genai` 2.19.0 (new pinned dependency), Vitest 4.1.11.

**Spec:** The Track 3 prompt pack supplied in the originating session, reproduced in condensed form under "Spec coverage" at the foot of this plan. Read `docs/KNOWN_GAPS.md` §"A failed upload strands TWO things" for the reconciliation decision this plan implements.

---

## Global Constraints

Copied verbatim from `CLAUDE.md` and the spec. Every task's requirements implicitly include this section.

- **Exact pins, no `^` or `~`.** The one new dependency is `@google/genai` at exactly `2.19.0` (verified against the live npm registry `latest` dist-tag on 2026-08-31: `npm view @google/genai dist-tags` → `{ next: '2.9.0-rc.0', latest: '2.19.0' }`). Add it to the `CLAUDE.md` pin table.
- **Every colour is a `var()`.** Not applicable here — no UI ships in this track — but `components/note-detail/__tests__/project-conventions.test.ts` scans `lib/` for `oklch(|#hex|rgb(|hsl(` and will fail the build on a match. No colour literals in `lib/transcription/`.
- **Soft ceiling 250 lines, hard ceiling 400**, enforced by the same test across `components/` and `lib/`.
- **The application has no confirmed public name.** No name string anywhere in code or copy.
- **Schema-file-first, no exceptions.** Never paste DDL into `db query` as an inline argument. Edit `supabase/schemas/notes.sql`, then apply that exact file with `db query --linked --file`. Inline `db query` is for `select` verification only. Never call `apply_migration` while iterating.
- **Never call `apply_migration`.** Use `migration new` → `cat` the schema files in order → `migration repair --status applied` → `migration list --linked`, and verify with `git hash-object`.
- **RLS is not in scope and gets no new policy.** The cron path uses the secret key and bypasses RLS entirely. Do not add, edit, or remove a policy on `notes` or `note_chunks`.
- **Never confirm a Storage write with `download()`.** Object *existence* is proved with `list()` metadata. `download()` appears exactly once in this track, and only to fetch bytes to send to Gemini — never to prove anything.
- **The Storage path is `{user_id}/{note_id}`** — two segments, that order, no extension.
- **Secret key confined to exactly two files:** `scripts/verify-rls.mjs` and `app/api/cron/transcribe/route.ts`. Never `NEXT_PUBLIC_`-prefixed.
- **Do not touch** `components/note-detail/`, `lib/recorder/`, or any RLS policy definition.
- **Measured platform ceilings (see "Measured facts" below):** Vercel Hobby → cron fires **once per day**, function `maxDuration` **300 s**.

---

## Measured facts this plan is built on

Every one of these was measured on 2026-08-31, not recalled. Re-measure rather than trusting this list.

| Fact | Value | How it was measured |
|---|---|---|
| Vercel team plan | `hobby` | `GET https://api.vercel.com/v2/teams` with the CLI token → `teams[0] = { slug: tekguyz, billing.plan: hobby }` |
| Vercel cron floor (Hobby) | **once per day**; more frequent expressions **fail deployment** | `vercel.com/docs/cron-jobs/manage-cron-jobs` § Cron jobs accuracy |
| Vercel `maxDuration` (Hobby, fluid compute) | **300 s** default *and* maximum; no extension available | `vercel.com/docs/functions/configuring-functions/duration` § Duration limits |
| Vercel cron auth | env var `CRON_SECRET`; Vercel sends it as `Authorization: Bearer <value>` | same docs page § Securing cron jobs, code sample quoted verbatim in Task 7 |
| Vercel env vars already set | only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `npx vercel env ls --project squid-ink --scope tekguyz` |
| Gemini model id | `gemini-3.5-transcribe` | `ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe` |
| Gemini audio caps | 1 h plain; **30 min** when diarization *or* word timestamps is on | same page |
| Gemini JS config casing | **snake_case** — `generation_config.transcription_config.mode.diarization_mode` | `ai.google.dev/gemini-api/docs/transcribe`, JS sample |
| Gemini incompatibility | `custom_vocabulary` is rejected alongside diarization **or** timestamps (HTTP 400) | Google AI forum thread 180240; diarization + word timestamps *together* is confirmed working |
| Live check constraint | `notes_processing_status_check`, four values, no `'failed'` | `npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select conname, pg_get_constraintdef(oid) …"` |
| `notes.audio_duration_seconds` | **already written** by Track 2 | `app/notes/actions.ts:51` writes `Math.floor(input.durationSeconds)`; `lib/recorder/use-recorder.ts:139` derives it from `state.elapsedMs / 1000` |
| Tier-1 `'failed'` write | **does not exist anywhere in the tree** | `grep -rn "failed" app lib --include=*.ts` returns only comments and `store.getState().fail(...)`, which is client state, not a database write |

**Two consequences the spec did not anticipate, both resolved below:**

1. **The conditional Track 2 edit is NOT needed.** `audio_duration_seconds` is populated. Task 6 still treats `null` defensively, but no `lib/recorder/` file is touched.
2. **Tier 1 stays unbuilt.** `docs/KNOWN_GAPS.md` assigns the in-session `'failed'` write to Track 3, but the spec's scope fence forbids touching `lib/recorder/`. The fence wins; this track ships the check constraint that unblocks it and records the gap with a named owner. See Task 9.

---

## File Structure

**Create**

| File | Responsibility |
|---|---|
| `lib/transcription/diarization-policy.ts` | Pure `durationSeconds → TranscriptionPlan`. Owns the 28-minute and 60-minute thresholds and nothing else. |
| `lib/transcription/transcript.ts` | The domain vocabulary every other module speaks: `TranscriptSegment`, `TranscriptionResult`, `Transcriber`. Plus two pure formatters — speaker-token mapping and `mm:ss`. No Gemini types, no I/O. |
| `lib/transcription/gemini-client.ts` | The **only** module that knows Gemini's wire format. Wire types, the pure `segmentsFromInteraction()` parser, and `createGeminiTranscriber()`. The SDK is `await import`ed lazily so the parser is testable without loading it. |
| `lib/transcription/persist-result.ts` | Writes `note_chunks` then flips `notes` to `'completed'`; and the single `markFailed()` used by every failure path. |
| `lib/transcription/sweep.ts` | All orchestration and all branching: candidate queries, atomic claim, existence check, staleness, caps, wall-clock budget. Every side effect is an injected port. |
| `app/api/cron/transcribe/route.ts` | `CRON_SECRET` gate, then builds the real ports and calls `sweep()`. The only application file that reads `SUPABASE_SECRET_KEY` or `GEMINI_API_KEY`. |
| `vercel.json` | Cron schedule and the function duration cap. Does not exist yet. |
| `scripts/verify-transcription-pipeline.mjs` | Live proof against the linked project. |
| `lib/transcription/__tests__/*.test.ts` | Four test files, one per `lib/transcription/` module. |
| `app/api/cron/transcribe/__tests__/route.test.ts` | The auth gate. |

**Deliberate deviation from the spec's file list:** the spec named one `gemini-client.ts`. This plan splits the *domain* vocabulary into `transcript.ts` so that `sweep.ts` and `persist-result.ts` can import types without importing a module that reaches for the Gemini SDK. That is what makes "the rest of the pipeline must not know Gemini's wire format" literally true rather than merely intended, and it keeps both files under the 250-line soft ceiling. Record this in the final report.

**Modify**

| File | Change |
|---|---|
| `supabase/schemas/notes.sql` | `'failed'` into the check constraint, twice — the inline `create table` form for a fresh database, and an idempotent `drop constraint / add constraint` pair for the existing one. |
| `lib/notes/types.ts` | `ProcessingStatus` gains `"failed"`; `ChunkMetadata` gains `ts_start_seconds` / `ts_end_seconds`. |
| `package.json` | `@google/genai` at `2.19.0`. |
| `CLAUDE.md` | New `## Transcription` section; the pin table; the secret-key amendment. |
| `docs/DEPLOYMENT.md` | `GEMINI_API_KEY`, `CRON_SECRET`, `SUPABASE_SECRET_KEY`, the cron schedule, the measured Hobby ceilings. |
| `docs/KNOWN_GAPS.md` | Resolve the two reconciliation entries **in place**; add four new gaps. |

---

## Task 1: `'failed'` in the check constraint

**Files:**
- Modify: `supabase/schemas/notes.sql:14-15`
- Modify: `lib/notes/types.ts:13`
- Create: `supabase/migrations/<timestamp>_transcription_failed_status.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `processing_status` may now hold `'failed'`. `ProcessingStatus = "local" | "uploading" | "analyzing" | "completed" | "failed"`.

- [ ] **Step 1: Edit the inline constraint in the schema file**

In `supabase/schemas/notes.sql`, replace lines 14-15:

```sql
  processing_status text not null default 'local'
    check (processing_status in ('local', 'uploading', 'analyzing', 'completed')),
```

with:

```sql
  -- 'failed' is terminal, and is reached two ways: a stale 'uploading' row
  -- whose Storage object never appeared, and a stale 'analyzing' row whose
  -- transcription function died mid-flight. Both are written by the sweep in
  -- lib/transcription/sweep.ts. There is deliberately no error-message column
  -- -- failures are logged to the Vercel function log, and no UI consumes them
  -- at single-owner scale.
  processing_status text not null default 'local'
    check (processing_status in
      ('local', 'uploading', 'analyzing', 'completed', 'failed')),
```

- [ ] **Step 2: Add the idempotent alter for the existing table**

`create table if not exists` is a no-op against the linked project, so the inline
edit above lands only on a fresh database. Insert this immediately after the
`create table` statement (before the `create index` block):

```sql
-- The table already exists in the linked project, so the inline check above is
-- a no-op there. This is how 'failed' actually lands. Postgres has no
-- if-not-exists for constraints, so drop-then-add -- both statements are
-- idempotent, which is what lets this whole file be re-applied after an edit.
--
-- The constraint name is not guessed. It was read back from the live catalog
-- on 2026-08-31: pg_constraint holds exactly one check constraint on
-- public.notes, named notes_processing_status_check.
alter table public.notes
  drop constraint if exists notes_processing_status_check;
alter table public.notes
  add constraint notes_processing_status_check
  check (processing_status in
    ('local', 'uploading', 'analyzing', 'completed', 'failed'));
```

- [ ] **Step 3: Apply the schema file to the linked project**

Run:

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn --file supabase/schemas/notes.sql
```

Expected: no error. Paste the output into the final report.

- [ ] **Step 4: Read the constraint back from the live catalog**

`db diff` is unavailable without Docker, so the catalog is the proof.

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.notes'::regclass and contype = 'c'"
```

Expected: `def` contains `'failed'::text` alongside `'local'`, `'uploading'`, `'analyzing'`, `'completed'`. Paste the output.

- [ ] **Step 5: Prove the constraint actually rejects a bad value and accepts `'failed'`**

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select 'failed'::text = any(array['local','uploading','analyzing','completed','failed']) as accepts_failed, 'bogus'::text = any(array['local','uploading','analyzing','completed','failed']) as accepts_bogus"
```

Expected: `accepts_failed = true`, `accepts_bogus = false`. This is a cheap sanity read; the real proof is Step 4's `pg_get_constraintdef`.

- [ ] **Step 6: Widen the TypeScript union**

In `lib/notes/types.ts`, replace line 13:

```ts
export type ProcessingStatus = "local" | "uploading" | "analyzing" | "completed";
```

with:

```ts
/** Mirrors the check constraint in supabase/schemas/notes.sql. 'failed' is
 *  terminal and is written only by lib/transcription/sweep.ts. */
export type ProcessingStatus =
  | "local"
  | "uploading"
  | "analyzing"
  | "completed"
  | "failed";
```

Also extend `ChunkMetadata` — find the `ts_start?: string;` / `ts_end?: string;` pair (around line 33) and add two numeric fields directly beneath them:

```ts
  ts_start?: string;
  ts_end?: string;
  /** The same instants as ts_start / ts_end, unrounded, in seconds. The string
   *  pair above is a DISPLAY value -- note-view-model.ts renders it verbatim --
   *  so it cannot also carry precision. Written by the transcription pipeline;
   *  nothing reads these yet. */
  ts_start_seconds?: number;
  ts_end_seconds?: number;
```

- [ ] **Step 7: Verify nothing switched exhaustively on the old union**

Run:

```bash
npx tsc --noEmit
```

Expected: clean. (`note-view-model.ts` never reads `processing_status`, so widening the union is safe — confirmed by grep on 2026-08-31.)

- [ ] **Step 8: Write the migration**

```bash
npx supabase migration new transcription_failed_status
```

Then fill the generated file with the exact schema file:

```bash
cat supabase/schemas/notes.sql > supabase/migrations/<timestamp>_transcription_failed_status.sql
```

- [ ] **Step 9: Prove the migration and the schema file are byte-identical**

```bash
git hash-object supabase/schemas/notes.sql supabase/migrations/<timestamp>_transcription_failed_status.sql
```

Expected: two identical hashes. Paste them.

- [ ] **Step 10: Repair the migration history and confirm**

The DDL is already applied (Step 3), so record it as applied rather than running it again:

```bash
npx supabase migration repair --linked --project-ref pbwvvakzbrimmdntqxxn --status applied <timestamp>
```

```bash
npx supabase migration list --linked --project-ref pbwvvakzbrimmdntqxxn
```

Expected: the new timestamp appears in both Local and Remote columns. Paste the output.

- [ ] **Step 11: Commit**

```bash
git add supabase/schemas/notes.sql supabase/migrations lib/notes/types.ts
git commit -m "feat(db): allow processing_status = 'failed'"
```

---

## Task 2: Diarization threshold

**Files:**
- Create: `lib/transcription/diarization-policy.ts`
- Test: `lib/transcription/__tests__/diarization-policy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DIARIZATION_MAX_SECONDS: 1680`
  - `PLAIN_MAX_SECONDS: 3600`
  - `type TranscriptionPlan = { kind: "diarized" } | { kind: "plain"; reason: string } | { kind: "too-long"; reason: string }`
  - `planFor(durationSeconds: number | null): TranscriptionPlan`

- [ ] **Step 1: Write the failing test**

Create `lib/transcription/__tests__/diarization-policy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  planFor,
  DIARIZATION_MAX_SECONDS,
  PLAIN_MAX_SECONDS,
} from "@/lib/transcription/diarization-policy";

describe("planFor", () => {
  it("diarizes at 27 minutes", () => {
    expect(planFor(27 * 60).kind).toBe("diarized");
  });

  it("diarizes exactly at the 28-minute threshold", () => {
    expect(planFor(28 * 60).kind).toBe("diarized");
    expect(DIARIZATION_MAX_SECONDS).toBe(28 * 60);
  });

  it("drops to plain one second past the threshold", () => {
    expect(planFor(28 * 60 + 1).kind).toBe("plain");
  });

  it("drops to plain at 29 minutes", () => {
    expect(planFor(29 * 60).kind).toBe("plain");
  });

  it("still transcribes plain at Gemini's own 60-minute cap", () => {
    expect(planFor(PLAIN_MAX_SECONDS).kind).toBe("plain");
    expect(PLAIN_MAX_SECONDS).toBe(60 * 60);
  });

  it("refuses one second past the 60-minute cap", () => {
    const plan = planFor(PLAIN_MAX_SECONDS + 1);
    expect(plan.kind).toBe("too-long");
    if (plan.kind !== "too-long") throw new Error("unreachable");
    expect(plan.reason).toContain("3601");
  });

  it("falls back to plain when the duration is unknown", () => {
    const plan = planFor(null);
    expect(plan.kind).toBe("plain");
    if (plan.kind !== "plain") throw new Error("unreachable");
    expect(plan.reason).toContain("unknown");
  });

  it("treats a zero or negative duration as unknown, not as diarizable", () => {
    expect(planFor(0).kind).toBe("plain");
    expect(planFor(-5).kind).toBe("plain");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run lib/transcription/__tests__/diarization-policy.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/transcription/diarization-policy"`.

- [ ] **Step 3: Write the implementation**

Create `lib/transcription/diarization-policy.ts`:

```ts
/** Whether a recording gets diarized, and whether it gets transcribed at all.
 *
 *  A pure function of duration, deliberately. Diarization is a processing
 *  OUTCOME, not a user setting -- notes.diarization_enabled has no UI toggle
 *  and must not grow one.
 *
 *  Both ceilings are Gemini's, not ours, and were read from
 *  ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe on 2026-08-31:
 *  one hour per request, dropping to thirty minutes the moment speaker
 *  diarization or word-level timestamps is enabled. We ask for both together,
 *  so the diarized path lives under the thirty-minute cap.
 *
 *  28 minutes rather than 30 is a deliberate safety margin. Our duration is the
 *  recorder's elapsed clock, which is not the decoded length of the container
 *  Gemini receives; a container that reports a little long would otherwise be
 *  rejected at the cap with nothing to show for the call. */

/** Diarize at or below this. 28 min, two minutes under Gemini's 30-min
 *  diarized cap. */
export const DIARIZATION_MAX_SECONDS = 28 * 60;

/** Gemini's plain-transcription cap. Past this we do not call at all. */
export const PLAIN_MAX_SECONDS = 60 * 60;

export type TranscriptionPlan =
  | { kind: "diarized" }
  | { kind: "plain"; reason: string }
  | { kind: "too-long"; reason: string };

export function planFor(durationSeconds: number | null): TranscriptionPlan {
  // Unknown, zero and negative all mean "the recorder did not tell us". Plain
  // is the safe answer: it succeeds for anything up to an hour, whereas a
  // wrongly-optimistic diarized call hard-fails at thirty minutes and we have
  // spent the upload for nothing. A degraded success beats a confident failure.
  if (durationSeconds === null || durationSeconds <= 0) {
    return {
      kind: "plain",
      reason: "duration unknown, defaulting to plain transcription",
    };
  }

  if (durationSeconds <= DIARIZATION_MAX_SECONDS) return { kind: "diarized" };

  if (durationSeconds <= PLAIN_MAX_SECONDS) {
    return {
      kind: "plain",
      reason:
        `${durationSeconds}s exceeds the ${DIARIZATION_MAX_SECONDS}s ` +
        `diarization threshold`,
    };
  }

  // No segmentation and no stitching. ROADMAP defers both explicitly at
  // single-owner scale, so the honest outcome is a clear failure with a log
  // line naming the reason -- not a silently truncated transcript.
  return {
    kind: "too-long",
    reason:
      `${durationSeconds}s exceeds Gemini's ${PLAIN_MAX_SECONDS}s cap; ` +
      `segmentation is not implemented`,
  };
}
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run lib/transcription/__tests__/diarization-policy.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/transcription/diarization-policy.ts lib/transcription/__tests__/diarization-policy.test.ts
git commit -m "feat(transcription): diarization threshold as a pure function"
```

---

## Task 3: Domain vocabulary and formatters

**Files:**
- Create: `lib/transcription/transcript.ts`
- Test: `lib/transcription/__tests__/transcript.test.ts`

**Interfaces:**
- Consumes: `SpeakerToken` from `@/lib/notes/view-types`.
- Produces:
  - `interface TranscriptSegment { speakerLabel: string | null; startSeconds: number; endSeconds: number; text: string }`
  - `interface TranscriptionResult { rawTranscript: string; segments: TranscriptSegment[]; diarized: boolean }`
  - `interface TranscribeRequest { audio: Blob; mimeType: string; diarize: boolean }`
  - `type Transcriber = (request: TranscribeRequest) => Promise<TranscriptionResult>`
  - `speakerFor(label: string | null): { name: string; initials: string; token: SpeakerToken } | null`
  - `formatTimestamp(seconds: number): string`

- [ ] **Step 1: Write the failing test**

Create `lib/transcription/__tests__/transcript.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { speakerFor, formatTimestamp } from "@/lib/transcription/transcript";

describe("speakerFor", () => {
  it("maps Gemini's spk_1 onto the first speaker token", () => {
    expect(speakerFor("spk_1")).toEqual({
      name: "Speaker 1",
      initials: "S1",
      token: "speaker-1",
    });
  });

  it("maps spk_2 and spk_3 onto the remaining tokens", () => {
    expect(speakerFor("spk_2")?.token).toBe("speaker-2");
    expect(speakerFor("spk_3")?.token).toBe("speaker-3");
  });

  it("cycles past the third token but keeps the real speaker number", () => {
    // Only three colour tokens exist in globals.css and Tailwind cannot build
    // a class name at runtime, so a fourth speaker must reuse a colour. The
    // NAME must still say 4 -- colour collision is cosmetic, a wrong name is a
    // lie about who spoke.
    expect(speakerFor("spk_4")).toEqual({
      name: "Speaker 4",
      initials: "S4",
      token: "speaker-1",
    });
    expect(speakerFor("spk_8")?.token).toBe("speaker-2");
    expect(speakerFor("spk_8")?.name).toBe("Speaker 8");
  });

  it("returns null for a missing label, not a fabricated speaker", () => {
    expect(speakerFor(null)).toBeNull();
  });

  it("returns null for a label with no number in it", () => {
    expect(speakerFor("unknown")).toBeNull();
  });
});

describe("formatTimestamp", () => {
  it("renders mm:ss with a leading zero", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(9)).toBe("00:09");
    expect(formatTimestamp(75)).toBe("01:15");
  });

  it("truncates fractional seconds rather than rounding up past the minute", () => {
    expect(formatTimestamp(59.9)).toBe("00:59");
  });

  it("grows an hour field only once there is an hour", () => {
    expect(formatTimestamp(3599)).toBe("59:59");
    expect(formatTimestamp(3600)).toBe("1:00:00");
    expect(formatTimestamp(3661)).toBe("1:01:01");
  });

  it("clamps a negative offset to zero", () => {
    expect(formatTimestamp(-1)).toBe("00:00");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run lib/transcription/__tests__/transcript.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/transcription/transcript.ts`:

```ts
import type { SpeakerToken } from "@/lib/notes/view-types";

/** The vocabulary every module downstream of the transcriber speaks.
 *
 *  Nothing here knows Gemini exists. That is the point: gemini-client.ts is the
 *  only file that may import the SDK or name a wire field, so swapping the
 *  provider is a one-file change. */

export interface TranscriptSegment {
  /** The provider's own label, e.g. "spk_1". Null when not diarized. */
  speakerLabel: string | null;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface TranscriptionResult {
  rawTranscript: string;
  segments: TranscriptSegment[];
  /** What actually happened, not what was requested. */
  diarized: boolean;
}

export interface TranscribeRequest {
  audio: Blob;
  mimeType: string;
  diarize: boolean;
}

export type Transcriber = (
  request: TranscribeRequest,
) => Promise<TranscriptionResult>;

/** globals.css defines exactly three speaker tokens, and
 *  components/note-detail/speaker-colors.ts is a static lookup because Tailwind
 *  cannot build a class name at runtime. Gemini diarizes up to eight speakers,
 *  so past the third the colour cycles.
 *
 *  The cycle is cosmetic and deliberate: two speakers sharing a colour is a
 *  legibility cost, whereas renaming Speaker 4 to Speaker 1 would be the page
 *  asserting something false about who spoke. */
const SPEAKER_TOKENS: readonly SpeakerToken[] = [
  "speaker-1",
  "speaker-2",
  "speaker-3",
];

export function speakerFor(
  label: string | null,
): { name: string; initials: string; token: SpeakerToken } | null {
  if (!label) return null;

  const digits = /(\d+)\s*$/.exec(label);
  if (!digits) return null;

  const n = Number(digits[1]);
  if (!Number.isFinite(n) || n < 1) return null;

  return {
    name: `Speaker ${n}`,
    initials: `S${n}`,
    token: SPEAKER_TOKENS[(n - 1) % SPEAKER_TOKENS.length],
  };
}

/** A DISPLAY value. note-view-model.ts renders metadata.ts_start verbatim, so
 *  this must already be human-readable -- which is exactly why the unrounded
 *  seconds are stored separately in ts_start_seconds. */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const s = String(total % 60).padStart(2, "0");
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);

  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${s}`;
  return `${String(m).padStart(2, "0")}:${s}`;
}
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run lib/transcription/__tests__/transcript.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/transcription/transcript.ts lib/transcription/__tests__/transcript.test.ts
git commit -m "feat(transcription): provider-neutral transcript vocabulary"
```

---

## Task 4: Gemini wrapper

**Files:**
- Create: `lib/transcription/gemini-client.ts`
- Test: `lib/transcription/__tests__/gemini-client.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `TranscriptSegment`, `TranscriptionResult`, `TranscribeRequest`, `Transcriber` from `@/lib/transcription/transcript`.
- Produces:
  - `segmentsFromInteraction(interaction: GeminiInteraction): TranscriptSegment[]` — pure, exported for tests
  - `parseOffsetSeconds(offset: string | undefined): number | null` — pure, exported for tests
  - `createGeminiTranscriber(apiKey: string): Transcriber`
  - `GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-transcribe"`

- [ ] **Step 1: Install the pinned dependency**

```bash
npm install --save-exact @google/genai@2.19.0
```

Confirm the pin is exact (no `^`):

```bash
node -e "console.log(require('./package.json').dependencies['@google/genai'])"
```

Expected: `2.19.0`.

- [ ] **Step 2: Write the failing test**

Only the pure parser is tested here. The SDK call itself is plumbing — the spec
scopes TDD to the claim logic, the threshold functions and the branching, and a
mocked SDK call would assert nothing but the mock.

Create `lib/transcription/__tests__/gemini-client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  segmentsFromInteraction,
  parseOffsetSeconds,
} from "@/lib/transcription/gemini-client";

/** Shaped exactly like the documented response:
 *  ai.google.dev/gemini-api/docs/transcribe, § speaker diarization. */
function interaction(
  words: { text: string; speaker?: string; from: string; to: string }[],
) {
  return {
    output_text: words.map((w) => w.text).join(" "),
    steps: [
      {
        content: [
          {
            annotations: words.map((w) => ({
              type: "word_info",
              text: w.text,
              speaker: w.speaker,
              start_offset: w.from,
              end_offset: w.to,
            })),
          },
        ],
      },
    ],
  };
}

describe("parseOffsetSeconds", () => {
  it("strips the trailing s", () => {
    expect(parseOffsetSeconds("0.450s")).toBe(0.45);
    expect(parseOffsetSeconds("12s")).toBe(12);
  });

  it("accepts a bare number", () => {
    expect(parseOffsetSeconds("3.5")).toBe(3.5);
  });

  it("returns null rather than NaN for junk or absence", () => {
    expect(parseOffsetSeconds(undefined)).toBeNull();
    expect(parseOffsetSeconds("")).toBeNull();
    expect(parseOffsetSeconds("later")).toBeNull();
  });
});

describe("segmentsFromInteraction", () => {
  it("groups consecutive words by speaker into one segment", () => {
    const segments = segmentsFromInteraction(
      interaction([
        { text: "Hello", speaker: "spk_1", from: "0s", to: "0.5s" },
        { text: "there", speaker: "spk_1", from: "0.5s", to: "1s" },
        { text: "Hi", speaker: "spk_2", from: "1.2s", to: "1.6s" },
      ]),
    );

    expect(segments).toEqual([
      { speakerLabel: "spk_1", startSeconds: 0, endSeconds: 1, text: "Hello there" },
      { speakerLabel: "spk_2", startSeconds: 1.2, endSeconds: 1.6, text: "Hi" },
    ]);
  });

  it("starts a new segment when the same speaker returns", () => {
    const segments = segmentsFromInteraction(
      interaction([
        { text: "A", speaker: "spk_1", from: "0s", to: "1s" },
        { text: "B", speaker: "spk_2", from: "1s", to: "2s" },
        { text: "C", speaker: "spk_1", from: "2s", to: "3s" },
      ]),
    );

    expect(segments.map((s) => s.text)).toEqual(["A", "B", "C"]);
    expect(segments.map((s) => s.speakerLabel)).toEqual([
      "spk_1",
      "spk_2",
      "spk_1",
    ]);
  });

  it("keeps one segment when nothing is diarized", () => {
    const segments = segmentsFromInteraction(
      interaction([
        { text: "One", from: "0s", to: "1s" },
        { text: "two", from: "1s", to: "2s" },
      ]),
    );

    expect(segments).toEqual([
      { speakerLabel: null, startSeconds: 0, endSeconds: 2, text: "One two" },
    ]);
  });

  it("breaks a long monologue at a pause", () => {
    // Without this, one speaker talking for twenty minutes is ONE chunk of a
    // few thousand words -- useless to render and useless to retrieve. A gap
    // between words is the cheapest honest sentence boundary available; we do
    // not get punctuation offsets.
    const segments = segmentsFromInteraction(
      interaction([
        { text: "One", speaker: "spk_1", from: "0s", to: "1s" },
        { text: "two", speaker: "spk_1", from: "1.1s", to: "2s" },
        { text: "Three", speaker: "spk_1", from: "9s", to: "10s" },
      ]),
    );

    expect(segments.map((s) => s.text)).toEqual(["One two", "Three"]);
    expect(segments[1].startSeconds).toBe(9);
  });

  it("does not break on a pause shorter than the threshold", () => {
    const segments = segmentsFromInteraction(
      interaction([
        { text: "One", speaker: "spk_1", from: "0s", to: "1s" },
        { text: "two", speaker: "spk_1", from: "2.4s", to: "3s" },
      ]),
    );

    expect(segments).toHaveLength(1);
  });

  it("returns no segments when there are no annotations at all", () => {
    expect(
      segmentsFromInteraction({ output_text: "Some text", steps: [] }),
    ).toEqual([]);
  });

  it("survives a response with missing steps, content or annotations", () => {
    expect(segmentsFromInteraction({ output_text: "x" })).toEqual([]);
    expect(segmentsFromInteraction({ output_text: "x", steps: [{}] })).toEqual(
      [],
    );
    expect(
      segmentsFromInteraction({ output_text: "x", steps: [{ content: [{}] }] }),
    ).toEqual([]);
  });

  it("skips a word with an unreadable offset rather than emitting NaN", () => {
    const segments = segmentsFromInteraction({
      output_text: "good bad",
      steps: [
        {
          content: [
            {
              annotations: [
                {
                  type: "word_info",
                  text: "good",
                  speaker: "spk_1",
                  start_offset: "0s",
                  end_offset: "1s",
                },
                { type: "word_info", text: "bad", speaker: "spk_1" },
              ],
            },
          ],
        },
      ],
    });

    expect(segments).toEqual([
      { speakerLabel: "spk_1", startSeconds: 0, endSeconds: 1, text: "good" },
    ]);
  });

  it("ignores annotations that are not word_info", () => {
    const segments = segmentsFromInteraction({
      output_text: "x",
      steps: [
        {
          content: [
            {
              annotations: [
                { type: "something_else", text: "ignore me" },
                {
                  type: "word_info",
                  text: "keep",
                  start_offset: "0s",
                  end_offset: "1s",
                },
              ],
            },
          ],
        },
      ],
    });

    expect(segments.map((s) => s.text)).toEqual(["keep"]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run lib/transcription/__tests__/gemini-client.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

Create `lib/transcription/gemini-client.ts`:

```ts
import type {
  TranscribeRequest,
  Transcriber,
  TranscriptSegment,
  TranscriptionResult,
} from "@/lib/transcription/transcript";

/** The ONLY module that knows Gemini's wire format.
 *
 *  Everything below the interface boundary speaks TranscriptionResult, so
 *  replacing the provider is a change to this file and nothing else.
 *
 *  Shapes below were read from ai.google.dev/gemini-api/docs/transcribe on
 *  2026-08-31, not recalled. Two details are load-bearing and were verified
 *  rather than assumed:
 *
 *  1. The JavaScript SDK takes the config in SNAKE_case -- generation_config,
 *     transcription_config, diarization_mode, mime_type. It does not
 *     camel-case them the way most Google JS SDKs do.
 *  2. custom_vocabulary is REJECTED with HTTP 400 alongside either diarization
 *     or timestamps (Google AI forum thread 180240). We never send it. Do not
 *     add speech biasing here without re-testing that combination.
 *
 *  Diarization and word-level timestamps together are confirmed working, and
 *  are requested together: without timestamps the speaker labels have nothing
 *  to attach to. Both features drop Gemini's audio cap from 60 to 30 minutes,
 *  which is what lib/transcription/diarization-policy.ts exists to respect. */

export const GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-transcribe";

interface GeminiAnnotation {
  type?: string;
  text?: string;
  speaker?: string;
  start_offset?: string;
  end_offset?: string;
}

interface GeminiContent {
  annotations?: GeminiAnnotation[];
}

interface GeminiStep {
  content?: GeminiContent[];
}

export interface GeminiInteraction {
  output_text?: string;
  steps?: GeminiStep[];
}

/** Offsets arrive as protobuf duration strings -- "0.450s". A bare number is
 *  accepted too, because the shape is documented loosely enough that it is
 *  cheaper to tolerate than to be surprised by in production. */
export function parseOffsetSeconds(offset: string | undefined): number | null {
  if (!offset) return null;
  const value = Number(offset.endsWith("s") ? offset.slice(0, -1) : offset);
  return Number.isFinite(value) ? value : null;
}

/** A silence at least this long starts a new segment even when the speaker has
 *  not changed. Without it, one person talking for twenty minutes becomes a
 *  single chunk of several thousand words -- unreadable in the transcript pane
 *  and useless as a retrieval unit later. Gemini gives word offsets and no
 *  punctuation offsets, so a pause is the only sentence boundary on offer. */
const SEGMENT_GAP_SECONDS = 2.5;

/** Gemini returns WORDS, not segments. Grouping consecutive words that share a
 *  speaker is what turns that into something a transcript pane can render, and
 *  it is the only real logic in this file -- which is why it is pure, exported,
 *  and tested without the SDK. */
export function segmentsFromInteraction(
  interaction: GeminiInteraction,
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;

  for (const step of interaction.steps ?? []) {
    for (const content of step.content ?? []) {
      for (const annotation of content.annotations ?? []) {
        if (annotation.type !== "word_info") continue;

        const text = annotation.text?.trim();
        const start = parseOffsetSeconds(annotation.start_offset);
        const end = parseOffsetSeconds(annotation.end_offset);

        // A word with no readable timing cannot be placed. Dropping it loses
        // one token; keeping it would put NaN into a jsonb column that
        // note-view-model.ts renders directly.
        if (!text || start === null || end === null) continue;

        const speakerLabel = annotation.speaker ?? null;

        const sameSpeaker = current && current.speakerLabel === speakerLabel;
        const continuous =
          current && start - current.endSeconds < SEGMENT_GAP_SECONDS;

        if (current && sameSpeaker && continuous) {
          current.text += ` ${text}`;
          current.endSeconds = end;
          continue;
        }

        current = { speakerLabel, startSeconds: start, endSeconds: end, text };
        segments.push(current);
      }
    }
  }

  return segments;
}

function transcriptionConfig(diarize: boolean) {
  // Verbatim, not smart: smart mode rewrites disfluencies, and a meeting
  // transcript that quietly edits what somebody said is worse than an untidy
  // one. custom_vocabulary is deliberately absent -- see the header.
  if (!diarize) return { mode: { type: "verbatim" } };

  return {
    mode: {
      type: "verbatim",
      diarization_mode: "speaker",
      timestamp_granularities: ["word"],
    },
  };
}

export function createGeminiTranscriber(apiKey: string): Transcriber {
  return async ({
    audio,
    mimeType,
    diarize,
  }: TranscribeRequest): Promise<TranscriptionResult> => {
    // Imported lazily so that the pure parser above can be unit-tested without
    // loading the SDK, and so the SDK never reaches a client bundle by
    // accident.
    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({ apiKey });

    // The File API, not inline bytes. A thirty-minute recording is tens of
    // megabytes and would not survive a JSON request body.
    const uploaded = await client.files.upload({
      file: audio,
      config: { mimeType },
    });

    if (!uploaded.uri) {
      throw new Error("Gemini file upload returned no uri");
    }

    const interaction = (await client.interactions.create({
      model: GEMINI_TRANSCRIBE_MODEL,
      input: [{ type: "audio", uri: uploaded.uri, mime_type: mimeType }],
      generation_config: { transcription_config: transcriptionConfig(diarize) },
    })) as GeminiInteraction;

    const rawTranscript = interaction.output_text?.trim() ?? "";
    if (!rawTranscript) {
      throw new Error("Gemini returned an empty transcript");
    }

    const segments = segmentsFromInteraction(interaction);

    return {
      rawTranscript,
      segments,
      // What HAPPENED, not what was asked for. A diarized request that comes
      // back with no speaker labels is a plain transcript, and notes
      // .diarization_enabled must record that rather than the intent.
      diarized: diarize && segments.some((s) => s.speakerLabel !== null),
    };
  };
}
```

- [ ] **Step 5: Run the test**

```bash
npx vitest run lib/transcription/__tests__/gemini-client.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 6: Typecheck — this is where an SDK shape mismatch surfaces**

```bash
npx tsc --noEmit
```

Expected: clean. If `files.upload` rejects a `Blob`, or `interactions.create`
rejects `generation_config`, **stop and re-read the SDK's own `.d.ts`** under
`node_modules/@google/genai/dist/`, then fix this file rather than casting the
error away. Record whatever the types actually say in the final report.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/transcription/gemini-client.ts lib/transcription/__tests__/gemini-client.test.ts
git commit -m "feat(transcription): gemini 3.5 transcribe wrapper"
```

---

## Task 5: Persisting a result

**Files:**
- Create: `lib/transcription/persist-result.ts`
- Test: `lib/transcription/__tests__/persist-result.test.ts`

**Interfaces:**
- Consumes: `TranscriptionResult` from `transcript.ts`; `speakerFor`, `formatTimestamp` from `transcript.ts`; `ChunkMetadata` from `@/lib/notes/types`.
- Produces:
  - `interface TranscriptionStore { deleteTranscriptChunks(noteId): Promise<void>; insertChunks(rows): Promise<void>; completeNote(args): Promise<boolean>; markFailed(noteId, reason): Promise<void> }`
  - `chunkRowsFor(args: { noteId; userId; result }): NoteChunkInsert[]` — pure, exported for tests
  - `persistTranscription(args: { store; noteId; userId; result }): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `lib/transcription/__tests__/persist-result.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  chunkRowsFor,
  persistTranscription,
  type TranscriptionStore,
} from "@/lib/transcription/persist-result";
import type { TranscriptionResult } from "@/lib/transcription/transcript";

const NOTE = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

const diarized: TranscriptionResult = {
  rawTranscript: "Hello there Hi",
  diarized: true,
  segments: [
    { speakerLabel: "spk_1", startSeconds: 0, endSeconds: 1, text: "Hello there" },
    { speakerLabel: "spk_2", startSeconds: 1.2, endSeconds: 1.6, text: "Hi" },
  ],
};

function store(): TranscriptionStore & {
  calls: string[];
  rows: unknown[];
} {
  const calls: string[] = [];
  const rows: unknown[] = [];
  return {
    calls,
    rows,
    deleteTranscriptChunks: vi.fn(async () => {
      calls.push("delete");
    }),
    insertChunks: vi.fn(async (r: unknown[]) => {
      calls.push("insert");
      rows.push(...r);
    }),
    completeNote: vi.fn(async () => {
      calls.push("complete");
      return true;
    }),
    markFailed: vi.fn(async () => {
      calls.push("failed");
    }),
  };
}

describe("chunkRowsFor", () => {
  it("writes one transcript_segment row per segment, with embedding null", () => {
    const rows = chunkRowsFor({ noteId: NOTE, userId: USER, result: diarized });

    expect(rows).toHaveLength(2);
    expect(rows[0].note_id).toBe(NOTE);
    expect(rows[0].user_id).toBe(USER);
    expect(rows[0].chunk_type).toBe("transcript_segment");
    expect(rows[0].embedding).toBeNull();
    expect(rows[0].content).toBe("Hello there");
  });

  it("leaves persona_id null — a transcript belongs to no lens", () => {
    const rows = chunkRowsFor({ noteId: NOTE, userId: USER, result: diarized });
    expect(rows.every((r) => r.persona_id === null)).toBe(true);
  });

  it("numbers segments from zero in order", () => {
    const rows = chunkRowsFor({ noteId: NOTE, userId: USER, result: diarized });
    expect(rows.map((r) => r.metadata.seq)).toEqual([0, 1]);
  });

  it("writes ts_start as a display string and the seconds alongside it", () => {
    const rows = chunkRowsFor({ noteId: NOTE, userId: USER, result: diarized });

    expect(rows[1].metadata.ts_start).toBe("00:01");
    expect(rows[1].metadata.ts_end).toBe("00:01");
    expect(rows[1].metadata.ts_start_seconds).toBe(1.2);
    expect(rows[1].metadata.ts_end_seconds).toBe(1.6);
  });

  it("resolves the speaker into a name, initials and a colour token", () => {
    const rows = chunkRowsFor({ noteId: NOTE, userId: USER, result: diarized });

    expect(rows[0].metadata.speaker).toEqual({
      name: "Speaker 1",
      initials: "S1",
      token: "speaker-1",
    });
    expect(rows[1].metadata.speaker?.token).toBe("speaker-2");
  });

  it("omits speaker entirely when nothing was diarized", () => {
    const rows = chunkRowsFor({
      noteId: NOTE,
      userId: USER,
      result: {
        rawTranscript: "One two",
        diarized: false,
        segments: [
          { speakerLabel: null, startSeconds: 0, endSeconds: 2, text: "One two" },
        ],
      },
    });

    expect(rows[0].metadata.speaker).toBeUndefined();
  });

  it("falls back to one whole-transcript chunk when there are no segments", () => {
    // A plain (non-diarized) call returns output_text and no word annotations.
    // Writing zero chunks would leave the transcript pane empty for a note that
    // transcribed perfectly well.
    const rows = chunkRowsFor({
      noteId: NOTE,
      userId: USER,
      result: { rawTranscript: "All of it", diarized: false, segments: [] },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("All of it");
    expect(rows[0].metadata.seq).toBe(0);
    expect(rows[0].metadata.ts_start).toBe("00:00");
  });

  it("writes no rows at all for an empty transcript", () => {
    expect(
      chunkRowsFor({
        noteId: NOTE,
        userId: USER,
        result: { rawTranscript: "   ", diarized: false, segments: [] },
      }),
    ).toEqual([]);
  });
});

describe("persistTranscription", () => {
  it("clears old chunks, inserts, and only then completes the note", async () => {
    const s = store();
    await persistTranscription({ store: s, noteId: NOTE, userId: USER, result: diarized });

    // Order is the whole safety property. If insert dies partway the row is
    // still 'analyzing', and the staleness sweep fails it an hour later --
    // which is why there is no bespoke rollback here.
    expect(s.calls).toEqual(["delete", "insert", "complete"]);
  });

  it("throws if the completing claim is lost, leaving the row for the sweep", async () => {
    const s = store();
    s.completeNote = vi.fn(async () => false);

    await expect(
      persistTranscription({ store: s, noteId: NOTE, userId: USER, result: diarized }),
    ).rejects.toThrow(/no longer/i);
  });

  it("does not insert an empty batch", async () => {
    const s = store();
    await persistTranscription({
      store: s,
      noteId: NOTE,
      userId: USER,
      result: { rawTranscript: "  ", diarized: false, segments: [] },
    });

    expect(s.calls).toEqual(["delete", "complete"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run lib/transcription/__tests__/persist-result.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/transcription/persist-result.ts`:

```ts
import type { ChunkMetadata } from "@/lib/notes/types";
import {
  formatTimestamp,
  speakerFor,
  type TranscriptionResult,
} from "@/lib/transcription/transcript";

/** Turns a TranscriptionResult into rows, and writes them in the one order
 *  that is safe to crash in the middle of.
 *
 *  Chunks are written BEFORE the 'completed' flip. If insertion dies partway,
 *  the row stays at 'analyzing' and the staleness sweep marks it 'failed' an
 *  hour later. That existing safety net is the rollback -- there is deliberately
 *  no transaction and no bespoke compensating write, because a second
 *  mechanism for the same failure is a second thing to get wrong.
 *
 *  The delete-then-insert is idempotency, not cleanup: a run that crashed after
 *  inserting would otherwise leave chunks that a later successful run would
 *  double. */

export interface NoteChunkInsert {
  note_id: string;
  user_id: string;
  chunk_type: "transcript_segment";
  /** A transcript belongs to no lens. Null reads as the default persona, which
   *  is exactly right -- it is raw material, not an interpretation. */
  persona_id: null;
  content: string;
  /** RAG embeddings are a separate future track. Explicitly null, not omitted,
   *  so the intent is visible at the call site. */
  embedding: null;
  metadata: ChunkMetadata;
}

export interface TranscriptionStore {
  deleteTranscriptChunks(noteId: string): Promise<void>;
  insertChunks(rows: NoteChunkInsert[]): Promise<void>;
  /** Atomic: flips 'analyzing' -> 'completed' only if the row is still
   *  'analyzing'. False means another worker or the staleness sweep took it. */
  completeNote(args: {
    noteId: string;
    rawTranscript: string;
    diarized: boolean;
  }): Promise<boolean>;
  markFailed(noteId: string, reason: string): Promise<void>;
}

export function chunkRowsFor(args: {
  noteId: string;
  userId: string;
  result: TranscriptionResult;
}): NoteChunkInsert[] {
  const { noteId, userId, result } = args;

  const base = {
    note_id: noteId,
    user_id: userId,
    chunk_type: "transcript_segment" as const,
    persona_id: null,
    embedding: null,
  };

  if (result.segments.length === 0) {
    // A plain transcription returns output_text with no word annotations. One
    // untimed chunk keeps the transcript readable; zero chunks would render an
    // empty pane for a note that transcribed perfectly well.
    const content = result.rawTranscript.trim();
    if (!content) return [];

    return [
      {
        ...base,
        content,
        metadata: { seq: 0, ts_start: formatTimestamp(0), ts_end: formatTimestamp(0) },
      },
    ];
  }

  return result.segments.map((segment, seq) => {
    const speaker = speakerFor(segment.speakerLabel);

    const metadata: ChunkMetadata = {
      seq,
      ts_start: formatTimestamp(segment.startSeconds),
      ts_end: formatTimestamp(segment.endSeconds),
      ts_start_seconds: segment.startSeconds,
      ts_end_seconds: segment.endSeconds,
    };

    // Omitted rather than null: note-view-model.ts substitutes its own Unknown
    // speaker for an absent one, and an explicit null would defeat that.
    if (speaker) metadata.speaker = speaker;

    return { ...base, content: segment.text, metadata };
  });
}

export async function persistTranscription(args: {
  store: TranscriptionStore;
  noteId: string;
  userId: string;
  result: TranscriptionResult;
}): Promise<void> {
  const { store, noteId, userId, result } = args;

  const rows = chunkRowsFor({ noteId, userId, result });

  await store.deleteTranscriptChunks(noteId);
  if (rows.length > 0) await store.insertChunks(rows);

  const completed = await store.completeNote({
    noteId,
    rawTranscript: result.rawTranscript,
    diarized: result.diarized,
  });

  if (!completed) {
    throw new Error(
      `note ${noteId} was no longer 'analyzing' when the transcript was ready`,
    );
  }
}
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run lib/transcription/__tests__/persist-result.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/transcription/persist-result.ts lib/transcription/__tests__/persist-result.test.ts
git commit -m "feat(transcription): persist transcript chunks before completing"
```

---

## Task 6: The sweep

**Files:**
- Create: `lib/transcription/sweep.ts`
- Test: `lib/transcription/__tests__/sweep.test.ts`

**Interfaces:**
- Consumes: `planFor` from `diarization-policy.ts`; `Transcriber` from `transcript.ts`; `TranscriptionStore`, `persistTranscription` from `persist-result.ts`.
- Produces:
  - `STALE_AFTER_MS = 60 * 60 * 1000`
  - `MAX_TRANSCRIPTIONS_PER_RUN = 3`
  - `MAX_RECONCILIATIONS_PER_RUN = 25`
  - `RUN_BUDGET_MS = 240_000`
  - `interface SweepPorts { … }` (below)
  - `sweep(ports: SweepPorts): Promise<SweepReport>`

- [ ] **Step 1: Write the failing test**

Create `lib/transcription/__tests__/sweep.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  sweep,
  STALE_AFTER_MS,
  MAX_TRANSCRIPTIONS_PER_RUN,
  type SweepPorts,
  type UploadingRow,
} from "@/lib/transcription/sweep";

const NOW = 1_800_000_000_000;
const USER = "22222222-2222-2222-2222-222222222222";

function row(overrides: Partial<UploadingRow> = {}): UploadingRow {
  return {
    id: "note-1",
    user_id: USER,
    audio_storage_path: `${USER}/note-1`,
    audio_duration_seconds: 60,
    updated_at: new Date(NOW - 1000).toISOString(),
    ...overrides,
  };
}

function ports(overrides: Partial<SweepPorts> = {}): SweepPorts {
  return {
    now: () => NOW,
    log: vi.fn(),
    listUploading: vi.fn(async () => []),
    listStaleAnalyzing: vi.fn(async () => []),
    claim: vi.fn(async () => true),
    objectExists: vi.fn(async () => true),
    downloadAudio: vi.fn(async () => ({
      blob: new Blob(["x"]),
      mimeType: "audio/webm",
    })),
    transcribe: vi.fn(async () => ({
      rawTranscript: "hello",
      diarized: true,
      segments: [
        { speakerLabel: "spk_1", startSeconds: 0, endSeconds: 1, text: "hello" },
      ],
    })),
    store: {
      deleteTranscriptChunks: vi.fn(async () => {}),
      insertChunks: vi.fn(async () => {}),
      completeNote: vi.fn(async () => true),
      markFailed: vi.fn(async () => {}),
    },
    ...overrides,
  };
}

describe("sweep — the happy path", () => {
  it("claims 'uploading' -> 'analyzing', transcribes, and completes", async () => {
    const p = ports({ listUploading: vi.fn(async () => [row()]) });
    const report = await sweep(p);

    expect(p.claim).toHaveBeenCalledWith("note-1", "uploading", "analyzing");
    expect(p.transcribe).toHaveBeenCalledTimes(1);
    expect(p.store.completeNote).toHaveBeenCalledTimes(1);
    expect(report.transcribed).toBe(1);
  });

  it("diarizes a short recording and not a long one", async () => {
    const short = ports({ listUploading: vi.fn(async () => [row({ audio_duration_seconds: 27 * 60 })]) });
    await sweep(short);
    expect(short.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ diarize: true }),
    );

    const long = ports({ listUploading: vi.fn(async () => [row({ audio_duration_seconds: 29 * 60 })]) });
    await sweep(long);
    expect(long.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ diarize: false }),
    );
  });
});

describe("sweep — the atomic claim", () => {
  it("does not transcribe when the claim is lost to a concurrent tick", async () => {
    // Two overlapping invocations see the same row. Only the UPDATE whose
    // WHERE still matches wins; the loser must not spend a Gemini call.
    const p = ports({
      listUploading: vi.fn(async () => [row()]),
      claim: vi.fn(async () => false),
    });
    const report = await sweep(p);

    expect(p.transcribe).not.toHaveBeenCalled();
    expect(report.transcribed).toBe(0);
    expect(report.skipped).toBe(1);
  });

  it("lets exactly one of two concurrent sweeps claim the same row", async () => {
    let claimed = false;
    const claim = vi.fn(async () => {
      if (claimed) return false;
      claimed = true;
      return true;
    });

    const a = ports({ listUploading: vi.fn(async () => [row()]), claim });
    const b = ports({ listUploading: vi.fn(async () => [row()]), claim });

    const [ra, rb] = await Promise.all([sweep(a), sweep(b)]);

    expect(ra.transcribed + rb.transcribed).toBe(1);
    // vi.mocked() is a type-only cast. ports() is typed as SweepPorts, and
    // tsconfig.json includes **/*.ts under strict, so reaching for .mock
    // directly would not typecheck.
    expect(
      vi.mocked(a.transcribe).mock.calls.length +
        vi.mocked(b.transcribe).mock.calls.length,
    ).toBe(1);
  });
});

describe("sweep — a missing Storage object", () => {
  it("leaves a young row alone when the object is absent", async () => {
    const p = ports({
      listUploading: vi.fn(async () => [
        row({ updated_at: new Date(NOW - (STALE_AFTER_MS - 1000)).toISOString() }),
      ]),
      objectExists: vi.fn(async () => false),
    });
    const report = await sweep(p);

    expect(p.claim).not.toHaveBeenCalled();
    expect(report.failed).toBe(0);
    expect(report.skipped).toBe(1);
  });

  it("fails a row past the hour when the object is absent", async () => {
    const p = ports({
      listUploading: vi.fn(async () => [
        row({ updated_at: new Date(NOW - (STALE_AFTER_MS + 1000)).toISOString() }),
      ]),
      objectExists: vi.fn(async () => false),
    });
    const report = await sweep(p);

    expect(p.claim).toHaveBeenCalledWith("note-1", "uploading", "failed");
    expect(report.failed).toBe(1);
  });

  it("transcribes a row past the hour when the object IS present", async () => {
    // Age alone never fails a row. The safety check is object existence -- an
    // old row with audio behind it is a lost write-back, not a lost upload.
    const p = ports({
      listUploading: vi.fn(async () => [
        row({ updated_at: new Date(NOW - STALE_AFTER_MS * 10).toISOString() }),
      ]),
    });
    const report = await sweep(p);

    expect(report.transcribed).toBe(1);
    expect(report.failed).toBe(0);
  });

  it("fails a row with no audio_storage_path at all, once stale", async () => {
    const p = ports({
      listUploading: vi.fn(async () => [
        row({
          audio_storage_path: null,
          updated_at: new Date(NOW - (STALE_AFTER_MS + 1)).toISOString(),
        }),
      ]),
    });
    const report = await sweep(p);

    expect(p.objectExists).not.toHaveBeenCalled();
    expect(report.failed).toBe(1);
  });
});

describe("sweep — a stale 'analyzing' row", () => {
  it("fails one past the hour", async () => {
    const p = ports({ listStaleAnalyzing: vi.fn(async () => ["crashed-note"]) });
    const report = await sweep(p);

    expect(p.claim).toHaveBeenCalledWith("crashed-note", "analyzing", "failed");
    expect(report.reconciled).toBe(1);
  });

  it("asks the database for the cutoff rather than filtering in memory", async () => {
    const p = ports();
    await sweep(p);

    expect(p.listStaleAnalyzing).toHaveBeenCalledWith(
      new Date(NOW - STALE_AFTER_MS).toISOString(),
      expect.any(Number),
    );
  });

  it("counts nothing when the claim is lost", async () => {
    const p = ports({
      listStaleAnalyzing: vi.fn(async () => ["crashed-note"]),
      claim: vi.fn(async () => false),
    });

    expect((await sweep(p)).reconciled).toBe(0);
  });
});

describe("sweep — recordings past Gemini's cap", () => {
  it("fails outright, with no Gemini call and a reason in the log", async () => {
    const p = ports({
      listUploading: vi.fn(async () => [row({ audio_duration_seconds: 61 * 60 })]),
    });
    const report = await sweep(p);

    expect(p.transcribe).not.toHaveBeenCalled();
    expect(p.store.markFailed).toHaveBeenCalledWith(
      "note-1",
      expect.stringContaining("segmentation is not implemented"),
    );
    expect(report.failed).toBe(1);
  });
});

describe("sweep — failure handling", () => {
  it("marks the note failed when Gemini throws, and keeps going", async () => {
    const p = ports({
      listUploading: vi.fn(async () => [row(), row({ id: "note-2" })]),
      transcribe: vi
        .fn()
        .mockRejectedValueOnce(new Error("gemini exploded"))
        .mockResolvedValue({ rawTranscript: "ok", diarized: false, segments: [] }),
    });
    const report = await sweep(p);

    expect(p.store.markFailed).toHaveBeenCalledWith(
      "note-1",
      expect.stringContaining("gemini exploded"),
    );
    expect(report.failed).toBe(1);
    expect(report.transcribed).toBe(1);
  });
});

describe("sweep — caps", () => {
  it("never transcribes more rows than the per-run cap", async () => {
    const many = Array.from({ length: 10 }, (_, i) => row({ id: `note-${i}` }));
    const p = ports({ listUploading: vi.fn(async () => many) });
    const report = await sweep(p);

    expect(report.transcribed).toBe(MAX_TRANSCRIPTIONS_PER_RUN);
    expect(p.transcribe).toHaveBeenCalledTimes(MAX_TRANSCRIPTIONS_PER_RUN);
  });

  it("logs what it dropped rather than reporting silent completeness", async () => {
    const many = Array.from({ length: 10 }, (_, i) => row({ id: `note-${i}` }));
    const log = vi.fn();
    await sweep(ports({ listUploading: vi.fn(async () => many), log }));

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/deferred|remaining/i));
  });

  it("stops claiming new work once the wall-clock budget is spent", async () => {
    let clock = NOW;
    const p = ports({
      now: () => clock,
      listUploading: vi.fn(async () => [row(), row({ id: "note-2" })]),
      transcribe: vi.fn(async () => {
        clock += 300_000; // blow the budget inside the first transcription
        return { rawTranscript: "ok", diarized: false, segments: [] };
      }),
    });
    const report = await sweep(p);

    expect(report.transcribed).toBe(1);
    expect(p.transcribe).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run lib/transcription/__tests__/sweep.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/transcription/sweep.ts`:

```ts
import { planFor } from "@/lib/transcription/diarization-policy";
import {
  persistTranscription,
  type TranscriptionStore,
} from "@/lib/transcription/persist-result";
import type { Transcriber } from "@/lib/transcription/transcript";

/** All the branching, and none of the I/O.
 *
 *  processing_status IS the queue. There is no job table: a row's own status
 *  says whether it is waiting, in flight, done or dead, and the transitions are
 *  the only coordination. Adding a queue table would mean two sources of truth
 *  that can disagree.
 *
 *  Every side effect is an injected port, which is what lets the whole state
 *  machine -- claim races, staleness, caps -- be tested with no database and no
 *  network. */

/** A row is stale after an hour. The threshold exists ONLY to avoid
 *  false-failing a slow-but-real upload; the actual safety check is whether the
 *  object exists. An old row with audio behind it is transcribed, not failed. */
export const STALE_AFTER_MS = 60 * 60 * 1000;

/** Vercel Hobby caps a function at 300 s and offers no extension (measured
 *  2026-08-31). Three transcriptions is what fits with room for a slow one. */
export const MAX_TRANSCRIPTIONS_PER_RUN = 3;

/** Reconciliation is a status flip and, at most, one list() -- cheap enough to
 *  clear a backlog in one tick. */
export const MAX_RECONCILIATIONS_PER_RUN = 25;

/** Stop claiming NEW work past this. Under the 300 s ceiling with enough left
 *  to finish and return rather than being killed mid-write. */
export const RUN_BUDGET_MS = 240_000;

export interface UploadingRow {
  id: string;
  user_id: string;
  audio_storage_path: string | null;
  audio_duration_seconds: number | null;
  updated_at: string;
}

export interface SweepPorts {
  now(): number;
  log(message: string): void;
  listUploading(limit: number): Promise<UploadingRow[]>;
  /** Rows still 'analyzing' whose updated_at is older than `cutoffIso`. */
  listStaleAnalyzing(cutoffIso: string, limit: number): Promise<string[]>;
  /** The atomic claim: a single UPDATE ... WHERE processing_status = expected.
   *  True only if this caller's update was the one that matched. */
  claim(noteId: string, expected: string, next: string): Promise<boolean>;
  /** list()/metadata, NEVER download(). Storage reads are CDN-cached. */
  objectExists(path: string): Promise<boolean>;
  downloadAudio(path: string): Promise<{ blob: Blob; mimeType: string }>;
  transcribe: Transcriber;
  store: TranscriptionStore;
}

export interface SweepReport {
  transcribed: number;
  failed: number;
  reconciled: number;
  skipped: number;
}

export async function sweep(ports: SweepPorts): Promise<SweepReport> {
  const startedAt = ports.now();
  const report: SweepReport = {
    transcribed: 0,
    failed: 0,
    reconciled: 0,
    skipped: 0,
  };

  const cutoffIso = new Date(startedAt - STALE_AFTER_MS).toISOString();

  // ---- Tier 2a: a crashed transcription -------------------------------------
  // Same query shape as the uploading pass, against a different status value.
  // Deliberately not a second mechanism.
  const crashed = await ports.listStaleAnalyzing(
    cutoffIso,
    MAX_RECONCILIATIONS_PER_RUN,
  );

  for (const noteId of crashed) {
    if (await ports.claim(noteId, "analyzing", "failed")) {
      report.reconciled += 1;
      ports.log(
        `note ${noteId}: stuck in 'analyzing' past ${STALE_AFTER_MS}ms — ` +
          `the transcription function did not finish. Marked 'failed'.`,
      );
    }
  }

  // ---- Tier 2b: uploads that may or may not have landed ----------------------
  const candidates = await ports.listUploading(MAX_TRANSCRIPTIONS_PER_RUN * 4);

  for (const row of candidates) {
    if (report.transcribed >= MAX_TRANSCRIPTIONS_PER_RUN) {
      report.skipped += 1;
      continue;
    }

    if (ports.now() - startedAt > RUN_BUDGET_MS) {
      report.skipped += 1;
      continue;
    }

    const ageMs = startedAt - Date.parse(row.updated_at);
    const stale = ageMs > STALE_AFTER_MS;

    const exists = row.audio_storage_path
      ? await ports.objectExists(row.audio_storage_path)
      : false;

    if (!exists) {
      if (!stale) {
        // A slow-but-real upload. Say nothing, do nothing, look again next tick.
        report.skipped += 1;
        continue;
      }

      if (await ports.claim(row.id, "uploading", "failed")) {
        report.failed += 1;
        ports.log(
          `note ${row.id}: no object at ${row.audio_storage_path ?? "(no path)"} ` +
            `after ${Math.round(ageMs / 60000)} min. The upload never landed. ` +
            `Marked 'failed'.`,
        );
      }
      continue;
    }

    if (!(await ports.claim(row.id, "uploading", "analyzing"))) {
      // Another tick got there first. Not an error.
      report.skipped += 1;
      continue;
    }

    const outcome = await transcribeOne(ports, row);
    if (outcome === "transcribed") report.transcribed += 1;
    else report.failed += 1;
  }

  const deferred = candidates.length - report.transcribed - report.failed;
  if (deferred > 0) {
    // Never let a cap read as completeness.
    ports.log(
      `${deferred} row(s) deferred to the next tick — per-run cap ` +
        `${MAX_TRANSCRIPTIONS_PER_RUN}, budget ${RUN_BUDGET_MS}ms.`,
    );
  }

  return report;
}

async function transcribeOne(
  ports: SweepPorts,
  row: UploadingRow,
): Promise<"transcribed" | "failed"> {
  const plan = planFor(row.audio_duration_seconds);

  if (plan.kind === "too-long") {
    ports.log(`note ${row.id}: ${plan.reason}. Marked 'failed'.`);
    await ports.store.markFailed(row.id, plan.reason);
    return "failed";
  }

  if (plan.kind === "plain") ports.log(`note ${row.id}: ${plan.reason}`);

  try {
    // download() ONLY here, and only to move bytes to Gemini. Existence was
    // already proved with list() above -- a CDN-cached read must never be the
    // thing that decides whether an object is there.
    const { blob, mimeType } = await ports.downloadAudio(
      row.audio_storage_path!,
    );

    const result = await ports.transcribe({
      audio: blob,
      mimeType,
      diarize: plan.kind === "diarized",
    });

    await persistTranscription({
      store: ports.store,
      noteId: row.id,
      userId: row.user_id,
      result,
    });

    ports.log(
      `note ${row.id}: transcribed, ${result.segments.length} segment(s), ` +
        `diarized=${result.diarized}.`,
    );
    return "transcribed";
  } catch (error) {
    // No error-message column at single-owner scale. The Vercel function log is
    // where a failure is read.
    const reason = error instanceof Error ? error.message : String(error);
    ports.log(`note ${row.id}: transcription failed — ${reason}`);
    await ports.store.markFailed(row.id, reason);
    return "failed";
  }
}
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run lib/transcription/__tests__/sweep.test.ts
```

Expected: PASS, 16 tests.

- [ ] **Step 5: Run the whole suite — the conventions guard must still pass**

```bash
npm test
```

Expected: all files pass, including `project-conventions.test.ts` (no colour
literals, nothing over 400 lines in `lib/`).

- [ ] **Step 6: Commit**

```bash
git add lib/transcription/sweep.ts lib/transcription/__tests__/sweep.test.ts
git commit -m "feat(transcription): sweep with atomic claim and two-tier reconciliation"
```

---

## Task 7: The cron route and `vercel.json`

**Files:**
- Create: `app/api/cron/transcribe/route.ts`
- Create: `app/api/cron/transcribe/__tests__/route.test.ts`
- Create: `vercel.json`

**Interfaces:**
- Consumes: `sweep`, `SweepPorts`, `MAX_RECONCILIATIONS_PER_RUN` from `sweep.ts`; `createGeminiTranscriber` from `gemini-client.ts`; `NoteChunkInsert`, `TranscriptionStore` from `persist-result.ts`.
- Produces: `GET /api/cron/transcribe`, and `isAuthorized(request, secret)` exported for tests.

- [ ] **Step 1: Write the failing test**

The one thing that must be tested here is that an unauthenticated request
cannot cost money. Create `app/api/cron/transcribe/__tests__/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.CRON_SECRET = "the-real-secret";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

async function get(headers: Record<string, string> = {}) {
  const { GET } = await import("@/app/api/cron/transcribe/route");
  return GET(new Request("https://example.test/api/cron/transcribe", { headers }));
}

describe("GET /api/cron/transcribe — the CRON_SECRET gate", () => {
  it("rejects a request with no Authorization header", async () => {
    expect((await get()).status).toBe(401);
  });

  it("rejects a wrong secret", async () => {
    expect((await get({ authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("rejects the right secret without the Bearer prefix", async () => {
    // Vercel always sends "Bearer <value>". Accepting the bare value would
    // widen the gate for no reason.
    expect((await get({ authorization: "the-real-secret" })).status).toBe(401);
  });

  it("refuses every request when CRON_SECRET is unset, rather than opening up", async () => {
    delete process.env.CRON_SECRET;
    expect((await get({ authorization: "Bearer anything" })).status).toBe(401);
    expect((await get()).status).toBe(401);
  });

  it("never constructs a Gemini client for an unauthorized request", async () => {
    // The whole point of the gate: an unauthenticated caller must not be able
    // to spend the API key.
    const genai = vi.fn();
    vi.doMock("@google/genai", () => ({ GoogleGenAI: genai }));

    await get({ authorization: "Bearer wrong" });

    expect(genai).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run app/api/cron/transcribe/__tests__/route.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the route**

Create `app/api/cron/transcribe/route.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
// Read-only import, not a modification: the scope fence puts lib/recorder/ off
// limits for EDITS, and re-declaring the bucket name here would create a second
// place for it to drift. upload-audio.ts is pure types and functions with no
// browser-only import, so it is safe on the server.
import { AUDIO_BUCKET } from "@/lib/recorder/upload-audio";
import { createGeminiTranscriber } from "@/lib/transcription/gemini-client";
import type {
  NoteChunkInsert,
  TranscriptionStore,
} from "@/lib/transcription/persist-result";
import {
  sweep,
  MAX_RECONCILIATIONS_PER_RUN,
  type SweepPorts,
  type UploadingRow,
} from "@/lib/transcription/sweep";

/** The Vercel Cron entry point, and the ONE piece of application code that
 *  holds the Supabase secret key.
 *
 *  ------------------------------------------------------------------------
 *  SECRET KEY AMENDMENT. Until this route existed the secret key lived in
 *  exactly one place, scripts/verify-rls.mjs, and docs/DEPLOYMENT.md recorded
 *  that it was "correctly absent" from Vercel. That is no longer true and the
 *  change is deliberate, not a leak:
 *
 *    - scripts/verify-rls.mjs  -- local only, reads .env.local
 *    - app/api/cron/transcribe/route.ts  -- THIS file, server only
 *
 *  Nowhere else. Never NEXT_PUBLIC_-prefixed. The key is needed because a cron
 *  invocation has no user session and therefore no RLS identity: it must read
 *  and write rows belonging to whichever user recorded them. That is what
 *  bypassing RLS is for, and it is why this route is gated on CRON_SECRET
 *  before it touches anything.
 *  ------------------------------------------------------------------------
 *
 *  maxDuration is 300 because the TEKGUYZ team is on the Vercel Hobby plan,
 *  where 300 s is both the default and the hard ceiling -- there is no extended
 *  duration to opt into (measured 2026-08-31). MAX_TRANSCRIPTIONS_PER_RUN is
 *  sized against that number, not against Pro's 800 s. */
export const maxDuration = 300;

/** Vercel sends the CRON_SECRET value as `Authorization: Bearer <value>`
 *  (vercel.com/docs/cron-jobs/manage-cron-jobs § Securing cron jobs).
 *
 *  An unset secret refuses everything. Failing open would leave a route that
 *  spends money on the Gemini API reachable by anyone who guesses the path. */
export function isAuthorized(request: Request, secret: string | undefined) {
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function storeFor(db: SupabaseClient): TranscriptionStore {
  return {
    async deleteTranscriptChunks(noteId) {
      const { error } = await db
        .from("note_chunks")
        .delete()
        .eq("note_id", noteId)
        .eq("chunk_type", "transcript_segment");
      if (error) throw new Error(`clearing old chunks failed: ${error.message}`);
    },

    async insertChunks(rows: NoteChunkInsert[]) {
      const { error } = await db.from("note_chunks").insert(rows);
      if (error) throw new Error(`chunk insert failed: ${error.message}`);
    },

    async completeNote({ noteId, rawTranscript, diarized }) {
      // Atomic, same shape as the claim: the eq on processing_status is what
      // makes a lost race return zero rows instead of overwriting somebody
      // else's work.
      const { data, error } = await db
        .from("notes")
        .update({
          raw_transcript: rawTranscript,
          diarization_enabled: diarized,
          processing_status: "completed",
        })
        .eq("id", noteId)
        .eq("processing_status", "analyzing")
        .select("id");

      if (error) throw new Error(`completing note failed: ${error.message}`);
      return (data?.length ?? 0) === 1;
    },

    async markFailed(noteId, reason) {
      const { error } = await db
        .from("notes")
        .update({ processing_status: "failed" })
        .eq("id", noteId)
        .in("processing_status", ["uploading", "analyzing"]);
      if (error) {
        console.error(`[transcribe] could not mark ${noteId} failed`, error.message);
      }
      console.error(`[transcribe] note ${noteId} failed: ${reason}`);
    },
  };
}

function portsFor(db: SupabaseClient, geminiKey: string): SweepPorts {
  const bucket = db.storage.from(AUDIO_BUCKET);

  return {
    now: () => Date.now(),
    log: (message) => console.log(`[transcribe] ${message}`),

    async listUploading(limit) {
      const { data, error } = await db
        .from("notes")
        .select("id, user_id, audio_storage_path, audio_duration_seconds, updated_at")
        .eq("processing_status", "uploading")
        .order("updated_at", { ascending: true })
        .limit(limit);

      if (error) throw new Error(`listing 'uploading' failed: ${error.message}`);
      return (data ?? []) as UploadingRow[];
    },

    async listStaleAnalyzing(cutoffIso, limit) {
      const { data, error } = await db
        .from("notes")
        .select("id")
        .eq("processing_status", "analyzing")
        .lt("updated_at", cutoffIso)
        .limit(limit);

      if (error) throw new Error(`listing 'analyzing' failed: ${error.message}`);
      return (data ?? []).map((r) => r.id as string);
    },

    async claim(noteId, expected, next) {
      // THE claim. One statement. Postgres row-locks the matched row, so a
      // concurrent invocation re-evaluates this WHERE after the lock releases
      // and matches nothing. No lock table, no read-then-write window.
      const { data, error } = await db
        .from("notes")
        .update({ processing_status: next })
        .eq("id", noteId)
        .eq("processing_status", expected)
        .select("id");

      if (error) throw new Error(`claim failed: ${error.message}`);
      return (data?.length ?? 0) === 1;
    },

    async objectExists(path) {
      // list(), never download(). Storage serves object reads through a
      // caching CDN and a download() straight after an upsert returns the
      // PRE-overwrite body -- observed on this project during Track 1.
      const slash = path.indexOf("/");
      const prefix = path.slice(0, slash);
      const name = path.slice(slash + 1);

      const { data, error } = await bucket.list(prefix, { search: name });
      if (error) throw new Error(`existence check failed: ${error.message}`);
      return (data ?? []).some((object) => object.name === name);
    },

    async downloadAudio(path) {
      // The one download() in this track, and it proves nothing -- it only
      // moves bytes to Gemini. Existence was already settled by list().
      const { data, error } = await bucket.download(path);
      if (error || !data) {
        throw new Error(`audio download failed: ${error?.message ?? "no body"}`);
      }
      return { blob: data, mimeType: data.type || "audio/webm" };
    },

    transcribe: createGeminiTranscriber(geminiKey),
    store: storeFor(db),
  };
}

export async function GET(request: Request) {
  if (!isAuthorized(request, process.env.CRON_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!url || !secretKey || !geminiKey) {
    const missing = [
      !url && "NEXT_PUBLIC_SUPABASE_URL",
      !secretKey && "SUPABASE_SECRET_KEY",
      !geminiKey && "GEMINI_API_KEY",
    ].filter(Boolean);

    console.error(`[transcribe] not configured: missing ${missing.join(", ")}`);
    return new Response(`Not configured: missing ${missing.join(", ")}`, {
      status: 500,
    });
  }

  const db = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const report = await sweep(portsFor(db, geminiKey));
    console.log(`[transcribe] ${JSON.stringify(report)}`);
    return Response.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[transcribe] sweep aborted: ${message}`);
    return new Response(`Sweep failed: ${message}`, { status: 500 });
  }
}

// Referenced so the cap is visible from the entry point rather than only in the
// sweep. Nothing else uses it here.
void MAX_RECONCILIATIONS_PER_RUN;
```

If that trailing `void` reads as noise when you get there, delete it and drop
`MAX_RECONCILIATIONS_PER_RUN` from the import list instead. Do not leave an
unused import — `tsc --noEmit` and the build will both object.

- [ ] **Step 4: Run the route test**

```bash
npx vitest run app/api/cron/transcribe/__tests__/route.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Write `vercel.json`**

Create `vercel.json` at the repo root:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/transcribe",
      "schedule": "0 * * * *"
    }
  ]
}
```

> **STOP. This schedule depends on an unresolved decision.**
>
> The TEKGUYZ team is on the Vercel **Hobby** plan (measured — see "Measured
> facts"). On Hobby, a cron may fire **once per day**, and an expression that
> fires more often **fails deployment outright**. `0 * * * *` is hourly and
> will therefore break the deploy.
>
> - **If the account stays on Hobby:** use `"schedule": "0 7 * * *"` and set
>   `maxDuration = 300` in the route (already correct). Transcription latency
>   becomes up to 24 hours. The route stays callable on demand with the bearer
>   token, so the verify script and any manual kick still work instantly.
> - **If the account moves to Pro:** `"0 * * * *"` (or tighter) is legal,
>   `maxDuration` may go to 800, and `MAX_TRANSCRIPTIONS_PER_RUN` can rise.
>
> Do not guess. Confirm which, then write that one string and delete this note.

- [ ] **Step 6: Full typecheck, build and suite**

```bash
npx tsc --noEmit
```

```bash
npm run build
```

```bash
npm test
```

Expected: all three clean. `npm run build` is where a bad `vercel.json` schema
or an unused import surfaces.

- [ ] **Step 7: Prove the secret key appears in exactly two files**

```bash
grep -rn "SUPABASE_SECRET_KEY" --include=*.ts --include=*.tsx --include=*.mjs app lib components scripts
```

Expected: exactly two files — `scripts/verify-rls.mjs` and
`app/api/cron/transcribe/route.ts`. Paste the raw output. (`.env.local.example`
and the docs name the variable too; the grep above is scoped to code on purpose,
and the report must say so rather than quietly excluding them.)

- [ ] **Step 8: Commit**

```bash
git add app/api vercel.json
git commit -m "feat(transcription): cron route gated on CRON_SECRET"
```

---

## Task 8: Live verification script

**Files:**
- Create: `scripts/verify-transcription-pipeline.mjs`

**Interfaces:**
- Consumes: `.env.local` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `RLS_TEST_OWNER_EMAIL`, `RLS_TEST_OWNER_PASSWORD`, `CRON_SECRET`, `GEMINI_API_KEY`.
- Produces: exit code 0 on PASS, 1 on FAIL, in the same `check(label, ok, detail)` house style as `scripts/verify-recorder-upload.mjs`.

- [ ] **Step 1: Add the two new keys to `.env.local` and to the example file**

Append to the gitignored `.env.local` (real values):

```
CRON_SECRET=<32+ random chars>
GEMINI_API_KEY=<the billed key>
```

Append to the committed `.env.local.example` (placeholders only):

```
# Server-only. Gates app/api/cron/transcribe — an unauthenticated request must
# never be able to spend the Gemini key. Vercel sends this as an
# `Authorization: Bearer <value>` header on every cron invocation.
CRON_SECRET=<32+ random characters>

# Server-only. Billed Google AI Studio key for gemini-3.5-transcribe.
GEMINI_API_KEY=<key>
```

- [ ] **Step 2: Write the script**

Create `scripts/verify-transcription-pipeline.mjs`. It runs three proofs against
the **real** route, over HTTP, so nothing is proved against a reimplementation
of the sweep:

```js
/**
 * Live proof of the Track 3 pipeline against the hosted project.
 *
 * Three proofs, each end to end through the REAL route -- not a reimplementation
 * of the sweep in this file, which would prove only that the copy agrees with
 * itself:
 *
 *   1. Happy path.  A real audio object at {user_id}/{note_id} plus an
 *      'uploading' row reaches 'completed', with raw_transcript and
 *      note_chunks rows behind it.
 *   2. Lost-session orphan.  An 'uploading' row backdated past the hour with NO
 *      object reaches 'failed'.
 *   3. Crashed transcription.  An 'analyzing' row backdated past the hour
 *      reaches 'failed'.
 *
 * Proofs 2 and 3 backdate updated_at on INSERT. That works because
 * notes_set_updated_at is a BEFORE UPDATE trigger -- it does not fire on
 * insert, so an explicit updated_at survives.
 *
 * Audio is synthesised locally with Windows SAPI rather than committed as a
 * fixture, so the transcript assertion is against words we chose. Set
 * TRANSCRIBE_TEST_AUDIO to a .wav path to skip synthesis.
 *
 * The object is never verified with download(). Existence comes from list()
 * metadata -- Storage reads are CDN-cached (docs/KNOWN_GAPS.md).
 *
 * Needs the dev server running:
 *     npm run dev
 *     node scripts/verify-transcription-pipeline.mjs
 */
```

Implement, in this order:

1. `loadEnv(".env.local")` — copy the exact helper from `scripts/verify-recorder-upload.mjs`.
2. `roleClaim(jwt)` — copy the same helper; assert the owner token's role is `authenticated` before trusting any owner-side read.
3. Build three clients: `admin` (secret key), `anon` (publishable), and `owner` (publishable + the signed-in JWT in an `Authorization` header).
4. `synthesiseSpeech(outPath)` — spawn PowerShell:
   `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('<path>'); $s.Speak('The quick brown fox jumps over the lazy dog'); $s.Dispose()`
   If it fails, print the `TRANSCRIBE_TEST_AUDIO` instruction and exit 1.
5. **Proof 1:** `randomUUID()` for the note id. Upload the WAV as the owner to `${userId}/${noteId}` with `contentType: "audio/wav"`, `upsert: true`. Confirm with `list(userId, { search: noteId })` — never `download()`. Insert the `notes` row as the owner at `processing_status: 'uploading'` with a real `audio_duration_seconds`. Call the route. Poll the row for up to 120 s.
   - `check("status reaches completed", row.processing_status === "completed")`
   - `check("raw_transcript is not empty", (row.raw_transcript ?? "").length > 0)`
   - `check("transcript mentions a word we synthesised", /fox|dog|quick/i.test(row.raw_transcript))`
   - `check("note_chunks has transcript_segment rows", chunks.length > 0)`
   - `check("every chunk has embedding null", chunks.every(c => c.embedding === null))`
   - `check("every chunk has persona_id null", chunks.every(c => c.persona_id === null))`
   - `check("chunk metadata carries seq and ts_start", chunks.every(c => typeof c.metadata?.seq === "number" && typeof c.metadata?.ts_start === "string"))`
6. **Proof 2:** insert a second row as `admin` with `processing_status: 'uploading'`, an `audio_storage_path` pointing at a note id with **no object**, and `updated_at` set to `new Date(Date.now() - 2 * 3600_000).toISOString()`. Call the route. Assert `processing_status === "failed"`.
7. **Proof 3:** insert a third row as `admin` at `processing_status: 'analyzing'` with the same backdated `updated_at`. Call the route. Assert `processing_status === "failed"`.
8. **Auth proof:** call the route with no `Authorization` header and assert `401`; call with `Bearer wrong` and assert `401`.
9. `callRoute()` helper:

```js
async function callRoute() {
  const res = await fetch("http://localhost:3000/api/cron/transcribe", {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  });
  if (!res.ok) throw new Error(`route returned ${res.status}: ${await res.text()}`);
  return res.json();
}
```

10. **Cleanup in a `finally` block**, so a failed assertion still tidies up. Two clients, for the reason `CLAUDE.md` gives: the **rows** as the owner (`service_role` has no grant on `public.notes`), the **objects** as the admin (no DELETE policy exists on storage). Delete `note_chunks` rows too — they cascade on note delete, but deleting them explicitly proves the read found real rows.

- [ ] **Step 3: Run it**

```bash
npm run dev
```

then, in a second shell:

```bash
node scripts/verify-transcription-pipeline.mjs
```

Expected: every line `ok`, final line `PASS`, exit 0. Paste the entire output
into the final report — not a summary of it.

- [ ] **Step 4: Re-run the two existing live proofs — nothing regressed**

```bash
node scripts/verify-rls.mjs
```

```bash
node scripts/verify-recorder-upload.mjs
```

Expected: `PASS` from both. The constraint change touched `notes`, so the RLS
proof is not optional. Paste both outputs.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-transcription-pipeline.mjs .env.local.example
git commit -m "test: live proof of the transcription pipeline"
```

---

## Task 9: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/KNOWN_GAPS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Add `@google/genai` to the `CLAUDE.md` pin table**

Add one row to the main pin table, and amend the sentence above it — it
currently says the versions were verified on 2026-08-30 with `zustand` and
`fake-indexeddb` on 2026-08-31. Add `@google/genai` to that second list.

```
| @google/genai | 2.19.0 |
```

- [ ] **Step 2: Add a `## Transcription` section to `CLAUDE.md`**

Place it directly after `## Recorder`, in the same voice — each paragraph states
a rule and the reason it exists. It must cover, at minimum:

- `processing_status` **is** the queue. No job table. The transitions are the
  only coordination, and a second source of truth could disagree with the first.
- The claim is one `UPDATE ... WHERE processing_status = <expected>` returning
  the updated rows. Never read-then-write. A claim that returns zero rows lost
  the race and must not spend a Gemini call.
- Reconciliation is two-tier and **this track owns only tier 2**. Tier 1 — the
  in-session `'failed'` write on a caught upload error — is still unbuilt and
  belongs to the recorder. The check constraint that unblocks it shipped here.
- Age never fails a row on its own. **Object existence is the safety check**; the
  1-hour threshold exists only to avoid false-failing a slow-but-real upload.
- Existence is proved with `list()`. `download()` appears once, purely to move
  bytes to Gemini, and proves nothing. Same CDN-staleness reason as the recorder.
- `updated_at`, not `created_at`, is the staleness clock — for `'uploading'` it
  equals `created_at` at insert, and for `'analyzing'` it is when the row was
  claimed, which is exactly the crash window we want to measure. A retry upsert
  restarting the clock is correct, not a bug.
- Diarization is a pure function of duration: 28 minutes, a deliberate 2-minute
  margin under Gemini's 30-minute diarized cap. Past 60 minutes we do not call
  at all — no segmentation, no stitching, a clear log line instead.
- **Never send `custom_vocabulary`.** Gemini rejects it with HTTP 400 alongside
  diarization or timestamps. Verified against the forum thread, not assumed.
- The Gemini JS SDK config is **snake_case** (`generation_config`,
  `transcription_config`, `diarization_mode`, `mime_type`), unlike most Google
  JS SDKs. Do not "fix" it to camelCase.
- Chunk writes precede the `'completed'` flip. A partial insert leaves the row
  at `'analyzing'` and the staleness sweep fails it later — **that is** the
  rollback. Do not add a transaction.
- The route is gated on `CRON_SECRET` as `Authorization: Bearer <value>`. An
  unset secret refuses everything; failing open would leave a money-spending
  route open to anyone who guesses the path.
- `maxDuration = 300` and `MAX_TRANSCRIPTIONS_PER_RUN = 3` are sized to the
  **Hobby** ceiling. Re-measure before raising either.
- The commands:

```
    node scripts/verify-transcription-pipeline.mjs   # needs `npm run dev` running
```

- [ ] **Step 3: Amend the `## Keys` section of `CLAUDE.md`**

It currently reads that the secret key "appears in exactly one place". Replace
that with the two named locations and the reason for the second:

> The secret key bypasses RLS and appears in exactly two places:
> `scripts/verify-rls.mjs`, which reads it from the gitignored `.env.local`, and
> `app/api/cron/transcribe/route.ts`, which reads it from the Vercel
> environment. Both are server-only. The cron route needs it because a cron
> invocation has no user session and therefore no RLS identity — it must read
> and write rows belonging to whichever user recorded them. That is why the
> route is gated on `CRON_SECRET` before it touches anything. Never give either
> a `NEXT_PUBLIC_` prefix — Next.js ships every such variable to the browser.

- [ ] **Step 4: Update `docs/DEPLOYMENT.md`**

Under `### Environment variables`, the file currently states that
`SUPABASE_SECRET_KEY` is "correctly absent from Vercel". That is now **wrong**.
Rewrite the section to list five variables, marking which are set and which the
owner must add, and record the measured Hobby ceilings:

```markdown
### Environment variables

Measured 2026-08-31 with:

    npx vercel env ls --project squid-ink --scope tekguyz

| Variable | Scope | Status |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Preview, Production | set |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Preview, Production | set |
| `SUPABASE_SECRET_KEY` | Production | **must be added** |
| `GEMINI_API_KEY` | Production | **must be added** |
| `CRON_SECRET` | Production | **must be added** |

`SUPABASE_SECRET_KEY` was previously recorded here as "correctly absent". That
is no longer true, and the change is deliberate. `app/api/cron/transcribe`
runs with no user session and therefore no RLS identity, so it needs the key
that bypasses RLS. It is Production-only, never `NEXT_PUBLIC_`-prefixed, and
the route refuses every request that does not carry the `CRON_SECRET` bearer
token before it touches the database or the Gemini API.

Add them with:

    npx vercel env add SUPABASE_SECRET_KEY production --project squid-ink --scope tekguyz
    npx vercel env add GEMINI_API_KEY production --project squid-ink --scope tekguyz
    npx vercel env add CRON_SECRET production --project squid-ink --scope tekguyz

### Cron

`vercel.json` schedules `/api/cron/transcribe`.

**Measured 2026-08-31**, `GET https://api.vercel.com/v2/teams` → the TEKGUYZ
team (`team_agYJ1s4InTpXXycvARJoGQ9g`) is on `billing.plan: "hobby"`. Two
ceilings follow, and both are load-bearing:

| | Hobby (current) | Pro |
|---|---|---|
| Cron frequency | **once per day**; anything more frequent fails deployment | once per minute |
| Cron timing | any moment within the specified hour | within the specified minute |
| Function `maxDuration` | **300 s**, default and maximum | 800 s, 1800 s extended |

The route is also reachable on demand with the same bearer token, which is how
`scripts/verify-transcription-pipeline.mjs` drives it and how a recording can be
transcribed without waiting for the schedule:

    curl -H "Authorization: Bearer $CRON_SECRET" https://squid-ink.vercel.app/api/cron/transcribe
```

- [ ] **Step 5: Resolve the reconciliation entries in `docs/KNOWN_GAPS.md` in place**

Do **not** delete either entry. Under `### A failed upload strands TWO things,
with no reconciliation path`, append a new block in the file's established
`**RESOLVED …**` voice:

```markdown
**BUILT 2026-08-31, Track 3 — tier 2 only.** `lib/transcription/sweep.ts` now
does both halves of tier 2: an `'uploading'` row past one hour with **no object
at its path** is marked `'failed'`, and an `'analyzing'` row past one hour —
a transcription function that died mid-flight — is marked `'failed'` by the
identical query shape against a different status value. Age alone never fails a
row: an old `'uploading'` row whose object IS present is transcribed, because
that is a lost client write-back rather than a lost upload.
`supabase/schemas/notes.sql` now allows `'failed'`, which the earlier note
correctly identified as a prerequisite.

**TIER 1 IS STILL NOT BUILT.** The in-session `'failed'` write on a caught
upload error remains absent from the tree. Track 3's scope fence put
`lib/recorder/` off limits, so this track shipped the constraint that unblocks
it and nothing else. Until it lands, an in-session upload failure is
indistinguishable from a lost session and waits the full hour for tier 2.
The change is roughly three lines in the `catch` block of
`lib/recorder/use-recorder.ts`. **Owner: whoever next opens `lib/recorder/`.**

**IndexedDB cleanup is still unbuilt.** The blob is discarded only on
`'completed'`. Rows that now reach `'failed'` keep their blob forever, which is
the correct conservative choice — nothing can resume an upload from it, but
deleting it would destroy the only copy of the audio. The unbounded-growth
problem the original entry names is therefore narrowed, not closed.
```

- [ ] **Step 6: Add the four new gaps to `docs/KNOWN_GAPS.md`**

Append a new top-level section, `## Transcription pipeline (recorded 2026-08-31)`,
with these four entries written out in full:

1. **No Realtime push. `processing_status` changes are visible on next page
   load only.** A note that finishes transcribing while the page is open keeps
   showing its old status until a navigation or refresh. Supabase Realtime was
   explicitly out of scope for this track. Deliberately deferred, not
   overlooked — and on the Hobby cron schedule the wait dominates anyway.
2. **Recordings past Gemini's caps fail outright.** Over 60 minutes, no call is
   made at all: the row goes straight to `'failed'` with a log line naming the
   duration. There is no segmentation and no stitching. ROADMAP defers both at
   single-owner scale. Between 28 and 60 minutes a recording still transcribes,
   but plain — **no speaker labels and no timestamps**, because Gemini drops its
   cap to 30 minutes the moment either is requested. The transcript pane will
   show one untimed block for those.
3. **No structured note generation and no embeddings.** `summary`, `takeaway`
   and `action_item` chunks are a separate future track needing its own
   persona/depth routing decision. `note_chunks.embedding` is written `null` on
   purpose; the hnsw index over it exists and is empty. Nothing in this track
   populates either.
4. **Transcription latency is bounded by the Vercel plan, not by the code.** On
   Hobby the cron fires once per day, so a recording can sit at `'uploading'`
   for up to 24 hours. The route is callable on demand with the `CRON_SECRET`
   bearer token, which is the current workaround. Moving to Pro makes the
   schedule a one-line change in `vercel.json` and lets `maxDuration` and
   `MAX_TRANSCRIPTIONS_PER_RUN` rise together. Re-measure the plan before
   changing either.

- [ ] **Step 7: Final full verification**

```bash
npm run build
```

```bash
npx tsc --noEmit
```

```bash
npm test
```

```bash
grep -rn "SUPABASE_SECRET_KEY" --include=*.ts --include=*.tsx --include=*.mjs app lib components scripts
```

Expected: three clean runs, and exactly two grep matches. Paste all four outputs.

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md docs/DEPLOYMENT.md docs/KNOWN_GAPS.md
git commit -m "docs: record the transcription pipeline and what it defers"
```

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| Vercel Cron route, `CRON_SECRET`-gated | 7 |
| Sweeps `'uploading'` and `'analyzing'` | 6 |
| Atomic per-row claim, no double-processing | 6, 7 |
| Gemini 3.5 Transcribe behind a clean interface | 3, 4 |
| Diarization as a pure, unit-tested threshold | 2 |
| Writes `raw_transcript` + `note_chunks`, `embedding` null | 5, 7 |
| Status transitions incl. both `'failed'` paths | 1, 6 |
| Migration adding `'failed'` | 1 |
| `scripts/verify-transcription-pipeline.mjs` | 8 |
| `vercel.json` cron schedule, frequency verified | 7 |
| `CLAUDE.md` `## Transcription` + secret-key amendment | 9 |
| `docs/DEPLOYMENT.md` env vars + schedule | 9 |
| `docs/KNOWN_GAPS.md` resolved in place + new gaps | 9 |
| Existence via `list()`, never `download()` | 6, 7 |
| Per-invocation row cap sized to a measured ceiling | 6, 7 |
| Chunk writes precede the `'completed'` flip | 5 |
| No new error-message column | 5, 7 |
| Over-cap recordings fail outright with a log line | 2, 6 |
| Secret key in exactly two files | 7 |
| Conditional `audio_duration_seconds` write | **Not needed** — measured as already written; see "Measured facts" |

**Out of scope and untouched, as specified:** structured note generation, RAG
embeddings, Supabase Realtime, segmentation past Gemini's caps,
`components/note-detail/`, `lib/recorder/`, every RLS policy.
