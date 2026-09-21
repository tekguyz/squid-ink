# Supabase Persistence Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Prompt 2 explicitly caps subagent delegation at 0 — do NOT use subagent-driven-development.

**Goal:** Stand up `notes` + `note_chunks` on Supabase with owner-only RLS proven by two real auth users, wire email/magic-link auth, and make `/notes/[id]` render one real seeded row instead of `lib/mock/note.ts`.

**Architecture:** Declarative schema files under `supabase/schemas/` are the source of truth. SQL is applied to the linked hosted project with `supabase db query --linked` (iterating freely, no migration history churn), checked with `supabase db advisors --linked`, then frozen into a single migration under `supabase/migrations/`. The Next.js side gets two thin `@supabase/ssr` client factories, a magic-link login route, and one server-side query function that assembles the existing `Note` view model from `notes` + `note_chunks` rows.

**Tech Stack:** Next.js 16.3.3 (App Router, RSC), React 19.2.8, TypeScript 7.0.2, Tailwind v4.3.3, Vitest 4.1.11, Supabase (hosted, Postgres 17.6), `@supabase/ssr`, `@supabase/supabase-js`, Supabase CLI 2.115.0.

**Spec:** Prompt 2 (Supabase schema, auth, RLS, real-data wiring), plus `DECISIONS.md` and `ROADMAP.md` §4 / §8.

---

## Environment facts (verified 2026-08-30, not assumed)

| Fact | Evidence |
|---|---|
| Project `Squid Ink`, ref `pbwvvakzbrimmdntqxxn`, `ACTIVE_HEALTHY`, `linked: true`, Postgres 17.6, region us-east-2 | `supabase projects list` |
| CLI installed 2.115.0; latest 2.116.0 | `supabase --version`, `npm view supabase dist-tags` |
| **Docker is NOT installed on this machine** | `Get-Command docker` → not found; `Test-Path 'C:\Program Files\Docker\Docker\Docker Desktop.exe'` → False |
| `supabase db query --linked --project-ref <ref>` runs **DDL** with no Docker and no DB password | Probe: `create table public._ddl_probe(id int); drop table public._ddl_probe;` → `ddl ok` |
| `supabase db advisors --linked` works with no Docker | Returns `No issues found` on the empty project — this is the clean baseline |
| `supabase migration new` and `supabase migration list --linked` work with no Docker | Probed in a throwaway scratchpad dir, since removed |
| **`supabase db pull` REQUIRES Docker** (builds a shadow database), on both `migra` and `pg-delta` engines | Probe → `LegacyImagePrepullError: failed to run docker` |
| **`supabase db dump` REQUIRES Docker** | Probe → `LegacyDockerRunError` |
| Baseline test suite green in this worktree | `npm test` → 4 files, 20 tests, 0 failures |
| Worktree | `C:\Projects\tekguyz-squid-ink\.claude\worktrees\supabase-persistence`, branch `worktree-supabase-persistence`, deps installed via `npm ci` |

### Deviation from the spec — must be reported at handoff

Prompt 2 §5 mandates `supabase db pull <name> --local --yes` to generate the migration. **That command cannot run on this machine** (Docker absent, proven above). Substitute, agreed in advance:

1. `supabase/schemas/*.sql` remain the hand-authored source of truth (spec intent preserved).
2. Iteration happens with `supabase db query --linked` (spec intent preserved — no `apply_migration`, no migration-history churn).
3. The migration file is created with `supabase migration new init_notes_and_note_chunks` and its body is the **verbatim concatenation of the schema files** — mechanically derived, not independently authored. Because the database starts empty, the diff from nothing to the final schema *is* the schema files, so this is provably equivalent to what `db pull` would emit.
4. Migration history on the remote is reconciled with `supabase migration repair --status applied <version> --linked`, then confirmed with `supabase migration list --linked`.

This is what `C:\Projects\tekguyz-crm` already does (imperative `migration new` files, no `schemas/` dir). If Docker is installed later, the declarative flow works unchanged from that point on. Recorded in `docs/KNOWN_GAPS.md` by Task 10.

---

## Global Constraints

- **Exact version pins, no `^`/`~`.** Verify with `npm view <pkg> dist-tags` at build time. Do not take a version from memory.
- **Zero colour literals in `components/` and `lib/`.** No `oklch()`, hex, `rgb()`, `hsl()`. Enforced by `components/note-detail/__tests__/project-conventions.test.ts`.
- **File ceilings: 250 soft, 400 hard.** The convention test enforces 400. A file nearing the ceiling gets a purpose-named extraction, never a raised ceiling or a `utils.ts`.
- **No app name anywhere in code.** User-facing copy stays generic. Only `package.json` `name` may say `squid-ink`.
- **Do not modify:** anything under `components/note-detail/`, `components/theme-toggle.tsx`, `app/globals.css`, `lib/mock/*`.
- **No `service_role` / secret key in application code.** Publishable key only, in `NEXT_PUBLIC_SUPABASE_*`. The secret key appears **only** in `scripts/verify-rls.mjs`, read from `.env.local`, which is gitignored.
- **Nothing calls `Math.random()` or `Date.now()` in a render path.**
- **RLS predicate is always `(select auth.uid()) = user_id`**, never bare `auth.uid()`. Every table gets four per-operation policies. UPDATE gets both `using` and `with check`.
- **Out of scope, do not start:** Google OAuth/Drive/Calendar/Tasks, any token-storage table, the audio Storage bucket / upload / playback (only the nullable `audio_storage_path` column ships), PII redaction, personas backend, action-item drawers, collections/tags, share links, PWA, webhooks, MCP bridge, Recorder UI, chat query logic.

---

## Mock-to-schema reconciliation (approved by the owner, 2026-08-30)

Read `lib/mock/types.ts` and `lib/mock/note.ts` in full. Every field the frozen components consume is dispositioned here. No field is silently added, dropped, or renamed.

