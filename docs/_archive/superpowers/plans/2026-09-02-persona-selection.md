# Persona Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pick which lens (persona) a note generates under, on Note Detail, before generation has been attempted — and make the shown lens provably the one that generated.

**Architecture:** A nullable `notes.persona_id` uuid with a composite FK to `personas (id, user_id)`. One new Server Action writes it behind the same atomic guard the rest of the codebase uses. `resolvePersonaFor` gains a precedence: the note's persona first, today's `neutral-analyst` slug path second. The value generation actually uses is read from the claim's own `RETURNING`, so nothing can change it mid-flight.

**Tech Stack:** Next.js 16.3.3 App Router, React 19.2.8, TypeScript 7.0.2, Tailwind v4.3.3, Supabase (`@supabase/ssr` 0.12.5, `supabase-js` 2.112.4), Vitest 4.1.11.

**Spec:** `docs/superpowers/specs/2026-09-02-persona-selection-design.md`

## Global Constraints

- **Every colour is a `var()` token.** Zero `oklch()`, hex, `rgb()`, `hsl()` in `app/`, `components/`, `lib/`. `components/note-detail/__tests__/project-conventions.test.ts` fails the build otherwise.
- **Soft ceiling 250 lines, hard ceiling 400** on shipped files. The convention test enforces 400 and skips `__tests__`.
- **`SUPABASE_SECRET_KEY` is read by exactly one shipped file**: `app/api/cron/transcribe/route.ts`. The convention test asserts the exact list. Nothing in this plan may read it.
- **Queries never filter on `user_id` in application code.** RLS supplies it. The one documented exception is the notegen/transcription cron path, which already carries its filter; do not add new ones.
- **No application name string anywhere** except `package.json` `name`.
- **Schema-file-first.** Never paste DDL into `db query` as an inline argument. Edit the `.sql` file, then apply that exact file with `--file`. Inline `db query` is for `select` verification only.
- **Never call `apply_migration` while iterating** — it writes a migration history entry every call and blocks further diffing.
- **Exact version pins**, no `^` or `~`. This plan adds no dependencies.
- Run every command from the worktree root: `C:\Projects\tekguyz-squid-ink\.claude\worktrees\persona-selection`.

---

### Task 1: Schema — `notes.persona_id`

**Files:**
- Modify: `supabase/schemas/notes.sql` (append the column, after the `notegen_status` block)
- Modify: `supabase/schemas/personas.sql` (append the FK + index at end of file)

**Interfaces:**
- Consumes: nothing.
- Produces: `public.notes.persona_id uuid` nullable; constraint `notes_persona_id_fkey`; index `notes_persona_id_idx`.

**Why the constraint lives in `personas.sql`:** `supabase/config.toml` `schema_paths` applies `notes.sql` **before** `personas.sql`. A foreign key from notes to personas declared in `notes.sql` would fail on a fresh apply because `public.personas` does not exist yet. The column has no dependency and stays in `notes.sql`; the constraint moves to the end of `personas.sql`, after the table and after `personas_id_user_id_key`.

- [ ] **Step 1: Add the column to `notes.sql`**

Append after the `notes_notegen_status_check` block and before the `notes_user_id_created_at_idx` index:

```sql
-- persona_id: which lens this note generates under. Nullable, and null keeps
-- meaning exactly what it means on note_chunks — the default persona. Every
-- note written before 2026-09-02 is null and generates as it always did;
-- there is no backfill, matching the persona provisioning trigger's own
-- deliberate no-backfill decision.
--
-- The FOREIGN KEY IS NOT HERE. config.toml applies this file before
-- personas.sql, so a reference to public.personas would not resolve on a
-- fresh apply. The constraint is declared at the end of personas.sql instead.
-- The column is declared here because this is the notes table.
alter table public.notes
  add column if not exists persona_id uuid;
```

- [ ] **Step 2: Add the FK and index to `personas.sql`**

Append at the very end of the file:

```sql
-- notes.persona_id's foreign key, declared HERE rather than in notes.sql
-- because config.toml applies notes.sql first and public.personas would not
-- exist yet. The column itself is declared in notes.sql.
--
-- Composite, for the reason note_chunks_persona_id_fkey is composite: a
-- foreign key is validated as the referenced table's owner and is NOT subject
-- to row level security, so a plain references personas (id) would let one
-- user's note point at another user's lens. Carrying user_id into the key
-- makes the database refuse it. personas_id_user_id_key above is the unique
-- constraint this requires.
--
-- MATCH SIMPLE (the default) means a null persona_id satisfies the constraint
-- with no lookup at all — null still means "the default persona".
--
-- set null names persona_id explicitly (Postgres 15+). Without the column
-- list, deleting a persona would try to null notes.user_id too, which is not
-- null. Same trap note_chunks.sql documents.
alter table public.notes
  drop constraint if exists notes_persona_id_fkey;
alter table public.notes
  add constraint notes_persona_id_fkey
  foreign key (persona_id, user_id) references public.personas (id, user_id)
  on delete set null (persona_id);

-- Postgres does not index foreign keys automatically, and on delete set null
-- has to find the rows to null.
create index if not exists notes_persona_id_idx
  on public.notes (persona_id);
```

- [ ] **Step 3: Apply both files, in `config.toml` order**

Read the project ref out of `.env.local` (`NEXT_PUBLIC_SUPABASE_URL` — the ref is the subdomain).

Run:
```bash
npx supabase db query --linked --project-ref <ref> --file supabase/schemas/notes.sql
```
Then:
```bash
npx supabase db query --linked --project-ref <ref> --file supabase/schemas/personas.sql
```
Expected: both succeed. Every statement is idempotent, so re-running is safe.

- [ ] **Step 4: Read the live catalog back — this is the proof, not the apply**

Run this as an inline `select` (verification only, which is the permitted use of inline `db query`):

```sql
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.notes'::regclass and conname = 'notes_persona_id_fkey';

select indexname, indexdef from pg_indexes
where tablename = 'notes' and indexname = 'notes_persona_id_idx';

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'notes' and column_name = 'persona_id';
```

Expected: the constraint definition contains `FOREIGN KEY (persona_id, user_id) REFERENCES personas(id, user_id) ON DELETE SET NULL (persona_id)`; the index exists; the column is `uuid`, `YES` nullable.

**Paste this output into the final report.** A passing `npm run build` is not evidence the migration landed.

- [ ] **Step 5: Prove the composite FK actually refuses a cross-tenant write**

Using `scripts/verify-rls.mjs` as the pattern for signing in two real users, attempt to set the owner's note `persona_id` to the intruder's persona uuid. Expected: rejected with SQLSTATE `23503`. This is the same proof `note_chunks` got on 2026-08-30.

- [ ] **Step 6: Commit**

```bash
git add supabase/schemas/notes.sql supabase/schemas/personas.sql
git commit -m "feat(schema): notes.persona_id, composite FK to personas"
```

---

### Task 2: Extract and extend `resolvePersonaFor`

**Files:**
- Create: `lib/notegen/resolve-persona.ts`
- Create: `lib/notegen/__tests__/resolve-persona.test.ts`
- Modify: `lib/notegen/notegen-ports.ts` (delete the function, re-export from the new module)
- Modify: `lib/notegen/sweep.ts` (`ResolvedPersona.source`, `NotegenPorts.resolvePersona` signature)
- Modify: `lib/notegen/__tests__/notegen-ports.test.ts` (move the `resolvePersonaFor` describe block out)

**Interfaces:**
- Consumes: `ResolvedPersona` from `lib/notegen/sweep`, `DEFAULT_PERSONA_ID` / `DEFAULT_PERSONA_FALLBACK` from `lib/notes/default-persona`.
- Produces: `resolvePersonaFor(db: SupabaseClient, userId: string, personaId: string | null): Promise<ResolvedPersona>`, and `ResolvedPersona.source: "note" | "row" | "fallback"`.

**Why extract:** `notegen-ports.ts` is 227 lines; this change adds roughly 60, crossing the 250 soft ceiling. CLAUDE.md § File layout: a file approaching the ceiling gets a purpose-named extraction, never a raised ceiling.

- [ ] **Step 1: Widen `ResolvedPersona.source` in `sweep.ts`**

Change:
```ts
  source: "row" | "fallback";
```
to:
```ts
  /** Which branch resolved this. "note" means the note carried an explicit
   *  persona_id; "row" the neutral-analyst slug lookup; "fallback" an account
   *  with no personas rows at all. generate-note.ts prints this, so the build
   *  report can answer "which path ran" with evidence rather than inference. */
  source: "note" | "row" | "fallback";
```

