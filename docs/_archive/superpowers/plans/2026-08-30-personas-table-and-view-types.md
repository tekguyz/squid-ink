# Personas Table + View-Types Fold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Personas a real Supabase table (plus `note_chunks.persona_id` and a `depth` field), and move the view types out of `lib/mock/types.ts` into `lib/notes/view-types.ts`, with zero visible change to the Note Detail screen.

**Architecture:** A new owner-scoped `personas` table holds the four personas that are currently a hardcoded array in `lib/notes/persona-presets.ts`. Takeaway chunks gain a nullable `persona_id` FK; a chunk with a null `persona_id` belongs to the default persona, which preserves today's rendering exactly. `buildNoteViewModel` grows a third parameter (`PersonaRow[]`) and assembles personas from rows instead of constants. Separately, every view type moves verbatim from `lib/mock/types.ts` to `lib/notes/view-types.ts` and the old file is deleted.

**Tech Stack:** Next.js 16.3.3 App Router (RSC), TypeScript 7.0.2, Supabase (hosted, declarative schema via `db query --file`), Vitest 4.1.11.

**Spec:** The user's "Prompt 3 — Personas table + view-types fold" message in this session (scope fence, file list, constraints and definition-of-done reproduced below).

## Global Constraints

- Hosted Supabase only. No Docker, no `db pull` / `db diff` / `db dump`. Apply schema with
  `npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn --file <path>`.
- **Schema-file-first, no exceptions.** Never paste DDL as an inline `db query` argument. Inline `db query` is for `select` verification only.
- Never call `apply_migration` while iterating.
- Every SQL statement idempotent — the whole file is re-applied on every edit.
- Four per-operation RLS policies per table (select/insert/update/delete). Never one blanket `for all`.
- Predicate is always `(select auth.uid()) = user_id`, wrapped. Never bare `auth.uid()`.
- Every policy carries `to authenticated` **and** an ownership predicate.
- UPDATE needs both `using` and `with check`.
- `revoke all on <table> from anon, authenticated;` before granting. `anon` gets nothing.
- Application queries never filter on `user_id` — RLS supplies it.
- `persona_id` FK: nullable, `on delete set null`. Never cascade.
- No `depth` column on `note_chunks` or anywhere pipeline-adjacent. `personas` only.
- No UI surface for `depth`. Backend + type only.
- Zero `oklch()` / hex / `rgb()` / `hsl()` literals in `components/` or `lib/` — the convention test fails the build on one.
- Soft file ceiling 250 lines, hard ceiling 400 (enforced by the convention test).
- No application name string anywhere in code.
- Type moves are **mechanical**. Move, do not rewrite or "improve".
- No visual change to `components/note-detail/` output.

## Known deviation from the prompt's "Do not touch" list

`components/note-detail/speaker-colors.ts` and `lib/mock/note.ts` are on the do-not-touch list, but both must change or `npm run typecheck` fails:

- `speaker-colors.ts:1` imports `SpeakerToken` from `@/lib/mock/types`, the file being deleted. One import-path line changes. Its lookup table is untouched.
- `lib/mock/note.ts:1` imports `Note, Speaker` from `./types`, also deleted. One import-path line changes. Additionally, `Persona` gains a required `depth` field, so the four persona literals in `mockNote` each need `depth: "dense"` added, or `tsc` errors. This is a mechanical consequence of the required type change, not a rewrite.

Both are flagged in the final report.

## File Structure

**Create**
- `supabase/schemas/personas.sql` — table, index, updated_at trigger, four RLS policies, revoke/grant.
- `lib/notes/view-types.ts` — the view types, moved verbatim from `lib/mock/types.ts`.
- `lib/notes/default-persona.ts` — `DEFAULT_PERSONA_ID` plus a single fallback persona for a user with no persona rows. Client-safe (no server imports), because `note-detail-shell.tsx` is a client component.
- `lib/notes/get-personas.ts` — server-side fetch, mirrors `get-note.ts`.
- `lib/notes/__tests__/get-personas.test.ts`.

**Modify**
- `supabase/schemas/note_chunks.sql` — `persona_id` column + index.
- `supabase/config.toml` — `schema_paths` gains `./schemas/personas.sql`, between notes and note_chunks.
- `supabase/seed.sql` — four persona rows, nine attributed takeaway chunks.
- `lib/notes/types.ts` — `PersonaRow`, `persona_id` on `ChunkRow`, import path.
- `lib/notes/note-view-model.ts` — third parameter, persona assembly.
- `lib/notes/get-note.ts` — fetch personas in the same `Promise.all`.
- `lib/notes/sample-exchange.ts`, `lib/notes/speaker-stats.ts` — import path.
- `lib/notes/__tests__/note-view-model.test.ts`, `__tests__/speaker-stats.test.ts` — import path / new signature.
- All twelve `components/note-detail/*` importers — import path only.
- `components/note-detail/note-detail-shell.tsx` — `DEFAULT_PERSONA_ID` now from `@/lib/notes/default-persona`.
- `components/note-detail/__tests__/persona-rail.test.tsx` — `DEFAULT_PERSONA_ID` import.
- `lib/mock/note.ts` — import path + `depth` on four persona literals (see deviation above).
- `scripts/verify-rls.mjs` — third query block for `personas`.
- `CLAUDE.md` — Data section.
- `docs/KNOWN_GAPS.md` — close the two gaps this plan closes.