| UI field | Home | Resolution |
|---|---|---|
| `id` | `notes.id` | UUID replaces the mock slug. Route param becomes a UUID. |
| `title` | `notes.title` | Direct. |
| `meta` | derived | `"Wed 26 Aug 2026 · 41 min"` from `created_at` + `audio_duration_seconds`. **Client name "Northwind Health" dropped** — approved. |
| `duration` | derived | `mm:ss` from `audio_duration_seconds`. |
| `turnCount` | derived | Count of `transcript_segment` chunks. |
| `spansLinked` | derived | Total citation references across summary runs + all persona takeaways + action items. |
| `stats` | **derived, not stored** | Computed at read time from `transcript_segment` chunks. **No new column** — approved. Values will differ from the mock's illustrative numbers; that is expected. |
| `summary` | `note_chunks` `chunk_type='summary'` | `content` = plain text; the `CiteRun[]` split lives in `metadata.runs`. |
| `actionItems` | `note_chunks` `chunk_type='action_item'` | `content` = text; `metadata` carries `owner`, `due`, `ts_start`, `segment_id`. |
| `segments` | `note_chunks` `chunk_type='transcript_segment'` | `content` = text; `metadata` carries `seq`, `ts_start`, `speaker{name,initials,token}`. |
| `personas` | partly | `neutral-analyst` takeaways come from real `takeaway` chunks. The other three personas stay a UI constant — approved. No `personas` table, no `persona_id` column. |
| `waveform` | **constant** | Stays a precomputed constant. Timeline bar is an Advanced-phase feature. |
| `playhead` | **constant** | Player position, not persisted. |
| `sampleExchange` | **constant** | Chat demo content; chat is out of scope. |
| `speaker.initials` / `speaker.token` | `note_chunks.metadata` | Stored inside the chunk's `metadata` jsonb — approved. |

**Type ownership wart:** the frozen components import `Note`, `Segment`, `Speaker`, etc. from `@/lib/mock/types`. Because `components/` and `lib/mock/` are both frozen this prompt, `lib/notes/*` must import those same types from `@/lib/mock/types`. Real code therefore depends on a path named "mock". Recorded in `docs/KNOWN_GAPS.md` by Task 10; the fix (move the view types to `lib/notes/view-types.ts` and update component imports) is a later, purely mechanical change.

---

## Schema deviations from ROADMAP §4 — must be reported

`ROADMAP.md` §4's `note_chunks` block is copied faithfully except for these tightenings. Each exists because the ROADMAP snippet was illustrative and would create an RLS hole or orphan rows as written:

| ROADMAP as written | Shipping as | Why |
|---|---|---|
| `note_id uuid references notes(id) on delete cascade` | `note_id uuid **not null** references ...` | A chunk with no note is unreachable and unowned. |
| `user_id uuid references auth.users(id)` | `user_id uuid **not null** references auth.users(id) **on delete cascade**` | A NULL `user_id` fails every RLS predicate and becomes invisible, undeletable data. Cascade matches `notes`. |
| `chunk_type text check (...)` | `chunk_type text **not null** check (...)` | A NULL type breaks every consumer's `switch`. |
| `metadata jsonb` | `metadata jsonb **not null default '{}'::jsonb`** | Removes null-guards from every read path. |
| `create index on note_chunks using hnsw (...)`, `using gin (...)` | same, plus named FK/composite indexes | Postgres does not index FK columns automatically; RLS predicates need an index on `user_id`. |

---

## File Structure

**Create — database**

| File | Responsibility |
|---|---|
| `supabase/config.toml` | CLI project config (generated by `supabase init`) |
| `supabase/schemas/notes.sql` | `notes` table, `updated_at` trigger fn + trigger, indexes, RLS enable + 4 policies, grants |
| `supabase/schemas/note_chunks.sql` | `vector` extension, `note_chunks` table, HNSW + GIN + FK indexes, RLS enable + 4 policies, grants |
| `supabase/seed.sql` | One completed note + its 19 chunks, resolved against the owner user by email |
| `supabase/migrations/<ts>_init_notes_and_note_chunks.sql` | Frozen concatenation of both schema files |

**Create — application**

| File | Responsibility |
|---|---|
| `lib/supabase/client.ts` | Browser client factory (`createBrowserClient`) |
| `lib/supabase/server.ts` | Server component / action / route-handler client factory (`createServerClient` + `cookies()`) |
| `lib/supabase/middleware.ts` | `updateSession` cookie-refresh helper used by root middleware |
| `middleware.ts` | Next.js middleware; refreshes the auth session on every matched request |
| `lib/notes/types.ts` | Database row types only (`NoteRow`, `ChunkRow`, `ChunkMetadata`) |
| `lib/notes/speaker-stats.ts` | Pure: segments → `SpeakerStat[]` (talk %, questions asked, filler count) |
| `lib/notes/note-view-model.ts` | Pure: `(NoteRow, ChunkRow[])` → `Note` |
| `lib/notes/get-note.ts` | Server-side fetch-by-id; returns `Note \| null`, throws on real errors |
| `lib/notes/waveform.ts` | `WAVEFORM` bar heights + `DEFAULT_PLAYHEAD` constants |
| `lib/notes/persona-presets.ts` | The three non-default personas, as UI constants |
| `lib/notes/sample-exchange.ts` | The demo chat exchange, as a UI constant |
| `app/login/page.tsx` | Server component shell for the magic-link form |
| `app/login/login-form.tsx` | Client component; submits an email, calls `signInWithOtp` |
| `app/auth/confirm/route.ts` | Magic-link landing; `verifyOtp` on `token_hash`, then redirect |
| `scripts/verify-rls.mjs` | Creates two real auth users, signs both in, runs the identical select as each, prints results |
| `.env.local.example` | Documents required vars. No real values. |

**Create — tests**

| File | Covers |
|---|---|
| `lib/notes/__tests__/speaker-stats.test.ts` | Talk-% shares sum to 100, question counting, filler counting |
| `lib/notes/__tests__/note-view-model.test.ts` | Chunk rows → `Note`; ordering, meta/duration formatting, derived counts |
| `lib/notes/__tests__/get-note.test.ts` | Row found, row absent → `null`, query error → throw |

**Modify**

| File | Change |
|---|---|
| `app/notes/[id]/page.tsx` | Swap `mockNote` import for `getNote(id)`; `notFound()` when null |
| `CLAUDE.md` | Append a Supabase stack section (declarative-schema workflow, pinned versions, the no-Docker deviation) |
| `.gitignore` | Add `!.env.local.example` — the existing `.env*` rule currently swallows it |
| `docs/KNOWN_GAPS.md` | Append the deferrals (do not overwrite) |
| `package.json` | Add the two pinned Supabase deps |

**Scope-fence note requiring approval:** `middleware.ts`, `lib/supabase/middleware.ts`, `app/login/*`, `app/auth/confirm/route.ts`, and `scripts/verify-rls.mjs` are **not** in Prompt 2's "Create" list, but Prompt 2's in-scope line says "Supabase auth (email/magic-link) wired in". Without a login route there is no session, and with RLS on, a session-less `/notes/[id]` renders nothing. These files are the minimum that makes "wired in" true. They add no visual work to Note Detail and touch no frozen file.

---