And change the port signature:
```ts
  /** personaId first, then the neutral-analyst slug, then the fallback. The
   *  user_id filter is the one deliberate exception to the standing rule —
   *  see CLAUDE.md § Data. */
  resolvePersona(userId: string, personaId: string | null): Promise<ResolvedPersona>;
```

- [ ] **Step 2: Write the failing test file**

Create `lib/notegen/__tests__/resolve-persona.test.ts`. Note the fake differs from `notegen-ports.test.ts`'s: this function can issue **two** queries, so results are a queue.

```ts
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePersonaFor } from "@/lib/notegen/resolve-persona";
import {
  DEFAULT_PERSONA_FALLBACK,
  DEFAULT_PERSONA_ID,
} from "@/lib/notes/default-persona";

type Result = { data: unknown; error: unknown };

/** Unlike notegen-ports.test.ts's fake, this one answers a QUEUE of results:
 *  resolvePersonaFor may issue a second query after the first misses, and a
 *  single fixed result cannot tell those two branches apart. Each maybeSingle
 *  consumes one entry; the last entry repeats if the queue runs dry. */
function fakeDb(...results: Result[]) {
  const chain: [string, ...unknown[]][] = [];
  const tables: string[] = [];
  const queue = [...results];
  let queryIndex = -1;
  /** Which chain entries belong to which query, so a test can assert the
   *  columns of the SECOND query without the first one's eq() calls bleeding in. */
  const perQuery: [string, ...unknown[]][][] = [];

  const builder: Record<string, unknown> = {
    maybeSingle: vi.fn(async () => queue.length > 1 ? queue.shift()! : queue[0]),
    then: (resolve: (v: unknown) => void) =>
      resolve(queue.length > 1 ? queue.shift()! : queue[0]),
  };

  for (const method of ["select", "eq", "is", "in", "maybeSingle"]) {
    if (method === "maybeSingle") continue;
    builder[method] = vi.fn((...args: unknown[]) => {
      chain.push([method, ...args]);
      perQuery[queryIndex].push([method, ...args]);
      return builder;
    });
  }

  const db = {
    from: vi.fn((table: string) => {
      tables.push(table);
      queryIndex += 1;
      perQuery.push([]);
      return builder;
    }),
  } as unknown as SupabaseClient;

  return { db, chain, tables, perQuery };
}

const NOTE_PERSONA = { slug: "sales-coach", name: "Sales Coach", depth: "dense" };
const NEUTRAL = { slug: DEFAULT_PERSONA_ID, name: "Neutral Analyst", depth: "dense" };

describe("resolvePersonaFor — the note's own persona", () => {
  it("scopes the lookup by BOTH id and user_id", async () => {
    // Composite ownership, the same check the foreign key enforces. The cron
    // caller is service_role and bypasses RLS, so an id-only lookup could
    // return another account's lens.
    const { db, perQuery } = fakeDb({ data: NOTE_PERSONA, error: null });

    await resolvePersonaFor(db, "u1", "p-uuid");

    const eqs = perQuery[0]
      .filter(([m]) => m === "eq")
      .map(([, col, val]) => [col, val]);
    expect(eqs).toEqual([
      ["id", "p-uuid"],
      ["user_id", "u1"],
    ]);
  });

  it("returns that persona with source 'note'", async () => {
    const { db } = fakeDb({ data: NOTE_PERSONA, error: null });
    expect(await resolvePersonaFor(db, "u1", "p-uuid")).toEqual({
      slug: "sales-coach",
      name: "Sales Coach",
      depth: "dense",
      source: "note",
    });
  });

  it("issues exactly ONE query when the note's persona resolves", async () => {
    const { db, tables } = fakeDb({ data: NOTE_PERSONA, error: null });
    await resolvePersonaFor(db, "u1", "p-uuid");
    expect(tables).toEqual(["personas"]);
  });

  it("falls through to the slug path when the id resolves to no row", async () => {
    // A lens deleted between selection and generation. on delete set null
    // normally nulls the column first; this is the belt for the window where
    // it has not yet.
    const { db, tables } = fakeDb(
      { data: null, error: null },
      { data: NEUTRAL, error: null },
    );
    expect(await resolvePersonaFor(db, "u1", "p-uuid")).toEqual({
      slug: DEFAULT_PERSONA_ID,
      name: "Neutral Analyst",
      depth: "dense",
      source: "row",
    });
    expect(tables).toEqual(["personas", "personas"]);
  });

  it("throws rather than falling back when the id lookup errors", async () => {
    const { db } = fakeDb({
      data: null,
      error: { message: "permission denied for table personas" },
    });
    await expect(resolvePersonaFor(db, "u1", "p-uuid")).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("resolvePersonaFor — null personaId keeps today's behaviour", () => {
  it("filters on user_id and slug, never id, never name", async () => {
    const { db, perQuery } = fakeDb({ data: NEUTRAL, error: null });

    await resolvePersonaFor(db, "u1", null);

    const eqs = perQuery[0]
      .filter(([m]) => m === "eq")
      .map(([, col, val]) => [col, val]);
    expect(eqs).toEqual([
      ["user_id", "u1"],
      ["slug", DEFAULT_PERSONA_ID],
    ]);
    expect(eqs.map(([c]) => c)).not.toContain("name");
  });

  it("reports source 'row' when the account is provisioned", async () => {
    const { db } = fakeDb({ data: { ...NEUTRAL, depth: "brief" }, error: null });
    expect(await resolvePersonaFor(db, "u1", null)).toEqual({
      slug: DEFAULT_PERSONA_ID,
      name: "Neutral Analyst",
      depth: "brief",
      source: "row",
    });
  });

  it("falls back with source 'fallback' on zero rows", async () => {
    const { db } = fakeDb({ data: null, error: null });
    expect(await resolvePersonaFor(db, "u1", null)).toEqual({
      slug: DEFAULT_PERSONA_FALLBACK.id,
      name: DEFAULT_PERSONA_FALLBACK.name,
      depth: DEFAULT_PERSONA_FALLBACK.depth,
      source: "fallback",
    });
  });

  it("throws on a real query error rather than silently falling back", async () => {
    const { db } = fakeDb({
      data: null,
      error: { message: "permission denied for table personas" },
    });
    await expect(resolvePersonaFor(db, "u1", null)).rejects.toThrow(
      /permission denied/,
    );
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run lib/notegen/__tests__/resolve-persona.test.ts`
Expected: FAIL — cannot resolve `@/lib/notegen/resolve-persona`.

- [ ] **Step 4: Create `lib/notegen/resolve-persona.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedPersona } from "@/lib/notegen/sweep";
import {
  DEFAULT_PERSONA_FALLBACK,
  DEFAULT_PERSONA_ID,
} from "@/lib/notes/default-persona";

/** Which persona config a note generates under.
 *
 *  It lived in notegen-ports.ts until 2026-09-02 and moved when per-note
 *  selection gave it a second branch. That file was 227 lines against a
 *  250-line soft ceiling, and "which lens frames this generation" is a
 *  different responsibility from the store and the ports factory — the same
 *  reasoning that split supabase-ports.ts out of the cron route.
 *
 *  THE user_id FILTER IS THE ONE DELIBERATE EXCEPTION to the standing rule
 *  that queries never filter on user_id in application code. The cron caller
 *  has no RLS to mask: service_role bypasses it entirely, so an unfiltered
 *  lookup would return whichever account's row Postgres reached first. The
 *  Server Action caller filters identically, where it is defence in depth. */

interface PersonaConfigRow {
  slug: string;
  name: string;
  depth: ResolvedPersona["depth"];
}

const CONFIG_COLUMNS = "slug, name, depth";

export async function resolvePersonaFor(
  db: SupabaseClient,
  userId: string,
  personaId: string | null,
): Promise<ResolvedPersona> {
  // 1. The note's own lens, when it has one.
  //
  // Scoped by id AND user_id — the same composite ownership the foreign key
  // enforces, and for the same reason: a foreign key is not subject to RLS,
  // and neither is service_role.
  if (personaId) {
    const { data, error } = await db
      .from("personas")
      .select(CONFIG_COLUMNS)
      .eq("id", personaId)
      .eq("user_id", userId)
      .maybeSingle<PersonaConfigRow>();

    if (error) {
      throw new Error(`resolving the note's persona failed: ${error.message}`);
    }

    if (data) {
      return {
        slug: data.slug,
        name: data.name,
        depth: data.depth,
        source: "note",
      };
    }

    // Zero rows: the lens was deleted between selection and generation.
    // on delete set null normally nulls the column before this can happen, so
    // this is the belt for the window where it has not yet. Falling through is
    // right — refusing to generate over a deleted lens would be worse than
    // generating under the default.
  }

  // 2. Today's path, unchanged. Slug, never name: personas.sql declares and
  // indexes unique (user_id, slug) and says in its own header that slug is the
  // key chosen to survive a reseed.
  const { data, error } = await db
    .from("personas")
    .select(CONFIG_COLUMNS)
    .eq("user_id", userId)
    .eq("slug", DEFAULT_PERSONA_ID)
    .maybeSingle<PersonaConfigRow>();

  // Thrown, not swallowed into the fallback. "permission denied for table
  // personas" is precisely what a missing service_role grant returns, and
  // falling back would hide that behind output that looks correct.
  if (error) throw new Error(`resolving persona failed: ${error.message}`);

  if (data) {
    return {
      slug: data.slug,
      name: data.name,
      depth: data.depth,
      source: "row",
    };
  }

  // 3. Zero rows: an account created before the 2026-08-31 provisioning
  // trigger and deliberately not backfilled. A crash floor, not a preset list.
  return {
    slug: DEFAULT_PERSONA_FALLBACK.id,
    name: DEFAULT_PERSONA_FALLBACK.name,
    depth: DEFAULT_PERSONA_FALLBACK.depth,
    source: "fallback",
  };
}
```

- [ ] **Step 5: Run the new test — expect PASS**

Run: `npx vitest run lib/notegen/__tests__/resolve-persona.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Delete the old copy and re-export**