**Delete**
- `lib/mock/types.ts`
- `lib/notes/persona-presets.ts` — fully superseded. `PRESET_PERSONAS` becomes seeded rows; `DEFAULT_PERSONA_NAME/SUB/ACTIONS` become column values on the seeded `neutral-analyst` row; `DEFAULT_PERSONA_ID` moves to `lib/notes/default-persona.ts`. A file named "presets" holding one id would be a lie.

---

### Task 1: Move the view types, delete `lib/mock/types.ts`

Pure mechanical relocation. No behaviour changes, no type changes yet.

**Files:**
- Create: `lib/notes/view-types.ts`
- Delete: `lib/mock/types.ts`
- Modify: every file matching `grep -rn "lib/mock/types" --include=*.ts --include=*.tsx .`

**Interfaces:**
- Consumes: nothing.
- Produces: `@/lib/notes/view-types` exporting `SpeakerToken`, `Speaker`, `Segment`, `Takeaway`, `SpeakerStat`, `Persona`, `ActionItem`, `CiteRun`, `Note` — identical shapes to the deleted file.

- [ ] **Step 1: Copy the file verbatim to its new home**

```bash
git mv lib/mock/types.ts lib/notes/view-types.ts
```

- [ ] **Step 2: Fix the header comment only**

The first comment says "Shapes for the Note Detail mock". Replace that one line with:

```ts
/** View types the Note Detail components consume. Shaped by
 *  lib/notes/note-view-model.ts from database rows. No colours live here —
 *  speakers carry a token name, and the token resolves in `app/globals.css`. */
```

Change nothing else in the file.

- [ ] **Step 3: Repoint every importer**

```bash
grep -rln "@/lib/mock/types" --include=*.ts --include=*.tsx components lib \
  | xargs sed -i 's|@/lib/mock/types|@/lib/notes/view-types|g'
sed -i 's|from "./types"|from "@/lib/notes/view-types"|' lib/mock/note.ts
```

Then fix the stale prose in `lib/notes/types.ts:2` by hand — it reads "which live in lib/mock/types.ts". It must read `lib/notes/view-types.ts`.

- [ ] **Step 4: Prove zero importers remain and the tree still builds**

```bash
grep -rn "lib/mock/types" --include=*.ts --include=*.tsx . --exclude-dir=node_modules --exclude-dir=.next
```
Expected: no output.

```bash
npm run typecheck && npm test
```
Expected: both pass. `lib/mock/types.ts` no longer exists.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move view types from lib/mock/types.ts to lib/notes/view-types.ts"
```

---

### Task 2: `personas` schema file

**Files:**
- Create: `supabase/schemas/personas.sql`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `public.set_updated_at()` from `notes.sql` (hence personas is applied after notes).
- Produces: `public.personas (id uuid, user_id uuid, slug text, name text, sub text, depth text, quick_actions text[], sort_order integer, created_at timestamptz, updated_at timestamptz)` with `unique (user_id, slug)`. `personas.id` is the FK target for Task 3.

- [ ] **Step 1: Write the schema file**

Create `supabase/schemas/personas.sql`:

```sql
-- personas: one row per lens a user can read a note through.
--
-- Was a hardcoded array in lib/notes/persona-presets.ts. Three of the four
-- personas had no backing row at all, so a takeaway could not be attributed
-- to a lens (docs/KNOWN_GAPS.md). This table plus note_chunks.persona_id is
-- what closes that.
--
-- slug, not id, is what the view model exposes as Persona.id. The client
-- remembers "neutral-analyst" across users and reseeds; a per-user uuid
-- would not survive either.
--
-- depth is ROADMAP.md §5's Brief/Dense/Exhaustive. Nothing consumes it yet —
-- there is no Gemini routing and no UI control — but it is a property of a
-- persona, so it lives here rather than being invented later on a chunk.
--
-- Every statement is idempotent so the whole file can be re-applied.

create table if not exists public.personas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Stable across environments; the view model surfaces this as Persona.id.
  slug text not null,
  name text not null,
  -- The rail's tooltip line, e.g. "dense · no framing".
  sub text not null,
  depth text not null default 'dense'
    check (depth in ('brief', 'dense', 'exhaustive')),
  -- The quick-action buttons under the rail. A text[] rather than jsonb:
  -- it is a list of plain strings with no per-item shape to carry.
  quick_actions text[] not null default '{}',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One "sales-coach" per user, never two.
  unique (user_id, slug)
);

-- Serves the rail's read: every persona of one user, in rail order. The
-- unique constraint above already indexes user_id, but not the ordering.
create index if not exists personas_user_id_sort_order_idx
  on public.personas (user_id, sort_order);

-- updated_at is maintained by the database, by the same function notes uses.
drop trigger if exists personas_set_updated_at on public.personas;
create trigger personas_set_updated_at
  before update on public.personas
  for each row execute function public.set_updated_at();

alter table public.personas enable row level security;

-- Four per-operation policies, matching notes and note_chunks. auth.uid() is
-- wrapped in a select so the planner evaluates it once per query rather than
-- once per row. `to authenticated` alone would be authentication without
-- authorization, so every policy also carries an ownership predicate.