## Task 1: Project scaffolding, pinned deps, env plumbing

**Files:**
- Create: `supabase/config.toml` (via CLI), `.env.local.example`
- Modify: `.gitignore`, `package.json`, `package-lock.json`

- [ ] **Step 1: Verify dependency versions live — do not trust this document**

```bash
npm view @supabase/ssr dist-tags && npm view @supabase/supabase-js dist-tags && npm view supabase dist-tags
```

Recorded 2026-08-30: `@supabase/ssr` latest `0.12.5`, `@supabase/supabase-js` latest `2.112.4`, CLI latest `2.116.0`. If any differ, use the live value and update `CLAUDE.md` in Task 10 to match.

- [ ] **Step 2: Install both packages at exact pins**

```bash
npm install --save-exact @supabase/ssr@0.12.5 @supabase/supabase-js@2.112.4
```

Then confirm `package.json` shows bare versions with no `^` or `~`.

- [ ] **Step 3: Initialise the Supabase project directory and link it**

```bash
npx supabase init
```

```bash
npx supabase link --project-ref pbwvvakzbrimmdntqxxn
```

If `link` prompts for a database password and none is available, skip it — every command in this plan uses `--linked --project-ref pbwvvakzbrimmdntqxxn`, which authenticates through the management API and needs no password.

- [ ] **Step 4: Enable the declarative schema path in `supabase/config.toml`**

Under the `[db]` section, add:

```toml
[db.migrations]
schema_paths = ["./schemas/*.sql"]
```

- [ ] **Step 5: Fix the `.gitignore` hole**

The existing rule `.env*` also ignores `.env.local.example`, so the example file would never be committed. Append to `.gitignore`:

```
!.env.local.example
```

Verify:

```bash
git check-ignore -v .env.local.example || echo "NOT IGNORED - correct"
```

Expected: `NOT IGNORED - correct`

- [ ] **Step 6: Read the project's API keys and write `.env.local`**

```bash
npx supabase projects api-keys --project-ref pbwvvakzbrimmdntqxxn -o env
```

Do **not** echo the secret key into the conversation transcript. Write `.env.local` (gitignored) containing the project URL, the publishable key, and the secret key. Use whichever key names the CLI actually emits — recent projects issue `sb_publishable_…` / `sb_secret_…`; older ones issue `anon` / `service_role`. Record the real names in `.env.local.example`.

- [ ] **Step 7: Write `.env.local.example` with no real values**

```
# Supabase — browser-safe. Both are sent to the client by Next.js.
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxxxxxx

# Server-only. Never referenced by app code — used solely by scripts/verify-rls.mjs.
# Bypasses RLS. Do not add a NEXT_PUBLIC_ prefix to this under any circumstances.
SUPABASE_SECRET_KEY=sb_secret_xxxxxxxxxxxxxxxxxxxx
```

- [ ] **Step 8: Confirm no secret is staged**

```bash
git status --short && git check-ignore -v .env.local
```

Expected: `.env.local` is ignored; it does not appear in `git status`.

- [ ] **Step 9: Commit**

```bash
git add .gitignore .env.local.example package.json package-lock.json supabase/config.toml
git commit -m "chore: add pinned Supabase deps and link hosted project"
```

---

## Schema-file-first discipline (binding on Tasks 2–4)

Because Docker is unavailable, `supabase db diff` cannot check the schema files against the live database. The only thing that keeps Task 4's "verbatim concatenation" honest is that **every byte of DDL reaches the database by way of a schema file**.

Rules, no exceptions:

1. **No ad hoc DDL.** Never paste a `create` / `alter` / `drop` statement into `db query` as a positional argument. Not to patch a typo, not to try something, not "just this once".
2. **Edit the `.sql` file, then apply that exact file** with `--file`. The file is the only input.
3. **Every statement is idempotent** (`if not exists`, `create or replace`, `drop policy if exists` before `create policy`) so re-applying the whole file after an edit is always safe. Iteration means re-running the file, not writing a patch.
4. **`db query` with inline SQL is read-only.** It is allowed for `select` verification only — `pg_policies`, `pg_indexes`, `information_schema`, row counts.
5. If a mistake needs undoing, fix the schema file so it is correct from empty, then re-apply the file. Do not write a compensating `alter` outside the file.

The one deliberate exception is `supabase/seed.sql` in Task 5, which is data, not schema, and is not part of the migration.

---

## Task 2: `notes` table, trigger, RLS, grants

**Files:**
- Create: `supabase/schemas/notes.sql`

**Discipline:** schema-file-first, as above. Write the file, apply the file, verify with `select` only.

**Interfaces:**
- Produces: table `public.notes` with columns `id, user_id, title, processing_status, raw_transcript, diarization_enabled, audio_duration_seconds, audio_storage_path, created_at, updated_at`; function `public.set_updated_at()`.

- [ ] **Step 1: Write `supabase/schemas/notes.sql`**

```sql
-- notes: one row per recording. Structured content (summaries, takeaways,
-- action items) lives in note_chunks, not here — see ROADMAP.md §4.

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  processing_status text not null default 'local'
    check (processing_status in ('local', 'uploading', 'analyzing', 'completed')),
  raw_transcript text,
  -- Processing outcome, not a user setting: diarization auto-disables past
  -- ~28 min per DECISIONS.md. No UI toggle is or should be wired to this.
  diarization_enabled boolean not null default true,
  audio_duration_seconds integer,
  -- Placeholder for the deferred Storage bucket. No bucket, no policies,
  -- no upload code ships in this prompt.
  audio_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Feed ordering, and the index the RLS predicate on user_id needs.
create index if not exists notes_user_id_created_at_idx
  on public.notes (user_id, created_at desc);

-- updated_at is maintained by the database, never by the client.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

alter table public.notes enable row level security;

-- Four per-operation policies. auth.uid() is wrapped in a select so the
-- planner caches it once per query instead of calling it per row.
drop policy if exists notes_select_own on public.notes;
create policy notes_select_own on public.notes
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists notes_insert_own on public.notes;
create policy notes_insert_own on public.notes
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- UPDATE needs both clauses. Without with check, a user could reassign
-- user_id to someone else and hand their row away.
drop policy if exists notes_update_own on public.notes;
create policy notes_update_own on public.notes
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists notes_delete_own on public.notes;
create policy notes_delete_own on public.notes
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- The project was created with "Automatically expose new tables" OFF, so
-- Data API access is granted explicitly. anon is deliberately not granted:
-- this app has no public reads.
grant select, insert, update, delete on public.notes to authenticated;
```

