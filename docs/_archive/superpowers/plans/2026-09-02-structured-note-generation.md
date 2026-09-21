# Structured Note Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a completed transcript into `summary` / `takeaway` / `action_item` rows in `note_chunks` with one Gemini call per note, chained automatically off transcription reaching `'completed'`.

**Architecture:** Seven files under `lib/notegen/` mirroring `lib/transcription/` one for one — same atomic-claim pattern, same injected-ports DI, same cost guarantees. A new nullable `notes.notegen_status` column is the queue, exactly as `processing_status` is for transcription. Two existing transcription-completion call sites (the cron sweep, and the manual action's `after()` block) each call one shared claim-and-generate function.

**Tech Stack:** Next.js 16.3.3 App Router, TypeScript 7.0.2, `@google/genai` 2.19.0 (`gemini-3.7-flash`), `@supabase/supabase-js` 2.112.4, Vitest 4.1.11, Postgres via the Supabase CLI 2.115.0 declarative-schema workflow.

**Spec:** `docs/superpowers/specs/2026-09-02-structured-note-generation-design.md`

## Global Constraints

- **Working directory is the worktree:** `C:\Projects\tekguyz-squid-ink\.claude\worktrees\notegen`, branch `worktree-notegen`. Baseline is 36 test files / 351 tests green.
- **400-line hard ceiling** on every file under `app/`, `components/`, `lib/`. `components/note-detail/__tests__/project-conventions.test.ts` fails the build otherwise. Test files are exempt (the walk skips `__tests__`).
- **Zero colour literals** in `components/` and `lib/`. Same guard test. Not relevant to this work but it runs on every file added.
- **Exactly one shipped file may read `SUPABASE_SECRET_KEY`:** `app/api/cron/transcribe/route.ts`. Same guard test. No file in `lib/notegen/` reads any environment variable — the caller supplies the client and the key.
- **No application name anywhere in code.** User-facing copy stays generic.
- **Model id is `gemini-3.7-flash`.** Verified live 2026-09-02: `inputTokenLimit=1048576`, `outputTokenLimit=65536`.
- **`thinking_level` values are lowercase strings** — `"minimal" | "low" | "medium" | "high"` (`genai.d.ts:14439`). Never the SCREAMING_CASE `ThinkingLevel` enum, which belongs to the other SDK surface.
- **`response_format` is top level on `interactions.create`**, not inside `generation_config` (`genai.d.ts:2803`). Shape `{ type: "text", mime_type: "application/json", schema }`. The top-level `response_mime_type` is `@deprecated` — do not use it.
- **Persona lookup filters `user_id` AND `slug`**, never `personas.id`, never `name`. See spec § Corrections 1.
- **Generated chunks always write `persona_id: null`** regardless of which persona config resolved.
- **`embedding` is always written `null`.** No TODO comment about it.
- **Never `download()` to prove anything.** Not relevant here — this pipeline is text-only and never touches Storage.
- **Do not edit `lib/transcription/*`.** Read from it, import from it, never modify it.
- **Schema-file-first.** Never paste DDL as an inline `db query` argument. Edit the `.sql` file, apply that exact file with `--file`. Inline `db query` is for `select` verification only.
- **Never run `apply_migration` while iterating** — it writes a migration history entry every call and blocks further diffing.
- Project ref for every CLI call: `pbwvvakzbrimmdntqxxn`.

---

### Task 1: Schema — `notegen_status` column and the `personas` grant

**Files:**
- Modify: `supabase/schemas/notes.sql` (append a column, a constraint block)
- Modify: `supabase/schemas/personas.sql:~110` (the grant block at the end)
- Modify: `lib/notes/types.ts` (add `notegen_status` to `NoteRow`)

**Interfaces:**
- Consumes: nothing.
- Produces: `notes.notegen_status` (`text`, nullable, checked against `'generating' | 'completed' | 'failed'`); `service_role` holds `SELECT` on `public.personas`; `NotegenStatus` type exported from `lib/notes/view-types.ts`.

**This task crosses the originating brief's "must not touch `personas.sql`" fence.** That fence existed to stop lens-text-as-column scope creep. It did not anticipate a missing grant. Cron note-gen cannot read a persona without it. Name this crossing in the final report.

- [ ] **Step 1: Add the column and its constraint to `notes.sql`**

Append to `supabase/schemas/notes.sql`, immediately after the existing `notes_processing_status_check` block and before the `notes_user_id_created_at_idx` index:

```sql
-- notegen_status: structured note generation's own queue, exactly as
-- processing_status is transcription's. There is no job table here either.
--
-- Nullable with no default, and null is load-bearing: it means "not eligible
-- yet". Every row is null until a transcript exists, so there is no 'pending'
-- string to invent — the column's nullability already says it.
--
-- The claim guard is two conditions, not one:
--   processing_status = 'completed' AND notegen_status IS NULL
-- which makes "cannot generate notes before a transcript exists" true by
-- construction rather than by caller discipline.
--
-- 'failed' is terminal and there is no retry, matching processing_status. It
-- is reached two ways: a caught error during generation, and a 'generating'
-- row swept after one hour by lib/notegen/sweep.ts.
alter table public.notes
  add column if not exists notegen_status text;

alter table public.notes
  drop constraint if exists notes_notegen_status_check;
alter table public.notes
  add constraint notes_notegen_status_check
  check (notegen_status in ('generating', 'completed', 'failed'));
```

No new policy and no new grant on `notes`. The four existing per-operation policies and the existing `service_role` grant already cover an added column on an already-covered table.

- [ ] **Step 2: Add the `service_role` grant to `personas.sql`**

Replace the final two lines of `supabase/schemas/personas.sql`:

```sql
revoke all on public.personas from anon, authenticated;

-- anon is deliberately granted nothing — this app has no public reads.
grant select, insert, update, delete on public.personas to authenticated;
```

with:

```sql
-- Revoke first, then grant, so this file is the sole authority on
-- privileges. The project defaults hand anon and authenticated TRUNCATE,
-- REFERENCES and TRIGGER on every new public table; TRUNCATE is not
-- row-level, so RLS does not constrain it.
revoke all on public.personas from anon, authenticated, service_role;

-- anon is deliberately granted nothing — this app has no public reads.
grant select, insert, update, delete on public.personas to authenticated;

-- service_role, for app/api/cron/transcribe's note-generation phase, which
-- must read the note owner's lens config to know which depth to generate at.
--
-- MEASURED 2026-09-02, the same way and with the same result as the notes and
-- note_chunks gaps found on 2026-08-31: role_table_grants showed service_role
-- holding only REFERENCES, TRIGGER and TRUNCATE here, so a cron persona read
-- would have failed with "permission denied for table personas".
--
-- A GRANT, not a policy. service_role already bypasses RLS; what it lacked was
-- reachability. The revoke above also strips the TRUNCATE it held for no
-- reason.
--
-- SELECT ONLY. Nothing in this project writes a persona as service_role —
-- provisioning is a security definer trigger running as supabase_auth_admin,
-- and every user-facing edit runs as authenticated under RLS.
grant select on public.personas to service_role;
```

- [ ] **Step 3: Apply both schema files**

Schema-file-first, in `config.toml` dependency order. Run from the worktree root:

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn --file supabase/schemas/notes.sql
```

Then:

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn --file supabase/schemas/personas.sql
```

Both files are fully idempotent, so re-running either is safe.

- [ ] **Step 4: Read the live catalog back — do not claim, verify**

Write `/tmp/verify-task1.sql`:

```sql
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.notes'::regclass and conname = 'notes_notegen_status_check';

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'notes' and column_name = 'notegen_status';

select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'personas'
group by grantee order by grantee;
```

Run:

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn --file /tmp/verify-task1.sql
```

Expected, all three:
- `notes_notegen_status_check` with def `CHECK (notegen_status = ANY (ARRAY['generating'::text, 'completed'::text, 'failed'::text]))`
- `notegen_status | text | YES | (null default)`
- `service_role` row reading exactly `SELECT` — no TRUNCATE, no REFERENCES, no TRIGGER

If `service_role` still shows `REFERENCES, TRIGGER, TRUNCATE`, the revoke did not include it. Re-check Step 2 and re-apply.

- [ ] **Step 5: Add the type to `lib/notes/view-types.ts`**

Find the existing `ProcessingStatus` declaration and add beneath it:

```ts
/** Structured note generation's own status, independent of ProcessingStatus.
 *  Null means "not eligible yet" — the transcript does not exist. */
export type NotegenStatus = "generating" | "completed" | "failed";
```

- [ ] **Step 6: Add the column to `NoteRow` in `lib/notes/types.ts`**

In the `NoteRow` interface, after `processing_status`:

```ts
  /** Null until a transcript exists. See supabase/schemas/notes.sql. */
  notegen_status: NotegenStatus | null;
```

and extend the existing import from `@/lib/notes/view-types` to include `NotegenStatus`.

- [ ] **Step 7: Typecheck and test**

```bash
npm run typecheck
```

Expected: PASS. If `NoteRow` is constructed literally anywhere in tests, those constructions now need the field — fix them by adding `notegen_status: null`.

```bash
npm test
```

Expected: 36 files / 351 tests, 0 failures.

- [ ] **Step 8: Commit**

```bash
git add supabase/schemas/notes.sql supabase/schemas/personas.sql lib/notes/types.ts lib/notes/view-types.ts
git commit -m "feat(notegen): notegen_status column, and the personas grant cron needs

notegen_status is nullable with no default because null means 'not eligible
yet' — the transcript does not exist. The claim guard is two conditions,
processing_status = 'completed' AND notegen_status IS NULL, which makes
'cannot generate notes before a transcript exists' true by construction.

The personas grant is a fence crossing, stated rather than slipped in. The
originating brief said not to touch personas.sql, to stop lens-text-as-column
scope creep; it did not anticipate a grant gap. role_table_grants showed
service_role holding only REFERENCES, TRIGGER and TRUNCATE on personas, so the
cron path's persona read would have failed with permission denied — the same
gap found on notes and note_chunks on 2026-08-31, found the same way. Select
only: nothing writes a persona as service_role.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `depth-policy.ts` — depth to thinking level and scope

**Files:**
- Create: `lib/notegen/depth-policy.ts`
- Test: `lib/notegen/__tests__/depth-policy.test.ts`

**Interfaces:**
- Consumes: `PersonaDepth` from `@/lib/notes/view-types`.
- Produces:
  - `export type ThinkingLevel = "minimal" | "low" | "medium" | "high"`
  - `export interface DepthPlan { thinkingLevel: ThinkingLevel; scope: DepthScope; wantsSummary: boolean }`
  - `export type DepthScope = "decisions-and-actions" | "balanced" | "cross-referenced"`
  - `export function planForDepth(depth: PersonaDepth): DepthPlan`

- [ ] **Step 1: Write the failing test**

Create `lib/notegen/__tests__/depth-policy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planForDepth } from "@/lib/notegen/depth-policy";

describe("planForDepth", () => {
  it("maps brief to low, and to decisions and actions only", () => {
    expect(planForDepth("brief")).toEqual({
      thinkingLevel: "low",
      scope: "decisions-and-actions",
      wantsSummary: false,
    });
  });

  it("maps dense to medium, and to all three at balanced depth", () => {
    expect(planForDepth("dense")).toEqual({
      thinkingLevel: "medium",
      scope: "balanced",
      wantsSummary: true,
    });
  });

  it("maps exhaustive to high, and widens scope rather than length", () => {
    expect(planForDepth("exhaustive")).toEqual({
      thinkingLevel: "high",
      scope: "cross-referenced",
      wantsSummary: true,
    });
  });

  it("falls back to the dense plan for a depth outside the union", () => {
    // The column is checked, so this is unreachable through the database.
    // It is reachable through DEFAULT_PERSONA_FALLBACK drifting, or a future
    // custom-persona phase, and a throw here would kill a whole cron run.
    expect(planForDepth("wide" as never)).toEqual(planForDepth("dense"));
  });

  it("never emits the SCREAMING_CASE enum members", () => {
    // genai.d.ts declares BOTH a lowercase union (the interactions surface,
    // which is the one we call) and a ThinkingLevel enum whose members are
    // "LOW"/"MEDIUM"/"HIGH" (the models.generateContent surface). Sending the
    // wrong casing is a 400 that only shows up live.
    for (const depth of ["brief", "dense", "exhaustive"] as const) {
      const { thinkingLevel } = planForDepth(depth);
      expect(thinkingLevel).toBe(thinkingLevel.toLowerCase());
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run lib/notegen/__tests__/depth-policy.test.ts
```

Expected: FAIL — cannot resolve `@/lib/notegen/depth-policy`.

- [ ] **Step 3: Write the implementation**

Create `lib/notegen/depth-policy.ts`:

```ts
import type { PersonaDepth } from "@/lib/notes/view-types";

/** Depth to a Gemini reasoning budget and a prompt scope.
 *
 *  A pure function of the persona's depth column, deliberately — the same
 *  shape lib/transcription/diarization-policy.ts uses for duration. No I/O, no
 *  SDK import, so the mapping is testable without a network.
 *
 *  DEPTH CHANGES SCOPE, NOT ONLY LENGTH. DECISIONS.md § "Structured note
 *  generation" is explicit that Exhaustive does more analytical work than a
 *  longer Dense. That is why this returns a scope alongside the thinking
 *  level: a single "how hard to think" number would make Exhaustive a Dense
 *  run with a bigger budget, which is precisely the thing that decision
 *  rejected.
 *
 *  THE VALUES ARE LOWERCASE, AND THAT MATTERS. genai.d.ts declares two
 *  different things named for thinking level: the lowercase union
 *  "minimal" | "low" | "medium" | "high" on GenerationConfig_2 (:14439), which
 *  is the interactions.create surface this project calls, and a ThinkingLevel
 *  enum whose members are SCREAMING_CASE (:14409), which belongs to the
 *  camelCase models.generateContent surface. Sending the enum member here is a
 *  400 that no unit test would catch. Read from the pinned 2.19.0 types on
 *  2026-09-02. */

export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

/** What the model is asked to produce, not how much of it.
 *
 *  - decisions-and-actions: decisions taken and action items. No summary.
 *  - balanced: summary, takeaways and action items, each at even weight.
 *  - cross-referenced: the same three, plus explicit cross-referencing
 *    between them and inference of action items only implied by the talk. */
export type DepthScope = "decisions-and-actions" | "balanced" | "cross-referenced";

export interface DepthPlan {
  thinkingLevel: ThinkingLevel;
  scope: DepthScope;
  /** Brief produces no summary at all, so persist-result must not fabricate an
   *  empty one and the response schema must not require it. */
  wantsSummary: boolean;
}

const DENSE: DepthPlan = {
  thinkingLevel: "medium",
  scope: "balanced",
  wantsSummary: true,
};

const PLANS: Record<PersonaDepth, DepthPlan> = {
  brief: {
    thinkingLevel: "low",
    scope: "decisions-and-actions",
    wantsSummary: false,
  },
  dense: DENSE,
  exhaustive: {
    thinkingLevel: "high",
    scope: "cross-referenced",
    wantsSummary: true,
  },
};

export function planForDepth(depth: PersonaDepth): DepthPlan {
  // A depth outside the union cannot come from the database — the column is
  // checked. It can come from DEFAULT_PERSONA_FALLBACK drifting out of step
  // with the column, or from the custom-persona phase DECISIONS.md defers.
  // Dense is the honest default there; a throw would fail a whole cron run
  // over one malformed lens.
  return PLANS[depth] ?? DENSE;
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run lib/notegen/__tests__/depth-policy.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/notegen/depth-policy.ts lib/notegen/__tests__/depth-policy.test.ts
git commit -m "feat(notegen): depth to thinking level and prompt scope

Pure, no SDK import, mirroring diarization-policy.ts. Returns a scope
alongside the level because DECISIONS.md is explicit that Exhaustive does more
analytical work rather than longer output, and a bare level would have made it
a Dense run with a bigger budget.

Lowercase values, asserted. genai.d.ts declares both a lowercase union for the
interactions surface we call and a SCREAMING_CASE enum for the other one;
sending the wrong casing is a 400 no unit test would otherwise catch.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `lens-prompts.ts` — the four lenses, keyed by slug

**Files:**
- Create: `lib/notegen/lens-prompts.ts`
- Test: `lib/notegen/__tests__/lens-prompts.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_PERSONA_ID` from `@/lib/notes/default-persona` (read-only import).
- Produces:
  - `export interface LensPrompt { slug: string; label: string; framing: string }`
  - `export function lensPromptFor(slug: string): LensPrompt`

- [ ] **Step 1: Write the failing test**

Create `lib/notegen/__tests__/lens-prompts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { lensPromptFor } from "@/lib/notegen/lens-prompts";
import { DEFAULT_PERSONA_ID } from "@/lib/notes/default-persona";

describe("lensPromptFor", () => {
  it("has a distinct framing for each of the four locked lenses", () => {
    const slugs = [
      "neutral-analyst",
      "sales-coach",
      "investor",
      "engineering-lead",
    ];
    const framings = slugs.map((s) => lensPromptFor(s).framing);

    for (const framing of framings) expect(framing.length).toBeGreaterThan(0);
    expect(new Set(framings).size).toBe(4);
  });

  it("keys on slug, which is what the database uniquely constrains", () => {
    expect(lensPromptFor("sales-coach").slug).toBe("sales-coach");
  });

  it("falls back to the neutral lens for an unrecognised slug", () => {
    // Custom personas are a documented later phase. One arriving early must
    // not throw inside a cron run.
    expect(lensPromptFor("chief-vibes-officer")).toEqual(
      lensPromptFor(DEFAULT_PERSONA_ID),
    );
  });

  it("falls back for an empty slug rather than returning undefined", () => {
    expect(lensPromptFor("").framing).toBe(lensPromptFor(DEFAULT_PERSONA_ID).framing);
  });

  it("is keyed by the same slugs persona_provisioning.sql inserts", () => {
    // If provisioning ever renames a slug, this catches the drift here rather
    // than as silently neutral output for three of the four lenses.
    for (const slug of [
      "neutral-analyst",
      "sales-coach",
      "investor",
      "engineering-lead",
    ]) {
      expect(lensPromptFor(slug).slug).toBe(slug);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run lib/notegen/__tests__/lens-prompts.test.ts
```

Expected: FAIL — cannot resolve `@/lib/notegen/lens-prompts`.

- [ ] **Step 3: Write the implementation**

Create `lib/notegen/lens-prompts.ts`:

```ts
import { DEFAULT_PERSONA_ID } from "@/lib/notes/default-persona";

/** How each lens is described to the model.
 *
 *  A static lookup in code, keyed by slug, and NOT a column. This is
 *  prompt-engineering configuration — the same category as
 *  components/note-detail/speaker-colors.ts, which maps a persona to a token
 *  name because Tailwind cannot build class names at runtime. It is
 *  emphatically not the same category as the deleted persona-presets.ts, which
 *  duplicated whole preset objects the personas table now owns. The row still
 *  owns identity, ordering, depth and quick-actions; this owns only the
 *  sentence handed to Gemini.
 *
 *  KEYED BY SLUG. personas.sql declares and indexes unique (user_id, slug) and
 *  states in its own header that slug is the key chosen to survive a reseed.
 *  name carries neither constraint nor index and is display text, so a future
 *  rename would silently route three lenses to neutral output. Recorded in
 *  CLAUDE.md § Data and DECISIONS.md § Personas on 2026-09-02.
 *
 *  The four slugs below are exactly the four persona_provisioning.sql inserts.
 *  A fifth arriving from the deferred custom-persona phase falls back to
 *  neutral rather than throwing — a cron run must not die on one odd lens. */

export interface LensPrompt {
  slug: string;
  /** The lens's display name, used inside the prompt so the model has a role
   *  rather than only a list of instructions. */
  label: string;
  /** One paragraph. What this lens looks for and what it leaves alone. */
  framing: string;
}

const NEUTRAL: LensPrompt = {
  slug: DEFAULT_PERSONA_ID,
  label: "Neutral Analyst",
  framing:
    "Read the transcript as a neutral analyst. Report what was actually " +
    "said and decided, with no framing, no coaching and no advocacy. Prefer " +
    "the speakers' own words for anything contested. Where the conversation " +
    "left something unresolved, say it is unresolved rather than resolving " +
    "it yourself.",
};

const LENSES: Record<string, LensPrompt> = {
  [DEFAULT_PERSONA_ID]: NEUTRAL,

  "sales-coach": {
    slug: "sales-coach",
    label: "Sales Coach",
    framing:
      "Read the transcript as a sales coach reviewing a call with the rep " +
      "who ran it. Attend to objections and how they were handled, buying " +
      "signals, concessions made, and commitments given on either side. Be " +
      "direct about what was mishandled. Do not soften a weak moment into a " +
      "neutral one.",
  },

  investor: {
    slug: "investor",
    label: "Investor",
    framing:
      "Read the transcript as an investor assessing the business behind the " +
      "conversation. Attend to unit economics, claimed and implied numbers, " +
      "expansion and concentration risk, and anything asserted without " +
      "evidence. Quantify where the transcript gives you the figures, and " +
      "name the gap where it does not.",
  },

  "engineering-lead": {
    slug: "engineering-lead",
    label: "Engineering Lead",
    framing:
      "Read the transcript as the engineering lead who has to deliver what " +
      "was discussed. Attend to scope, sequencing, dependencies, and the " +
      "assumptions that would break the plan if wrong. Separate what was " +
      "actually committed to from what was merely floated.",
  },
};

export function lensPromptFor(slug: string): LensPrompt {
  return LENSES[slug] ?? NEUTRAL;
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run lib/notegen/__tests__/lens-prompts.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/notegen/lens-prompts.ts lib/notegen/__tests__/lens-prompts.test.ts
git commit -m "feat(notegen): the four lens framings, keyed by slug

Static lookup in code, same category as speaker-colors.ts, not the same
category as the deleted persona-presets.ts — the row still owns identity,
depth, ordering and quick-actions; this owns only the sentence handed to
Gemini.

Keyed by slug because that is the column personas.sql uniquely constrains and
indexes. An unrecognised slug falls back to neutral rather than throwing: the
custom-persona phase is deferred, not forbidden, and a cron run must not die
on one odd lens.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `persist-result.ts` — rows, and the one safe write order

**Files:**
- Create: `lib/notegen/persist-result.ts`
- Test: `lib/notegen/__tests__/persist-result.test.ts`

**Interfaces:**
- Consumes: `ChunkMetadata` from `@/lib/notes/types`.
- Produces:
  - `export interface GeneratedNote { summary: string | null; takeaways: string[]; actionItems: string[] }`
  - `export interface NotegenChunkInsert { note_id: string; user_id: string; chunk_type: "summary" | "takeaway" | "action_item"; persona_id: null; embedding: null; content: string; metadata: ChunkMetadata }`
  - `export interface NotegenStore { deleteGeneratedChunks(noteId: string): Promise<void>; insertChunks(rows: NotegenChunkInsert[]): Promise<void>; completeNotegen(noteId: string): Promise<boolean>; failNotegen(noteId: string): Promise<boolean> }`
  - `export function generatedChunkRowsFor(args: { noteId: string; userId: string; note: GeneratedNote }): NotegenChunkInsert[]`
  - `export async function persistGeneratedNote(args: { store: NotegenStore; noteId: string; userId: string; note: GeneratedNote }): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `lib/notegen/__tests__/persist-result.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  generatedChunkRowsFor,
  persistGeneratedNote,
  type GeneratedNote,
  type NotegenStore,
} from "@/lib/notegen/persist-result";

const NOTE: GeneratedNote = {
  summary: "They agreed to ship the mapping work first.",
  takeaways: ["Mapping ships first", "Billing slips a week"],
  actionItems: ["Dana to draft the sequencing plan"],
};

function storeSpy(overrides: Partial<NotegenStore> = {}) {
  const calls: string[] = [];
  const store: NotegenStore = {
    deleteGeneratedChunks: vi.fn(async () => {
      calls.push("delete");
    }),
    insertChunks: vi.fn(async () => {
      calls.push("insert");
    }),
    completeNotegen: vi.fn(async () => {
      calls.push("complete");
      return true;
    }),
    failNotegen: vi.fn(async () => true),
    ...overrides,
  };
  return { store, calls };
}

describe("generatedChunkRowsFor", () => {
  it("writes persona_id null on every row whatever resolved the config", () => {
    const rows = generatedChunkRowsFor({
      noteId: "n1",
      userId: "u1",
      note: NOTE,
    });
    expect(rows.every((r) => r.persona_id === null)).toBe(true);
  });

  it("writes embedding null on every row", () => {
    const rows = generatedChunkRowsFor({ noteId: "n1", userId: "u1", note: NOTE });
    expect(rows.every((r) => r.embedding === null)).toBe(true);
  });

  it("emits one summary, then takeaways, then action items", () => {
    const rows = generatedChunkRowsFor({ noteId: "n1", userId: "u1", note: NOTE });
    expect(rows.map((r) => r.chunk_type)).toEqual([
      "summary",
      "takeaway",
      "takeaway",
      "action_item",
    ]);
  });

  it("numbers takeaways from 01 for the rendered ordinal", () => {
    const rows = generatedChunkRowsFor({ noteId: "n1", userId: "u1", note: NOTE });
    const takeaways = rows.filter((r) => r.chunk_type === "takeaway");
    expect(takeaways.map((r) => r.metadata.n)).toEqual(["01", "02"]);
  });

  it("emits no summary row when the depth produced none", () => {
    const rows = generatedChunkRowsFor({
      noteId: "n1",
      userId: "u1",
      note: { ...NOTE, summary: null },
    });
    expect(rows.some((r) => r.chunk_type === "summary")).toBe(false);
  });

  it("drops blank entries rather than writing empty chunks", () => {
    const rows = generatedChunkRowsFor({
      noteId: "n1",
      userId: "u1",
      note: { summary: "   ", takeaways: ["", "  ", "real"], actionItems: [] },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("real");
    expect(rows[0].metadata.n).toBe("01");
  });
});

describe("persistGeneratedNote", () => {
  it("deletes, inserts, then flips — in that order", async () => {
    const { store, calls } = storeSpy();
    await persistGeneratedNote({ store, noteId: "n1", userId: "u1", note: NOTE });
    expect(calls).toEqual(["delete", "insert", "complete"]);
  });

  it("still deletes and flips when the model produced nothing usable", async () => {
    // A completed note with zero chunks is a legitimate outcome for a
    // transcript with no decisions in it. Leaving it at 'generating' would
    // hand it to the staleness sweep an hour later for no reason.
    const { store, calls } = storeSpy();
    await persistGeneratedNote({
      store,
      noteId: "n1",
      userId: "u1",
      note: { summary: null, takeaways: [], actionItems: [] },
    });
    expect(calls).toEqual(["delete", "complete"]);
  });

  it("throws when the flip finds the row is no longer 'generating'", async () => {
    const { store } = storeSpy({ completeNotegen: vi.fn(async () => false) });
    await expect(
      persistGeneratedNote({ store, noteId: "n1", userId: "u1", note: NOTE }),
    ).rejects.toThrow(/no longer 'generating'/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run lib/notegen/__tests__/persist-result.test.ts
```

Expected: FAIL — cannot resolve `@/lib/notegen/persist-result`.

- [ ] **Step 3: Write the implementation**

Create `lib/notegen/persist-result.ts`:

```ts
import type { ChunkMetadata } from "@/lib/notes/types";

/** Turns a GeneratedNote into rows, and writes them in the one order that is
 *  safe to crash in the middle of.
 *
 *  Chunks are written BEFORE the 'completed' flip, exactly as
 *  lib/transcription/persist-result.ts writes transcript segments before its
 *  own flip. If insertion dies partway, the row stays at 'generating' and the
 *  staleness sweep in lib/notegen/sweep.ts marks it 'failed' an hour later.
 *  THAT EXISTING NET IS THE ROLLBACK — there is deliberately no transaction
 *  and no compensating write, because a second mechanism for the same failure
 *  is a second thing to get wrong.
 *
 *  The delete-then-insert is idempotency, not cleanup: a run that crashed
 *  after inserting would otherwise leave chunks a later successful run
 *  doubles.
 *
 *  FIRST-RUN SIDE EFFECT, EXPECTED. The claim guard matches every note already
 *  at processing_status = 'completed', which on first run includes the seeded
 *  note carrying hand-written takeaways at persona_id null. The delete below
 *  removes those and the insert replaces them with generated ones. That is the
 *  designed behaviour, not a bug — the seed rows were a fixture standing in
 *  for this pipeline. */

export interface GeneratedNote {
  /** Null when the depth produced none — Brief asks for decisions and action
   *  items only. Not an empty string: absent and blank are different, and only
   *  one of them should reach the database as a row. */
  summary: string | null;
  takeaways: string[];
  actionItems: string[];
}

export type NotegenChunkType = "summary" | "takeaway" | "action_item";

export interface NotegenChunkInsert {
  note_id: string;
  user_id: string;
  chunk_type: NotegenChunkType;
  /** Null, always, whichever persona config drove generation. Null reads as
   *  the default persona, which is the existing convention every chunk written
   *  before the personas table follows. The resolved persona supplies lens and
   *  depth to the generator and is never persisted onto a chunk. */
  persona_id: null;
  /** RAG embeddings are a separate track. Explicitly null, not omitted, so the
   *  intent is visible at the call site. */
  embedding: null;
  content: string;
  metadata: ChunkMetadata;
}

export interface NotegenStore {
  deleteGeneratedChunks(noteId: string): Promise<void>;
  insertChunks(rows: NotegenChunkInsert[]): Promise<void>;
  /** Atomic: flips 'generating' -> 'completed' only if the row is still
   *  'generating'. False means the staleness sweep took it first. */
  completeNotegen(noteId: string): Promise<boolean>;
  /** Atomic: flips 'generating' -> 'failed'. False means somebody else moved
   *  it. Terminal — there is no retry. */
  failNotegen(noteId: string): Promise<boolean>;
}

/** Two digits, matching ChunkMetadata.n's documented "01", "02", "03". */
function ordinal(index: number): string {
  return String(index + 1).padStart(2, "0");
}

export function generatedChunkRowsFor(args: {
  noteId: string;
  userId: string;
  note: GeneratedNote;
}): NotegenChunkInsert[] {
  const { noteId, userId, note } = args;

  const base = {
    note_id: noteId,
    user_id: userId,
    persona_id: null as null,
    embedding: null as null,
  };

  const rows: NotegenChunkInsert[] = [];

  // A blank string from the model is not a chunk. Guarding here rather than at
  // the call site keeps the rule in one place for all three types.
  const summary = note.summary?.trim();
  if (summary) {
    rows.push({
      ...base,
      chunk_type: "summary",
      content: summary,
      metadata: { seq: 0 },
    });
  }

  const takeaways = note.takeaways.map((t) => t.trim()).filter(Boolean);
  takeaways.forEach((content, index) => {
    rows.push({
      ...base,
      chunk_type: "takeaway",
      content,
      // n is the rendered ordinal; seq is position within the type. Both, so a
      // reader does not have to derive one from the other.
      metadata: { seq: index, n: ordinal(index) },
    });
  });

  const actions = note.actionItems.map((a) => a.trim()).filter(Boolean);
  actions.forEach((content, index) => {
    // No owner and no due. ROADMAP §5 keeps action items bare text until the
    // drawer that would edit those fields exists.
    rows.push({
      ...base,
      chunk_type: "action_item",
      content,
      metadata: { seq: index, n: ordinal(index) },
    });
  });

  return rows;
}

export async function persistGeneratedNote(args: {
  store: NotegenStore;
  noteId: string;
  userId: string;
  note: GeneratedNote;
}): Promise<void> {
  const { store, noteId, userId, note } = args;

  const rows = generatedChunkRowsFor({ noteId, userId, note });

  await store.deleteGeneratedChunks(noteId);
  if (rows.length > 0) await store.insertChunks(rows);

  // Zero rows still completes. A transcript with nothing decided in it is a
  // legitimate outcome, and leaving the row at 'generating' would hand it to
  // the staleness sweep an hour later for no reason.
  const completed = await store.completeNotegen(noteId);

  if (!completed) {
    throw new Error(
      `note ${noteId} was no longer 'generating' when its notes were ready`,
    );
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run lib/notegen/__tests__/persist-result.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/notegen/persist-result.ts lib/notegen/__tests__/persist-result.test.ts
git commit -m "feat(notegen): generated chunk rows, and the one safe write order

Chunks before the flip, mirroring lib/transcription/persist-result.ts. A
partial insert leaves the row at 'generating' and the staleness sweep fails it
an hour later — that existing net is the rollback, so there is no transaction
and no compensating write.

persona_id null on every row whatever resolved the config, and embedding null.
Zero usable rows still completes: a transcript with nothing decided in it is a
real outcome, and stranding it at 'generating' would cost a pointless sweep.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `gemini-client.ts` — the only module knowing the wire format

**Files:**
- Create: `lib/notegen/gemini-client.ts`
- Test: `lib/notegen/__tests__/gemini-client.test.ts`

**Interfaces:**
- Consumes: `DepthPlan` from `@/lib/notegen/depth-policy`; `LensPrompt` from `@/lib/notegen/lens-prompts`; `GeneratedNote` from `@/lib/notegen/persist-result`.
- Produces:
  - `export const GEMINI_NOTEGEN_MODEL = "gemini-3.7-flash"`
  - `export interface NoteGenRequest { transcript: string; lens: LensPrompt; plan: DepthPlan }`
  - `export type NoteGenerator = (request: NoteGenRequest) => Promise<GeneratedNote>`
  - `export function systemPromptFor(lens: LensPrompt, plan: DepthPlan): string`
  - `export function responseSchemaFor(plan: DepthPlan): Record<string, unknown>`
  - `export function parseGeneratedNote(rawText: string): GeneratedNote`
  - `export function createGeminiNoteGenerator(apiKey: string): NoteGenerator`

- [ ] **Step 1: Write the failing test**

Create `lib/notegen/__tests__/gemini-client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  GEMINI_NOTEGEN_MODEL,
  parseGeneratedNote,
  responseSchemaFor,
  systemPromptFor,
} from "@/lib/notegen/gemini-client";
import { planForDepth } from "@/lib/notegen/depth-policy";
import { lensPromptFor } from "@/lib/notegen/lens-prompts";

describe("GEMINI_NOTEGEN_MODEL", () => {
  it("is the flash id verified live on 2026-09-02", () => {
    expect(GEMINI_NOTEGEN_MODEL).toBe("gemini-3.7-flash");
  });
});

describe("systemPromptFor", () => {
  it("carries the lens framing verbatim", () => {
    const lens = lensPromptFor("investor");
    expect(systemPromptFor(lens, planForDepth("dense"))).toContain(lens.framing);
  });

  it("asks brief for no summary and exhaustive for cross-referencing", () => {
    const lens = lensPromptFor("neutral-analyst");
    const brief = systemPromptFor(lens, planForDepth("brief"));
    const exhaustive = systemPromptFor(lens, planForDepth("exhaustive"));

    expect(brief).toMatch(/no summary/i);
    expect(exhaustive).toMatch(/cross-referenc/i);
    expect(brief).not.toEqual(exhaustive);
  });

  it("differs across all three depths for one lens", () => {
    const lens = lensPromptFor("neutral-analyst");
    const prompts = (["brief", "dense", "exhaustive"] as const).map((d) =>
      systemPromptFor(lens, planForDepth(d)),
    );
    expect(new Set(prompts).size).toBe(3);
  });
});

describe("responseSchemaFor", () => {
  it("omits summary entirely when the depth wants none", () => {
    const schema = responseSchemaFor(planForDepth("brief"));
    expect(Object.keys(schema.properties as object)).toEqual([
      "takeaways",
      "action_items",
    ]);
  });

  it("requires all three when the depth wants a summary", () => {
    const schema = responseSchemaFor(planForDepth("dense"));
    expect(schema.required).toEqual(["summary", "takeaways", "action_items"]);
  });
});

describe("parseGeneratedNote", () => {
  it("reads the three fields off well-formed JSON", () => {
    expect(
      parseGeneratedNote(
        '{"summary":"S","takeaways":["a","b"],"action_items":["c"]}',
      ),
    ).toEqual({ summary: "S", takeaways: ["a", "b"], actionItems: ["c"] });
  });

  it("returns a null summary when the field is absent", () => {
    expect(parseGeneratedNote('{"takeaways":[],"action_items":[]}').summary).toBeNull();
  });

  it("tolerates a fenced code block around the JSON", () => {
    // response_format should prevent this, but a model that ignores it once
    // must not cost the whole call. Cheap to tolerate, expensive to be
    // surprised by in production.
    const fenced = '```json\n{"summary":"S","takeaways":[],"action_items":[]}\n```';
    expect(parseGeneratedNote(fenced).summary).toBe("S");
  });

  it("throws with the offending text when the body is not JSON", () => {
    expect(() => parseGeneratedNote("I'm afraid I can't do that")).toThrow(
      /did not return JSON/i,
    );
  });

  it("coerces a non-array takeaways field to an empty array", () => {
    expect(
      parseGeneratedNote('{"summary":"S","takeaways":"oops","action_items":[]}')
        .takeaways,
    ).toEqual([]);
  });

  it("drops non-string entries rather than writing them as chunks", () => {
    expect(
      parseGeneratedNote('{"takeaways":["a",5,null,"b"],"action_items":[]}')
        .takeaways,
    ).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run lib/notegen/__tests__/gemini-client.test.ts
```

Expected: FAIL — cannot resolve `@/lib/notegen/gemini-client`.

- [ ] **Step 3: Write the implementation**

Create `lib/notegen/gemini-client.ts`:

```ts
import type { DepthPlan } from "@/lib/notegen/depth-policy";
import type { LensPrompt } from "@/lib/notegen/lens-prompts";
import type { GeneratedNote } from "@/lib/notegen/persist-result";

/** The ONLY module in this track that knows Gemini's wire format.
 *
 *  Everything below the NoteGenerator boundary speaks GeneratedNote, so
 *  replacing the provider is a change to this file and nothing else — the same
 *  boundary lib/transcription/gemini-client.ts draws.
 *
 *  Every shape below was read from node_modules/@google/genai/dist/genai.d.ts
 *  at the pinned 2.19.0 on 2026-09-02, and the model id from the live models
 *  endpoint the same day. None of it is recalled and none is copied from the
 *  published samples. Three details are load-bearing:
 *
 *  1. response_format IS TOP LEVEL on interactions.create, not inside
 *     generation_config (CreateModelInteraction, :2803). Its shape is
 *     { type: "text", mime_type: "application/json", schema }
 *     (TextResponseFormat_2, :14365). The sibling top-level response_mime_type
 *     is marked @deprecated in these same types and is not sent.
 *  2. generation_config.thinking_level takes the LOWERCASE union
 *     "minimal" | "low" | "medium" | "high" (:6251, :14439). The SCREAMING_CASE
 *     ThinkingLevel enum (:14409) belongs to the camelCase
 *     models.generateContent surface and is a 400 here. depth-policy.ts owns
 *     that mapping and asserts the casing.
 *  3. THE CASING SPLIT IS REAL AND IS NOT A MISTAKE. interactions.create takes
 *     snake_case throughout; the Files API takes camelCase. This file only
 *     touches interactions, so everything here is snake_case. Do not "make it
 *     consistent" with the upload call in the transcription client.
 *
 *  TEXT ONLY. This pipeline never fetches, never re-sends and never sees the
 *  source audio. DECISIONS.md § "Structured note generation" fixes that for
 *  all four lenses in MVP; audio-native input for Sales Coach is named there
 *  as a future option, not built.
 *
 *  CONTEXT IS NOT A CONSTRAINT, and this was checked rather than assumed. The
 *  live model card gives gemini-3.7-flash an inputTokenLimit of 1,048,576. The
 *  longest transcript that can reach here is 60 minutes — the ceiling
 *  lib/transcription/diarization-policy.ts already enforces upstream — which
 *  is roughly 9,000 words at 150 wpm, near 12,000 tokens with speaker tags.
 *  Three orders of magnitude of headroom. */

export const GEMINI_NOTEGEN_MODEL = "gemini-3.7-flash";

export interface NoteGenRequest {
  transcript: string;
  lens: LensPrompt;
  plan: DepthPlan;
}

export type NoteGenerator = (request: NoteGenRequest) => Promise<GeneratedNote>;

/** What each scope asks for, beyond the lens framing. Depth changes what the
 *  model does, not merely how much it writes — see depth-policy.ts. */
const SCOPE_INSTRUCTIONS: Record<DepthPlan["scope"], string> = {
  "decisions-and-actions":
    "Extract only two things: the decisions actually taken, and the action " +
    "items. Write no summary. Omit discussion that reached no decision. If " +
    "nothing was decided, return empty arrays rather than inventing content.",

  balanced:
    "Produce three things at even weight: a short summary of what the " +
    "conversation was and where it landed, the takeaways worth remembering, " +
    "and the action items. Keep each takeaway to one idea.",

  "cross-referenced":
    "Produce a summary, takeaways and action items, and do the analytical " +
    "work a shorter reading would skip. Cross-reference the takeaways " +
    "against each other and against the summary, naming where they reinforce " +
    "or contradict. Infer action items that were clearly implied by what was " +
    "agreed but never stated as a task, and mark an inferred item by " +
    "beginning it with \"Implied: \". Do not invent commitments nobody made.",
};

export function systemPromptFor(lens: LensPrompt, plan: DepthPlan): string {
  return [
    `You are reading a meeting transcript as the ${lens.label}.`,
    "",
    lens.framing,
    "",
    SCOPE_INSTRUCTIONS[plan.scope],
    "",
    "Ground every statement in the transcript. Do not speculate about what " +
      "was meant, and do not add advice that was not discussed. Where a " +
      "speaker is identified, you may attribute; where speakers are unlabelled, " +
      "do not guess who said what.",
    "",
    "Return JSON matching the provided schema and nothing else.",
  ].join("\n");
}

export function responseSchemaFor(plan: DepthPlan): Record<string, unknown> {
  const stringArray = {
    type: "array",
    items: { type: "string" },
  };

  // Brief produces no summary, so the field is absent from the schema rather
  // than present-but-nullable. A nullable field the prompt tells the model to
  // leave empty is two instructions that can disagree.
  const properties: Record<string, unknown> = plan.wantsSummary
    ? {
        summary: { type: "string" },
        takeaways: stringArray,
        action_items: stringArray,
      }
    : { takeaways: stringArray, action_items: stringArray };

  return {
    type: "object",
    properties,
    required: Object.keys(properties),
  };
}

/** Only strings survive. A model that returns a number, a null or a nested
 *  object in one of these arrays must not put it into a not-null text column. */
function stringsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Pure, exported and tested without the SDK — the same reason
 *  segmentsFromInteraction is in the transcription client. */
export function parseGeneratedNote(rawText: string): GeneratedNote {
  // response_format should make the fence impossible. Tolerating it is cheap;
  // being surprised by it in production costs a whole call.
  const body = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // The offending text is in the message because there is no error column at
    // this scale — the Vercel function log is where a failure is read, so it
    // has to carry enough to diagnose from.
    throw new Error(
      `Gemini did not return JSON for note generation: ${body.slice(0, 200)}`,
    );
  }

  const record = (parsed ?? {}) as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary : null;

  return {
    summary,
    takeaways: stringsFrom(record.takeaways),
    actionItems: stringsFrom(record.action_items),
  };
}

export function createGeminiNoteGenerator(apiKey: string): NoteGenerator {
  return async ({ transcript, lens, plan }: NoteGenRequest) => {
    // Imported lazily so the pure parser above is unit-testable without
    // loading the SDK, and so the SDK never reaches a client bundle by
    // accident. Same reasoning as the transcription client.
    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({ apiKey });

    // Inline text, not the Files API. A 60-minute transcript is tens of
    // kilobytes — the upload indirection the audio path needs buys nothing
    // here and adds a failure mode.
    const interaction = (await client.interactions.create({
      model: GEMINI_NOTEGEN_MODEL,
      system_instruction: systemPromptFor(lens, plan),
      input: [{ type: "text", text: transcript }],
      // TOP LEVEL. Not inside generation_config — see the header.
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: responseSchemaFor(plan),
      },
      generation_config: { thinking_level: plan.thinkingLevel },
    })) as { output_text?: string };

    const rawText = interaction.output_text?.trim() ?? "";
    if (!rawText) {
      // Two causes land here and this message cannot tell them apart: the
      // model genuinely returned nothing, or the SDK renamed output_text and
      // the cast above erased the real return type. If this fires on a
      // transcript you can read, suspect the wire shape first — log the raw
      // interaction and compare it against genai.d.ts.
      throw new Error(
        "Gemini returned no note-generation output (empty result, or output_text moved)",
      );
    }

    return parseGeneratedNote(rawText);
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run lib/notegen/__tests__/gemini-client.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/notegen/gemini-client.ts lib/notegen/__tests__/gemini-client.test.ts
git commit -m "feat(notegen): the Gemini surface, read from the pinned SDK types

response_format is top level on interactions.create, not inside
generation_config, and its sibling response_mime_type is deprecated in the
same types. thinking_level takes the lowercase union; the SCREAMING_CASE enum
belongs to the other SDK surface and would be a 400. Both read from
genai.d.ts at 2.19.0 on 2026-09-02, not from samples.

Model id verified against the live models endpoint the same day, along with
the 1,048,576-token input limit — a 60-minute transcript is near 12,000
tokens, so context is not a constraint. Checked, not assumed.

The parser is pure and tested without the SDK, and tolerates a code fence the
response schema should already prevent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `sweep.ts` — ports, constants and the state machine

**Files:**
- Create: `lib/notegen/sweep.ts`
- Test: `lib/notegen/__tests__/sweep.test.ts` (written in Task 8, after `generate-note.ts` exists)

**Interfaces:**
- Consumes: `NotegenStore` from `@/lib/notegen/persist-result`; `NoteGenerator` from `@/lib/notegen/gemini-client`; `PersonaDepth` from `@/lib/notes/view-types`; `claimNoteForGeneration` / `generateClaimedNote` from `@/lib/notegen/generate-note` (Task 7).
- Produces:
  - `export const NOTEGEN_STALE_AFTER_MS = 60 * 60 * 1000`
  - `export const MAX_NOTEGEN_PER_RUN = 5`
  - `export const MAX_NOTEGEN_RECONCILIATIONS_PER_RUN = 25`
  - `export interface GeneratableRow { id: string; user_id: string; raw_transcript: string | null; updated_at: string }`
  - `export interface ResolvedPersona { slug: string; name: string; depth: PersonaDepth; source: "row" | "fallback" }`
  - `export interface NotegenPorts { now(); log(); listGeneratable(limit); listStaleGenerating(cutoffIso, limit); claimForGeneration(noteId); resolvePersona(userId); generate: NoteGenerator; store: NotegenStore }`
  - `export interface NotegenReport { generated; failed; reconciled; deferred; blank; contended }`
  - `export async function notegenSweep(ports: NotegenPorts, options: { deadlineAt: number }): Promise<NotegenReport>`

This task creates the file with everything except the loop body's calls into `generate-note.ts`. Because Task 7 imports types from here and this imports functions from there, **write this file first with the types, then Task 7, then return in Task 8 to add the loop.** The circular type-only import is the same shape `lib/transcription/sweep.ts` and `transcribe-note.ts` already have and TypeScript resolves it.

- [ ] **Step 1: Write the file, types and constants only**

Create `lib/notegen/sweep.ts`:

```ts
import type { NoteGenerator } from "@/lib/notegen/gemini-client";
import type { NotegenStore } from "@/lib/notegen/persist-result";
import type { PersonaDepth } from "@/lib/notes/view-types";

/** All the branching, and none of the I/O.
 *
 *  notegen_status IS the queue, exactly as processing_status is transcription's.
 *  There is no job table here either: the row's own status says whether it is
 *  eligible, in flight, done or dead, and the transitions are the only
 *  coordination. A queue table would be a second source of truth that can
 *  disagree with the first.
 *
 *  Every side effect is an injected port, which is what lets claim races,
 *  staleness and caps be tested with no database and no network.
 *
 *  THIS FILE OWNS notegen_status AND NOTHING ELSE. lib/transcription/sweep.ts
 *  owns processing_status. The stale-row logic below is the same query SHAPE
 *  as that file's stale-'analyzing' pass, deliberately reimplemented here
 *  rather than reached across for — editing that file to handle a column it
 *  does not own is the scope violation this project's conventions call out. */

/** A row is stale after an hour, matching transcription's threshold. Here it
 *  means only one thing: the generation function died mid-flight. There is no
 *  slow-but-real case to protect, because unlike an upload there is nothing
 *  external still arriving — which is why age alone IS terminal here, where in
 *  the transcription sweep object existence had to be the real check. */
export const NOTEGEN_STALE_AFTER_MS = 60 * 60 * 1000;

/** Above transcription's 3, and for a measured reason: a text-only call on
 *  roughly 12,000 tokens returns in seconds where an audio transcription takes
 *  minutes. The cap bounds COST; the shared budget below bounds wall-clock,
 *  and on a run where transcription used the clock this phase claims nothing
 *  at all. Both still apply. */
export const MAX_NOTEGEN_PER_RUN = 5;

/** Failing a stale row is a status flip and no Gemini call — cheap enough to
 *  clear a backlog in one tick. Same number, same reasoning, as the
 *  transcription sweep's reconciliation cap. */
export const MAX_NOTEGEN_RECONCILIATIONS_PER_RUN = 25;

export interface GeneratableRow {
  id: string;
  user_id: string;
  raw_transcript: string | null;
  updated_at: string;
}

/** Which lens config a note generates under, and how that was decided.
 *
 *  `source` exists for the report. "Which persona-resolution path executed"
 *  is a question the build has to answer with evidence, and a boolean derived
 *  after the fact would be a guess. */
export interface ResolvedPersona {
  slug: string;
  name: string;
  depth: PersonaDepth;
  source: "row" | "fallback";
}

export interface NotegenPorts {
  now(): number;
  log(message: string): void;
  /** processing_status = 'completed' AND notegen_status IS NULL, oldest first. */
  listGeneratable(limit: number): Promise<GeneratableRow[]>;
  /** Still 'generating' with updated_at older than cutoffIso. */
  listStaleGenerating(cutoffIso: string, limit: number): Promise<string[]>;
  /** THE claim. One statement, one implementation, two callers. True only if
   *  this caller's UPDATE was the one that matched. */
  claimForGeneration(noteId: string): Promise<boolean>;
  /** Scoped by user_id AND slug — never personas.id, never name. See
   *  CLAUDE.md § Data. */
  resolvePersona(userId: string): Promise<ResolvedPersona>;
  generate: NoteGenerator;
  store: NotegenStore;
}

/** The only observability this pipeline has. There is no error column, and the
 *  Vercel function log is where a run is read, so the counters distinguish
 *  causes rather than tallying rows. */
export interface NotegenReport {
  generated: number;
  failed: number;
  /** Stale 'generating' rows flipped to 'failed'. */
  reconciled: number;
  /** Pushed to the next tick by the per-run cap or the shared budget. */
  deferred: number;
  /** Claimed, then found to have no usable transcript. Terminal, and never a
   *  Gemini call. */
  blank: number;
  /** An overlapping invocation claimed the row first. Not an error. */
  contended: number;
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS. The file exports only types and constants so far.

- [ ] **Step 3: Commit**

```bash
git add lib/notegen/sweep.ts
git commit -m "feat(notegen): sweep ports, caps and report shape

notegen_status is the queue, same as processing_status is transcription's. The
stale pass is deliberately reimplemented here rather than reaching into
lib/transcription/sweep.ts, which owns a different column.

Age alone is terminal here, unlike transcription, and the comment says why: a
stale 'generating' row has nothing still arriving from outside, so there is no
slow-but-real case that object existence had to protect there.

MAX_NOTEGEN_PER_RUN is 5 against transcription's 3 — a text call on ~12k
tokens returns in seconds, and the shared budget is the real backstop.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `generate-note.ts` — the one claim, the one generate

**Files:**
- Create: `lib/notegen/generate-note.ts`
- Test: `lib/notegen/__tests__/generate-note.test.ts`

**Interfaces:**
- Consumes: `GeneratableRow`, `NotegenPorts`, `ResolvedPersona` from `@/lib/notegen/sweep`; `planForDepth` from `@/lib/notegen/depth-policy`; `lensPromptFor` from `@/lib/notegen/lens-prompts`; `persistGeneratedNote` from `@/lib/notegen/persist-result`.
- Produces:
  - `export type ClaimOutcome = "claimed" | "contended" | "blank"`
  - `export type NotegenOutcome = ClaimOutcome | "generated" | "failed"`
  - `export type ClaimPorts = Pick<NotegenPorts, "claimForGeneration" | "log" | "store">`
  - `export type GeneratePorts = Pick<NotegenPorts, "log" | "resolvePersona" | "generate" | "store">`
  - `export async function claimNoteForGeneration(ports: ClaimPorts, row: GeneratableRow): Promise<ClaimOutcome>`
  - `export async function generateClaimedNote(ports: GeneratePorts, row: GeneratableRow): Promise<"generated" | "failed">`
  - `export async function claimAndGenerate(ports: ClaimPorts & GeneratePorts, row: GeneratableRow): Promise<NotegenOutcome>`

- [ ] **Step 1: Write the failing test**

Create `lib/notegen/__tests__/generate-note.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  claimAndGenerate,
  claimNoteForGeneration,
  generateClaimedNote,
} from "@/lib/notegen/generate-note";
import type { GeneratableRow, NotegenPorts } from "@/lib/notegen/sweep";
import { DEFAULT_PERSONA_FALLBACK } from "@/lib/notes/default-persona";

const ROW: GeneratableRow = {
  id: "n1",
  user_id: "u1",
  raw_transcript: "Dana: we ship mapping first. Ravi: agreed.",
  updated_at: new Date().toISOString(),
};

function ports(overrides: Partial<NotegenPorts> = {}) {
  const generate = vi.fn(async () => ({
    summary: "S",
    takeaways: ["t"],
    actionItems: ["a"],
  }));

  const base: NotegenPorts = {
    now: () => Date.now(),
    log: vi.fn(),
    listGeneratable: vi.fn(async () => []),
    listStaleGenerating: vi.fn(async () => []),
    claimForGeneration: vi.fn(async () => true),
    resolvePersona: vi.fn(async () => ({
      slug: "neutral-analyst",
      name: "Neutral Analyst",
      depth: "dense" as const,
      source: "row" as const,
    })),
    generate,
    store: {
      deleteGeneratedChunks: vi.fn(async () => {}),
      insertChunks: vi.fn(async () => {}),
      completeNotegen: vi.fn(async () => true),
      failNotegen: vi.fn(async () => true),
    },
    ...overrides,
  };

  return { ports: base, generate };
}

describe("claimNoteForGeneration", () => {
  it("returns 'claimed' when the guarded update matched", async () => {
    const { ports: p } = ports();
    expect(await claimNoteForGeneration(p, ROW)).toBe("claimed");
  });

  it("returns 'contended' when the guarded update matched nothing", async () => {
    const { ports: p } = ports({ claimForGeneration: vi.fn(async () => false) });
    expect(await claimNoteForGeneration(p, ROW)).toBe("contended");
  });

  it("spends no Gemini call on a contended claim", async () => {
    // THE cost guarantee. Counted, not read off the code.
    const { ports: p, generate } = ports({
      claimForGeneration: vi.fn(async () => false),
    });
    await claimAndGenerate(p, ROW);
    expect(generate).not.toHaveBeenCalled();
  });

  it("fails a claimed row whose transcript is only whitespace", async () => {
    const { ports: p } = ports();
    const outcome = await claimNoteForGeneration(p, {
      ...ROW,
      raw_transcript: "   \n\t ",
    });
    expect(outcome).toBe("blank");
    expect(p.store.failNotegen).toHaveBeenCalledWith("n1");
  });

  it("fails a claimed row whose transcript is null", async () => {
    const { ports: p } = ports();
    expect(
      await claimNoteForGeneration(p, { ...ROW, raw_transcript: null }),
    ).toBe("blank");
  });

  it("spends no Gemini call on a blank transcript", async () => {
    const { ports: p, generate } = ports();
    await claimAndGenerate(p, { ...ROW, raw_transcript: "" });
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("generateClaimedNote", () => {
  it("makes exactly one Gemini call for one note", async () => {
    const { ports: p, generate } = ports();
    await generateClaimedNote(p, ROW);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("passes the resolved depth through as a thinking level", async () => {
    const { ports: p, generate } = ports({
      resolvePersona: vi.fn(async () => ({
        slug: "investor",
        name: "Investor",
        depth: "exhaustive" as const,
        source: "row" as const,
      })),
    });
    await generateClaimedNote(p, ROW);
    expect(generate.mock.calls[0][0].plan.thinkingLevel).toBe("high");
    expect(generate.mock.calls[0][0].lens.slug).toBe("investor");
  });

  it("completes on the fallback persona rather than throwing", async () => {
    // The zero-persona-row path: an account created before the 2026-08-31
    // provisioning trigger. It must generate, not crash.
    const { ports: p, generate } = ports({
      resolvePersona: vi.fn(async () => ({
        slug: DEFAULT_PERSONA_FALLBACK.id,
        name: DEFAULT_PERSONA_FALLBACK.name,
        depth: DEFAULT_PERSONA_FALLBACK.depth,
        source: "fallback" as const,
      })),
    });
    expect(await generateClaimedNote(p, ROW)).toBe("generated");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(p.store.completeNotegen).toHaveBeenCalledWith("n1");
  });

  it("marks the row failed when the model throws", async () => {
    const { ports: p } = ports({
      generate: vi.fn(async () => {
        throw new Error("429 rate limited");
      }),
    });
    expect(await generateClaimedNote(p, ROW)).toBe("failed");
    expect(p.store.failNotegen).toHaveBeenCalledWith("n1");
  });

  it("puts the failure reason in the log, since there is no error column", async () => {
    const { ports: p } = ports({
      generate: vi.fn(async () => {
        throw new Error("429 rate limited");
      }),
    });
    await generateClaimedNote(p, ROW);
    expect(p.log).toHaveBeenCalledWith(expect.stringContaining("429 rate limited"));
  });

  it("marks the row failed when the flip loses to the staleness sweep", async () => {
    const { ports: p } = ports();
    p.store.completeNotegen = vi.fn(async () => false);
    expect(await generateClaimedNote(p, ROW)).toBe("failed");
  });
});

describe("claimAndGenerate", () => {
  it("returns 'generated' on the happy path", async () => {
    const { ports: p } = ports();
    expect(await claimAndGenerate(p, ROW)).toBe("generated");
  });

  it("short-circuits before resolving a persona when contended", async () => {
    const { ports: p } = ports({ claimForGeneration: vi.fn(async () => false) });
    await claimAndGenerate(p, ROW);
    expect(p.resolvePersona).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run lib/notegen/__tests__/generate-note.test.ts
```

Expected: FAIL — cannot resolve `@/lib/notegen/generate-note`.

- [ ] **Step 3: Write the implementation**

Create `lib/notegen/generate-note.ts`:

```ts
import { planForDepth } from "@/lib/notegen/depth-policy";
import { lensPromptFor } from "@/lib/notegen/lens-prompts";
import { persistGeneratedNote } from "@/lib/notegen/persist-result";
import type { GeneratableRow, NotegenPorts } from "@/lib/notegen/sweep";

/** ONE note, from eligible to a terminal state. Both triggers call this: the
 *  cron sweep's second phase, and the deferred block of the manual Transcribe
 *  action once transcription succeeds.
 *
 *  It is a separate module from sweep.ts for the reason the transcription
 *  track split transcribe-note.ts out of its own sweep: two copies of the
 *  claim would be two sources of truth that can disagree, and the
 *  disagreement would cost a Gemini call.
 *
 *  WHAT IS NOT HERE, DELIBERATELY: age. Staleness is a sweep-only concern.
 *  Unlike the transcription claim there is also no failOnMissingObject flag,
 *  because there is no object — this pipeline is text-only and the transcript
 *  is already on the row it just claimed. The two callers therefore take the
 *  identical path with no options at all. */

export type ClaimOutcome =
  /** This caller's UPDATE was the one that matched. It owns the row. */
  | "claimed"
  /** The guarded UPDATE matched zero rows: another invocation moved it first,
   *  or it was never eligible. NOT an error — and never a Gemini call. */
  | "contended"
  /** Claimed, then found to hold no usable transcript. Terminal, and still
   *  never a Gemini call. */
  | "blank";

export type NotegenOutcome = ClaimOutcome | "generated" | "failed";

/** Narrower than NotegenPorts so a caller cannot reach the generator from the
 *  claim. store is included because a blank transcript is failed here. */
export type ClaimPorts = Pick<
  NotegenPorts,
  "claimForGeneration" | "log" | "store"
>;

/** The generating half. Only ever called on a row this process just claimed. */
export type GeneratePorts = Pick<
  NotegenPorts,
  "log" | "resolvePersona" | "generate" | "store"
>;

export async function claimNoteForGeneration(
  ports: ClaimPorts,
  row: GeneratableRow,
): Promise<ClaimOutcome> {
  // THE claim, through the one implementation in notegen-ports.ts. The guard
  // it carries — processing_status = 'completed' AND notegen_status IS NULL —
  // is what makes "cannot generate before a transcript exists" true by
  // construction rather than by caller discipline.
  if (!(await ports.claimForGeneration(row.id))) return "contended";

  // Blankness is checked AFTER the claim, not before, and that is deliberate.
  // Checking first would leave the row eligible forever, so every sweep would
  // re-examine it and a handful of permanently blank rows could starve real
  // work out of the per-run cap. Claiming then failing is terminal and
  // self-clearing. The guarantee that matters is unchanged: this is still
  // before any Gemini call.
  const transcript = row.raw_transcript?.trim();
  if (!transcript) {
    ports.log(
      `note ${row.id}: completed with no usable transcript. ` +
        `Marked 'failed' without a model call.`,
    );
    await ports.store.failNotegen(row.id);
    return "blank";
  }

  return "claimed";
}

export async function generateClaimedNote(
  ports: GeneratePorts,
  row: GeneratableRow,
): Promise<"generated" | "failed"> {
  try {
    // Scoped by user_id AND slug. The user_id filter is application-level,
    // which the standing rule forbids everywhere else — it is the one
    // deliberate exception, because the cron caller runs as service_role and
    // bypasses RLS, so an unfiltered lookup can return another account's row.
    const persona = await ports.resolvePersona(row.user_id);
    const plan = planForDepth(persona.depth);
    const lens = lensPromptFor(persona.slug);

    const note = await ports.generate({
      transcript: row.raw_transcript!.trim(),
      lens,
      plan,
    });

    await persistGeneratedNote({
      store: ports.store,
      noteId: row.id,
      userId: row.user_id,
      note: note,
    });

    ports.log(
      `note ${row.id}: generated under ${lens.label} ` +
        `(${persona.depth}/${plan.thinkingLevel}, persona from ${persona.source}) — ` +
        `summary=${note.summary ? "yes" : "no"}, ` +
        `${note.takeaways.length} takeaway(s), ` +
        `${note.actionItems.length} action item(s).`,
    );
    return "generated";
  } catch (error) {
    // No error-message column at single-owner scale. The Vercel function log
    // is where a failure is read, so the reason has to reach it.
    const reason = error instanceof Error ? error.message : String(error);
    ports.log(`note ${row.id}: note generation failed — ${reason}`);
    await ports.store.failNotegen(row.id);
    return "failed";
  }
}

/** The whole unit in one call.
 *
 *  Unlike the transcription track, BOTH shipped callers use this composed
 *  form. The sweep's cap counts model attempts, and here a cheap rejection —
 *  contended or blank — is distinguishable from the returned outcome without
 *  splitting the steps, because neither costs a call. */
export async function claimAndGenerate(
  ports: ClaimPorts & GeneratePorts,
  row: GeneratableRow,
): Promise<NotegenOutcome> {
  const outcome = await claimNoteForGeneration(ports, row);
  if (outcome !== "claimed") return outcome;
  return generateClaimedNote(ports, row);
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run lib/notegen/__tests__/generate-note.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/notegen/generate-note.ts lib/notegen/__tests__/generate-note.test.ts
git commit -m "feat(notegen): the one claim and the one generate, shared by both triggers

A separate module from sweep.ts for the reason transcribe-note.ts was split
out of the transcription sweep: two copies of the claim would be two sources
of truth that can disagree, and the disagreement costs a Gemini call.

The blank-transcript guard runs after the claim rather than before, and the
comment says why — checking first leaves the row eligible forever, so a
handful of blank rows could starve real work out of the per-run cap. Still
before any model call, which is the guarantee that matters, and it is proved
by counting calls rather than by reading the code.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `sweep.ts` — the loop

**Files:**
- Modify: `lib/notegen/sweep.ts` (append the `notegenSweep` function)
- Test: `lib/notegen/__tests__/sweep.test.ts`

**Interfaces:**
- Consumes: `claimAndGenerate` from `@/lib/notegen/generate-note`.
- Produces: `export async function notegenSweep(ports: NotegenPorts, options: { deadlineAt: number }): Promise<NotegenReport>`

- [ ] **Step 1: Write the failing test**

Create `lib/notegen/__tests__/sweep.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  MAX_NOTEGEN_PER_RUN,
  NOTEGEN_STALE_AFTER_MS,
  notegenSweep,
  type GeneratableRow,
  type NotegenPorts,
} from "@/lib/notegen/sweep";

const NOW = 1_800_000_000_000;

function rowsOf(count: number): GeneratableRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    user_id: "u1",
    raw_transcript: "Dana: we ship mapping first.",
    updated_at: new Date(NOW - 1000).toISOString(),
  }));
}

function ports(overrides: Partial<NotegenPorts> = {}) {
  const generate = vi.fn(async () => ({
    summary: "S",
    takeaways: ["t"],
    actionItems: ["a"],
  }));

  const base: NotegenPorts = {
    now: () => NOW,
    log: vi.fn(),
    listGeneratable: vi.fn(async () => rowsOf(2)),
    listStaleGenerating: vi.fn(async () => []),
    claimForGeneration: vi.fn(async () => true),
    resolvePersona: vi.fn(async () => ({
      slug: "neutral-analyst",
      name: "Neutral Analyst",
      depth: "dense" as const,
      source: "row" as const,
    })),
    generate,
    store: {
      deleteGeneratedChunks: vi.fn(async () => {}),
      insertChunks: vi.fn(async () => {}),
      completeNotegen: vi.fn(async () => true),
      failNotegen: vi.fn(async () => true),
    },
    ...overrides,
  };

  return { ports: base, generate };
}

const FAR = { deadlineAt: NOW + 240_000 };

describe("notegenSweep", () => {
  it("generates every eligible row inside the cap", async () => {
    const { ports: p } = ports();
    const report = await notegenSweep(p, FAR);
    expect(report.generated).toBe(2);
  });

  it("never exceeds MAX_NOTEGEN_PER_RUN model calls", async () => {
    const { ports: p, generate } = ports({
      listGeneratable: vi.fn(async () => rowsOf(MAX_NOTEGEN_PER_RUN + 4)),
    });
    const report = await notegenSweep(p, FAR);
    expect(generate).toHaveBeenCalledTimes(MAX_NOTEGEN_PER_RUN);
    expect(report.generated).toBe(MAX_NOTEGEN_PER_RUN);
    expect(report.deferred).toBe(4);
  });

  it("claims nothing when the shared budget is already spent", async () => {
    // Phase two runs after transcription on the SAME 300 s ceiling. A run
    // where transcription used the clock must generate nothing rather than
    // start work the platform will kill mid-write.
    const { ports: p, generate } = ports();
    const report = await notegenSweep(p, { deadlineAt: NOW - 1 });
    expect(generate).not.toHaveBeenCalled();
    expect(p.claimForGeneration).not.toHaveBeenCalled();
    expect(report.deferred).toBe(2);
  });

  it("flips a stale 'generating' row to failed and counts it", async () => {
    const { ports: p } = ports({
      listGeneratable: vi.fn(async () => []),
      listStaleGenerating: vi.fn(async () => ["old1", "old2"]),
    });
    const report = await notegenSweep(p, FAR);
    expect(report.reconciled).toBe(2);
    expect(p.store.failNotegen).toHaveBeenCalledWith("old1");
    expect(p.store.failNotegen).toHaveBeenCalledWith("old2");
  });

  it("asks for stale rows using a one-hour cutoff on updated_at", async () => {
    const { ports: p } = ports();
    await notegenSweep(p, FAR);
    const [cutoffIso] = (p.listStaleGenerating as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(cutoffIso).toBe(new Date(NOW - NOTEGEN_STALE_AFTER_MS).toISOString());
  });

  it("spends no model call reconciling a stale row", async () => {
    const { ports: p, generate } = ports({
      listGeneratable: vi.fn(async () => []),
      listStaleGenerating: vi.fn(async () => ["old1"]),
    });
    await notegenSweep(p, FAR);
    expect(generate).not.toHaveBeenCalled();
  });

  it("does not count a lost stale flip as reconciled", async () => {
    const { ports: p } = ports({
      listGeneratable: vi.fn(async () => []),
      listStaleGenerating: vi.fn(async () => ["old1"]),
    });
    p.store.failNotegen = vi.fn(async () => false);
    expect((await notegenSweep(p, FAR)).reconciled).toBe(0);
  });

  it("counts a contended row without spending its cap slot", async () => {
    const { ports: p, generate } = ports({
      listGeneratable: vi.fn(async () => rowsOf(MAX_NOTEGEN_PER_RUN + 1)),
      claimForGeneration: vi.fn(async () => false),
    });
    const report = await notegenSweep(p, FAR);
    expect(report.contended).toBe(MAX_NOTEGEN_PER_RUN + 1);
    expect(report.deferred).toBe(0);
    expect(generate).not.toHaveBeenCalled();
  });

  it("counts a blank transcript without spending its cap slot", async () => {
    const rows = rowsOf(2).map((r) => ({ ...r, raw_transcript: "  " }));
    const { ports: p, generate } = ports({
      listGeneratable: vi.fn(async () => rows),
    });
    const report = await notegenSweep(p, FAR);
    expect(report.blank).toBe(2);
    expect(generate).not.toHaveBeenCalled();
  });

  it("counts a generation failure", async () => {
    const { ports: p } = ports({
      listGeneratable: vi.fn(async () => rowsOf(1)),
      generate: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    expect((await notegenSweep(p, FAR)).failed).toBe(1);
  });

  it("logs when work was actually deferred, and stays quiet otherwise", async () => {
    const { ports: quiet } = ports();
    await notegenSweep(quiet, FAR);
    expect(quiet.log).not.toHaveBeenCalledWith(expect.stringContaining("deferred"));

    const { ports: busy } = ports({
      listGeneratable: vi.fn(async () => rowsOf(MAX_NOTEGEN_PER_RUN + 1)),
    });
    await notegenSweep(busy, FAR);
    expect(busy.log).toHaveBeenCalledWith(expect.stringContaining("deferred"));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run lib/notegen/__tests__/sweep.test.ts
```

Expected: FAIL — `notegenSweep` is not exported.

- [ ] **Step 3: Append the loop to `lib/notegen/sweep.ts`**

Add this import at the top of the file, after the existing imports:

```ts
import { claimAndGenerate } from "@/lib/notegen/generate-note";
```

Append to the end of the file:

```ts
/** Phase two of the cron run.
 *
 *  deadlineAt is passed IN rather than computed here, and that is the whole
 *  point: this phase shares the transcription phase's clock. The route
 *  computes one startedAt, hands transcription its budget, and hands what is
 *  left to this. Starting a second 240 s budget here would let one invocation
 *  run past the platform's 300 s hard ceiling and be killed mid-write. */
export async function notegenSweep(
  ports: NotegenPorts,
  options: { deadlineAt: number },
): Promise<NotegenReport> {
  const report: NotegenReport = {
    generated: 0,
    failed: 0,
    reconciled: 0,
    deferred: 0,
    blank: 0,
    contended: 0,
  };

  /** MODEL ATTEMPTS, which is what the cap must bound.
   *
   *  Counting successes instead would leave the cap inoperative in exactly the
   *  case it is sized for — a failing call is the expensive one. Cheap
   *  rejections do not count: a contended claim and a blank transcript each
   *  cost one UPDATE and no model call, so a backlog of either must not starve
   *  real work. Same reasoning as the transcription sweep's `attempts`. */
  let attempts = 0;

  const cutoffIso = new Date(
    ports.now() - NOTEGEN_STALE_AFTER_MS,
  ).toISOString();

  // ---- Stale 'generating' rows ----------------------------------------------
  // The same query shape as the transcription sweep's stale-'analyzing' pass,
  // against this track's own column. Deliberately not a second mechanism, and
  // deliberately not a call into that file, which owns processing_status.
  const crashed = await ports.listStaleGenerating(
    cutoffIso,
    MAX_NOTEGEN_RECONCILIATIONS_PER_RUN,
  );

  for (const noteId of crashed) {
    if (await ports.store.failNotegen(noteId)) {
      report.reconciled += 1;
      ports.log(
        `note ${noteId}: stuck in 'generating' past ${NOTEGEN_STALE_AFTER_MS}ms — ` +
          `the generation function did not finish. Marked 'failed'.`,
      );
    }
  }

  // ---- Eligible rows --------------------------------------------------------
  const candidates = await ports.listGeneratable(MAX_NOTEGEN_PER_RUN * 4);

  for (const row of candidates) {
    if (attempts >= MAX_NOTEGEN_PER_RUN) {
      report.deferred += 1;
      continue;
    }

    if (ports.now() > options.deadlineAt) {
      report.deferred += 1;
      continue;
    }

    const outcome = await claimAndGenerate(ports, row);

    if (outcome === "contended") {
      report.contended += 1;
      continue;
    }

    if (outcome === "blank") {
      report.blank += 1;
      continue;
    }

    // Only a row that reached the model spends a slot.
    attempts += 1;
    if (outcome === "generated") report.generated += 1;
    else report.failed += 1;
  }

  // Never let a cap read as completeness — but only say "deferred" when work
  // was actually pushed aside, so a healthy tick does not cry wolf.
  if (report.deferred > 0) {
    ports.log(
      `${report.deferred} row(s) deferred to the next tick — per-run cap ` +
        `${MAX_NOTEGEN_PER_RUN} attempt(s), shared budget exhausted at ` +
        `${options.deadlineAt}.`,
    );
  }

  return report;
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run lib/notegen/__tests__/sweep.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/notegen/sweep.ts lib/notegen/__tests__/sweep.test.ts
git commit -m "feat(notegen): the phase-two loop, on a budget it does not own

deadlineAt is a parameter, not a constant computed here. That is the design:
phase two shares the transcription phase's clock under one 300 s platform
ceiling, so a second 240 s budget would let a run be killed mid-write. Tested
with an already-spent deadline claiming nothing at all.

The cap counts model attempts, not rows. A contended claim and a blank
transcript each cost one UPDATE and no call, so neither spends a slot —
otherwise a backlog of cheap rejections starves real work, which is the same
trap the transcription sweep's attempts counter avoids.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: `notegen-ports.ts` — the one Supabase implementation

**Files:**
- Create: `lib/notegen/notegen-ports.ts`
- Test: `lib/notegen/__tests__/notegen-ports.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` from `@supabase/supabase-js`; `NotegenPorts`, `GeneratableRow`, `ResolvedPersona` from `@/lib/notegen/sweep`; `NotegenStore` from `@/lib/notegen/persist-result`; `createGeminiNoteGenerator` from `@/lib/notegen/gemini-client`; `DEFAULT_PERSONA_ID`, `DEFAULT_PERSONA_FALLBACK` from `@/lib/notes/default-persona`.
- Produces:
  - `export function createNotegenStore(db: SupabaseClient): NotegenStore`
  - `export function resolvePersonaFor(db: SupabaseClient, userId: string): Promise<ResolvedPersona>`
  - `export function createNotegenPorts(db: SupabaseClient, geminiKey: string): NotegenPorts`

- [ ] **Step 1: Write the failing test**

Create `lib/notegen/__tests__/notegen-ports.test.ts`. This tests the query *shape* against a hand-built fake client — the live behaviour is Task 12's job.

```ts
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePersonaFor } from "@/lib/notegen/notegen-ports";
import {
  DEFAULT_PERSONA_FALLBACK,
  DEFAULT_PERSONA_ID,
} from "@/lib/notes/default-persona";

/** Records every .eq() the query builder saw, so the test can assert WHICH
 *  columns were filtered on rather than only that a row came back. */
function fakeDb(result: { data: unknown; error: unknown }) {
  const eqs: [string, unknown][] = [];
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      eqs.push([column, value]);
      return builder;
    }),
    maybeSingle: vi.fn(async () => result),
  };
  const db = { from: vi.fn(() => builder) } as unknown as SupabaseClient;
  return { db, eqs, builder };
}

describe("resolvePersonaFor", () => {
  it("filters on user_id and slug, never on id and never on name", async () => {
    const { db, eqs } = fakeDb({
      data: { slug: DEFAULT_PERSONA_ID, name: "Neutral Analyst", depth: "dense" },
      error: null,
    });

    await resolvePersonaFor(db, "u1");

    expect(eqs).toEqual([
      ["user_id", "u1"],
      ["slug", DEFAULT_PERSONA_ID],
    ]);
    expect(eqs.map(([c]) => c)).not.toContain("id");
    expect(eqs.map(([c]) => c)).not.toContain("name");
  });

  it("reports source 'row' when the account is provisioned", async () => {
    const { db } = fakeDb({
      data: { slug: DEFAULT_PERSONA_ID, name: "Neutral Analyst", depth: "brief" },
      error: null,
    });
    expect(await resolvePersonaFor(db, "u1")).toEqual({
      slug: DEFAULT_PERSONA_ID,
      name: "Neutral Analyst",
      depth: "brief",
      source: "row",
    });
  });

  it("falls back with source 'fallback' on zero rows", async () => {
    // An account created before the 2026-08-31 provisioning trigger and
    // deliberately not backfilled.
    const { db } = fakeDb({ data: null, error: null });
    expect(await resolvePersonaFor(db, "u1")).toEqual({
      slug: DEFAULT_PERSONA_FALLBACK.id,
      name: DEFAULT_PERSONA_FALLBACK.name,
      depth: DEFAULT_PERSONA_FALLBACK.depth,
      source: "fallback",
    });
  });

  it("throws on a real query error rather than silently falling back", async () => {
    // permission denied is exactly what a missing service_role grant returns.
    // Swallowing it into the fallback would hide the grant gap behind output
    // that looks correct.
    const { db } = fakeDb({
      data: null,
      error: { message: "permission denied for table personas" },
    });
    await expect(resolvePersonaFor(db, "u1")).rejects.toThrow(/permission denied/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run lib/notegen/__tests__/notegen-ports.test.ts
```

Expected: FAIL — cannot resolve `@/lib/notegen/notegen-ports`.

- [ ] **Step 3: Write the implementation**

Create `lib/notegen/notegen-ports.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { createGeminiNoteGenerator } from "@/lib/notegen/gemini-client";
import type { NotegenStore } from "@/lib/notegen/persist-result";
import type {
  GeneratableRow,
  NotegenPorts,
  ResolvedPersona,
} from "@/lib/notegen/sweep";
import {
  DEFAULT_PERSONA_FALLBACK,
  DEFAULT_PERSONA_ID,
} from "@/lib/notes/default-persona";

/** The Supabase implementation of NotegenPorts — the only place in this track
 *  that turns the state machine's ports into real queries.
 *
 *  THE CLAIM IS THE REASON THIS IS ONE FILE. A second copy of the guarded
 *  UPDATE would be a second mechanism for the guarantee this pipeline actually
 *  depends on. There is one, here, and both callers use it.
 *
 *  Nothing here reads an environment variable. The caller supplies the client,
 *  which is what lets the cron pass a secret-key client (no session, so no RLS
 *  identity) and the Server Action pass a token client (RLS supplies the
 *  owner) without this file knowing the difference — the same arrangement
 *  lib/transcription/supabase-ports.ts uses. */

const GENERATED_TYPES = ["summary", "takeaway", "action_item"] as const;

export function createNotegenStore(db: SupabaseClient): NotegenStore {
  return {
    async deleteGeneratedChunks(noteId) {
      // Only this track's three types. A transcript_segment row belongs to the
      // transcription pipeline and deleting it here would silently empty the
      // transcript pane.
      const { error } = await db
        .from("note_chunks")
        .delete()
        .eq("note_id", noteId)
        .in("chunk_type", GENERATED_TYPES);
      if (error) {
        throw new Error(`clearing old generated chunks failed: ${error.message}`);
      }
    },

    async insertChunks(rows) {
      const { error } = await db.from("note_chunks").insert(rows);
      if (error) throw new Error(`chunk insert failed: ${error.message}`);
    },

    async completeNotegen(noteId) {
      // Atomic, same shape as the claim: the eq on notegen_status is what
      // makes a lost race return zero rows instead of overwriting somebody
      // else's work.
      const { data, error } = await db
        .from("notes")
        .update({ notegen_status: "completed" })
        .eq("id", noteId)
        .eq("notegen_status", "generating")
        .select("id");

      if (error) throw new Error(`completing note gen failed: ${error.message}`);
      return (data?.length ?? 0) === 1;
    },

    async failNotegen(noteId) {
      // Guarded on 'generating' exactly. A looser guard would be a live hazard
      // the moment a regeneration affordance exists, flipping a fresh retry to
      // terminal — the same trap markFailed avoids in the transcription store.
      const { data, error } = await db
        .from("notes")
        .update({ notegen_status: "failed" })
        .eq("id", noteId)
        .eq("notegen_status", "generating")
        .select("id");

      if (error) {
        console.error(`[notegen] could not mark ${noteId} failed`, error.message);
        return false;
      }
      return (data?.length ?? 0) === 1;
    },
  };
}

/** Which persona config a note generates under.
 *
 *  SCOPED BY user_id AND slug. Never personas.id — that is a per-user
 *  gen_random_uuid() from the provisioning trigger, while DEFAULT_PERSONA_ID
 *  is the slug string "neutral-analyst", so the comparison is a type error
 *  rather than a quiet miss. Never name either: personas.sql declares and
 *  indexes unique (user_id, slug) and states in its own header that slug is
 *  the key chosen to survive a reseed, whereas name is display text carrying
 *  no constraint at all. Recorded in CLAUDE.md § Data and DECISIONS.md §
 *  Personas on 2026-09-02.
 *
 *  THE user_id FILTER IS THE ONE DELIBERATE EXCEPTION to the standing rule
 *  that queries never filter on user_id in application code. That rule exists
 *  because RLS supplies the owner and a redundant filter would mask an RLS
 *  failure. The cron caller has no RLS to mask: service_role bypasses it
 *  entirely, so an unfiltered lookup would return whichever account's Neutral
 *  Analyst row Postgres reached first. The Server Action caller filters
 *  identically, where it is defence in depth and one shared query shape rather
 *  than a requirement. */
export async function resolvePersonaFor(
  db: SupabaseClient,
  userId: string,
): Promise<ResolvedPersona> {
  const { data, error } = await db
    .from("personas")
    .select("slug, name, depth")
    .eq("user_id", userId)
    .eq("slug", DEFAULT_PERSONA_ID)
    .maybeSingle<{ slug: string; name: string; depth: ResolvedPersona["depth"] }>();

  // Thrown, not swallowed into the fallback. "permission denied for table
  // personas" is precisely what a missing service_role grant returns, and
  // falling back would hide that behind output that looks correct.
  if (error) throw new Error(`resolving persona failed: ${error.message}`);

  if (data) {
    return { slug: data.slug, name: data.name, depth: data.depth, source: "row" };
  }

  // Zero rows: an account created before the 2026-08-31 provisioning trigger
  // and deliberately not backfilled. The fallback is a crash floor that keeps
  // generation working for it.
  return {
    slug: DEFAULT_PERSONA_FALLBACK.id,
    name: DEFAULT_PERSONA_FALLBACK.name,
    depth: DEFAULT_PERSONA_FALLBACK.depth,
    source: "fallback",
  };
}

export function createNotegenPorts(
  db: SupabaseClient,
  geminiKey: string,
): NotegenPorts {
  return {
    now: () => Date.now(),
    log: (message) => console.log(`[notegen] ${message}`),

    async listGeneratable(limit) {
      const { data, error } = await db
        .from("notes")
        .select("id, user_id, raw_transcript, updated_at")
        .eq("processing_status", "completed")
        .is("notegen_status", null)
        .order("updated_at", { ascending: true })
        .limit(limit);

      if (error) {
        throw new Error(`listing generatable notes failed: ${error.message}`);
      }
      return (data ?? []) as GeneratableRow[];
    },

    async listStaleGenerating(cutoffIso, limit) {
      const { data, error } = await db
        .from("notes")
        .select("id")
        .eq("notegen_status", "generating")
        .lt("updated_at", cutoffIso)
        .limit(limit);

      if (error) {
        throw new Error(`listing stale 'generating' failed: ${error.message}`);
      }
      return (data ?? []).map((r) => r.id as string);
    },

    async claimForGeneration(noteId) {
      // THE claim. One statement, one implementation, two callers. Postgres
      // row-locks the matched row, so a concurrent invocation re-evaluates
      // this WHERE after the lock releases and matches nothing. No lock table,
      // no read-then-write window.
      //
      // The processing_status clause is load-bearing, not belt-and-braces: it
      // is what makes "cannot generate notes before a transcript exists" true
      // by construction rather than by caller discipline.
      const { data, error } = await db
        .from("notes")
        .update({ notegen_status: "generating" })
        .eq("id", noteId)
        .eq("processing_status", "completed")
        .is("notegen_status", null)
        .select("id");

      if (error) throw new Error(`notegen claim failed: ${error.message}`);
      return (data?.length ?? 0) === 1;
    },

    resolvePersona: (userId) => resolvePersonaFor(db, userId),
    generate: createGeminiNoteGenerator(geminiKey),
    store: createNotegenStore(db),
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run lib/notegen/__tests__/notegen-ports.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

```bash
npm run typecheck
```

Expected: PASS.

```bash
npm test
```

Expected: all green, 36 + 6 = 42 files.

- [ ] **Step 6: Commit**

```bash
git add lib/notegen/notegen-ports.ts lib/notegen/__tests__/notegen-ports.test.ts
git commit -m "feat(notegen): the one Supabase implementation of the ports

One claim, one file, two callers — a second copy of the guarded UPDATE would
be a second source of truth for the guarantee this pipeline depends on.
Nothing here reads an environment variable, so the same code serves the cron's
secret-key client and the action's token client.

The persona lookup filters user_id and slug, asserted by recording which
columns the query builder saw rather than only that a row came back. A query
error throws instead of falling back: permission denied is exactly what a
missing service_role grant returns, and swallowing it would hide the grant gap
behind output that looks correct.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Wire the cron route's phase two

**Files:**
- Modify: `app/api/cron/transcribe/route.ts`

**Interfaces:**
- Consumes: `notegenSweep`, `MAX_NOTEGEN_PER_RUN` from `@/lib/notegen/sweep`; `createNotegenPorts` from `@/lib/notegen/notegen-ports`; `RUN_BUDGET_MS` from `@/lib/transcription/sweep` (read-only import).
- Produces: the route's JSON response gains a `notegen` key holding a `NotegenReport`.

- [ ] **Step 1: Add the imports**

At the top of `app/api/cron/transcribe/route.ts`, after the existing imports:

```ts
import { createNotegenPorts } from "@/lib/notegen/notegen-ports";
import { notegenSweep } from "@/lib/notegen/sweep";
import { RUN_BUDGET_MS } from "@/lib/transcription/sweep";
```

`RUN_BUDGET_MS` is a read-only import. `lib/transcription/sweep.ts` is not modified.

- [ ] **Step 2: Extend the route's doc comment**

Insert before the closing `*/` of the file's header block:

```
 *  TWO PHASES ON ONE CLOCK, added 2026-09-02. Transcription runs first, then
 *  structured note generation sweeps whatever reached 'completed' — including
 *  rows this same invocation just transcribed, which is why the order is not
 *  arbitrary. Both phases share ONE startedAt and one RUN_BUDGET_MS. Phase two
 *  is handed the remaining budget as a deadline rather than computing its own,
 *  because two 240 s budgets under a 300 s platform ceiling is a run that gets
 *  killed mid-write.
 *
 *  The note-gen ports are built from the SAME db client. A second client here
 *  would be a second secret-key read for no reason — this route is still the
 *  only shipped file that reads SUPABASE_SECRET_KEY, and
 *  project-conventions.test.ts fails the build if that stops being true.
```

- [ ] **Step 3: Replace the try block**

Replace:

```ts
  try {
    const report = await sweep(createTranscriptionPorts(db, geminiKey));
    console.log(`[transcribe] ${JSON.stringify(report)}`);
    return Response.json(report);
  } catch (error) {
```

with:

```ts
  // ONE clock for both phases. Read before phase one so the deadline handed to
  // phase two accounts for every millisecond transcription spends.
  const startedAt = Date.now();

  try {
    const report = await sweep(createTranscriptionPorts(db, geminiKey));
    console.log(`[transcribe] ${JSON.stringify(report)}`);

    // Phase two, on the remainder of the SAME budget. A run where
    // transcription used the clock claims nothing here and defers instead.
    const notegen = await notegenSweep(createNotegenPorts(db, geminiKey), {
      deadlineAt: startedAt + RUN_BUDGET_MS,
    });
    console.log(`[notegen] ${JSON.stringify(notegen)}`);

    return Response.json({ ...report, notegen });
  } catch (error) {
```

- [ ] **Step 4: Typecheck and run the convention guard**

```bash
npm run typecheck
```

Expected: PASS.

```bash
npx vitest run components/note-detail/__tests__/project-conventions.test.ts
```

Expected: PASS — in particular the `SUPABASE_SECRET_KEY` assertion still lists exactly this one file, and the route is still under 400 lines.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/transcribe/route.ts
git commit -m "feat(notegen): chain note generation off the cron's transcription phase

Phase two sweeps whatever reached 'completed', including rows this same
invocation just transcribed — the order is not arbitrary.

One startedAt, one RUN_BUDGET_MS, read before phase one so the deadline handed
to phase two accounts for every millisecond transcription spent. Two 240 s
budgets under a 300 s platform ceiling is a run killed mid-write.

Same db client, so this route remains the only shipped file reading
SUPABASE_SECRET_KEY, which project-conventions.test.ts enforces.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Wire the manual action's deferred block

**Files:**
- Modify: `app/notes/actions/transcription.ts`

**Interfaces:**
- Consumes: `createNotegenPorts` from `@/lib/notegen/notegen-ports`; `claimAndGenerate` from `@/lib/notegen/generate-note`.
- Produces: no change to `TranscriptionTrigger`. The browser's answer is unchanged — note-gen is entirely deferred.

- [ ] **Step 1: Add the imports**

After the existing imports in `app/notes/actions/transcription.ts`:

```ts
import { claimAndGenerate } from "@/lib/notegen/generate-note";
import { createNotegenPorts } from "@/lib/notegen/notegen-ports";
```

- [ ] **Step 2: Hoist the deferred client and chain note generation**

Replace the whole existing `after(async () => { ... });` block with:

```ts
  after(async () => {
    // transcribeClaimedNote handles its own failures and writes 'failed'
    // itself, so this catch should never fire. It exists because the response
    // has already been sent: a rejection here is an UNHANDLED one, invisible
    // to the caller and to the browser, and it would leave the row at
    // 'analyzing' for the staleness sweep to fail an hour later with nothing
    // in the log saying why. There is no error column at this scale — the
    // Vercel function log is where a failure is read, so it has to reach it.
    try {
      // ONE deferred client for BOTH phases, built once here.
      //
      // It was inlined into createTranscriptionPorts before 2026-09-02.
      // Hoisting it is not tidying: constructing a second one would be a
      // second client that can refresh, and a refresh inside after() rotates
      // the user's refresh token into a cookie write that is silently dropped
      // — the exact bug lib/supabase/deferred-client.ts documents and that was
      // fixed on 2026-09-01. Cookies are not touched again in this block.
      const deferred = createDeferredClient(session.access_token);

      const transcribed = await transcribeClaimedNote(
        createTranscriptionPorts(deferred, geminiKey),
        row,
      );

      // Note generation chains only off a real transcript. A failed
      // transcription leaves processing_status at 'failed', so the note-gen
      // claim's own guard would refuse it anyway — this check just avoids
      // spending an UPDATE to find that out.
      if (transcribed !== "transcribed") return;

      // The claim re-reads nothing: raw_transcript is what transcription just
      // wrote, so it is fetched fresh rather than carried on the stale `row`.
      const { data: generatable } = await deferred
        .from("notes")
        .select("id, user_id, raw_transcript, updated_at")
        .eq("id", noteId)
        .maybeSingle();

      if (!generatable) return;

      // The SAME shared function the cron's phase two calls. If both reach
      // this note, the loser takes a contended zero-row claim and spends no
      // Gemini call — no new coordination needed.
      await claimAndGenerate(
        createNotegenPorts(deferred, geminiKey),
        generatable,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `[transcribe] note ${noteId}: deferred work threw — ${reason}`,
      );
    }
  });
```

- [ ] **Step 3: Extend the action's doc comment**

Add to the end of the JSDoc block above `triggerTranscription`, before the closing `*/`:

```
 * NOTE GENERATION CHAINS HERE, added 2026-09-02. Once transcription succeeds
 * the same deferred client — one instance, hoisted, never a second
 * construction — carries straight into claimAndGenerate. The browser's answer
 * is unchanged: it still learns only whether the transcription claim landed,
 * in milliseconds, and note generation is entirely deferred behind it.
```

- [ ] **Step 4: Typecheck, convention guard, full suite**

```bash
npm run typecheck
```

Expected: PASS.

```bash
npm test
```

Expected: all green.

```bash
npm run build
```

Expected: a clean production build.

- [ ] **Step 5: Commit**

```bash
git add app/notes/actions/transcription.ts
git commit -m "feat(notegen): chain note generation off the manual transcribe action

One deferred client for both phases, hoisted out of the inline construction it
had before. This is not tidying: a second construction is a second client that
can refresh, and a refresh inside after() rotates the refresh token into a
cookie write that is silently dropped — the bug deferred-client.ts documents
and that was fixed on 2026-09-01. Cookies are not touched again in the block.

The note row is re-read rather than reused, because raw_transcript is what
transcription just wrote and the carried row predates it.

Same shared claim as the cron's phase two. If both reach one note the loser
takes a contended zero-row claim and spends no Gemini call.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Live verification script

**Files:**
- Create: `scripts/verify-notegen-pipeline.mjs`
- Modify: `.gitignore` (only if a scratch artefact is introduced — it is not; no change expected)

**Interfaces:**
- Consumes: the shipped `lib/notegen/*` modules through the same `@/`-alias resolve hook `scripts/verify-manual-transcribe.mjs` uses.
- Produces: a pass/fail console proof. Exit code 0 on success.

The script **imports the shipped modules** rather than re-implementing them. A copy would only prove the copy agrees with itself.

- [ ] **Step 1: Write the script**

Create `scripts/verify-notegen-pipeline.mjs`. Model the loader and the two-client setup on `scripts/verify-manual-transcribe.mjs:40-70` exactly — read that file first and copy its `register(...)` resolve hook and its `.env.local` parsing verbatim.

The script must:

1. Sign in as the owner (`print-signin-link.mjs`'s account) with the publishable key, and build an admin client with `SUPABASE_SECRET_KEY` for cleanup only.
2. Insert a note row directly at `processing_status: 'completed'`, `notegen_status: null`, with a fixed known transcript — no audio, no Storage, no transcription. Text-only pipeline, text-only fixture:

```js
const TRANSCRIPT = [
  "Dana: We agreed to ship the mapping work before billing.",
  "Ravi: Agreed. I'll draft the sequencing plan by Friday.",
  "Dana: And we hold the billing migration until mapping is green.",
].join("\n");
```

3. Wrap `ports.generate` in a counter, exactly as `verify-manual-transcribe.mjs` wraps `ports.transcribe`:

```js
const realPorts = createNotegenPorts(owner, geminiKey);
let geminiCalls = 0;
const ports = {
  ...realPorts,
  generate: async (request) => {
    geminiCalls += 1;
    return realPorts.generate(request);
  },
};
```

4. **Proof 1 — a completed note generates.** Call `claimAndGenerate(ports, row)`. Assert the outcome is `"generated"`, `geminiCalls === 1`, the row reads `notegen_status = 'completed'`, and `note_chunks` holds at least one row whose `chunk_type` is in the three generated types, every one with `persona_id === null` and `embedding === null`.

5. **Proof 2 — a repeat claim is contended and free.** Record `geminiCalls`, call `claimAndGenerate` again on the same row, assert the outcome is `"contended"` and `geminiCalls` did not move.

6. **Proof 3 — concurrent double-claim yields exactly one winner.** On a second fresh row, `await Promise.all([claimAndGenerate(ports, row2), claimAndGenerate(ports, row2)])`; assert exactly one `"generated"` and one `"contended"`, and that `geminiCalls` rose by exactly 1.

7. **Proof 4 — persona resolution.** Call `resolvePersonaFor(owner, userId)` and print `slug`, `depth` and `source`. Assert `slug === DEFAULT_PERSONA_ID`. Print which branch executed — this is the evidence the report needs and must not be inferred afterwards.

8. **Proof 5 — blank transcript costs nothing.** Insert a third row at `'completed'` with `raw_transcript: "   "`. Assert `claimAndGenerate` returns `"blank"`, `geminiCalls` did not move, and the row reads `notegen_status = 'failed'`.

9. Clean up in a `finally`: delete the three note rows **as the owner** (exercising the RLS path a real user takes), and their chunks cascade. Do not delete as the admin — a script that deletes as admin silently succeeds while proving nothing about RLS.

- [ ] **Step 2: Run it**

```bash
node scripts/verify-notegen-pipeline.mjs
```

Expected: every proof prints PASS and the process exits 0. No dev server needed — this exercises the shipped functions directly, not an HTTP route.

**Paste the full output into the final report.** A summary claiming it passed is not evidence.

- [ ] **Step 3: If Proof 4 reports `source: "fallback"`**

That is the expected result for `4tekguyz@gmail.com`, which predates the provisioning trigger. It is not a failure — record it in the report as the fallback path having been exercised live, which is stronger evidence than the unit test alone.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-notegen-pipeline.mjs
git commit -m "test(notegen): live proof against the real project and real Gemini

Imports the shipped modules through the same alias resolve hook
verify-manual-transcribe.mjs uses — a re-implementation would only prove the
copy agrees with itself.

The Gemini port is wrapped in a counter, so 'no second call' is measured
rather than asserted. Five proofs: a completed note generates with one call;
a repeat claim is contended and free; a concurrent double-claim yields exactly
one winner; persona resolution reports which branch executed; a blank
transcript goes terminal without a call.

Cleanup deletes rows as the OWNER, exercising the RLS path a real user takes.
Deleting as the admin would succeed while proving nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Migration, and close the KNOWN_GAPS entry

**Files:**
- Create: `supabase/migrations/<timestamp>_notegen_status_and_personas_grant.sql`
- Modify: `docs/KNOWN_GAPS.md:190-207`
- Modify: `CLAUDE.md` (a `## Note generation` section)

**Interfaces:**
- Consumes: the final shape of `supabase/schemas/notes.sql` and `supabase/schemas/personas.sql`.
- Produces: a migration whose content matches the concatenated schema files, verified by `git hash-object`.

- [ ] **Step 1: Cut the migration**

Only now that the shape is final:

```bash
npx supabase migration new notegen_status_and_personas_grant
```

Fill it with `cat` of the schema files in `config.toml` order — read the order out of `config.toml`, do not take it from memory:

```bash
cat supabase/schemas/notes.sql supabase/schemas/personas.sql supabase/schemas/note_chunks.sql supabase/schemas/persona_provisioning.sql supabase/schemas/storage_audio.sql > supabase/migrations/<timestamp>_notegen_status_and_personas_grant.sql
```

- [ ] **Step 2: Repair the history and confirm**

```bash
npx supabase migration repair --status applied <timestamp> --linked --project-ref pbwvvakzbrimmdntqxxn
```

```bash
npx supabase migration list --linked --project-ref pbwvvakzbrimmdntqxxn
```

Expected: the new timestamp appears in both Local and Remote columns.

- [ ] **Step 3: Verify the migration matches the schema files byte for byte**

```bash
cat supabase/schemas/notes.sql supabase/schemas/personas.sql supabase/schemas/note_chunks.sql supabase/schemas/persona_provisioning.sql supabase/schemas/storage_audio.sql | git hash-object --stdin
```

```bash
git hash-object supabase/migrations/<timestamp>_notegen_status_and_personas_grant.sql
```

Expected: identical hashes. If they differ, the migration was edited by hand — regenerate it from the `cat`.

- [ ] **Step 4: Close the KNOWN_GAPS entry**

Replace the whole `- **`Persona.depth` exists but nothing consumes it.**` bullet at `docs/KNOWN_GAPS.md:190-207` with:

```markdown
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
  `interactions.create` call.

  **Two things this did NOT close, both still open.** No UI control sets
  depth — every persona still carries the `'dense'` column default, so
  Brief and Exhaustive are reachable today only by editing a row by hand,
  and live verification therefore exercised Dense alone. And the recorder
  still selects no persona at capture, so every note generates under the
  Neutral Analyst / default lens; the other three framings in
  `lib/notegen/lens-prompts.ts` are shipped, unit-tested and unexercised
  end to end. Both belong to ROADMAP §5 / Core UX/UI.
```

- [ ] **Step 5: Add the `CLAUDE.md` section**

Add a `## Note generation` section after `## Transcription`. It must state, at minimum: `notegen_status` is the queue and `null` means not-eligible; the two-condition claim and why the `processing_status` clause is load-bearing; that both triggers call `claimAndGenerate`; that phase two shares the cron's one `RUN_BUDGET_MS`; that the manual path reuses the one hoisted deferred client and why a second is the rotation bug; the SDK field placements (`response_format` top-level, lowercase `thinking_level`); that lens prompts are keyed by slug in code and are not a column; and the `MAX_NOTEGEN_PER_RUN = 5` sizing. Cross-reference `§ Data`'s persona-resolution rule rather than restating it.

- [ ] **Step 6: Full verification**

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build
```

All three green.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations docs/KNOWN_GAPS.md CLAUDE.md
git commit -m "docs(notegen): migration, and close the depth-unconsumed gap

The gap is closed narrowly and says what it did not close: no UI sets depth,
so every persona still carries the 'dense' column default and live
verification exercised Dense alone; and the recorder still selects no persona
at capture, so the other three lens framings are shipped and unit-tested but
unexercised end to end. Recording that is the point — a gap entry that reads
as fully closed would be wrong.

Migration is a cat of the schema files in config.toml order, hash-verified
against them rather than hand-edited.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: the column and grant to Task 1; the seven `lib/notegen/` files to Tasks 2–9; both call sites to Tasks 10–11; the five unit-test requirements to Tasks 2 (fallback depth), 3 (lens fallback), 7 (zero-row claim spends nothing, blank transcript spends nothing, fallback persona completes) and 8 (stale sweep); the four live proofs plus persona-path evidence to Task 12; the KNOWN_GAPS close and the fence-crossing record to Tasks 1 and 13.

**Type consistency.** `NotegenStore` is defined once in Task 4 and implemented once in Task 9 with the same four methods. `GeneratableRow` and `ResolvedPersona` are defined in Task 6 and consumed in Tasks 7 and 9. `claimAndGenerate` is defined in Task 7 and called in Tasks 8, 11 and 12. `failNotegen` returns `Promise<boolean>` everywhere — the sweep counts it, so a `void` return would make Task 8's "does not count a lost stale flip" test unwritable.

**Ordering hazard.** Task 6 must land before Task 7, and Task 8 after Task 7, because `sweep.ts` and `generate-note.ts` import from each other. Task 6 therefore ships types only. This is the same shape `lib/transcription/sweep.ts` and `transcribe-note.ts` already have.

**Known gap in this plan.** Task 12 describes the verification script's five proofs and its fixture but does not paste the whole file, because it is a close structural copy of `scripts/verify-manual-transcribe.mjs` and reproducing 350 lines here would guarantee drift between the two. The step says to read that file first and copy its loader verbatim. This is the one place the plan asks the implementer to work from an existing file rather than from the plan text.