drop policy if exists personas_select_own on public.personas;
create policy personas_select_own on public.personas
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists personas_insert_own on public.personas;
create policy personas_insert_own on public.personas
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- Without with check, a user could rewrite user_id and hand the row away.
drop policy if exists personas_update_own on public.personas;
create policy personas_update_own on public.personas
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists personas_delete_own on public.personas;
create policy personas_delete_own on public.personas
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Revoke first, then grant, so this file is the sole authority on
-- privileges. The project defaults hand anon and authenticated TRUNCATE,
-- REFERENCES and TRIGGER on every new public table; TRUNCATE is not
-- row-level, so RLS does not constrain it.
revoke all on public.personas from anon, authenticated;

-- anon is deliberately granted nothing — this app has no public reads.
grant select, insert, update, delete on public.personas to authenticated;
```

- [ ] **Step 2: Register it in `config.toml`, in dependency order**

In `supabase/config.toml`, replace the `schema_paths` line with:

```toml
schema_paths = ["./schemas/notes.sql", "./schemas/personas.sql", "./schemas/note_chunks.sql"]
```

Order matters and is not a glob: personas needs `set_updated_at()` from notes, and note_chunks needs `personas.id` as an FK target.

- [ ] **Step 3: Apply the file**

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn --file supabase/schemas/personas.sql
```
Expected: success, no error output.

- [ ] **Step 4: Read the live catalog back**

`db diff` is unavailable, so verify by reading the catalog. Inline `db query` is fine here — it is a select.

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select policyname, cmd, qual, with_check from pg_policies where tablename = 'personas' order by cmd"
```
Expected: four rows, cmd = DELETE / INSERT / SELECT / UPDATE, every `qual` / `with_check` reading `( SELECT auth.uid() AS uid) = user_id`, and UPDATE carrying both.

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select grantee, privilege_type from information_schema.role_table_grants where table_name = 'personas' and grantee in ('anon','authenticated') order by grantee, privilege_type"
```
Expected: `authenticated` with exactly DELETE, INSERT, SELECT, UPDATE. Zero rows for `anon`.

- [ ] **Step 5: Commit**

```bash
git add supabase/schemas/personas.sql supabase/config.toml
git commit -m "feat(db): add owner-scoped personas table with four per-operation policies"
```

---

### Task 3: `note_chunks.persona_id`

**Files:**
- Modify: `supabase/schemas/note_chunks.sql`

**Interfaces:**
- Consumes: `public.personas (id)` from Task 2.
- Produces: `note_chunks.persona_id uuid null references public.personas (id) on delete set null`, plus `note_chunks_persona_id_idx`.

- [ ] **Step 1: Add the column to the create-table body**

In `supabase/schemas/note_chunks.sql`, inside the `create table if not exists public.note_chunks (...)` body, after the `chunk_type` column, add:

```sql
  -- Which lens produced this chunk. Null means "belongs to the default
  -- persona" — every chunk written before personas existed reads that way,
  -- which is what keeps the rendered page unchanged.
  --
  -- on delete set null, never cascade: deleting a lens must not delete the
  -- takeaways written through it.
  persona_id uuid references public.personas (id) on delete set null,
```

- [ ] **Step 2: Add the idempotent alter for the already-created table**

`create table if not exists` is a no-op against the live table, so the column needs an explicit alter too. Add immediately after the `create table` statement:

```sql
-- The table already exists in the linked project, so create-table-if-not-
-- exists above is a no-op there. This is how the new column actually lands.
alter table public.note_chunks
  add column if not exists persona_id uuid references public.personas (id) on delete set null;
```

- [ ] **Step 3: Add the index**

After the existing `note_chunks_user_id_idx`:

```sql
-- Postgres does not index foreign keys automatically, and the takeaway read
-- groups by exactly this column.
create index if not exists note_chunks_persona_id_idx
  on public.note_chunks (persona_id);
```

- [ ] **Step 4: Apply and verify**

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn --file supabase/schemas/note_chunks.sql
```

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select column_name, data_type, is_nullable from information_schema.columns where table_name = 'note_chunks' and column_name = 'persona_id'"
```
Expected: one row, `uuid`, `is_nullable = YES`.

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select conname, confdeltype from pg_constraint where conrelid = 'public.note_chunks'::regclass and contype = 'f'"
```
Expected: the persona FK present with `confdeltype = n` (SET NULL), not `c` (CASCADE).

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select indexname from pg_indexes where tablename = 'note_chunks' and indexname = 'note_chunks_persona_id_idx'"
```
Expected: one row.

- [ ] **Step 5: Commit**

```bash
git add supabase/schemas/note_chunks.sql
git commit -m "feat(db): add nullable note_chunks.persona_id FK with set-null delete"
```

---

### Task 4: Seed the four personas and their takeaways

The seeded values must be **diffed against the pre-change `lib/notes/persona-presets.ts`**, not retyped from memory. Recover it with `git show HEAD~N:lib/notes/persona-presets.ts` if it has already been deleted at this point (it has not — Task 7 deletes it).

**Files:**
- Modify: `supabase/seed.sql`

**Interfaces:**
- Consumes: `public.personas` (Task 2), `note_chunks.persona_id` (Task 3).
- Produces: four `personas` rows with slugs `neutral-analyst`, `sales-coach`, `investor`, `engineering-lead` for the seed owner, and nine `note_chunks` takeaway rows carrying `persona_id`.

- [ ] **Step 1: Append the persona insert to `supabase/seed.sql`**