- [ ] **Step 2: Apply it to the linked project**

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn --file supabase/schemas/notes.sql
```

If `--file` is not a valid flag on CLI 2.115.0, check `npx supabase db query --help` and pass the SQL as the positional argument instead. Do **not** use `apply_migration` — it writes a permanent history entry per call and blocks further diffing.

- [ ] **Step 3: Verify the table, trigger, policies, and grants exist**

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select relrowsecurity from pg_class where oid = 'public.notes'::regclass;"
```

Expected: `relrowsecurity: true`

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select policyname, cmd, qual, with_check from pg_policies where tablename = 'notes' order by policyname;"
```

Expected: four rows; `notes_update_own` has a non-null `with_check`.

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select grantee, privilege_type from information_schema.role_table_grants where table_name = 'notes' and grantee in ('anon','authenticated') order by grantee, privilege_type;"
```

Expected: four rows for `authenticated`, zero for `anon`.

- [ ] **Step 4: Run advisors and record the output verbatim**

```bash
npx supabase db advisors --linked --type all --level info
```

Fix anything at error/warn level. Any remaining finding must be listed with a stated reason it is accepted.

- [ ] **Step 5: Commit**

```bash
git add supabase/schemas/notes.sql
git commit -m "feat(db): add notes table with owner-only RLS and updated_at trigger"
```

---

## Task 3: `note_chunks` table, pgvector, indexes, RLS, grants

**Files:**
- Create: `supabase/schemas/note_chunks.sql`

**Discipline:** schema-file-first, as above. The `create extension` line lives **inside** `note_chunks.sql` — do not run it as a separate ad hoc command, or the migration would be missing it.

**Interfaces:**
- Consumes: `public.notes` from Task 2.
- Produces: table `public.note_chunks` with columns `id, note_id, user_id, chunk_type, content, embedding, metadata, created_at`.

- [ ] **Step 1: Check where pgvector currently lives, if anywhere**

Read-only. Installing the extension into `public` trips the advisors' `extension_in_public` warning, so the schema file targets `extensions`.

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector';"
```

If it already exists in `public`, **report it and stop** rather than silently relocating it — moving an extension is a destructive operation on any dependent object.

- [ ] **Step 2: Write `supabase/schemas/note_chunks.sql`**

Follows `ROADMAP.md` §4, with the not-null and index tightenings listed in "Schema deviations" above.

```sql
-- note_chunks: multi-granularity RAG chunks. Structured content (summary,
-- takeaway, action_item) and transcript segments share one table so that
-- retrieval is uniform — see ROADMAP.md §4.

create extension if not exists vector with schema extensions;