In `lib/notegen/notegen-ports.ts`, delete the whole `resolvePersonaFor` function and its doc comment, delete the now-unused `DEFAULT_PERSONA_FALLBACK` / `DEFAULT_PERSONA_ID` imports, and add near the top:

```ts
import { resolvePersonaFor } from "@/lib/notegen/resolve-persona";

/** Re-exported so callers and tests that already import it from here keep
 *  working. It MOVED on 2026-09-02, it did not change owner — see
 *  lib/notegen/resolve-persona.ts for why. */
export { resolvePersonaFor } from "@/lib/notegen/resolve-persona";
```

Update the port wiring in `createNotegenPorts`:

```ts
    resolvePersona: (userId, personaId) => resolvePersonaFor(db, userId, personaId),
```

- [ ] **Step 7: Move the old describe block out of `notegen-ports.test.ts`**

Delete the entire `describe("resolvePersonaFor", ...)` block from `lib/notegen/__tests__/notegen-ports.test.ts` — it is superseded by the new file, which covers the same four cases plus the new branch. Remove the now-unused `resolvePersonaFor`, `DEFAULT_PERSONA_FALLBACK` and `DEFAULT_PERSONA_ID` imports if nothing else in the file uses them.

- [ ] **Step 8: Run the whole notegen suite**

Run: `npx vitest run lib/notegen`
Expected: PASS. `generate-note.test.ts` and `sweep.test.ts` may fail on the `resolvePersona` arity — that is Task 3's work. If they fail only on that, proceed; if anything else fails, stop and investigate.

- [ ] **Step 9: Commit**

```bash
git add lib/notegen/resolve-persona.ts lib/notegen/__tests__/resolve-persona.test.ts lib/notegen/notegen-ports.ts lib/notegen/__tests__/notegen-ports.test.ts lib/notegen/sweep.ts
git commit -m "feat(notegen): resolve the note's own persona before the default slug"
```

---

### Task 3: The claim carries the persona