```sql
-- The four personas, migrated verbatim out of lib/notes/persona-presets.ts.
-- Owner resolved by email, same as the note above, so this file carries no
-- environment-specific user id.
--
-- sort_order is the rail order: neutral-analyst first, which is what
-- DEFAULT_PERSONA_ID selects on mount.
with owner as (
  select id from auth.users where email = 'squid-ink-owner@example.test'
),
seed (id, slug, name, sub, depth, quick_actions, sort_order) as (
  values
    ('66666666-0000-4000-8000-000000000001'::uuid, 'neutral-analyst', 'Neutral Analyst', 'dense · no framing', 'dense',
      array['Extract decisions only', 'Timeline of blockers', 'Unanswered questions', 'Diff against last call'], 0),
    ('66666666-0000-4000-8000-000000000002'::uuid, 'sales-coach', 'Sales Coach', 'coaching · direct', 'dense',
      array['Score objection handling', 'Draft follow-up email', 'Next-call agenda', 'Concessions made'], 1),
    ('66666666-0000-4000-8000-000000000003'::uuid, 'investor', 'Investor', 'economics · risk', 'dense',
      array['Unit-economics read', 'Expansion risk memo', 'Diligence questions', 'Quantified risks'], 2),
    ('66666666-0000-4000-8000-000000000004'::uuid, 'engineering-lead', 'Engineering Lead', 'scope · sequencing', 'dense',
      array['Scope the mapping work', 'Risk register entry', 'Sequencing plan', 'Handoff brief'], 3)
)
insert into public.personas (id, user_id, slug, name, sub, depth, quick_actions, sort_order)
select seed.id, owner.id, seed.slug, seed.name, seed.sub, seed.depth, seed.quick_actions, seed.sort_order
from seed cross join owner
on conflict (id) do nothing;
```

Note on `depth`: the pre-change file encoded no depth for any persona. `'dense'` is the column default and matches the only persona whose subtitle names one ("dense · no framing"). No depth is invented per-persona.

- [ ] **Step 2: Append the nine attributed takeaway chunks**

These are the `takeaways` arrays of the three non-default personas, copied verbatim. The three existing takeaway chunks (`44444444-…`) keep `persona_id` null and therefore read as the default persona's — that is what keeps the page identical.

```sql
-- Takeaways for the three non-default personas, migrated verbatim out of
-- PRESET_PERSONAS in lib/notes/persona-presets.ts. These are new rows, not a
-- backfill of the existing three, which stay null-attributed and therefore
-- belong to the default persona.
with owner as (
  select id from auth.users where email = 'squid-ink-owner@example.test'
),
seed (id, persona_slug, content, metadata) as (
  values
    ('77777777-0000-4000-8000-000000000001'::uuid, 'sales-coach', 'The per-seat objection was never tested — you moved to per-clinic in one turn.', $j${"n":"01","seq":1,"ts_start":"03:04","segment_id":7}$j$::jsonb),
    ('77777777-0000-4000-8000-000000000002'::uuid, 'sales-coach', 'Your side named the 40-seat cap first; the customer never had to price their own growth.', $j${"n":"02","seq":2,"ts_start":"03:31","segment_id":8}$j$::jsonb),
    ('77777777-0000-4000-8000-000000000003'::uuid, 'sales-coach', 'The Sept 9 date is the only hard commitment on the call — anchor the next agenda on it.', $j${"n":"03","seq":3,"ts_start":"00:58","segment_id":3}$j$::jsonb),
    ('77777777-0000-4000-8000-000000000004'::uuid, 'investor', 'Capped per-clinic pricing shifts expansion upside to the customer above 40 seats.', $j${"n":"01","seq":1,"ts_start":"03:31","segment_id":8}$j$::jsonb),
    ('77777777-0000-4000-8000-000000000005'::uuid, 'investor', 'Onboarding cost falls sharply after the first EHR of a family — margin improves with clustering, not headcount.', $j${"n":"02","seq":2,"ts_start":"02:26","segment_id":6}$j$::jsonb),
    ('77777777-0000-4000-8000-000000000006'::uuid, 'investor', 'Q4 expansion collides with a migration freeze: revenue timing risk, not demand risk.', $j${"n":"03","seq":3,"ts_start":"04:48","segment_id":10}$j$::jsonb),
    ('77777777-0000-4000-8000-000000000007'::uuid, 'engineering-lead', 'Hand-written field maps are the bottleneck — clinic count is not the scaling variable.', $j${"n":"01","seq":1,"ts_start":"01:35","segment_id":4}$j$::jsonb),
    ('77777777-0000-4000-8000-000000000008'::uuid, 'engineering-lead', 'Clinics 5–6 in Q4 would land mapping work inside the migration freeze week.', $j${"n":"02","seq":2,"ts_start":"04:48","segment_id":10}$j$::jsonb),
    ('77777777-0000-4000-8000-000000000009'::uuid, 'engineering-lead', 'Two clinics stay dark until the customer''s Sept 9 security review clears — plan a staged cutover.', $j${"n":"03","seq":3,"ts_start":"00:58","segment_id":3}$j$::jsonb)
)
insert into public.note_chunks (id, note_id, user_id, chunk_type, content, metadata, persona_id)
select
  seed.id,
  '11111111-1111-4111-8111-111111111111',
  owner.id,
  'takeaway',
  seed.content,
  seed.metadata,
  persona.id
from seed
cross join owner
join public.personas persona
  on persona.user_id = owner.id and persona.slug = seed.persona_slug
on conflict (id) do nothing;
```