create table if not exists public.note_chunks (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  chunk_type text not null check (chunk_type in
    ('summary', 'takeaway', 'action_item', 'transcript_segment', 'imported_doc')),
  content text not null,
  -- voyage-3-large output width. Null until the embedding pipeline ships.
  embedding extensions.vector(1024),
  -- {speaker, ts_start, ts_end, source_url, seq} plus per-type extras:
  -- runs (summary), owner/due (action_item), segment_id (citations).
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Postgres does not index foreign keys automatically. This composite also
-- serves "all chunks of one note, of one type" reads.
create index if not exists note_chunks_note_id_chunk_type_idx
  on public.note_chunks (note_id, chunk_type);

-- The column the RLS predicate filters on.
create index if not exists note_chunks_user_id_idx
  on public.note_chunks (user_id);

-- Hybrid retrieval: vector cosine similarity + Postgres full text,
-- fused later by reciprocal rank fusion (ROADMAP.md §4).
create index if not exists note_chunks_embedding_idx
  on public.note_chunks using hnsw (embedding extensions.vector_cosine_ops);

create index if not exists note_chunks_content_fts_idx
  on public.note_chunks using gin (to_tsvector('english', content));

alter table public.note_chunks enable row level security;

drop policy if exists note_chunks_select_own on public.note_chunks;
create policy note_chunks_select_own on public.note_chunks
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists note_chunks_insert_own on public.note_chunks;
create policy note_chunks_insert_own on public.note_chunks
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists note_chunks_update_own on public.note_chunks;
create policy note_chunks_update_own on public.note_chunks
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists note_chunks_delete_own on public.note_chunks;
create policy note_chunks_delete_own on public.note_chunks
  for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.note_chunks to authenticated;
```

- [ ] **Step 3: Apply and verify**

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn --file supabase/schemas/note_chunks.sql
```

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select indexname from pg_indexes where tablename = 'note_chunks' order by indexname;"
```

Expected: the primary key plus `note_chunks_content_fts_idx`, `note_chunks_embedding_idx`, `note_chunks_note_id_chunk_type_idx`, `note_chunks_user_id_idx`.

If `hnsw` errors because the column is entirely null-able and empty, that is not a real failure — HNSW builds fine on an empty table. A genuine error here means the extension is not in `extensions`; re-check Step 1.

- [ ] **Step 4: Run advisors again, record verbatim**

```bash
npx supabase db advisors --linked --type all --level info
```

- [ ] **Step 5: Commit**

```bash
git add supabase/schemas/note_chunks.sql
git commit -m "feat(db): add note_chunks with pgvector, HNSW/GIN indexes and owner-only RLS"
```

---

## Task 4: Freeze the migration

**Files:**
- Create: `supabase/migrations/<timestamp>_init_notes_and_note_chunks.sql`

- [ ] **Step 1: Create the empty migration file with the CLI**

Never invent a migration filename or timestamp by hand.

```bash
npx supabase migration new init_notes_and_note_chunks
```

- [ ] **Step 2: Fill it with the verbatim concatenation of the schema files**

Order matters — `notes` must exist before `note_chunks` references it.

```bash
cat supabase/schemas/notes.sql supabase/schemas/note_chunks.sql > supabase/migrations/<timestamp>_init_notes_and_note_chunks.sql
```

- [ ] **Step 3: Mark it applied on the remote, since the SQL already ran there**

```bash
npx supabase migration repair --status applied <timestamp> --linked --project-ref pbwvvakzbrimmdntqxxn
```

- [ ] **Step 4: Confirm local and remote history agree**

```bash
npx supabase migration list --linked --project-ref pbwvvakzbrimmdntqxxn
```

Expected: one row where `local` and `remote` both show `<timestamp>`.

- [ ] **Step 5: Prove the frozen migration actually matches the live database**

`supabase db diff` is the normal way to catch drift, and it is unavailable without Docker. This step replaces it by reading the live catalog back and checking it line-for-line against the schema files. Do this **after** freezing, so the thing being checked is the thing that was committed.

First, confirm the migration really is byte-identical to the two schema files:

```bash
cat supabase/schemas/notes.sql supabase/schemas/note_chunks.sql | git hash-object --stdin
```

```bash
git hash-object supabase/migrations/<timestamp>_init_notes_and_note_chunks.sql
```

Expected: the two hashes are identical. If they are not, the migration was edited by hand — regenerate it with `cat` and investigate why.

Then read the live catalog for each of the three object classes:

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select table_name, column_name, data_type, udt_name, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name in ('notes','note_chunks') order by table_name, ordinal_position;"
```

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename in ('notes','note_chunks') order by tablename, policyname;"
```

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in ('notes','note_chunks') order by tablename, indexname;"
```

Also confirm the objects the first three queries do not cover — the trigger, the check constraints, RLS being enabled, and the grants:

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select c.relname, c.relrowsecurity, t.tgname from pg_class c left join pg_trigger t on t.tgrelid = c.oid and not t.tgisinternal where c.oid in ('public.notes'::regclass, 'public.note_chunks'::regclass);"
```

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid) from pg_constraint where conrelid in ('public.notes'::regclass, 'public.note_chunks'::regclass) order by tbl, conname;"
```

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name in ('notes','note_chunks') and grantee in ('anon','authenticated') order by table_name, grantee, privilege_type;"
```

**Checklist to tick off against the schema files, one line at a time:**

- [ ] Every column in the files appears in `information_schema.columns` with the same type, nullability, and default. No extra columns exist.
- [ ] `notes` has exactly 10 columns; `note_chunks` has exactly 8.
- [ ] `embedding` reports `udt_name` = `vector`, and the `vector` extension is in the `extensions` schema.
- [ ] Exactly 8 policies exist — 4 per table. Every one is `to authenticated`.
- [ ] Every `qual` and `with_check` reads `( SELECT auth.uid() AS uid) = user_id` — the wrapped form, not bare `auth.uid()`.
- [ ] Every `update` policy has a non-null `with_check`. Every `insert` policy has a non-null `with_check`.
- [ ] Every index in the files appears in `pg_indexes`, including `hnsw` on `embedding` and `gin` on `to_tsvector('english', content)`. No extra indexes beyond the primary keys.
- [ ] `relrowsecurity` is `true` on both tables.
- [ ] The `notes_set_updated_at` trigger exists on `notes`.
- [ ] Both check constraints exist with the exact value lists from the files (`processing_status`, `chunk_type`).
- [ ] `authenticated` holds SELECT/INSERT/UPDATE/DELETE on both tables. `anon` holds nothing.

Any mismatch means the schema file and the database disagree. **Fix the schema file, re-apply it, re-freeze the migration, and re-run this whole step** — never patch the database to match a stale file.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations
git commit -m "chore(db): freeze initial schema as a migration"
```

---

## Task 5: Seed one real note

**Files:**
- Create: `supabase/seed.sql`

**Interfaces:**
- Produces: note id `11111111-1111-4111-8111-111111111111`, owned by the auth user with email `squid-ink-owner@example.test`.

- [ ] **Step 1: Create the two test auth users**

They must exist before the seed can resolve an owner. Task 6's script creates them; run only its user-creation half here, or create them inline with the same Admin API call. Emails:

- Owner: `squid-ink-owner@example.test`
- Second user (owns nothing): `squid-ink-intruder@example.test`

Use a strong generated password for each and keep it in `.env.local`, not in any committed file.

- [ ] **Step 2: Write `supabase/seed.sql`**

Idempotent, and it resolves the owner by email so no user id is hardcoded.

```sql
-- One completed note plus the chunks Note Detail renders. Owner is resolved
-- by email so this file carries no environment-specific user id.

with owner as (
  select id from auth.users where email = 'squid-ink-owner@example.test'
)
insert into public.notes (
  id, user_id, title, processing_status, raw_transcript,
  diarization_enabled, audio_duration_seconds, created_at, updated_at
)
select
  '11111111-1111-4111-8111-111111111111',
  owner.id,
  'Pilot pricing & rollout',
  'completed',
  -- Raw transcript is always retained regardless of diarization outcome.
  'Before pricing, I want to be honest about where the pilot stands: ...',
  true,
  2467,                                  -- 41:07, renders as "41 min"
  '2026-08-26T14:00:00Z',                -- renders as "Wed 26 Aug 2026"
  '2026-08-26T14:00:00Z'
from owner
on conflict (id) do nothing;
```

Then the chunks, all against the same note, in one statement per type. Reuse the exact prose from `lib/mock/note.ts` so the rendered page is visually comparable to Prompt 1's output:

- **12** `transcript_segment` rows — `content` = the segment text; `metadata` = `{"seq": 1, "ts_start": "00:12", "speaker": {"name": "Priya Raghavan", "initials": "PR", "token": "speaker-1"}}`
- **1** `summary` row — `content` = the joined summary prose; `metadata.runs` = the `CiteRun[]` array verbatim from the mock
- **3** `takeaway` rows — `metadata` = `{"n": "01", "seq": 1, "ts_start": "00:58", "segment_id": 3}`
- **3** `action_item` rows — `metadata` = `{"owner": "P. Raghavan", "due": "Sep 9", "ts_start": "00:58", "segment_id": 3}`

`embedding` stays null throughout — no embedding pipeline ships this prompt.

Guard the whole chunk insert with `on conflict do nothing` on a deterministic id per chunk, or a `where not exists` clause, so re-running the seed is safe.

- [ ] **Step 3: Apply the seed**

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn --file supabase/seed.sql
```

- [ ] **Step 4: Verify row counts**

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select chunk_type, count(*) from public.note_chunks group by chunk_type order by chunk_type;"
```

Expected: `action_item: 3`, `summary: 1`, `takeaway: 3`, `transcript_segment: 12`.

- [ ] **Step 5: Commit**

```bash
git add supabase/seed.sql
git commit -m "feat(db): seed one completed note with its chunks"
```

---

## Task 6: Prove RLS with two real users

This is the task the whole prompt is graded on. A restated claim that "RLS works", without the second user's genuinely empty result obtained through the `authenticated` role, is not evidence.

**Files:**
- Create: `scripts/verify-rls.mjs`

### Which proof path this exercises — state this plainly in the final report

There are two distinct paths a "second user sees nothing" proof could take. They are not equivalent, and the report must say which one ran.

| Path | What it proves | Used here |
|---|---|---|
| **A. Real password-grant JWT, sent as `Authorization: Bearer`** — sign in via `supabase-js`, take the returned `access_token`, attach it to a publishable-key client. PostgREST validates the signature and derives the Postgres role from the token's own `role` claim. | RLS is enforced by the database against a genuine, project-signed session token. Nothing about the role is asserted by us. | **Yes — this is what `scripts/verify-rls.mjs` runs.** |
| **B. Real session cookies through Next.js middleware** — sign in in a browser, let `@supabase/ssr` write the cookies, let `middleware.ts` refresh them, and let a server component read through them. | The same, plus that the app's own cookie/session plumbing hands the right identity to the query. | **Partly — covered manually in Task 9, Step 6, not by this script.** |

Path A is what Prompt 2's definition of done explicitly sanctions ("sign in via the JS client … with the user's access token set"). It is **real auth, not role-injection**: the JWT is issued by the project's auth server and verified by PostgREST. The thing Prompt 2 forbids is the opposite — running as `service_role` or as the Postgres superuser, or hand-forging `request.jwt.claims` while connected as an RLS-bypassing role. The script must actively rule that out by decoding each token and asserting `role === "authenticated"` before it trusts any result.

Path A alone does **not** prove the app's cookie plumbing is correct. Task 9, Step 6 closes that gap by driving the real browser session for both users. Both results go in the report.

- [ ] **Step 1: Write `scripts/verify-rls.mjs`**

Requirements the script must meet:

1. Read `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` from `.env.local`.
2. With a `service_role` admin client, `createUser` both test users (`email_confirm: true`) — idempotent, tolerating "already registered".
3. Sign **each** user in with `signInWithPassword` through a **publishable-key** client to obtain a real session JWT.
4. Run the **identical** query as each user, through a client constructed with that user's access token:

```js
const asUser = createClient(url, publishableKey, {
  global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await asUser
  .from("notes")
  .select("id, title, user_id, processing_status")
  .eq("id", "11111111-1111-4111-8111-111111111111");
```

5. Print, for each user: the email, the user id, the decoded JWT `role` claim (must read `authenticated`, not `service_role`), the row count, and the raw `data` / `error`.
6. Exit non-zero unless the owner sees exactly 1 row **and** the second user sees exactly 0 rows with `error === null`.

**Hard rule:** the second-user check must never run as `service_role` or as the Postgres superuser. Both bypass RLS entirely and produce a false pass. The script must assert the JWT `role` claim is `authenticated` before trusting either result.

- [ ] **Step 2: Run it**

```bash
node scripts/verify-rls.mjs
```

- [ ] **Step 3: Capture the output verbatim for the final report**

Expected shape:

```
owner      squid-ink-owner@example.test     role=authenticated  rows=1  error=null
intruder   squid-ink-intruder@example.test  role=authenticated  rows=0  error=null
PASS
```

An `error` such as `permission denied for table notes` on the second user is a **failure**, not a pass — it means the grant is missing rather than RLS filtering rows. The required result is a genuine empty set.

- [ ] **Step 4: Repeat the same two-user check against `note_chunks`**

Same script, same assertions. Both tables must be proven.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-rls.mjs
git commit -m "test(db): prove owner-only RLS with two real authenticated users"
```

---

## Task 7: Supabase clients and magic-link auth

**Files:**
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/middleware.ts`, `middleware.ts`, `app/login/page.tsx`, `app/login/login-form.tsx`, `app/auth/confirm/route.ts`

**Interfaces:**
- Produces: `createClient()` from `lib/supabase/client` (browser) and `createClient()` from `lib/supabase/server` (async, server-only). Task 9 consumes the server one.

- [ ] **Step 1: Confirm the current `@supabase/ssr` App Router pattern before writing code**

Fetch `https://supabase.com/docs/guides/auth/server-side/nextjs.md` and `https://supabase.com/changelog.md`. The cookie API (`getAll` / `setAll`) changed once already; do not write this from memory.

- [ ] **Step 2: Write `lib/supabase/client.ts`**

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
```

- [ ] **Step 3: Write `lib/supabase/server.ts`**

`cookies()` is async in Next.js 15+, so the factory is async. The `setAll` try/catch is required: server components cannot write cookies, and the middleware refresh covers that case.

```ts
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a server component. Middleware refreshes the
            // session, so this is safe to ignore.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 4: Write `lib/supabase/middleware.ts` and root `middleware.ts`**

`updateSession` must call `supabase.auth.getUser()` — `getSession()` alone does not revalidate the token — and must return the same `NextResponse` object the cookies were written onto.

- [ ] **Step 5: Write the login route — bare minimum, deliberately unstyled**

`app/login/page.tsx` is a server component rendering `app/login/login-form.tsx`. The client form calls `signInWithOtp({ email, options: { emailRedirectTo: <origin>/auth/confirm } })` and shows a "check your email" state. Copy stays generic — no app name.

**This is not the Auth surface from `App_Surfaces.dc.html`.** That is a separate Core UX/UI design pass, later. Ship the smallest thing that functions: a label, an email input, a submit button, and a status line. Use only the layout utilities needed to make it usable — no bespoke visual treatment, no new tokens, no design decisions that a later pass would have to undo. If a styling choice feels like design rather than plumbing, leave it out.

- [ ] **Step 6: Write `app/auth/confirm/route.ts`**

Reads `token_hash` and `type` from the query string, calls `supabase.auth.verifyOtp`, redirects to `next` on success and to `/login?error=…` on failure.

- [ ] **Step 7: Enable email auth in the dashboard**

Confirm the Email provider is on and the redirect URL allowlist includes `http://localhost:3000/**` for local development.

- [ ] **Step 8: Verify manually with the browser preview**

Start the dev server, visit `/login`, submit the owner email, follow the magic link, confirm a session cookie is set and `/login` redirects away.

- [ ] **Step 9: Commit**

```bash
git add lib/supabase middleware.ts app/login app/auth
git commit -m "feat(auth): add Supabase SSR clients and magic-link sign-in"
```

---

## Task 8: Pure view-model logic (TDD)

**Files:**
- Create: `lib/notes/types.ts`, `lib/notes/speaker-stats.ts`, `lib/notes/note-view-model.ts`, `lib/notes/waveform.ts`, `lib/notes/persona-presets.ts`, `lib/notes/sample-exchange.ts`
- Test: `lib/notes/__tests__/speaker-stats.test.ts`, `lib/notes/__tests__/note-view-model.test.ts`

**Interfaces:**
- Produces:
  - `computeSpeakerStats(segments: Segment[]): SpeakerStat[]`
  - `buildNoteViewModel(row: NoteRow, chunks: ChunkRow[]): Note`
  - `WAVEFORM: number[]`, `DEFAULT_PLAYHEAD: string`
  - `EXTRA_PERSONAS: Persona[]`, `SAMPLE_EXCHANGE: Note["sampleExchange"]`
- All view types (`Note`, `Segment`, `Speaker`, `SpeakerStat`, `Persona`, `CiteRun`, `ActionItem`, `Takeaway`) are imported from `@/lib/mock/types` — see the type-ownership wart above.

**Definitions, fixed here so tests and implementation cannot drift:**

- **talk %** — each speaker's share of total words across all segments, rounded, with largest-remainder adjustment so the set sums to exactly 100. Rendered as `"46%"`.
- **asked** — count of `?` characters in that speaker's segment text. Rendered as a bare string, `"5"`.
- **fillers** — count of case-insensitive whole-word matches from this fixed list: `um`, `uh`, `er`, `like`, `you know`, `sort of`, `kind of`, `i mean`, `basically`, `actually`, `right`. The list lives as a named exported constant in `speaker-stats.ts` so the definition is inspectable.
- **turnCount** — number of `transcript_segment` chunks.
- **spansLinked** — total citation references across the summary's `runs`, every persona's takeaways, and every action item.
- **meta** — `"<Ddd D Mmm YYYY> · <N> min"`, built from explicit UTC date parts (never `toLocaleDateString` with a floating locale — that hydrates differently on server and client).
- **duration** — `mm:ss`, zero-padded, from `audio_duration_seconds`.

- [ ] **Step 1: Write the failing speaker-stats test**

```ts
import { describe, expect, it } from "vitest";
import { computeSpeakerStats } from "../speaker-stats";
import type { Segment, Speaker } from "@/lib/mock/types";

const A: Speaker = { name: "A", initials: "AA", token: "speaker-1" };
const B: Speaker = { name: "B", initials: "BB", token: "speaker-2" };

const seg = (id: number, speaker: Speaker, text: string): Segment => ({
  id, time: "00:00", speaker, text,
});

describe("computeSpeakerStats", () => {
  it("splits talk share by word count and sums to 100%", () => {
    const stats = computeSpeakerStats([
      seg(1, A, "one two three"),
      seg(2, B, "four"),
    ]);
    expect(stats.map((s) => s.talk)).toEqual(["75%", "25%"]);
  });

  it("counts question marks per speaker", () => {
    const stats = computeSpeakerStats([
      seg(1, A, "why? how? really?"),
      seg(2, B, "no questions here"),
    ]);
    expect(stats[0].asked).toBe("3");
    expect(stats[1].asked).toBe("0");
  });

  it("counts filler words case-insensitively on whole words only", () => {
    const stats = computeSpeakerStats([
      seg(1, A, "Um, like, you know, basically likeness"),
    ]);
    expect(stats[0].fillers).toBe("4");
  });

  it("returns one row per distinct speaker, in first-appearance order", () => {
    const stats = computeSpeakerStats([seg(1, B, "x"), seg(2, A, "y")]);
    expect(stats.map((s) => s.speaker.name)).toEqual(["B", "A"]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/notes/__tests__/speaker-stats.test.ts
```

Expected: FAIL — cannot resolve `../speaker-stats`.

- [ ] **Step 3: Implement `lib/notes/speaker-stats.ts`**

Word count via `text.trim().split(/\s+/).length`. Largest-remainder: compute exact percentages, floor them, then hand out the leftover points to the largest fractional parts. Filler matching with a single case-insensitive regex built from the escaped list, anchored with `\b` on both sides.

- [ ] **Step 4: Run and confirm it passes**

```bash
npx vitest run lib/notes/__tests__/speaker-stats.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing view-model test**

Cover: segments ordered by `metadata.seq`; `turnCount` equals segment count; `duration` of 2467 renders `"41:07"`; `meta` of `2026-08-26T14:00:00Z` + 2467 renders `"Wed 26 Aug 2026 · 41 min"`; `personas[0].id` is `"neutral-analyst"` and its takeaways come from the `takeaway` chunks; `personas` length is 4 with the three presets appended; `spansLinked` counts every citation.

- [ ] **Step 6: Run it and confirm it fails**

- [ ] **Step 7: Implement the constants files, then `note-view-model.ts`**

`waveform.ts`, `persona-presets.ts`, and `sample-exchange.ts` hold values copied from `lib/mock/note.ts` (copied, not imported — `lib/mock/*` stays unused by real code). `note-view-model.ts` partitions chunks by `chunk_type`, sorts by `metadata.seq`, and assembles the `Note`. If it approaches 250 lines, extract the chunk-partitioning into `lib/notes/chunk-partition.ts` — do not raise the ceiling.

- [ ] **Step 8: Run the full suite**

```bash
npm test
```

Expected: the 20 pre-existing tests still pass, plus the new ones.

- [ ] **Step 9: Commit**

```bash
git add lib/notes
git commit -m "feat(notes): build the Note view model from chunk rows"
```

---

## Task 9: `getNote` and the page swap (TDD)

**Files:**
- Create: `lib/notes/get-note.ts`
- Test: `lib/notes/__tests__/get-note.test.ts`
- Modify: `app/notes/[id]/page.tsx`

**Interfaces:**
- Consumes: `createClient()` from `@/lib/supabase/server`, `buildNoteViewModel` from Task 8.
- Produces: `getNote(id: string): Promise<Note | null>`

- [ ] **Step 1: Write the failing test**

Mock the server client module so no network is touched.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));

const { getNote } = await import("../get-note");

describe("getNote", () => {
  beforeEach(() => from.mockReset());

  it("returns null when no row matches the id", async () => {
    // notes query resolves with data: null
    // ...builder stub omitted for brevity in this snippet; the real test
    // stubs .select().eq().maybeSingle() and .select().eq() chains.
    expect(await getNote("11111111-1111-4111-8111-111111111111")).toBeNull();
  });

  it("throws when the query itself errors", async () => {
    await expect(getNote("x")).rejects.toThrow();
  });

  it("returns an assembled Note when the row and its chunks exist", async () => {
    const note = await getNote("11111111-1111-4111-8111-111111111111");
    expect(note?.title).toBe("Pilot pricing & rollout");
    expect(note?.segments).toHaveLength(12);
  });
});
```

Write the builder stubs out in full in the real file — no `// omitted` placeholders in shipped test code.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/notes/__tests__/get-note.test.ts
```

- [ ] **Step 3: Implement `lib/notes/get-note.ts`**

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { buildNoteViewModel } from "./note-view-model";
import type { Note } from "@/lib/mock/types";
import type { ChunkRow, NoteRow } from "./types";

/** Fetch one note and its chunks. RLS scopes this to the signed-in owner —
 *  a note belonging to someone else reads as "not found", not as an error. */
export async function getNote(id: string): Promise<Note | null> {
  const supabase = await createClient();

  const { data: note, error: noteError } = await supabase
    .from("notes")
    .select("*")
    .eq("id", id)
    .maybeSingle<NoteRow>();

  if (noteError) throw new Error(`Failed to load note: ${noteError.message}`);
  if (!note) return null;

  const { data: chunks, error: chunkError } = await supabase
    .from("note_chunks")
    .select("*")
    .eq("note_id", id)
    .returns<ChunkRow[]>();

  if (chunkError) throw new Error(`Failed to load note chunks: ${chunkError.message}`);

  return buildNoteViewModel(note, chunks ?? []);
}
```

Note: no `user_id` filter in the query. RLS supplies it. Adding a redundant application-level filter would hide an RLS failure rather than expose it.

- [ ] **Step 4: Run and confirm it passes**

- [ ] **Step 5: Swap the page**

```tsx
import { notFound } from "next/navigation";
import { NoteDetailShell } from "@/components/note-detail/note-detail-shell";
import { getNote } from "@/lib/notes/get-note";

export default async function NoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const note = await getNote(id);
  if (!note) notFound();
  return <NoteDetailShell note={note} />;
}
```

`NoteDetailShell` is untouched. Its props do not change.

- [ ] **Step 6: Verify in the browser, in both themes — and close the cookie-path gap**

Sign in as the owner, open `/notes/11111111-1111-4111-8111-111111111111`. Confirm the page renders the seeded data, then toggle to dark and confirm again. Capture a screenshot of each. Check the console for hydration warnings — a date-formatting mismatch shows up here.

Then sign out, sign in as `squid-ink-intruder@example.test`, and open the **same** URL. Expected: the 404 / not-found route, because `getNote` returned `null`. Anything else — the note rendering, or a server error instead of not-found — is an RLS or plumbing failure, not a cosmetic one.

This is **proof path B** from Task 6: real session cookies, through `middleware.ts`, into a server component. Path A (the script) proves the database enforces RLS against a genuine JWT; this step proves the app hands the database the right identity. Report both.

- [ ] **Step 7: Commit**

```bash
git add lib/notes/get-note.ts lib/notes/__tests__/get-note.test.ts "app/notes/[id]/page.tsx"
git commit -m "feat(notes): read Note Detail from Supabase instead of mock data"
```

---

## Task 10: Docs, verification, review

**Files:**
- Modify: `CLAUDE.md`, `docs/KNOWN_GAPS.md`

- [ ] **Step 1: Append the Supabase section to `CLAUDE.md`**

Cover: the declarative schema workflow and the no-Docker deviation; the `db query --linked` iteration loop and the standing ban on `apply_migration` during iteration; the pinned `@supabase/ssr` / `@supabase/supabase-js` versions with the date they were verified; the RLS policy shape (four per-operation policies, wrapped `auth.uid()`, `with check` on update); and the rule that no secret key may appear in app code.

- [ ] **Step 2: Append to `docs/KNOWN_GAPS.md` — append, never overwrite**

Entries required:
1. **Google provider-token refresh** — no Google OAuth, no Drive/Calendar/Tasks, no token-storage table. Deferred; no consumer exists yet.
2. **Audio Storage bucket deferred** — `notes.audio_storage_path` ships as a nullable placeholder. No bucket, no policies, no upload or playback code. Build it when the timeline-bar feature (ROADMAP §8, Advanced) is actually scheduled.
3. **Google connection table deferred** — same reason.
4. **Migration generation needs Docker** — `db pull` / `db dump` are unavailable on this machine; the initial migration is a verbatim copy of the schema files. Provably equivalent for a from-empty schema, but the second migration will need either Docker or a hand-authored file.
5. **View types live under `lib/mock/types.ts`** — real code in `lib/notes/` imports them from there because `components/` and `lib/mock/` were frozen this prompt. Move them to `lib/notes/view-types.ts` and update component imports in a later pass.
6. **Speaker stats are recomputed on every read** — cheap at one note, but if the feed ever shows stats per row this becomes an N+1 and should be materialised.
7. **`scripts/verify-rls.mjs` is not part of `npm test`** — it needs network access and the secret key, so it stays a manually run script.

- [ ] **Step 3: Run the full verification set and capture every output verbatim**

```bash
npx tsc --noEmit
```

```bash
npm test
```

```bash
npm run build
```

```bash
npx supabase db advisors --linked --project-ref pbwvvakzbrimmdntqxxn --type all --level info
```

```bash
node scripts/verify-rls.mjs
```

```bash
git status --short
```

The last one must show no `.env.local` and no secret.

- [ ] **Step 4: Request code review**

Use `superpowers:requesting-code-review` together with `vercel-react-best-practices`, scoped to the query-wiring change. Skip `web-design-guidelines` — no visual work happens in this prompt.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/KNOWN_GAPS.md
git commit -m "docs: record Supabase workflow and the deferrals this prompt did not start"
```