**Files:**
- Modify: `lib/notegen/sweep.ts` (add `ClaimResult`, change `NotegenPorts.claimForGeneration`)
- Modify: `lib/notegen/notegen-ports.ts` (widen the claim's `RETURNING`)
- Modify: `lib/notegen/generate-note.ts` (`ClaimResolution`, thread `personaId`)
- Modify: `lib/notegen/__tests__/notegen-ports.test.ts`
- Modify: `lib/notegen/__tests__/generate-note.test.ts`
- Modify: `lib/notegen/__tests__/sweep.test.ts` (port fake returns the union)

**Interfaces:**
- Consumes: `resolvePersona(userId, personaId)` from Task 2.
- Produces:
  - `ClaimResult = { status: "claimed"; personaId: string | null } | { status: "lost" }` (exported from `lib/notegen/sweep`)
  - `ClaimResolution = { outcome: "claimed"; personaId: string | null } | { outcome: "contended" } | { outcome: "blank" }` (exported from `lib/notegen/generate-note`)
  - `generateClaimedNote(ports, row, personaId: string | null)`
  - `claimAndGenerate(ports, row)` — return type `NotegenOutcome`, **unchanged**, so `sweep.ts`'s counters need no edit.

**Why tagged unions:** "claimed with no persona" and "lost the race" are both falsy-adjacent. Collapsed into `boolean | string | null` they become distinguishable only by a caller checking `!== null` against two different nullable things. This exact file already carries a documented data-loss incident from one missing clause (`deleteGeneratedChunks`, 2026-09-02).

- [ ] **Step 1: Write the failing test for the widened `RETURNING`**

In `lib/notegen/__tests__/notegen-ports.test.ts`, replace the existing `claimForGeneration` describe block with:

```ts
describe("claimForGeneration", () => {
  it("guards on BOTH processing_status and a null notegen_status", async () => {
    // The processing_status clause is what makes "cannot generate notes before
    // a transcript exists" true by construction. Losing it would be silent.
    const { db, chain } = fakeDb({
      data: [{ id: "n1", persona_id: null }],
      error: null,
    });
    await createNotegenPorts(db, "key").claimForGeneration("n1");

    expect(chain).toContainEqual(["eq", "processing_status", "completed"]);
    expect(chain).toContainEqual(["is", "notegen_status", null]);
  });

  it("RETURNS persona_id from the claim itself, not a second select", async () => {
    // The value generation uses must be the one on the row this UPDATE
    // row-locked. A second select afterwards could read a write that landed
    // in between, which is exactly what the lock exists to prevent.
    const { db, chain, tables } = fakeDb({
      data: [{ id: "n1", persona_id: "p-uuid" }],
      error: null,
    });
    await createNotegenPorts(db, "key").claimForGeneration("n1");

    expect(chain).toContainEqual(["select", "id, persona_id"]);
    expect(tables).toEqual(["notes"]);
  });

  it("reports the claimed persona", async () => {
    const { db } = fakeDb({
      data: [{ id: "n1", persona_id: "p-uuid" }],
      error: null,
    });
    expect(await createNotegenPorts(db, "key").claimForGeneration("n1")).toEqual({
      status: "claimed",
      personaId: "p-uuid",
    });
  });

  it("distinguishes 'claimed with no persona' from 'lost'", async () => {
    // The whole reason this is a tagged union. Both are falsy-adjacent and
    // must never be told apart by a nullable check.
    const { db } = fakeDb({
      data: [{ id: "n1", persona_id: null }],
      error: null,
    });
    expect(await createNotegenPorts(db, "key").claimForGeneration("n1")).toEqual({
      status: "claimed",
      personaId: null,
    });
  });

  it("reports 'lost' on a zero-row claim", async () => {
    const { db } = fakeDb({ data: [], error: null });
    expect(await createNotegenPorts(db, "key").claimForGeneration("n1")).toEqual({
      status: "lost",
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run lib/notegen/__tests__/notegen-ports.test.ts`
Expected: FAIL — the claim still returns a boolean and selects `"id"`.

- [ ] **Step 3: Add `ClaimResult` to `sweep.ts`**

Above `NotegenPorts`:

```ts
/** What the guarded claim reports back.
 *
 *  A TAGGED UNION, not a nullable boolean, and that is deliberate. "Claimed,
 *  but the note carries no persona" and "lost the race" are both
 *  falsy-adjacent; collapsing them into boolean | string | null would leave
 *  them distinguishable only by a caller checking !== null against two
 *  different nullable things. This module's history includes a data-loss bug
 *  caused by exactly one missing clause in this area. */
export type ClaimResult =
  | { status: "claimed"; personaId: string | null }
  | { status: "lost" };
```

And change the port:

```ts
  /** THE claim. One statement, one implementation, two callers. It carries
   *  persona_id out of its own RETURNING so generation reads the value this
   *  UPDATE row-locked, never one a later write could change. */
  claimForGeneration(noteId: string): Promise<ClaimResult>;
```

- [ ] **Step 4: Widen the claim in `notegen-ports.ts`**

Replace the body of `claimForGeneration`:

```ts
    async claimForGeneration(noteId) {
      // THE claim. One statement, one implementation, two callers. Postgres
      // row-locks the matched row, so a concurrent invocation re-evaluates
      // this WHERE after the lock releases and matches nothing. No lock table,
      // no read-then-write window.
      //
      // The processing_status clause is load-bearing, not belt-and-braces: it
      // is what makes "cannot generate notes before a transcript exists" true
      // by construction rather than by caller discipline.
      //
      // persona_id RIDES OUT ON THE RETURNING, added 2026-09-02. It is not a
      // convenience. A second select after the claim could read a write that
      // landed between the two, so the note would generate under a lens the
      // user did not have selected when the lens froze. This value is the one
      // on the row this statement locked.
      const { data, error } = await db
        .from("notes")
        .update({ notegen_status: "generating" })
        .eq("id", noteId)
        .eq("processing_status", "completed")
        .is("notegen_status", null)
        .select("id, persona_id");

      if (error) throw new Error(`notegen claim failed: ${error.message}`);

      const rows = (data ?? []) as { id: string; persona_id: string | null }[];
      if (rows.length !== 1) return { status: "lost" };
      return { status: "claimed", personaId: rows[0].persona_id };
    },
```

- [ ] **Step 5: Run the ports test — expect PASS**

Run: `npx vitest run lib/notegen/__tests__/notegen-ports.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing tests for the threading**

In `lib/notegen/__tests__/generate-note.test.ts`, update the shared `ports()` helper's defaults:

```ts
    claimForGeneration: vi.fn(async () => ({
      status: "claimed" as const,
      personaId: null,
    })),
    resolvePersona: vi.fn(async () => ({
      slug: DEFAULT_PERSONA_ID,
      name: "Neutral Analyst",
      depth: "dense" as const,
      source: "row" as const,
    })),
```

Update every existing assertion of the form `expect(await claimNoteForGeneration(p, ROW)).toBe("claimed")` to `.toEqual({ outcome: "claimed", personaId: null })`, `"contended"` to `{ outcome: "contended" }`, `"blank"` to `{ outcome: "blank" }`. Update the `claimForGeneration: vi.fn(async () => false)` overrides to `vi.fn(async () => ({ status: "lost" as const }))`. Update every `generateClaimedNote(p, ROW)` call to `generateClaimedNote(p, ROW, null)`.

Then add these new tests:

```ts
describe("the claimed persona reaches resolution", () => {
  it("carries persona_id out of the claim", async () => {
    const { ports: p } = ports({
      claimForGeneration: vi.fn(async () => ({
        status: "claimed" as const,
        personaId: "p-uuid",
      })),
    });
    expect(await claimNoteForGeneration(p, ROW)).toEqual({
      outcome: "claimed",
      personaId: "p-uuid",
    });
  });

  it("hands that persona to resolvePersona, with the note's owner", async () => {
    const { ports: p } = ports();
    await generateClaimedNote(p, ROW, "p-uuid");
    expect(p.resolvePersona).toHaveBeenCalledWith(ROW.user_id, "p-uuid");
  });

  it("passes null through unchanged for a note with no persona", async () => {
    // Every note written before 2026-09-02. It must resolve exactly as it did.
    const { ports: p } = ports();
    await generateClaimedNote(p, ROW, null);
    expect(p.resolvePersona).toHaveBeenCalledWith(ROW.user_id, null);
  });

  it("claimAndGenerate threads the claimed persona end to end", async () => {
    const { ports: p } = ports({
      claimForGeneration: vi.fn(async () => ({
        status: "claimed" as const,
        personaId: "p-uuid",
      })),
    });
    await claimAndGenerate(p, ROW);
    expect(p.resolvePersona).toHaveBeenCalledWith(ROW.user_id, "p-uuid");
  });

  it("still spends no model call on a lost claim", async () => {
    const { ports: p } = ports({
      claimForGeneration: vi.fn(async () => ({ status: "lost" as const })),
    });
    expect(await claimAndGenerate(p, ROW)).toBe("contended");
    expect(p.resolvePersona).not.toHaveBeenCalled();
    expect(p.generate).not.toHaveBeenCalled();
  });
});
```

Import `claimAndGenerate` at the top of the file if it is not already imported.

- [ ] **Step 7: Run and confirm failure**

Run: `npx vitest run lib/notegen/__tests__/generate-note.test.ts`
Expected: FAIL — `generateClaimedNote` takes two arguments, `claimNoteForGeneration` returns a string.

- [ ] **Step 8: Thread it through `generate-note.ts`**

Replace `ClaimOutcome`'s doc block with an added type, keeping `ClaimOutcome` itself (sweep's counters use the strings):

```ts
/** The claim's answer, with the persona the claim itself returned.
 *
 *  An object rather than the bare string it used to be, for the same reason
 *  ClaimResult is tagged: the persona is nullable and so is "no result", and a
 *  caller must never tell them apart by a truthiness check. */
export type ClaimResolution =
  | { outcome: "claimed"; personaId: string | null }
  | { outcome: "contended" }
  | { outcome: "blank" };
```

Rewrite `claimNoteForGeneration`:

```ts
export async function claimNoteForGeneration(
  ports: ClaimPorts,
  row: GeneratableRow,
): Promise<ClaimResolution> {
  // THE claim, through the one implementation in notegen-ports.ts. It carries
  // the note's persona_id back out of its own RETURNING — see ClaimResult.
  const claim = await ports.claimForGeneration(row.id);
  if (claim.status !== "claimed") return { outcome: "contended" };

  // Blankness is checked AFTER the claim, not before, and that is deliberate.
  // Checking first would leave the row eligible forever, so every sweep would
  // re-examine it and a handful of permanently blank rows could starve real
  // work out of the per-run cap. Claiming then failing is terminal and
  // self-clearing. The guarantee that matters is unchanged: this is still
  // before any model call.
  //
  // It also means a LOST claim never reaches this branch, so a blank row we do
  // not own can never be failed over the winner's 'generating'.
  const transcript = row.raw_transcript?.trim();
  if (!transcript) {
    ports.log(
      `note ${row.id}: completed with no usable transcript. ` +
        `Marked 'failed' without a model call.`,
    );
    await ports.store.failNotegen(row.id);
    return { outcome: "blank" };
  }

  return { outcome: "claimed", personaId: claim.personaId };
}
```

Change `generateClaimedNote`'s signature and its resolve call:

```ts
export async function generateClaimedNote(
  ports: GeneratePorts,
  row: GeneratableRow,
  /** From the claim's own RETURNING, never a fresh read. Null means the note
   *  carries no lens and resolution falls to the default slug. */
  personaId: string | null,
): Promise<"generated" | "failed"> {
  try {
    const persona = await ports.resolvePersona(row.user_id, personaId);
```

And `claimAndGenerate`:

```ts
export async function claimAndGenerate(
  ports: ClaimPorts & GeneratePorts,
  row: GeneratableRow,
): Promise<NotegenOutcome> {
  const claim = await claimNoteForGeneration(ports, row);
  if (claim.outcome !== "claimed") return claim.outcome;
  return generateClaimedNote(ports, row, claim.personaId);
}
```

- [ ] **Step 9: Fix `sweep.test.ts`'s port fake**

Change `claimForGeneration: vi.fn(async () => true)` to `vi.fn(async () => ({ status: "claimed" as const, personaId: null }))`, and the `false` override to `vi.fn(async () => ({ status: "lost" as const }))`. Add `personaId: null` is not needed on the lost branch.

- [ ] **Step 10: Run the full notegen suite — expect PASS**

Run: `npx vitest run lib/notegen`
Expected: PASS, all files.

- [ ] **Step 11: Commit**

```bash
git add lib/notegen
git commit -m "feat(notegen): the claim returns the persona it locked"
```

---

### Task 4: Thread `persona_id` to the view model

**Files:**
- Modify: `lib/notes/types.ts` (`NoteRow.persona_id`)
- Modify: `lib/notes/view-types.ts` (`Note.personaId`, `Note.notegenStatus`)
- Modify: `lib/notes/note-view-model.ts` (uuid → slug translation)
- Modify: `lib/mock/note.ts` (the two new required fields)
- Modify: `lib/notes/__tests__/note-view-model.test.ts`

**Interfaces:**
- Consumes: `PersonaRow` (already passed into `buildNoteViewModel`).
- Produces: `Note.personaId: string | null` (a **slug**), `Note.notegenStatus: NotegenStatus | null`.

`get-note.ts` needs no change — it already selects `*`. `lib/notes/list-notes.ts` builds its own `NoteListItem` type and is unaffected.

- [ ] **Step 1: Write the failing tests**

Add to `lib/notes/__tests__/note-view-model.test.ts`. Match the existing fixture helpers in that file for `noteRow()` / `personaRow()` — read them first and reuse them rather than inventing new ones.

```ts
describe("the note's selected persona", () => {
  it("exposes the persona as a SLUG, never the uuid", async () => {
    // The client speaks slugs everywhere — Persona.id is a slug, the rail
    // reports a slug, the stored preference is a slug. A uuid is per-user and
    // does not survive a reseed.
    const personas = [
      personaRow({ id: "uuid-neutral", slug: "neutral-analyst" }),
      personaRow({ id: "uuid-sales", slug: "sales-coach" }),
    ];
    const note = buildNoteViewModel(
      noteRow({ persona_id: "uuid-sales" }),
      [],
      personas,
    );
    expect(note.personaId).toBe("sales-coach");
  });

  it("is null when the note carries no persona", () => {
    // Every note written before 2026-09-02.
    const note = buildNoteViewModel(noteRow({ persona_id: null }), [], [
      personaRow({ id: "uuid-neutral", slug: "neutral-analyst" }),
    ]);
    expect(note.personaId).toBeNull();
  });

  it("is null when the uuid matches no row the user owns", () => {
    // RLS filtered the row out, or the lens was deleted. Rendering a lens the
    // user cannot see would be worse than falling back to the default.
    const note = buildNoteViewModel(
      noteRow({ persona_id: "uuid-gone" }),
      [],
      [personaRow({ id: "uuid-neutral", slug: "neutral-analyst" })],
    );
    expect(note.personaId).toBeNull();
  });

  it("carries notegen_status through for the rail's lock", () => {
    expect(buildNoteViewModel(noteRow({ notegen_status: "completed" }), [], []).notegenStatus)
      .toBe("completed");
    expect(buildNoteViewModel(noteRow({ notegen_status: null }), [], []).notegenStatus)
      .toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run lib/notes/__tests__/note-view-model.test.ts`
Expected: FAIL — `personaId` and `notegenStatus` are not on the returned object.

- [ ] **Step 3: Add `persona_id` to `NoteRow`**

In `lib/notes/types.ts`, inside `NoteRow`, after `notegen_status`:

```ts
  /** Which lens this note generates under. Null means the default persona —
   *  the same meaning the column carries on note_chunks. Every note written
   *  before 2026-09-02 is null and there is no backfill. */
  persona_id: string | null;
```

- [ ] **Step 4: Add the two fields to `Note`**

In `lib/notes/view-types.ts`, inside `Note`, after `processingStatus`:

```ts
  /** Structured note generation's queue state. Read by the persona rail,
   *  which stops being interactive once this is non-null. */
  notegenStatus: NotegenStatus | null;
  /** The SLUG of the lens this note generates under, or null when nothing has
   *  been chosen. Never a uuid — every client-facing persona identifier in
   *  this project is a slug, because a uuid is per-user and does not survive a
   *  reseed. note-view-model.ts does the translation. */
  personaId: string | null;
```

- [ ] **Step 5: Translate in `note-view-model.ts`**

Inside `buildNoteViewModel`, after `const personas = toPersonas(...)`:

```ts
  // uuid on the row, slug on the view model. An id matching no row the user
  // owns yields null: RLS filtered it, or the lens was deleted, and rendering
  // a lens the reader cannot see would be worse than the default.
  const personaId =
    personaRows.find((p) => p.id === row.persona_id)?.slug ?? null;
```

Add both to the returned object, next to `processingStatus`:

```ts
    notegenStatus: row.notegen_status,
    personaId,
```

- [ ] **Step 6: Add the fields to the mock fixture**

In `lib/mock/note.ts`, alongside `processingStatus: "completed"`:

```ts
  notegenStatus: "completed",
  personaId: DEFAULT_PERSONA_ID,
```

Import `DEFAULT_PERSONA_ID` from `@/lib/notes/default-persona` if it is not already imported.

- [ ] **Step 7: Run the notes suite and typecheck**

Run: `npx vitest run lib/notes` — expected PASS.
Run: `npm run typecheck` — expected clean. Any other file constructing a `Note` literal will surface here; fix it by adding the two fields.

- [ ] **Step 8: Commit**

```bash
git add lib/notes lib/mock/note.ts
git commit -m "feat(notes): carry the note's lens slug and notegen status to the view"
```

---

### Task 5: The Server Action

**Files:**
- Create: `app/notes/actions/persona.ts`
- Create: `app/notes/actions/__tests__/persona.test.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`, `DEFAULT_PERSONA_ID` from `@/lib/notes/default-persona`.
- Produces:
  - `type PersonaWriteOutcome = "written" | "locked" | "no-persona" | "not-found"`
  - `setNotePersona(noteId: string, slug: string): Promise<PersonaWriteOutcome>`
  - `seedNotePersona(noteId: string): Promise<PersonaWriteOutcome>`

**Read first:** `app/notes/actions/recording.ts` and `app/notes/actions/transcription.ts`, for the module's voice and the `"use server"` placement. This file needs **its own** `"use server"` — the directive is per module and this folder has no shared entry point.

- [ ] **Step 1: Write the failing test**

Create `app/notes/actions/__tests__/persona.test.ts`. Mock the Supabase server client the way this repo's other action-adjacent tests do; read `lib/notes/__tests__/get-note.test.ts` first for the established `vi.mock("@/lib/supabase/server")` shape and reuse it.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

/** Two recording arrays, not one. The notes chain proves the guard; the
 *  personas chain proves WHICH slug was looked up, which is the only way to
 *  tell "seeded from the remembered lens" from "seeded from the default". */
const updateChain: [string, ...unknown[]][] = [];
const personaChain: [string, ...unknown[]][] = [];

const state = {
  /** Answers the personas lookup. A queue: seedNotePersona may look up a
   *  remembered slug, miss, and look up the default. The last entry repeats. */
  personaLookups: [{ data: { id: "p-uuid" } as unknown, error: null as unknown }],
  updateResult: { data: [{ id: "n1" }] as unknown, error: null as unknown },
  user: { id: "u1", user_metadata: {} as Record<string, unknown> },
  updateUser: vi.fn(async () => ({ data: {}, error: null })),
};

const nextPersonaLookup = () =>
  state.personaLookups.length > 1
    ? state.personaLookups.shift()!
    : state.personaLookups[0];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
      updateUser: state.updateUser,
    },
    from: (table: string) => {
      const sink = table === "notes" ? updateChain : personaChain;
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "update", "eq", "is", "in"]) {
        builder[m] = vi.fn((...args: unknown[]) => {
          sink.push([m, ...args]);
          return builder;
        });
      }
      builder.maybeSingle = vi.fn(async () => nextPersonaLookup());
      builder.then = (resolve: (v: unknown) => void) =>
        resolve(table === "notes" ? state.updateResult : nextPersonaLookup());
      return builder;
    },
  }),
}));

/** Every slug the action asked the personas table for, in order. */
const lookedUpSlugs = () =>
  personaChain
    .filter(([m, col]) => m === "eq" && col === "slug")
    .map(([, , val]) => val);

const { setNotePersona, seedNotePersona } = await import(
  "@/app/notes/actions/persona"
);
const { DEFAULT_PERSONA_ID } = await import("@/lib/notes/default-persona");

beforeEach(() => {
  updateChain.length = 0;
  personaChain.length = 0;
  state.personaLookups = [{ data: { id: "p-uuid" }, error: null }];
  state.updateResult = { data: [{ id: "n1" }], error: null };
  state.user = { id: "u1", user_metadata: {} };
  state.updateUser.mockClear();
});

describe("setNotePersona — the guarded write", () => {
  it("refuses to write once the lens is frozen", async () => {
    // ENFORCEMENT, not decoration. A Server Action is a public HTTP endpoint;
    // the rail's disabled attribute is UX. The guard is what actually holds.
    expect(updateChain).toEqual([]);
    await setNotePersona("n1", "sales-coach");

    expect(updateChain).toContainEqual([
      "in",
      "processing_status",
      ["local", "uploading"],
    ]);
    expect(updateChain).toContainEqual(["is", "notegen_status", null]);
  });

  it("reports 'locked' when the guarded update matches nothing", async () => {
    state.updateResult = { data: [], error: null };
    expect(await setNotePersona("n1", "sales-coach")).toBe("locked");
  });

  it("reports 'written' when it matches", async () => {
    expect(await setNotePersona("n1", "sales-coach")).toBe("written");
  });

  it("never filters on user_id — RLS supplies the owner", async () => {
    // A redundant filter would mask an RLS failure instead of exposing it.
    await setNotePersona("n1", "sales-coach");
    const columns = updateChain
      .filter(([m]) => m === "eq" || m === "in")
      .map(([, col]) => col);
    expect(columns).not.toContain("user_id");
  });
});

describe("setNotePersona — the preference", () => {
  it("remembers the SLUG, not the uuid", async () => {
    await setNotePersona("n1", "sales-coach");
    expect(state.updateUser).toHaveBeenCalledWith({
      data: { last_persona_id: "sales-coach" },
    });
  });

  it("does not move the default when the write was refused", async () => {
    state.updateResult = { data: [], error: null };
    await setNotePersona("n1", "sales-coach");
    expect(state.updateUser).not.toHaveBeenCalled();
  });
});

describe("setNotePersona — an account with no personas", () => {
  it("writes nothing and reports 'no-persona'", async () => {
    // The zero-row account default-persona.ts describes. Leaving persona_id
    // null is what keeps its existing fallback path untouched.
    state.personaLookups = [{ data: null, error: null }];
    expect(await setNotePersona("n1", "sales-coach")).toBe("no-persona");
    expect(updateChain).toEqual([]);
    expect(state.updateUser).not.toHaveBeenCalled();
  });
});

describe("seedNotePersona", () => {
  it("uses the remembered slug when there is one", async () => {
    state.user = { id: "u1", user_metadata: { last_persona_id: "investor" } };
    await seedNotePersona("n1");
    expect(lookedUpSlugs()).toEqual(["investor"]);
  });

  it("uses the default slug when nothing is remembered", async () => {
    state.user = { id: "u1", user_metadata: {} };
    expect(await seedNotePersona("n1")).toBe("written");
    expect(lookedUpSlugs()).toEqual([DEFAULT_PERSONA_ID]);
  });

  it("falls back to the default when the remembered lens is gone", async () => {
    // A renamed or deleted persona must not strand every new note.
    state.user = { id: "u1", user_metadata: { last_persona_id: "gone" } };
    state.personaLookups = [
      { data: null, error: null },
      { data: { id: "p-uuid" }, error: null },
    ];
    expect(await seedNotePersona("n1")).toBe("written");
    expect(lookedUpSlugs()).toEqual(["gone", DEFAULT_PERSONA_ID]);
  });

  it("guards on a null persona_id so it can never overwrite a choice", async () => {
    await seedNotePersona("n1");
    expect(updateChain).toContainEqual(["is", "persona_id", null]);
  });

  it("carries the frozen-state guard too", async () => {
    await seedNotePersona("n1");
    expect(updateChain).toContainEqual([
      "in",
      "processing_status",
      ["local", "uploading"],
    ]);
    expect(updateChain).toContainEqual(["is", "notegen_status", null]);
  });

  it("does NOT write the preference — seeding is not a user decision", async () => {
    await seedNotePersona("n1");
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it("reports 'no-persona' for an account with no lenses at all", async () => {
    // Nothing is written, so resolvePersonaFor's DEFAULT_PERSONA_FALLBACK
    // branch keeps running exactly as it does today.
    state.personaLookups = [{ data: null, error: null }];
    expect(await seedNotePersona("n1")).toBe("no-persona");
    expect(updateChain).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run app/notes/actions/__tests__/persona.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write `app/notes/actions/persona.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_PERSONA_ID } from "@/lib/notes/default-persona";

/**
 * Which lens a note generates under, chosen on Note Detail before generation.
 *
 * Its own "use server". The directive is per module and app/notes/actions has
 * no shared entry point to put one in — the same reason recording.ts and
 * transcription.ts each carry theirs.
 *
 * THE AUTHENTICATED COOKIE CLIENT, never the secret key. RLS confines every
 * read and write here to the caller's own rows, so a request for somebody
 * else's note matches zero rows exactly as a frozen note does. No
 * application-level user_id filter — that would mask an RLS failure instead of
 * exposing it, and app/api/cron/transcribe/route.ts stays the only shipped
 * file reading SUPABASE_SECRET_KEY.
 *
 * NO REGENERATION. docs/DECISIONS.md § Personas rejected it on 2026-08-30 and
 * this module does not reopen it: the guard below is what makes the rejection
 * true rather than merely unimplemented.
 */

export type PersonaWriteOutcome =
  /** The guarded UPDATE matched. */
  | "written"
  /** Zero rows: generation has already been attempted, so the lens is frozen. */
  | "locked"
  /** The slug resolves to no row this user owns — the zero-persona account.
   *  Nothing is written, so the existing fallback resolution runs untouched. */
  | "no-persona"
  /** No such note, or not this user's. */
  | "not-found";

/** The window in which a lens can still be chosen.
 *
 *  Deliberately WIDER than "notegen_status is null". Pressing Transcribe moves
 *  processing_status to 'analyzing' while notegen_status stays null for the
 *  whole transcription — generation only claims afterwards, inside after().
 *  Locking on notegen_status alone would leave minutes in which the rail shows
 *  one lens and generation could use another. The premise of this feature is
 *  that those are the same lens. */
const SELECTABLE_STATUSES = ["local", "uploading"] as const;

/** The note's persona_id uuid for a slug this user owns, or null.
 *
 *  No user_id filter: RLS scopes it. Zero rows is not an error — it is the
 *  account created before the 2026-08-31 provisioning trigger and deliberately
 *  not backfilled. */
async function personaIdForSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  slug: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("personas")
    .select("id")
    .eq("slug", slug)
    .maybeSingle<{ id: string }>();

  if (error) throw new Error(`Failed to read the persona: ${error.message}`);
  return data?.id ?? null;
}

/** THE guarded write. One statement, both callers.
 *
 *  Same shape as the notegen claim, for the same reason: Postgres row-locks
 *  the matched row, so there is no read-then-write window in which the note
 *  could freeze between the check and the write. A zero-row result IS the
 *  answer, not an error to retry. */
async function writePersona(
  supabase: Awaited<ReturnType<typeof createClient>>,
  noteId: string,
  personaId: string,
  onlyWhenUnset: boolean,
): Promise<boolean> {
  let query = supabase
    .from("notes")
    .update({ persona_id: personaId })
    .eq("id", noteId)
    .in("processing_status", [...SELECTABLE_STATUSES])
    .is("notegen_status", null);

  // Seeding must never overwrite a real choice — including its own, if two
  // tabs mount at once.
  if (onlyWhenUnset) query = query.is("persona_id", null);

  const { data, error } = await query.select("id");

  if (error) throw new Error(`Failed to set the note's lens: ${error.message}`);
  return (data?.length ?? 0) === 1;
}

/**
 * The user picked a lens.
 *
 * Writes the note, then remembers the choice for their next note. The
 * preference is written ONLY after the note write lands: a refused write must
 * not move the default for every future note.
 */
export async function setNotePersona(
  noteId: string,
  slug: string,
): Promise<PersonaWriteOutcome> {
  const supabase = await createClient();

  const personaId = await personaIdForSlug(supabase, slug);
  if (!personaId) return "no-persona";

  if (!(await writePersona(supabase, noteId, personaId, false))) return "locked";

  // A SLUG, not a uuid — the uuid is per-user and does not survive a reseed,
  // which is the same reason personas.sql chose slug as its key.
  //
  // Auth user metadata, not a table. One preference field does not earn a
  // schema addition, and this rides the session the user already has.
  const { error } = await supabase.auth.updateUser({
    data: { last_persona_id: slug },
  });
  // Logged, not thrown. The note is already correct; failing the whole action
  // because a convenience did not persist would be the wrong trade.
  if (error) {
    console.error(`[persona] could not remember ${slug}`, error.message);
  }

  revalidatePath(`/notes/${noteId}`);
  return "written";
}

/**
 * Give a note that has none the user's last-used lens, or the default.
 *
 * A REAL WRITE, not a visual default. The rail must never highlight a lens
 * that is not what the database holds, because the whole promise of this
 * feature is that the lens shown is the lens that generates.
 *
 * Does NOT write the preference. Seeding is not a decision the user made.
 */
export async function seedNotePersona(
  noteId: string,
): Promise<PersonaWriteOutcome> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "not-found";

  const remembered = user.user_metadata?.last_persona_id;
  const slug = typeof remembered === "string" ? remembered : DEFAULT_PERSONA_ID;

  // A remembered lens the user no longer owns falls back to the default rather
  // than failing — a renamed or deleted persona must not strand new notes.
  const personaId =
    (await personaIdForSlug(supabase, slug)) ??
    (slug === DEFAULT_PERSONA_ID
      ? null
      : await personaIdForSlug(supabase, DEFAULT_PERSONA_ID));

  // Zero personas rows at all. Leave persona_id null so resolvePersonaFor's
  // DEFAULT_PERSONA_FALLBACK branch runs exactly as it does today.
  if (!personaId) return "no-persona";

  if (!(await writePersona(supabase, noteId, personaId, true))) return "locked";

  revalidatePath(`/notes/${noteId}`);
  return "written";
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx vitest run app/notes/actions/__tests__/persona.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Confirm the convention guard still passes**

Run: `npx vitest run components/note-detail/__tests__/project-conventions.test.ts`
Expected: PASS — in particular the `SUPABASE_SECRET_KEY` single-reader assertion and the 400-line ceiling.

- [ ] **Step 6: Commit**

```bash
git add app/notes/actions/persona.ts app/notes/actions/__tests__/persona.test.ts
git commit -m "feat(actions): set a note's lens behind a frozen-state guard"
```

---

### Task 6: The rail locks

**Files:**
- Modify: `components/note-detail/persona-rail.tsx`
- Modify: `components/note-detail/__tests__/persona-rail.test.tsx`

**Interfaces:**
- Consumes: `Persona` from `@/lib/notes/view-types`.
- Produces: `PersonaRailProps` gains `locked: boolean`.

- [ ] **Step 1: Write the failing tests**

Add to `components/note-detail/__tests__/persona-rail.test.tsx`. The existing `base` object needs `locked: false` added so the current tests keep compiling.

```ts
describe("PersonaRail — locked", () => {
  it("disables every lens once the note is frozen", async () => {
    render(<PersonaRail {...base} locked onSelect={vi.fn()} />);
    for (const name of ["Neutral Analyst", "Investor"]) {
      expect(screen.getByRole("tab", { name })).toBeDisabled();
    }
  });

  it("does not report a selection when a locked lens is clicked", async () => {
    // The client-side half of the lock. The Server Action's guard is the half
    // that actually enforces it — this only stops the pointless round trip.
    const onSelect = vi.fn();
    render(<PersonaRail {...base} locked onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("tab", { name: "Investor" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("still shows which lens generated the note", async () => {
    // Locked is not hidden. The rail's job when frozen is to report the truth
    // about how the note was generated.
    render(<PersonaRail {...base} locked selectedId="investor" onSelect={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Investor" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("is fully interactive while the note is still selectable", async () => {
    const onSelect = vi.fn();
    render(<PersonaRail {...base} locked={false} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("tab", { name: "Investor" }));
    expect(onSelect).toHaveBeenCalledWith("investor");
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run components/note-detail/__tests__/persona-rail.test.tsx`
Expected: FAIL — `locked` is not a prop and the buttons are never disabled.

- [ ] **Step 3: Implement the lock**

In `components/note-detail/persona-rail.tsx`, add to `PersonaRailProps`:

```ts
  /** True once generation has been attempted, or once Transcribe has been
   *  pressed. The lens that generated a note is a fact about it, not a filter
   *  over it — see docs/DECISIONS.md § Personas, "Regeneration — considered
   *  and rejected". This is the UX half of the lock; the enforcing half is the
   *  guard in app/notes/actions/persona.ts. */
  locked: boolean;
```

Change the button to branch on it. Every colour stays a token — no literals:

```tsx
            <button
              key={persona.id}
              type="button"
              role="tab"
              aria-selected={selected}
              disabled={locked}
              title={persona.sub}
              onClick={() => onSelect(persona.id)}
              className={[
                "border-l-2 px-[11px] pt-2 pb-[9px] text-left",
                "font-header text-sm font-semibold leading-[1.25]",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                locked ? "cursor-default" : "cursor-pointer",
                selected
                  ? "border-accent bg-paper text-ink"
                  : locked
                    ? "border-transparent text-placeholder"
                    : "border-transparent text-rail-idle hover:bg-raised",
              ].join(" ")}
            >
```

`disabled` is a real attribute here, not `aria-disabled`. That is the opposite of `transcribe-button.tsx`, which is deliberate: that button must stay reachable to announce a failure, while a locked lens has nothing to announce beyond what `aria-selected` already says.

The selected lens keeps `text-ink` when locked — it is reporting a fact, and dimming it would hide the answer.

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run components/note-detail/__tests__/persona-rail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Confirm no colour literal crept in**

Run: `npx vitest run components/note-detail/__tests__/project-conventions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/note-detail/persona-rail.tsx components/note-detail/__tests__/persona-rail.test.tsx
git commit -m "feat(note-detail): the lens rail locks once generation is committed"
```

---

### Task 7: Wire the shell

**Files:**
- Modify: `components/note-detail/note-detail-shell.tsx`
- Create: `components/note-detail/__tests__/note-detail-shell-persona.test.tsx`

**Interfaces:**
- Consumes: `setNotePersona` / `seedNotePersona` from Task 5, `locked` from Task 6, `note.personaId` / `note.notegenStatus` from Task 4.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing tests**

Create `components/note-detail/__tests__/note-detail-shell-persona.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockNote } from "@/lib/mock/note";
import type { Note } from "@/lib/notes/view-types";

const seedNotePersona = vi.fn(async () => "written" as const);
const setNotePersona = vi.fn(async () => "written" as const);
const refresh = vi.fn();

vi.mock("@/app/notes/actions/persona", () => ({ seedNotePersona, setNotePersona }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { NoteDetailShell } = await import("../note-detail-shell");

const note = (over: Partial<Note>): Note => ({ ...mockNote, ...over });

beforeEach(() => {
  seedNotePersona.mockClear();
  setNotePersona.mockClear();
  refresh.mockClear();
});

describe("seeding on mount", () => {
  it("seeds a fresh note that carries no lens", async () => {
    // A REAL write, not a visual default: the rail must never highlight a lens
    // the database does not hold.
    render(
      <NoteDetailShell
        note={note({ personaId: null, notegenStatus: null, processingStatus: "uploading" })}
      />,
    );
    await waitFor(() => expect(seedNotePersona).toHaveBeenCalledWith(mockNote.id));
  });

  it("does NOT seed a note that already has one", async () => {
    render(
      <NoteDetailShell
        note={note({ personaId: "investor", notegenStatus: null, processingStatus: "uploading" })}
      />,
    );
    await waitFor(() => expect(seedNotePersona).not.toHaveBeenCalled());
  });

  it("does NOT seed a locked note", async () => {
    // Writing a lens onto a note that already generated under a different one
    // would make the rail lie — the exact failure this feature exists to stop.
    render(
      <NoteDetailShell
        note={note({ personaId: null, notegenStatus: "completed", processingStatus: "completed" })}
      />,
    );
    await waitFor(() => expect(seedNotePersona).not.toHaveBeenCalled());
  });

  it("does NOT seed once Transcribe has been pressed", async () => {
    render(
      <NoteDetailShell
        note={note({ personaId: null, notegenStatus: null, processingStatus: "analyzing" })}
      />,
    );
    await waitFor(() => expect(seedNotePersona).not.toHaveBeenCalled());
  });
});

describe("choosing a lens", () => {
  it("writes the choice through the action", async () => {
    render(
      <NoteDetailShell
        note={note({ personaId: "neutral-analyst", notegenStatus: null, processingStatus: "uploading" })}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Investor" }));
    await waitFor(() =>
      expect(setNotePersona).toHaveBeenCalledWith(mockNote.id, "investor"),
    );
  });

  it("cannot choose once the note is locked", async () => {
    render(
      <NoteDetailShell
        note={note({ personaId: "neutral-analyst", notegenStatus: "completed", processingStatus: "completed" })}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Investor" }));
    expect(setNotePersona).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run components/note-detail/__tests__/note-detail-shell-persona.test.tsx`
Expected: FAIL — the shell holds `personaId` in local state seeded from `DEFAULT_PERSONA_ID` and calls no action.

- [ ] **Step 3: Rewrite the shell's persona state**

In `components/note-detail/note-detail-shell.tsx`:

Add imports:
```ts
import { useRouter } from "next/navigation";
import { seedNotePersona, setNotePersona } from "@/app/notes/actions/persona";
```

Add above the component:
```ts
/** The window in which a lens can still be chosen. Mirrors
 *  SELECTABLE_STATUSES in app/notes/actions/persona.ts — the client copy is
 *  UX, that one is enforcement, and they must agree. */
const SELECTABLE: ReadonlySet<string> = new Set(["local", "uploading"]);
```

Replace the persona state:
```ts
  const router = useRouter();

  // Locked the moment generation is committed. WIDER than "notegen_status is
  // set": pressing Transcribe leaves notegen_status null for the whole
  // transcription, and a lens switched in that window would race the claim.
  const locked =
    note.notegenStatus !== null || !SELECTABLE.has(note.processingStatus);

  // Optimistic, reconciled by router.refresh(). The server value is the
  // authority — this only avoids a flash of the old lens.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const personaId = pendingId ?? note.personaId ?? DEFAULT_PERSONA_ID;

  const persona =
    note.personas.find((p) => p.id === personaId) ?? note.personas[0];

  // Seed the note's lens on mount, as a REAL write. The rail must never
  // highlight something the database does not hold.
  //
  // Never for a locked note: writing a lens onto a note that already generated
  // under a different one would make the rail lie.
  //
  // The ref makes this once per mount rather than once per effect run — React
  // 19 StrictMode double-invokes effects in development, and this one writes.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || locked || note.personaId !== null) return;
    seeded.current = true;
    void seedNotePersona(note.id).then((outcome) => {
      // "no-persona" is the zero-personas account: nothing was written and
      // nothing should be. Only a real write is worth a refresh.
      if (outcome === "written") router.refresh();
    });
  }, [note.id, note.personaId, locked, router]);

  const handlePersonaSelect = useCallback(
    (slug: string) => {
      if (locked) return;
      setPendingId(slug);
      void setNotePersona(note.id, slug).then((outcome) => {
        if (outcome !== "written") setPendingId(null);
        router.refresh();
      });
    },
    [locked, note.id, router],
  );
```

Pass the new props to the rail:
```tsx
      <PersonaRail
        personas={note.personas}
        selectedId={persona.id}
        locked={locked}
        quickActions={persona.actions}
        spansLinked={note.spansLinked}
        onSelect={handlePersonaSelect}
      />
```

Ensure `useRef` is in the React import.

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run components/note-detail`
Expected: PASS across the folder.

- [ ] **Step 5: Check the line count**

Run: `wc -l components/note-detail/note-detail-shell.tsx`
Expected: under 250. It starts at 109. If it exceeds 250, extract the persona state into `components/note-detail/use-note-persona.ts` — a purpose-named hook, the same move `use-transcription-poll.ts` made — rather than leaving it.

- [ ] **Step 6: Full suite and typecheck**

Run: `npm test` — expected PASS.
Run: `npm run typecheck` — expected clean.
Run: `npm run build` — expected clean.

- [ ] **Step 7: Commit**

```bash
git add components/note-detail
git commit -m "feat(note-detail): seed the note's lens on mount, write every change"
```

---

### Task 8: Live proof and documentation

**Files:**
- Create: `scripts/verify-persona-selection.mjs`
- Modify: `docs/KNOWN_GAPS.md` (two entries)
- Modify: `CLAUDE.md` (§ Data, § Note generation)

**Interfaces:**
- Consumes: everything above.
- Produces: a runnable proof, and docs that match the tree.

**Read first:** `scripts/verify-notegen-pipeline.mjs`. Follow its shape — sign in as `RLS_TEST_OWNER_EMAIL`, count Gemini calls, delete rows as the owner. Do not re-implement the pipeline; drive the real code.

- [ ] **Step 1: Write `scripts/verify-persona-selection.mjs`**

It must prove five things and print each with its evidence:

1. **Seed on mount is real.** Insert a note at `processing_status = 'uploading'`, call `seedNotePersona`'s query shape, then read `notes.persona_id` back and resolve it to a slug. Print the uuid and the slug.
2. **Selection writes.** Set the note to `sales-coach`. Read `persona_id` back and confirm it is the Sales Coach uuid.
3. **The guard holds against a locked note.** Flip `notegen_status` to `'completed'`, attempt the same guarded UPDATE, and confirm **zero rows** — proving the lock is server-side and not merely a disabled button.
4. **Sales Coach genuinely frames the generation.** Put a transcript on the note, reset it to `processing_status = 'completed'` / `notegen_status = null` / `persona_id = <sales-coach uuid>`, run `claimAndGenerate`, and **print the generated `note_chunks.content` in full**. A row count is not the proof.
5. **A null `persona_id` still generates as before.** Same transcript, `persona_id = null`, and confirm the log line reports `persona from row` (or `fallback`) and the Neutral Analyst framing.

Clean up as the owner, matching the existing scripts.

- [ ] **Step 2: Run it**

Run: `node scripts/verify-persona-selection.mjs`
Expected: five passes. **Capture the full output**, especially the generated Sales Coach text.

- [ ] **Step 3: Prove the zero-persona account is unchanged**

Sign in as `4tekguyz@gmail.com` (0 persona rows, per `docs/KNOWN_GAPS.md`) and generate a note. Confirm the log reports `persona from fallback` and that generation completes. This is the DoD item that guards against a regression in `default-persona.ts`'s path.

- [ ] **Step 4: Verify the lock in a real browser**

Start the dev server through the preview tooling, open a note whose `notegen_status` is non-null, and confirm the lens buttons are genuinely non-interactive. Screenshot it. A unit test asserting `toBeDisabled()` is not this proof.

- [ ] **Step 5: Update `docs/KNOWN_GAPS.md` § "Persona timing is decided"**

Replace the "Still genuinely unbuilt" paragraph. The new text must:
- say persona **selection** shipped 2026-09-02, on Note Detail rather than in the recorder, and why (capture stays one click);
- say the persona/depth **routing** for `summary`, `takeaway` and `action_item` chunks is what shipped with it;
- keep **depth exposure** listed as open;
- not touch the paragraphs above it, which record the resolved attribution-timing decision.

- [ ] **Step 6: Update the "Two things this did NOT close" paragraph**

That paragraph names two open items. The **persona-selection half closes here**; the **depth-exposure half stays open**. Rewrite it so the depth half survives intact as its own statement and the persona half is marked closed with a date and a pointer to the verification script. **Do not merge the two into one item.**

- [ ] **Step 7: Update `CLAUDE.md`**

- § Data, "Which persona row a generation pipeline reads its config from": add the new precedence — `notes.persona_id` first, scoped `(id, user_id)`, then the slug path unchanged. Note that `resolvePersonaFor` moved to `lib/notegen/resolve-persona.ts`.
- § Note generation: record that the claim's `RETURNING` carries `persona_id`, that `claimForGeneration` returns a tagged union, and why the lock is wider than `notegen_status`.

- [ ] **Step 8: Full green, then commit**

Run: `npm test`, `npm run typecheck`, `npm run build`. All must be clean.

```bash
git add scripts/verify-persona-selection.mjs docs/KNOWN_GAPS.md CLAUDE.md
git commit -m "docs(personas): record shipped lens selection, keep depth open"
```

---

## Self-review

**Spec coverage.** § 1 → Task 1. § 2 → Task 5. § 3 → Task 2. § 4 → Task 3. § 5 → Tasks 5, 6, 7 (the guard, the rail, the shell). § 6 → Task 4. § 7 → Tasks 6, 7. § 8 → Task 8. No section is unimplemented.

**Type consistency.** `ClaimResult` is defined in Task 3 Step 3 and consumed in Steps 4, 8, 9. `ClaimResolution` is defined in Step 8 and consumed by `claimAndGenerate` in the same step. `resolvePersonaFor(db, userId, personaId)` is defined in Task 2 Step 4 and called in Task 2 Step 6's port wiring and Task 3 Step 8. `PersonaWriteOutcome` is defined and used only in Task 5. `Note.personaId` / `Note.notegenStatus` are defined in Task 4 Step 4 and read in Tasks 6 and 7. `locked` is defined in Task 6 Step 3 and passed in Task 7 Step 3.

**Placeholder scan.** Clean. An earlier draft of Task 5 Step 1 left a
non-compiling `state.personaLookupSlug` reference with a note telling the
implementer to fix it; that was a plan failure, not a flag, and the mock now
records the personas chain in its own array so `lookedUpSlugs()` asserts it
directly.

**Verification is live, not local.** Task 1 Step 4 and Task 8 Steps 2–4 are the
only evidence that counts for the definition of done. A green `npm test` proves
none of the five DoD items on its own.