- [ ] **Step 3: Apply the seed**

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn --file supabase/seed.sql
```
Expected: success. Both new blocks are `on conflict do nothing`, so re-running is safe.

- [ ] **Step 4: Diff the seeded rows against the pre-change constants**

This is the DoD's "spot-checkable by diffing" step — do it as an actual diff, not by eye.

```bash
git show HEAD:lib/notes/persona-presets.ts > /tmp/persona-presets-before.ts
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select slug, name, sub, depth, quick_actions, sort_order from personas order by sort_order"
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select p.slug, c.metadata->>'n' as n, c.metadata->>'ts_start' as time, c.metadata->>'segment_id' as segment_id, c.content from note_chunks c join personas p on p.id = c.persona_id where c.chunk_type = 'takeaway' order by p.sort_order, n"
```

Compare each name / sub / quick-action / takeaway string against `/tmp/persona-presets-before.ts`. Any mismatch is a bug in the seed, not in the source.

- [ ] **Step 5: Commit**

```bash
git add supabase/seed.sql
git commit -m "feat(db): seed the four personas and their attributed takeaway chunks"
```

---

### Task 5: `PersonaRow`, `depth` on `Persona`, `persona_id` on `ChunkRow`

**Files:**
- Modify: `lib/notes/view-types.ts`, `lib/notes/types.ts`, `lib/mock/note.ts`
- Create: `lib/notes/default-persona.ts`

**Interfaces:**
- Consumes: `Persona`, `Takeaway` from `lib/notes/view-types` (Task 1).
- Produces:
  - `PersonaDepth = "brief" | "dense" | "exhaustive"` and `Persona.depth: PersonaDepth` in `lib/notes/view-types.ts`
  - `PersonaRow` and `ChunkRow.persona_id: string | null` in `lib/notes/types.ts`
  - `DEFAULT_PERSONA_ID: string` and `DEFAULT_PERSONA_FALLBACK: Omit<Persona, "takeaways">` in `lib/notes/default-persona.ts`

- [ ] **Step 1: Add `depth` to the view type**

In `lib/notes/view-types.ts`, above `Persona`:

```ts
/** ROADMAP.md §5's Brief/Dense/Exhaustive. Carried on the type and the table;
 *  nothing consumes it yet — there is no model routing and no UI control. */
export type PersonaDepth = "brief" | "dense" | "exhaustive";
```

and add the field to `Persona`:

```ts
export interface Persona {
  id: string;
  name: string;
  sub: string;
  depth: PersonaDepth;
  takeaways: Takeaway[];
  actions: string[];
}
```

- [ ] **Step 2: Add the row types**

In `lib/notes/types.ts`, change the import to pull `PersonaDepth` too:

```ts
import type { PersonaDepth, SpeakerToken } from "@/lib/notes/view-types";
```

Add `persona_id` to `ChunkRow`, directly after `chunk_type`:

```ts
  /** Null means the chunk belongs to the default persona. */
  persona_id: string | null;
```

And append:

```ts
/** A personas row. `slug` is what the view model exposes as Persona.id —
 *  the uuid is per-user and would not survive a reseed. */