- [ ] **Step 6: Finish the branch**

Use `superpowers:finishing-a-development-branch`. There is no git remote on this repository, so this is a local merge into `main`, not a PR.

---

## Reporting contract — what the final report must contain

Nothing in this list may be summarised or restated. Paste it.

1. **What shipped, file by file.**
2. **What was skipped and why** — Google OAuth/Drive/Calendar/Tasks and any token table; the Storage bucket, upload flow, and playback UI. Confirm explicitly that neither was quietly started.
3. **Mock-to-schema mismatches and how each was resolved** — the table above, plus the ROADMAP §4 tightenings.
4. **`supabase db advisors` output, verbatim**, together with the CLI version it ran under.
5. **Both RLS test queries, verbatim** — the SQL, which role and JWT each ran as, and the actual results for the owner and for the second user. The second user's empty result must have been obtained through the `authenticated` role.
5a. **Which proof path ran.** State explicitly that `scripts/verify-rls.mjs` exercises **path A** — a real password-grant JWT sent as an `Authorization: Bearer` header, validated by PostgREST, with the decoded `role` claim asserted to be `authenticated` — and **not** real session cookies through `middleware.ts`. Report the cookie path (**path B**) separately, from the Task 9 Step 6 browser check. Do not let one stand in for the other.
6. **`npm run build` output, verbatim.**
7. **`npx tsc --noEmit` output, verbatim.**
8. **The `db pull` deviation** — that migration generation could not run as the spec specified, why, and what replaced it.