export interface PersonaRow {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  sub: string;
  depth: PersonaDepth;
  quick_actions: string[];
  sort_order: number;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 3: Create the default-persona module**

Create `lib/notes/default-persona.ts`:

```ts
import type { Persona } from "./view-types";

/** The slug of the persona selected on mount. A slug, not a uuid, because the
 *  uuid is per-user and changes on reseed. */
export const DEFAULT_PERSONA_ID = "neutral-analyst";

/** Rendered only when the signed-in user has no personas rows at all — a new
 *  account before its personas are provisioned. Without it the rail would
 *  render zero lenses and the shell would read a persona off an empty array.
 *  It is a crash floor, not a preset list: the four real personas are rows. */
export const DEFAULT_PERSONA_FALLBACK: Omit<Persona, "takeaways"> = {
  id: DEFAULT_PERSONA_ID,
  name: "Neutral Analyst",
  sub: "dense · no framing",
  depth: "dense",
  actions: [
    "Extract decisions only",
    "Timeline of blockers",
    "Unanswered questions",
    "Diff against last call",
  ],
};
```

- [ ] **Step 4: Repair `lib/mock/note.ts` for the required `depth`**

`mockNote` declares four `Persona` literals. Each needs a `depth`. Add `depth: "dense",` immediately after each persona's `sub:` line — four edits, nothing else in the file changes.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```
Expected: pass. If `note-view-model.ts` errors on `PRESET_PERSONAS` missing `depth`, add `depth: "dense"` to the three literals there too — Task 7 deletes that file anyway.

- [ ] **Step 6: Commit**

```bash
git add lib/notes/view-types.ts lib/notes/types.ts lib/notes/default-persona.ts lib/mock/note.ts lib/notes/persona-presets.ts
git commit -m "feat(types): add PersonaDepth, PersonaRow and ChunkRow.persona_id"
```

---

### Task 6: `getPersonas` (TDD)

**Files:**
- Create: `lib/notes/get-personas.ts`, `lib/notes/__tests__/get-personas.test.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`, `PersonaRow` from `./types`.
- Produces: `getPersonas(): Promise<PersonaRow[]>` — ordered by `sort_order` ascending, `[]` when the user has none, throws on a query error.

- [ ] **Step 1: Write the failing test**

Create `lib/notes/__tests__/get-personas.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PersonaRow } from "../types";

type Result<T> = { data: T; error: { message: string } | null };

/** Stubs the one chain getPersonas builds:
 *    .from("personas").select(...).order(...).returns()
 *  The chain is thenable so awaiting it resolves either way. */
function stubClient(personas: Result<PersonaRow[] | null>) {
  const order = vi.fn(() => chain);
  const chain: Record<string, unknown> = {
    select: () => chain,
    order,
    returns: () => Promise.resolve(personas),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(personas).then(resolve),
  };
  return { from: vi.fn(() => chain), order };
}

const client = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => client.current,
}));

const { getPersonas } = await import("../get-personas");

const row: PersonaRow = {
  id: "66666666-0000-4000-8000-000000000001",
  user_id: "79db5c35-8d50-41c9-a265-49b786994455",
  slug: "neutral-analyst",
  name: "Neutral Analyst",
  sub: "dense · no framing",
  depth: "dense",
  quick_actions: ["Extract decisions only"],
  sort_order: 0,
  created_at: "2026-08-30T00:00:00Z",
  updated_at: "2026-08-30T00:00:00Z",
};

describe("getPersonas", () => {
  beforeEach(() => {
    client.current = null;
  });

  it("returns the user's persona rows", async () => {
    client.current = stubClient({ data: [row], error: null });
    await expect(getPersonas()).resolves.toEqual([row]);
  });

  it("returns an empty array when the user has no personas", async () => {
    // RLS filters another user's rows out, so this is what a fresh account
    // and a foreign account look like alike — never an error.
    client.current = stubClient({ data: null, error: null });
    await expect(getPersonas()).resolves.toEqual([]);
  });

  it("orders by sort_order ascending, which is rail order", async () => {
    const stub = stubClient({ data: [row], error: null });
    client.current = stub;
    await getPersonas();
    expect(stub.order).toHaveBeenCalledWith("sort_order", { ascending: true });
  });

  it("throws when the query errors", async () => {
    client.current = stubClient({ data: null, error: { message: "persona boom" } });
    await expect(getPersonas()).rejects.toThrow(/persona boom/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run lib/notes/__tests__/get-personas.test.ts
```
Expected: FAIL — cannot resolve `../get-personas`.

- [ ] **Step 3: Write the implementation**

Create `lib/notes/get-personas.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type { PersonaRow } from "./types";

/**
 * The signed-in user's personas, in rail order.
 *
 * No user_id filter — RLS supplies it, and personas_user_id_sort_order_idx
 * serves exactly this ordering. A user with no rows gets an empty array, not
 * an error: that is also what another user's rows look like once RLS has
 * filtered them, and the two must be indistinguishable.
 */
export async function getPersonas(): Promise<PersonaRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("personas")
    .select("*")
    .order("sort_order", { ascending: true })
    .returns<PersonaRow[]>();

  if (error) throw new Error(`Failed to load personas: ${error.message}`);

  return data ?? [];
}
```

- [ ] **Step 4: Run the test again**

```bash
npx vitest run lib/notes/__tests__/get-personas.test.ts
```
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/notes/get-personas.ts lib/notes/__tests__/get-personas.test.ts
git commit -m "feat(notes): fetch personas from the database"
```

---

### Task 7: Assemble personas in the view model, delete `persona-presets.ts` (TDD)

**Files:**
- Modify: `lib/notes/note-view-model.ts`, `lib/notes/get-note.ts`, `lib/notes/__tests__/note-view-model.test.ts`, `lib/notes/__tests__/get-note.test.ts`, `components/note-detail/note-detail-shell.tsx`, `components/note-detail/__tests__/persona-rail.test.tsx`
- Delete: `lib/notes/persona-presets.ts`

**Interfaces:**
- Consumes: `PersonaRow` (Task 5), `getPersonas` (Task 6), `DEFAULT_PERSONA_ID` / `DEFAULT_PERSONA_FALLBACK` (Task 5).
- Produces: `buildNoteViewModel(row: NoteRow, chunks: ChunkRow[], personas: PersonaRow[]): Note`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/notes/__tests__/note-view-model.test.ts` (adapt the existing fixtures' names — every existing `buildNoteViewModel(row, chunks)` call in this file gains a third argument, `[]` unless the test is about personas):

```ts
const personaRow = (slug: string, sortOrder: number): PersonaRow => ({
  id: `id-${slug}`,
  user_id: "79db5c35-8d50-41c9-a265-49b786994455",
  slug,
  name: slug,
  sub: `${slug} sub`,
  depth: "dense",
  quick_actions: [`${slug} action`],
  sort_order: sortOrder,
  created_at: "2026-08-30T00:00:00Z",
  updated_at: "2026-08-30T00:00:00Z",
});

const takeawayChunk = (id: string, personaId: string | null, seq: number): ChunkRow => ({
  id,
  note_id: noteRow.id,
  user_id: noteRow.user_id,
  chunk_type: "takeaway",
  persona_id: personaId,
  content: `takeaway ${id}`,
  embedding: null,
  metadata: { seq, n: String(seq).padStart(2, "0"), ts_start: "00:58", segment_id: 3 },
  created_at: "2026-08-30T00:00:00Z",
});

describe("persona assembly", () => {
  it("exposes the persona slug as the view id, in sort_order", () => {
    const note = buildNoteViewModel(noteRow, [], [
      personaRow("investor", 2),
      personaRow("neutral-analyst", 0),
    ]);
    // The query orders rows; the view model must not reorder them.
    expect(note.personas.map((p) => p.id)).toEqual(["investor", "neutral-analyst"]);
  });

  it("maps quick_actions onto actions and carries depth through", () => {
    const note = buildNoteViewModel(noteRow, [], [personaRow("neutral-analyst", 0)]);
    expect(note.personas[0].actions).toEqual(["neutral-analyst action"]);
    expect(note.personas[0].depth).toBe("dense");
  });

  it("gives a null-attributed takeaway to the default persona", () => {
    const note = buildNoteViewModel(
      noteRow,
      [takeawayChunk("c1", null, 1)],
      [personaRow("neutral-analyst", 0), personaRow("investor", 1)],
    );
    expect(note.personas[0].takeaways).toHaveLength(1);
    expect(note.personas[1].takeaways).toEqual([]);
  });

  it("gives an attributed takeaway to its own persona only", () => {
    const note = buildNoteViewModel(
      noteRow,
      [takeawayChunk("c1", "id-investor", 1)],
      [personaRow("neutral-analyst", 0), personaRow("investor", 1)],
    );
    expect(note.personas[0].takeaways).toEqual([]);
    expect(note.personas[1].takeaways).toHaveLength(1);
  });

  it("falls back to a single default persona when the user has no rows", () => {
    // A new account before its personas are provisioned. The rail must still
    // render, and the takeaways must still land somewhere.
    const note = buildNoteViewModel(noteRow, [takeawayChunk("c1", null, 1)], []);
    expect(note.personas).toHaveLength(1);
    expect(note.personas[0].id).toBe(DEFAULT_PERSONA_ID);
    expect(note.personas[0].takeaways).toHaveLength(1);
  });

  it("counts every persona's takeaways in spansLinked", () => {
    const note = buildNoteViewModel(
      noteRow,
      [takeawayChunk("c1", null, 1), takeawayChunk("c2", "id-investor", 1)],
      [personaRow("neutral-analyst", 0), personaRow("investor", 1)],
    );
    expect(note.spansLinked).toBe(2);
  });
});
```

Add `PersonaRow` and `DEFAULT_PERSONA_ID` to that file's imports.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run lib/notes/__tests__/note-view-model.test.ts
```
Expected: FAIL — `buildNoteViewModel` takes two arguments.

- [ ] **Step 3: Implement the assembly**

In `lib/notes/note-view-model.ts`, replace the `persona-presets` import with:

```ts
import { DEFAULT_PERSONA_FALLBACK, DEFAULT_PERSONA_ID } from "./default-persona";
```

and add `PersonaRow` to the `./types` import. Replace the inline `defaultPersona` block in `buildNoteViewModel` with a call to this new function, placed next to `toTakeaways`:

```ts
/** Group takeaway chunks under the personas that produced them.
 *
 *  A chunk with a null persona_id predates attribution and belongs to the
 *  default persona — that is what keeps a note written before this table
 *  existed rendering exactly as it did. */
function toPersonas(personaRows: PersonaRow[], takeaways: ChunkRow[]): Persona[] {
  if (personaRows.length === 0) {
    return [{ ...DEFAULT_PERSONA_FALLBACK, takeaways: toTakeaways(takeaways) }];
  }

  const byPersonaId = new Map<string, ChunkRow[]>();
  const unattributed: ChunkRow[] = [];
  for (const chunk of takeaways) {
    if (chunk.persona_id === null) unattributed.push(chunk);
    else byPersonaId.set(chunk.persona_id, [...(byPersonaId.get(chunk.persona_id) ?? []), chunk]);
  }

  return personaRows.map((row) => {
    const own = byPersonaId.get(row.id) ?? [];
    const mine = row.slug === DEFAULT_PERSONA_ID ? [...own, ...unattributed] : own;
    return {
      id: row.slug,
      name: row.name,
      sub: row.sub,
      depth: row.depth,
      actions: row.quick_actions,
      takeaways: toTakeaways(mine.sort(bySeq)),
    };
  });
}
```

Change the signature and the call site:

```ts
export function buildNoteViewModel(
  row: NoteRow,
  chunks: ChunkRow[],
  personaRows: PersonaRow[],
): Note {
```

```ts
  const personas = toPersonas(personaRows, grouped.takeaway);
```

- [ ] **Step 4: Wire `getNote` to fetch personas**

In `lib/notes/get-note.ts`, import `getPersonas`, add it to the existing `Promise.all`, and pass the result through:

```ts
  const [
    { data: note, error: noteError },
    { data: chunks, error: chunkError },
    personas,
  ] = await Promise.all([
    supabase.from("notes").select("*").eq("id", id).maybeSingle<NoteRow>(),
    supabase.from("note_chunks").select("*").eq("note_id", id).returns<ChunkRow[]>(),
    // Personas are per-user, not per-note, so this rides along rather than
    // waiting for the note. getPersonas throws on error; there is nothing to
    // check here.
    getPersonas(),
  ]);
```

```ts
  return buildNoteViewModel(note, chunks ?? [], personas);
```

`lib/notes/__tests__/get-note.test.ts` stubs `from()` by table name — add a `personas` branch returning `{ data: [], error: null }` so the third query resolves.

- [ ] **Step 5: Repoint `DEFAULT_PERSONA_ID` and delete the presets file**

```bash
sed -i 's|import { DEFAULT_PERSONA_ID } from "@/lib/mock/note";|import { DEFAULT_PERSONA_ID } from "@/lib/notes/default-persona";|' components/note-detail/note-detail-shell.tsx
git rm lib/notes/persona-presets.ts
```

In `components/note-detail/__tests__/persona-rail.test.tsx`, split the import: `mockNote` still comes from `@/lib/mock/note`, `DEFAULT_PERSONA_ID` now comes from `@/lib/notes/default-persona`.

- [ ] **Step 6: Run everything**

```bash
npm run typecheck && npm test && npm run build
```
Expected: all three pass. `grep -rn "persona-presets" .` returns nothing outside this plan.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(notes): build personas from database rows, drop the hardcoded presets"
```

---

### Task 8: Prove RLS on `personas`

**Files:**
- Modify: `scripts/verify-rls.mjs`

**Interfaces:**
- Consumes: the seeded personas from Task 4 and the policies from Task 2.
- Produces: a third `--- personas ---` block in the script's output.

- [ ] **Step 1: Add the query**

In `scripts/verify-rls.mjs`, append to the `QUERIES` array:

```js
  {
    table: "personas",
    sql: "select id, slug, name, user_id from personas",
    run: (c) => c.from("personas").select("id, slug, name, user_id"),
  },
```

No `.eq()` filter: the point is that the second user sees zero rows of a table the first user has four rows in. A filter would weaken that.

- [ ] **Step 2: Run the proof and keep the full output**

```bash
node scripts/verify-rls.mjs
```

Expected, verbatim in shape: three `---` blocks; for `personas`, `owner … rows=4 error=null` and `intruder … rows=0 error=null`; final line `PASS`. Both users must show `role=authenticated`.

An `error` on the second user is a **failure**, not a pass: "permission denied" means the grant is missing, not that RLS filtered rows.

- [ ] **Step 3: Run the database advisors**

```bash
npx supabase db advisors --linked --project-ref pbwvvakzbrimmdntqxxn --type all --level info
```
Expected: no new `rls_disabled_in_public`, `policy_exists_rls_disabled`, `auth_rls_initplan` or `multiple_permissive_policies` finding naming `personas`.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-rls.mjs
git commit -m "test(rls): prove owner-only access to personas with two real sessions"
```

---

### Task 9: Visual regression check and documentation

**Files:**
- Modify: `CLAUDE.md`, `docs/KNOWN_GAPS.md`

- [ ] **Step 1: Render the page and compare**

Start the dev server through the preview tool (never `npm run dev` in Bash), sign in as the seed owner, and open the note. Confirm against the pre-change screen:

- four lenses in the rail, in order: Neutral Analyst, Sales Coach, Investor, Engineering Lead
- clicking each lens shows its three takeaways, matching the strings in `git show HEAD~N:lib/notes/persona-presets.ts`
- each lens's four quick-action buttons match
- the rail footer still reads `12 spans linked`

- [ ] **Step 2: Update the CLAUDE.md Data section**

Replace the Data section's second paragraph. The new text:

```markdown
Note Detail reads from Supabase. `lib/notes/get-note.ts` fetches the note, its
chunks and the user's personas through the server client and
`lib/notes/note-view-model.ts` shapes them into what the components render.
There is still no `fetch` and no API client — the Supabase SDK is the only
data path, and it is called from server components.

The view types the components consume live in `lib/notes/view-types.ts`.
`lib/notes/types.ts` holds the database row shapes that mirror
`supabase/schemas/*.sql`. `lib/mock/types.ts` is gone.

`lib/mock/note.ts` is no longer rendered. `mockNote` has no importer outside
component tests, which use it as a fixture. Do not add new mock rows — new
data goes in the database.
```

Also, in the Supabase section, note the schema order: `notes.sql`, `personas.sql`, `note_chunks.sql` — personas needs `set_updated_at()` from notes, and note_chunks FKs to personas.

- [ ] **Step 3: Close the gaps in `docs/KNOWN_GAPS.md`**

Two entries are now false and must be rewritten, not deleted — say what closed them:

- "**`Persona` has no depth field.**" — now a `depth` column and a `PersonaDepth` field. Still nothing consumes it: no model routing, no UI control. Reword to that narrower gap.
- "**Three of four personas are hardcoded.**" — closed. All four are rows in `public.personas`, and `note_chunks.persona_id` attributes a takeaway to a lens.

Add one new gap: **personas are not provisioned for new users.** There is no trigger on `auth.users` and no persona authoring UI, so a fresh account gets zero rows and falls back to `DEFAULT_PERSONA_FALLBACK` in `lib/notes/default-persona.ts`. Provisioning belongs with the Personas UI phase (ROADMAP §5).

Also fix the line that says `lib/mock/types.ts` holds the view types.

- [ ] **Step 4: Final gate**

```bash
npm run typecheck && npm test && npm run build
```
Expected: all pass.

```bash
grep -rn "lib/mock/types\|persona-presets" --include=*.ts --include=*.tsx . --exclude-dir=node_modules --exclude-dir=.next
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/KNOWN_GAPS.md
git commit -m "docs: record the personas table and the view-types move"
```
