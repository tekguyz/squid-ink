# Ask-Your-Notes Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship ask-your-notes chat on Note Detail — single-note chat that stuffs the transcript into a cached context block, and all-notes chat that reaches a hybrid vector+full-text search tool — with citations, persistence, and hard cost ceilings.

**Architecture:** Retrieval splits by scope. Single-note chat uses no retrieval at all: the raw transcript plus this note's generated chunks go into one `cache_control: ephemeral` block, so it works the instant transcription finishes and never reads `notegen_status`. All-notes chat is the only retrieval consumer — Claude gets a `search_notes` tool backed by a non-`SECURITY DEFINER` Postgres function, so RLS on `notes`/`note_chunks` does the owner-scoping with no `user_id` filter in app code. Chat history persists in a new `chat_messages` table and is re-read server-side each turn, never trusted from the client.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 7, Vercel AI SDK (`ai` 7.0.92, `@ai-sdk/anthropic` 4.0.49, `@ai-sdk/react` 4.0.95), `zod` 4.5.4, Claude Sonnet 5, Voyage `voyage-4`, Supabase (hosted only), Vitest 4, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-03-ask-your-notes-chat-design.md` — read it before Task 1. Every "why" lives there; this plan is the "how".

---

## Global Constraints

Copied verbatim from the spec and CLAUDE.md. Every task's requirements implicitly include this section.

- **Exact version pins. No `^`, no `~`.** New: `ai` `7.0.92`, `@ai-sdk/anthropic` `4.0.49`, `@ai-sdk/react` `4.0.95`, `zod` `4.5.4`. Verified against the live npm registry 2026-09-03.
- **Model id is `claude-sonnet-5`.** Exact string, no date suffix. Sonnet 5 removed `budget_tokens` and answers **400** if it is sent — use `thinking: { type: 'adaptive' }` or omit `thinking`.
- **The AI SDK step-loop helper is `isStepCount(n)`, NOT `stepCountIs(n)`.** `stepCountIs` is an older name and does not exist in `ai` 7.x. Import `isStepCount` from `ai`.
- **Every colour is a `var()` token.** Zero `oklch()`, hex, `rgb()`, `hsl()` in `components/` or `lib/`. `components/note-detail/__tests__/project-conventions.test.ts` fails the build otherwise.
- **Soft ceiling 250 lines, hard ceiling 400** on shipped files. The conventions test enforces 400 across every `.ts`/`.tsx` in the tree except `__tests__`.
- **Feature-grouped folders, at most one level deep.** `components/note-detail/chat/`, `lib/chat/`. Never `parts/`, `utils/`, or `common/`.
- **`lib/rag/*` reads no environment variable at all.** A conventions test asserts `process.env` never appears under `lib/rag/`. The caller supplies every key.
- **Queries never filter on `user_id` in application code.** RLS supplies it. A redundant filter masks an RLS failure instead of exposing it. (The cron path is the one documented exception and is not touched here.)
- **Schema-file-first, no exceptions.** Never paste DDL into `db query` as an inline argument. Edit the `.sql` file, apply that exact file. Every statement idempotent. Inline `db query` is for `select` verification only.
- **Never call `apply_migration` while iterating.** It writes a migration history entry on every call and blocks further diffing.
- **`config.toml` `schema_paths` is an explicit ordered list, never a glob.**
- **No brand name anywhere in code.** User-facing copy stays generic.
- **Docker is not installed.** There is no local Supabase stack. Everything runs against the linked project through the management API.
- **RLS shape:** four per-operation policies, predicate always `(select auth.uid()) = user_id` (wrapped), every policy carries `to authenticated`, UPDATE needs both `using` and `with check`, `revoke all` before granting, `anon` gets nothing.

**Environment variables used by this feature.** Both server-only, both read in exactly one new file (`app/api/chat/route.ts`):

- `ANTHROPIC_API_KEY` — new. Must never carry a `NEXT_PUBLIC_` prefix.
- `VOYAGE_API_KEY` — existing. **This feature makes `app/api/chat/route.ts` its third reader**, so the existing conventions guard (which asserts exactly two) must be widened in Task 1 or the suite reds.

**Commands:**

```bash
npm run typecheck
npm test
npm run build
```

Supabase project ref: read it from `.env.local` / the linked project — do not hardcode one into a file.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `supabase/schemas/chat_messages.sql` | The table, its two indexes, four RLS policies, grants |
| `supabase/schemas/search_note_chunks.sql` | Hybrid RRF search function, `security invoker` |
| `lib/rag/query-embed.ts` | Voyage wrapper with `input_type: "query"` — query side only |
| `lib/rag/search-tool.ts` | `search_notes` tool definition + RPC handler |
| `lib/chat/limits.ts` | Length cap, rate-limit window, history trimming — pure |
| `lib/chat/context.ts` | This-note context block, history flattening, system prompts |
| `lib/chat/ports.ts` | The one Supabase implementation: history read, message writes, rate count |
| `lib/chat/citations.ts` | Build the persisted citation map from a run's tool results |
| `lib/chat/types.ts` | `ChatScope`, `ChatTurn`, `Citation`, `SearchHit` — shared by server and client |
| `app/api/chat/route.ts` | The streaming route. Thin: auth, gates, wire-up |
| `components/note-detail/chat/chat-panel.tsx` | `useChat`, scope toggle, message list, composer |
| `components/note-detail/chat/chat-message.tsx` | One turn, incl. the ungrounded notice |
| `components/note-detail/chat/cite-runs.tsx` | `CiteRun[]` → `CitationChip` / cross-note link |
| `components/note-detail/chat/parse-citations.ts` | Marker text → `CiteRun[]`. Pure, unit-tested |
| `components/note-detail/chat/scope-toggle.tsx` | This note / All notes |
| `scripts/verify-chat-rls.mjs` | Two-user RLS proof + deleted-note citation floor |
| `scripts/verify-chat-search.mjs` | 90-day/25-note boundary, 25-cap, both chunk types, notegen independence |

**Modified:**

| File | Change |
|---|---|
| `package.json` | Four new exact pins |
| `supabase/config.toml` | Two schema paths appended, in order |
| `components/note-detail/__tests__/project-conventions.test.ts` | `ANTHROPIC_API_KEY` guard; widen `VOYAGE_API_KEY` to three readers |
| `lib/notes/view-types.ts` | `ChatTurn` re-export for client components |
| `app/notes/[id]/page.tsx` | Load chat history, pass to shell |
| `components/note-detail/note-detail-shell.tsx` | `ChatComposer` → `ChatPanel` |
| `docs/DECISIONS.md`, `docs/ROADMAP.md`, `CLAUDE.md`, `docs/KNOWN_GAPS.md` | Per the reporting contract |

**Deleted:** `components/note-detail/chat-composer.tsx` (replaced by `chat/`).

---

## Task 1: Dependencies and the environment guards

Foundation. Nothing else compiles without the packages, and the conventions suite goes red the moment the route lands unless the guards are widened first.

**Files:**
- Modify: `package.json`
- Modify: `components/note-detail/__tests__/project-conventions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the four packages on disk; a conventions suite that will accept `app/api/chat/route.ts` as a reader of `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY`.

- [ ] **Step 1: Re-verify the pins against the live registry**

Do not take these from the plan. Run:

```bash
for p in ai @ai-sdk/anthropic @ai-sdk/react zod; do echo -n "$p -> "; npm view "$p" dist-tags.latest; done
```

Expected (as of 2026-09-03): `ai -> 7.0.92`, `@ai-sdk/anthropic -> 4.0.49`, `@ai-sdk/react -> 4.0.95`, `zod -> 4.5.4`. If a number differs, use what the registry says and note the change in the final report.

- [ ] **Step 2: Install with exact pins**

```bash
npm install --save-exact ai@7.0.92 @ai-sdk/anthropic@4.0.49 @ai-sdk/react@4.0.95 zod@4.5.4
```

- [ ] **Step 3: Confirm no range crept into package.json**

```bash
node -e "const d=require('./package.json').dependencies;for(const k of ['ai','@ai-sdk/anthropic','@ai-sdk/react','zod'])if(/[\^~]/.test(d[k]))throw new Error(k+' is a range: '+d[k]);console.log('all exact')"
```

Expected: `all exact`.

- [ ] **Step 4: Write the failing guard tests**

In `components/note-detail/__tests__/project-conventions.test.ts`, **replace** the existing `it("reads VOYAGE_API_KEY from exactly the two shipped triggers", ...)` block with these two:

```ts
  it("reads VOYAGE_API_KEY from exactly the three shipped triggers", () => {
    // Server-only, exactly like the Gemini key. Three entry points and no
    // fourth: the deferred half of the Transcribe action, the cron route's
    // third phase, and the chat route, which embeds the QUESTION at
    // input_type "query". If a client component ever reaches a module that
    // reads this, the key ships to the browser — this is the guard that stops
    // that, and lib/rag/* deliberately reads no env var at all.
    const readers = sourceFiles().filter((f) =>
      read(f).includes("process.env.VOYAGE_API_KEY"),
    );
    expect(readers.sort()).toEqual([
      path.join("app", "api", "chat", "route.ts"),
      path.join("app", "api", "cron", "transcribe", "route.ts"),
      path.join("app", "notes", "actions", "transcription.ts"),
    ]);
  });

  it("reads ANTHROPIC_API_KEY from exactly one shipped file", () => {
    // The chat route is the only place that talks to Claude. Same reasoning as
    // the Voyage guard: a second reader is how a server key finds its way into
    // a client component's import graph.
    const readers = sourceFiles().filter((f) =>
      read(f).includes("process.env.ANTHROPIC_API_KEY"),
    );
    expect(readers).toEqual([path.join("app", "api", "chat", "route.ts")]);
  });

  it("never gives a server key a NEXT_PUBLIC_ prefix", () => {
    // Next.js ships every NEXT_PUBLIC_ variable to the browser. This is cheap
    // and catches the one-character version of a total key compromise.
    const offenders = sourceFiles().filter((f) =>
      /NEXT_PUBLIC_(ANTHROPIC|VOYAGE|SUPABASE_SECRET)/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });
```

Also extend the client-import-graph test. Find `expect(clientFiles.filter((f) => read(f).includes("VOYAGE_API_KEY"))).toEqual([]);` and add immediately after it:

```ts
    expect(
      clientFiles.filter((f) => read(f).includes("ANTHROPIC_API_KEY")),
    ).toEqual([]);
```

- [ ] **Step 5: Run the tests and confirm they fail for the right reason**

```bash
npm test -- project-conventions
```

Expected: the two reader tests FAIL because `app/api/chat/route.ts` does not exist yet, so the arrays are short. The `NEXT_PUBLIC_` test and the client-graph test PASS already. This is the correct failure — it is the guard waiting for Task 8.

- [ ] **Step 6: Add a temporary skip so the suite is green between here and Task 8**

Change the two reader tests to `it.skip(...)` and add a comment above each:

```ts
  // UNSKIP IN TASK 8, when app/api/chat/route.ts lands. Left skipped rather
  // than deleted so the guard cannot be forgotten.
```

- [ ] **Step 7: Run the full suite**

```bash
npm test && npm run typecheck
```

Expected: PASS, with two skipped.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json components/note-detail/__tests__/project-conventions.test.ts
git commit -m "chore(deps): pin the AI SDK, and widen the server-key guards for chat"
```

---

## Task 2: `chat_messages` table

**Files:**
- Create: `supabase/schemas/chat_messages.sql`
- Modify: `supabase/config.toml:64`
- Create: `scripts/verify-chat-rls.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.chat_messages` with columns `id uuid`, `note_id uuid not null`, `user_id uuid not null`, `role text`, `content text`, `scope text`, `metadata jsonb not null default '{}'`, `created_at timestamptz not null default now()`. Task 3 does not use it; Tasks 5, 7, 8, 10 do.

- [ ] **Step 1: Write the schema file**

Create `supabase/schemas/chat_messages.sql`:

```sql
-- chat_messages: one row per chat turn, user or assistant.
--
-- note_id is NOT NULL even for an all-notes conversation. Chat is a Note
-- Detail surface: an all-notes turn still happens ON a note's page, and
-- note_id records which page. `scope` records what the turn actually
-- searched. Two different facts, both kept.
--
-- Two columns are tightened against the ROADMAP snippet, which was
-- illustrative. Both tightenings match note_chunks:
--   user_id  -> on delete cascade  (without it a deleted account leaves rows
--              that fail every RLS predicate — invisible, undeletable data)
--   metadata -> not null default '{}'  (removes null-guards from every read)
--
-- Every statement is idempotent so the whole file can be re-applied.

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- Which retrieval path this turn used. Nullable because a row written
  -- before the toggle existed has no answer, and inventing one would be a
  -- lie. Live code always writes it.
  scope text check (scope in ('this_note', 'all_notes')),
  -- { citations: [{ key, chunkId, noteId, noteTitle, chunkType, tsStart }] }
  -- on assistant rows. This is what lets a `c<n>` chip still resolve after a
  -- page reload, when the tool result that produced it is long gone.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The display read: one note's conversation, oldest first.
create index if not exists chat_messages_note_id_created_at_idx
  on public.chat_messages (note_id, created_at);

-- The RATE LIMIT's index, not decoration. lib/chat/ports.ts counts the
-- caller's rows in the last 60 seconds on every single send. Without this
-- that count is a sequential scan that gets slower with every message ever
-- sent — a cost ceiling that itself becomes a cost.
create index if not exists chat_messages_user_id_created_at_idx
  on public.chat_messages (user_id, created_at);

alter table public.chat_messages enable row level security;

-- Four per-operation policies, matching notes and note_chunks. auth.uid() is
-- wrapped in a select so the planner evaluates it once per query, not once
-- per row.

drop policy if exists chat_messages_select_own on public.chat_messages;
create policy chat_messages_select_own on public.chat_messages
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists chat_messages_insert_own on public.chat_messages;
create policy chat_messages_insert_own on public.chat_messages
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- Without with check, a user could rewrite user_id and hand the row away.
drop policy if exists chat_messages_update_own on public.chat_messages;
create policy chat_messages_update_own on public.chat_messages
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists chat_messages_delete_own on public.chat_messages;
create policy chat_messages_delete_own on public.chat_messages
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Revoke first, then grant, so this file is the sole authority on
-- privileges. The project defaults hand anon and authenticated TRUNCATE,
-- REFERENCES and TRIGGER on every new public table; TRUNCATE is not
-- row-level, so RLS does not constrain it.
revoke all on public.chat_messages from anon, authenticated, service_role;

-- anon is deliberately granted nothing — this app has no public reads.
grant select, insert, update, delete on public.chat_messages to authenticated;

-- service_role is deliberately granted NOTHING here. Unlike notes and
-- note_chunks, no cron job and no background sweep touches this table: every
-- write happens inside a request that carries the user's session. If that
-- ever changes, add the grant deliberately and say why — do not copy the
-- other two files' grant block in by reflex.
```

- [ ] **Step 2: Append to `config.toml`, preserving order**

`supabase/config.toml:64`. `chat_messages` references `public.notes`, so it must come after `notes.sql`. Appending at the end satisfies that. Replace the line with:

```toml
schema_paths = ["./schemas/notes.sql", "./schemas/personas.sql", "./schemas/note_chunks.sql", "./schemas/persona_provisioning.sql", "./schemas/storage_audio.sql", "./schemas/chat_messages.sql"]
```

- [ ] **Step 3: Apply the file — the whole file, never inline DDL**

```bash
npx supabase db query --linked --project-ref <ref> --file supabase/schemas/chat_messages.sql
```

Expected: success, no rows. Re-run it once more and confirm it succeeds again — that is the idempotency check, and it is not optional.

- [ ] **Step 4: Read the live catalog back**

`db diff` is unavailable without Docker, so confirm from the catalog directly:

```bash
npx supabase db query --linked --project-ref <ref> --query "select policyname, cmd, qual, with_check from pg_policies where tablename = 'chat_messages' order by policyname"
npx supabase db query --linked --project-ref <ref> --query "select indexname from pg_indexes where tablename = 'chat_messages' order by indexname"
npx supabase db query --linked --project-ref <ref> --query "select grantee, privilege_type from information_schema.role_table_grants where table_name = 'chat_messages' order by grantee, privilege_type"
```

Expected: four policies (`chat_messages_delete_own`, `_insert_own`, `_select_own`, `_update_own`); update carries a non-null `with_check`; three indexes (pkey + the two named above); grants list `authenticated` with SELECT/INSERT/UPDATE/DELETE and **no** `anon` and **no** `service_role` rows.

- [ ] **Step 5: Write the RLS proof script**

Create `scripts/verify-chat-rls.mjs`. Model it on `scripts/verify-rls.mjs` — read that file first and match its structure, its `.env.local` loading, and its cleanup. It must:

1. Sign in **two real users** with genuine `auth.users` session JWTs. Not password-grant against `service_role`, not the secret key. This is the project's established convention and the DoD names it explicitly.
2. As user A: insert a note, then insert a `chat_messages` row against it.
3. As user B: run the identical `select` on `chat_messages`. Assert **zero rows and no error** — a genuine empty result, not `permission denied`. A permission error means the grant is wrong; an empty result means RLS is right.
4. As user B: attempt an insert carrying user A's `user_id`. Assert it is refused.
5. As user A: attempt an update setting `user_id` to user B's id. Assert refused — this is the `with check` half.
6. **The citation floor:** insert an assistant row whose `metadata.citations` names a note id; delete that note; re-read the row. Assert the row survives (the citation is dangling, not cascaded away, because `metadata` is opaque jsonb) and that the dangling id is detectable. Task 9's client test consumes this shape.
7. Clean up: delete the rows **as the owner**, not as the admin. Deleting as `service_role` bypasses RLS and would silently succeed while proving nothing.

- [ ] **Step 6: Run it**

```bash
node scripts/verify-chat-rls.mjs
```

Expected: every assertion passes. **Paste the full output into the final report** — the reporting contract asks for the command and its output, not a claim that it passed.

- [ ] **Step 7: Commit**

```bash
git add supabase/schemas/chat_messages.sql supabase/config.toml scripts/verify-chat-rls.mjs
git commit -m "feat(db): chat_messages, owner-scoped, with the rate limit's index"
```

---

## Task 3: `search_note_chunks` function

**Files:**
- Create: `supabase/schemas/search_note_chunks.sql`
- Modify: `supabase/config.toml:64`
- Create: `scripts/verify-chat-search.mjs`

**Interfaces:**
- Consumes: `public.notes`, `public.note_chunks` (read-only; no write path is touched).
- Produces: `public.search_note_chunks(query_embedding extensions.vector(1024), query_text text)` returning rows of `(chunk_id uuid, note_id uuid, note_title text, chunk_type text, content text, ts_start text, seq int, score double precision)`. Task 6 calls it by that exact name and argument order.

**Two traps this task must not fall into.** Both are consequences of `set search_path = ''`, which the Supabase linter requires:

1. **The `<=>` operator lives in `extensions`, not `pg_catalog`.** With an empty search path it is unresolvable. Write it as `operator(extensions.<=>)`.
2. **`'english'::regconfig` resolves through the search path too.** Write `'pg_catalog.english'::regconfig`. It resolves to the same OID the existing `note_chunks_content_fts_idx` was built with, so the index still matches — Step 5 proves that with `EXPLAIN` rather than assuming it.

- [ ] **Step 1: Write the schema file**

Create `supabase/schemas/search_note_chunks.sql`:

```sql
-- search_note_chunks: hybrid retrieval for cross-note chat, per ROADMAP.md §4.
--
-- NOT security definer. It runs as the caller, so RLS on notes and
-- note_chunks does the owner-scoping. There is deliberately NO
-- `user_id = auth.uid()` filter in this body and none around it in app code:
-- a redundant filter would mask an RLS failure instead of exposing it, which
-- is the standing rule in CLAUDE.md § Supabase → RLS rules.
--
-- The candidate pool is ONE clause. `created_at > now() - interval '90 days'
-- order by created_at desc limit 25` naturally yields whichever bound is
-- smaller: 25 for a busy month, fewer (or none) for a quiet year. No second
-- branch, nothing to keep in sync.
--
-- The result cap is unconditional: 25 chunks post-RRF, whatever the pool.
--
-- set search_path = '' is what the database linter wants, and it has two
-- consequences that are easy to get wrong and hard to notice:
--   * <=> lives in extensions, so it is written operator(extensions.<=>)
--   * 'english'::regconfig resolves through the search path, so it is written
--     'pg_catalog.english'::regconfig — the same OID
--     note_chunks_content_fts_idx was built with, which is what keeps the gin
--     index matching. Proved with EXPLAIN, not assumed.

create or replace function public.search_note_chunks(
  query_embedding extensions.vector(1024),
  query_text text
)
returns table (
  chunk_id uuid,
  note_id uuid,
  note_title text,
  chunk_type text,
  content text,
  ts_start text,
  seq int,
  score double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with candidates as (
    select n.id, n.title
    from public.notes n
    where n.created_at > now() - interval '90 days'
    order by n.created_at desc
    limit 25
  ),
  vector_arm as (
    select
      c.id,
      row_number() over (
        order by c.embedding operator(extensions.<=>) query_embedding
      ) as rank
    from public.note_chunks c
    join candidates k on k.id = c.note_id
    where c.embedding is not null
    order by c.embedding operator(extensions.<=>) query_embedding
    limit 50
  ),
  text_arm as (
    select
      c.id,
      row_number() over (
        order by ts_rank(
          to_tsvector('pg_catalog.english'::regconfig, c.content),
          plainto_tsquery('pg_catalog.english'::regconfig, query_text)
        ) desc
      ) as rank
    from public.note_chunks c
    join candidates k on k.id = c.note_id
    where to_tsvector('pg_catalog.english'::regconfig, c.content)
          @@ plainto_tsquery('pg_catalog.english'::regconfig, query_text)
    order by ts_rank(
      to_tsvector('pg_catalog.english'::regconfig, c.content),
      plainto_tsquery('pg_catalog.english'::regconfig, query_text)
    ) desc
    limit 50
  ),
  fused as (
    select
      coalesce(v.id, t.id) as id,
      -- Reciprocal rank fusion, k = 60. A chunk found by both arms scores
      -- the sum, which is what makes hybrid beat either arm alone.
      coalesce(1.0 / (60 + v.rank), 0.0)
        + coalesce(1.0 / (60 + t.rank), 0.0) as score
    from vector_arm v
    full outer join text_arm t on t.id = v.id
  )
  select
    c.id as chunk_id,
    c.note_id,
    k.title as note_title,
    c.chunk_type,
    c.content,
    c.metadata ->> 'ts_start' as ts_start,
    (c.metadata ->> 'seq')::int as seq,
    f.score
  from fused f
  join public.note_chunks c on c.id = f.id
  join candidates k on k.id = c.note_id
  order by f.score desc, c.id
  limit 25;
$$;

-- Revoke first, then grant, so this file is the sole authority. Postgres
-- grants EXECUTE on new functions to PUBLIC by default, which would hand
-- anon a retrieval endpoint — RLS would return them nothing, but an
-- unauthenticated caller should not reach the function at all.
revoke all on function public.search_note_chunks(extensions.vector(1024), text)
  from public, anon, authenticated, service_role;

grant execute on function public.search_note_chunks(extensions.vector(1024), text)
  to authenticated;
```

- [ ] **Step 2: Append to `config.toml`**

`supabase/config.toml:64`. The function references both tables, so it goes last:

```toml
schema_paths = ["./schemas/notes.sql", "./schemas/personas.sql", "./schemas/note_chunks.sql", "./schemas/persona_provisioning.sql", "./schemas/storage_audio.sql", "./schemas/chat_messages.sql", "./schemas/search_note_chunks.sql"]
```

- [ ] **Step 3: Apply the file**

```bash
npx supabase db query --linked --project-ref <ref> --file supabase/schemas/search_note_chunks.sql
```

Expected: success. Run it a second time and confirm it succeeds again.

- [ ] **Step 4: Confirm it is not `SECURITY DEFINER`**

```bash
npx supabase db query --linked --project-ref <ref> --query "select proname, prosecdef, proconfig from pg_proc where proname = 'search_note_chunks'"
```

Expected: `prosecdef` is `false`. `proconfig` contains `search_path=`. If `prosecdef` is `true` the function bypasses RLS and the whole owner-scoping story is void — stop and fix it.

- [ ] **Step 5: Prove the FTS index still matches**

This is the `'pg_catalog.english'` trap. Run:

```bash
npx supabase db query --linked --project-ref <ref> --query "explain select id from public.note_chunks where to_tsvector('pg_catalog.english'::regconfig, content) @@ plainto_tsquery('pg_catalog.english'::regconfig, 'budget')"
```

Expected: the plan names `note_chunks_content_fts_idx` (a Bitmap Index Scan). If it shows a Seq Scan, the regconfig OIDs differ and every full-text query will scan the table — fix the expression before continuing.

- [ ] **Step 6: Run the advisors**

```bash
npx supabase db advisors --linked --project-ref <ref> --type all --level info
```

Expected: no new warning about `search_note_chunks`. In particular no `function_search_path_mutable` and no `security_definer_view`-family finding.

- [ ] **Step 7: Write the search proof script**

Create `scripts/verify-chat-search.mjs`. No dev server needed. It must seed and then prove, counting Voyage calls rather than trusting them:

1. Seed one note dated **inside** the 90-day window with a `transcript_segment` chunk containing a distinctive phrase, and a `takeaway` chunk containing a different distinctive phrase. Embed both through the real query/document path.
2. Seed one note dated **outside** the window (`created_at` set to 100 days ago) whose chunk contains a phrase that would otherwise rank first.
3. Seed **26 notes** inside the window so the `limit 25` pool bound bites, with the oldest of them carrying a would-be-top-ranked chunk.
4. **Proof 1:** a query aimed at the transcript phrase returns that `transcript_segment` chunk.
5. **Proof 2:** a query aimed at the takeaway phrase returns that structured chunk.
6. **Proof 3:** every call returns at most 25 rows. Assert on `.length <= 25` across several queries.
7. **Proof 4:** the out-of-window note's chunk is **never** returned, even for a query written to target it exactly.
8. **Proof 5:** the 26th-oldest in-window note's chunk is never returned, proving the `limit 25` pool bound.
9. **Proof 6:** count the Voyage calls made and assert one per query — the query embedding is not being computed twice.
10. Clean up as the owner.

Pace it for a throttled account the way `verify-embeddings-pipeline.mjs` does — read that script's `VOYAGE_MIN_CALL_INTERVAL_MS` handling and reuse the same shape and default.

- [ ] **Step 8: Run it**

```bash
VOYAGE_MIN_CALL_INTERVAL_MS=0 node scripts/verify-chat-search.mjs
```

Expected: six proofs pass. Paste the output into the final report.

- [ ] **Step 9: Commit**

```bash
git add supabase/schemas/search_note_chunks.sql supabase/config.toml scripts/verify-chat-search.mjs
git commit -m "feat(db): hybrid RRF search, RLS-scoped, 90-day/25-note pool"
```

---

## Task 4: `lib/rag/query-embed.ts`

The query side of an asymmetric embedder. Reusing the document embedder degrades ranking **silently, with no error** — which is exactly why this gets its own file and its own test rather than a boolean parameter on the existing one.

**Files:**
- Create: `lib/rag/query-embed.ts`
- Test: `lib/rag/__tests__/query-embed.test.ts`

**Interfaces:**
- Consumes: `VOYAGE_ENDPOINT`, `VOYAGE_MODEL`, `VOYAGE_OUTPUT_DIMENSION`, `VoyageError` from `@/lib/rag/voyage-client`.
- Produces: `export type QueryEmbedder = (text: string) => Promise<number[]>` and `export function createVoyageQueryEmbedder(apiKey: string): QueryEmbedder`.

- [ ] **Step 1: Write the failing test**

Create `lib/rag/__tests__/query-embed.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { createVoyageQueryEmbedder } from "@/lib/rag/query-embed";
import { VoyageError, VOYAGE_OUTPUT_DIMENSION } from "@/lib/rag/voyage-client";

const vector = () => Array.from({ length: VOYAGE_OUTPUT_DIMENSION }, () => 0.1);

function mockFetch(body: unknown, status = 200) {
  const spy = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe("createVoyageQueryEmbedder", () => {
  it("sends input_type 'query' — NOT 'document'", async () => {
    // Voyage is asymmetric. This is the whole reason the file exists: sending
    // "document" for a question degrades ranking with no error at all.
    const spy = mockFetch({ data: [{ index: 0, embedding: vector() }] });
    await createVoyageQueryEmbedder("k")("what did we decide about pricing?");

    const sent = JSON.parse(spy.mock.calls[0][1].body);
    expect(sent.input_type).toBe("query");
    expect(sent.input_type).not.toBe("document");
  });

  it("pins the output dimension and dtype the column requires", async () => {
    const spy = mockFetch({ data: [{ index: 0, embedding: vector() }] });
    await createVoyageQueryEmbedder("k")("q");

    const sent = JSON.parse(spy.mock.calls[0][1].body);
    expect(sent.output_dimension).toBe(1024);
    expect(sent.output_dtype).toBe("float");
  });

  it("sends exactly one text, never an array of many", async () => {
    const spy = mockFetch({ data: [{ index: 0, embedding: vector() }] });
    await createVoyageQueryEmbedder("k")("q");

    const sent = JSON.parse(spy.mock.calls[0][1].body);
    expect(sent.input).toEqual(["q"]);
  });

  it("returns the bare vector, not a one-element array of vectors", async () => {
    mockFetch({ data: [{ index: 0, embedding: vector() }] });
    const got = await createVoyageQueryEmbedder("k")("q");

    expect(Array.isArray(got)).toBe(true);
    expect(got).toHaveLength(VOYAGE_OUTPUT_DIMENSION);
    expect(typeof got[0]).toBe("number");
  });

  it("refuses a vector of the wrong width", async () => {
    mockFetch({ data: [{ index: 0, embedding: [0.1, 0.2] }] });
    await expect(createVoyageQueryEmbedder("k")("q")).rejects.toBeInstanceOf(
      VoyageError,
    );
  });

  it("classifies 429 as transient and 400 as content", async () => {
    mockFetch({ error: "slow down" }, 429);
    await expect(
      createVoyageQueryEmbedder("k")("q"),
    ).rejects.toMatchObject({ kind: "transient" });

    mockFetch({ error: "bad" }, 400);
    await expect(
      createVoyageQueryEmbedder("k")("q"),
    ).rejects.toMatchObject({ kind: "content" });
  });

  it("refuses blank input without spending a call", async () => {
    const spy = mockFetch({ data: [] });
    await expect(createVoyageQueryEmbedder("k")("   ")).rejects.toBeInstanceOf(
      VoyageError,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npm test -- query-embed
```

Expected: FAIL — cannot resolve `@/lib/rag/query-embed`.

- [ ] **Step 3: Write the implementation**

Create `lib/rag/query-embed.ts`:

```ts
/** The QUERY side of Voyage's asymmetric embedding, and the only reason this
 *  file is separate from voyage-client.ts.
 *
 *  Voyage embeds stored content and search questions differently. Stored
 *  content is a "document"; the question asked at retrieval time is a
 *  "query". Sending the wrong one does NOT error — it silently returns a
 *  vector that ranks worse. A boolean parameter on the document embedder
 *  would put both behaviours one typo apart in the same call site, so they
 *  live in separate functions with separate tests instead.
 *
 *  Reads no environment variable, exactly like every other module under
 *  lib/rag/. The caller supplies the key, which is what keeps VOYAGE_API_KEY
 *  out of every client component's import graph. project-conventions.test.ts
 *  fails the build if that stops being true.
 *
 *  The pins are imported rather than restated: the endpoint, the model and
 *  the 1024 width are stated once, in voyage-client.ts, next to the reasons
 *  they were chosen.
 */

import {
  VOYAGE_ENDPOINT,
  VOYAGE_MODEL,
  VOYAGE_OUTPUT_DIMENSION,
  VoyageError,
  type VoyageErrorKind,
} from "./voyage-client";

/** One question in, one vector out. */
export type QueryEmbedder = (text: string) => Promise<number[]>;

function kindFor(status: number): VoyageErrorKind {
  if (status === 401 || status === 403) return "fatal";
  if (status === 429 || status >= 500) return "transient";
  return "content";
}

interface VoyageResponse {
  data?: { embedding?: unknown; index?: unknown }[];
}

export function createVoyageQueryEmbedder(apiKey: string): QueryEmbedder {
  return async (text) => {
    // Blank in, blank out — and no call, because a whitespace question is a
    // client bug rather than something Voyage can answer.
    if (text.trim().length === 0) {
      throw new VoyageError("refusing to embed a blank query", "content", null);
    }

    let response: Response;
    try {
      response = await fetch(VOYAGE_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: [text],
          model: VOYAGE_MODEL,
          // THE reason this file exists. Never "document".
          input_type: "query",
          output_dimension: VOYAGE_OUTPUT_DIMENSION,
          output_dtype: "float",
          truncation: true,
        }),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new VoyageError(
        `voyage query request failed: ${reason}`,
        "transient",
        null,
      );
    }

    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, 300);
      throw new VoyageError(
        `voyage returned ${response.status}: ${body}`,
        kindFor(response.status),
        response.status,
      );
    }

    const payload = (await response.json()) as VoyageResponse;
    const embedding = payload.data?.[0]?.embedding;

    if (
      !Array.isArray(embedding) ||
      embedding.length !== VOYAGE_OUTPUT_DIMENSION
    ) {
      throw new VoyageError(
        `voyage returned a ${
          Array.isArray(embedding) ? embedding.length : "non-array"
        } query vector; note_chunks.embedding is a fixed ` +
          `vector(${VOYAGE_OUTPUT_DIMENSION})`,
        "content",
        response.status,
      );
    }

    return embedding as number[];
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test -- query-embed && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Confirm the no-env-var rule still holds**

```bash
npm test -- project-conventions
```

Expected: PASS. The `lib/rag/*` files-read-no-`process.env` assertion now covers the new file too.

- [ ] **Step 6: Commit**

```bash
git add lib/rag/query-embed.ts lib/rag/__tests__/query-embed.test.ts
git commit -m "feat(rag): embed the question at input_type query, not document"
```

---

## Task 5: Chat limits — length cap, rate window, history trimming

Pure functions, no I/O. These are the two cost ceilings, so they get tested first and hardest.

**Files:**
- Create: `lib/chat/types.ts`
- Create: `lib/chat/limits.ts`
- Test: `lib/chat/__tests__/limits.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `lib/chat/types.ts`: `export type ChatScope = "this_note" | "all_notes"`; `export interface Citation { key: string; chunkId: string; noteId: string; noteTitle: string | null; chunkType: string; tsStart: string | null }`; `export interface ChatTurn { id: string; role: "user" | "assistant"; content: string; scope: ChatScope | null; citations: Citation[]; createdAt: string }`; `export interface SearchHit { chunkId: string; noteId: string; noteTitle: string | null; chunkType: string; content: string; tsStart: string | null; seq: number | null; score: number }`
  - `lib/chat/limits.ts`: `MAX_MESSAGE_CHARS = 4000`; `MAX_MESSAGES_PER_WINDOW = 20`; `RATE_WINDOW_MS = 60_000`; `MAX_HISTORY_TURNS = 20`; `MAX_HISTORY_TOKENS = 8000`; `export function overLengthCap(text: string): boolean`; `export function estimateTokens(text: string): number`; `export function trimHistory(turns: ChatTurn[]): ChatTurn[]`

- [ ] **Step 1: Write `lib/chat/types.ts`**

```ts
/** Types shared by the chat route, its ports, and the client panel.
 *
 *  This module is CLIENT-SAFE by design — the panel is a client component and
 *  must not pull in the server Supabase client, exactly as
 *  lib/notes/default-persona.ts is client-safe for the persona rail. Keep it
 *  types-only: no imports with runtime weight, no environment reads.
 */

/** Which retrieval path a turn used. Single-note stuffs the transcript;
 *  all-notes is the only mode with a search tool. */
export type ChatScope = "this_note" | "all_notes";

/** One resolved citation, persisted onto the assistant row so a `c<n>` chip
 *  still resolves after a reload — long after the tool result that produced
 *  it is gone. */
export interface Citation {
  /** The marker body: "t8" or "c3". */
  key: string;
  chunkId: string;
  noteId: string;
  /** Null until note auto-titling exists. The chip renders "Untitled note". */
  noteTitle: string | null;
  chunkType: string;
  /** "04:12", or null for a structured chunk that has no timestamp. */
  tsStart: string | null;
}

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  scope: ChatScope | null;
  citations: Citation[];
  createdAt: string;
}

/** One row out of search_note_chunks. */
export interface SearchHit {
  chunkId: string;
  noteId: string;
  noteTitle: string | null;
  chunkType: string;
  content: string;
  tsStart: string | null;
  seq: number | null;
  score: number;
}
```

- [ ] **Step 2: Write the failing test**

Create `lib/chat/__tests__/limits.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  MAX_MESSAGE_CHARS,
  MAX_HISTORY_TURNS,
  MAX_HISTORY_TOKENS,
  overLengthCap,
  estimateTokens,
  trimHistory,
} from "@/lib/chat/limits";
import type { ChatTurn } from "@/lib/chat/types";

const turn = (i: number, content = `turn ${i}`): ChatTurn => ({
  id: String(i),
  role: i % 2 === 0 ? "user" : "assistant",
  content,
  scope: "this_note",
  citations: [],
  createdAt: new Date(2026, 8, 3, 0, 0, i).toISOString(),
});

describe("overLengthCap", () => {
  it("accepts exactly 4,000 characters", () => {
    expect(MAX_MESSAGE_CHARS).toBe(4000);
    expect(overLengthCap("x".repeat(4000))).toBe(false);
  });

  it("refuses 4,001 characters", () => {
    expect(overLengthCap("x".repeat(4001))).toBe(true);
  });

  it("counts characters, not trimmed characters", () => {
    // A 4,001-character paste that is mostly whitespace still costs tokens to
    // send. Trimming first would let it through.
    expect(overLengthCap(" ".repeat(4001))).toBe(true);
  });
});

describe("estimateTokens", () => {
  it("is four characters to a token, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("trimHistory", () => {
  it("keeps everything when the history is short", () => {
    const turns = [turn(0), turn(1), turn(2)];
    expect(trimHistory(turns)).toEqual(turns);
  });

  it("keeps only the last 20 turns", () => {
    expect(MAX_HISTORY_TURNS).toBe(20);
    const turns = Array.from({ length: 50 }, (_, i) => turn(i));
    const kept = trimHistory(turns);

    expect(kept).toHaveLength(20);
    expect(kept[0].id).toBe("30");
    expect(kept.at(-1)!.id).toBe("49");
  });

  it("drops oldest-first when 20 turns still exceed the token budget", () => {
    expect(MAX_HISTORY_TOKENS).toBe(8000);
    // 2,000 chars ~= 500 tokens each. 20 of them is 10,000 — over budget.
    const turns = Array.from({ length: 20 }, (_, i) =>
      turn(i, "x".repeat(2000)),
    );
    const kept = trimHistory(turns);

    expect(kept.length).toBeLessThan(20);
    // The NEWEST turn survives. Dropping from the wrong end would throw away
    // the context the answer actually needs.
    expect(kept.at(-1)!.id).toBe("19");
    const total = kept.reduce((n, t) => n + estimateTokens(t.content), 0);
    expect(total).toBeLessThanOrEqual(8000);
  });

  it("keeps at least the newest turn even if it alone busts the budget", () => {
    // A single 4,000-char message is 1,000 tokens and fits. But guard the
    // degenerate case anyway: returning [] would send Claude no user message
    // at all, which is a 400 rather than a graceful degradation.
    const turns = [turn(0, "x".repeat(80_000))];
    expect(trimHistory(turns)).toHaveLength(1);
  });

  it("does not mutate its input", () => {
    const turns = Array.from({ length: 50 }, (_, i) => turn(i));
    const before = turns.length;
    trimHistory(turns);
    expect(turns).toHaveLength(before);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

```bash
npm test -- limits
```

Expected: FAIL — cannot resolve `@/lib/chat/limits`.

- [ ] **Step 4: Write the implementation**

Create `lib/chat/limits.ts`:

```ts
/** The two cost ceilings, as pure functions.
 *
 *  This is a solo-owner app behind session middleware, so the threat here is
 *  NOT an anonymous attacker — that door is already shut. It is a compromised
 *  session or a client bug looping requests, which is why the limits are
 *  cheap, unconditional, and checked before anything is spent.
 */

import type { ChatTurn } from "./types";

/** Anything longer is refused before it reaches embedding or Claude. A large
 *  paste is the cheapest way to inflate both cost and latency. */
export const MAX_MESSAGE_CHARS = 4000;

/** Counted against chat_messages, not a new table — the table this feature
 *  already creates answers the question. */
export const MAX_MESSAGES_PER_WINDOW = 20;
export const RATE_WINDOW_MS = 60_000;

/** How much conversation Claude sees. FULL history stays in chat_messages for
 *  display regardless of what is sent. */
export const MAX_HISTORY_TURNS = 20;
export const MAX_HISTORY_TOKENS = 8000;

export function overLengthCap(text: string): boolean {
  return text.length > MAX_MESSAGE_CHARS;
}

/** Four characters to a token, the usual English rule of thumb. This bounds a
 *  budget; it does not need to be exact, and calling a real tokenizer to
 *  decide how many old turns to drop would cost more than it saves. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Newest-first truncation: take the last MAX_HISTORY_TURNS, then drop from
 *  the OLD end until the token estimate fits.
 *
 *  The newest turn is always kept. Returning an empty array would send Claude
 *  a request with no user message, which is a 400 rather than a graceful
 *  degradation. */
export function trimHistory(turns: ChatTurn[]): ChatTurn[] {
  const recent = turns.slice(-MAX_HISTORY_TURNS);
  if (recent.length === 0) return [];

  let total = recent.reduce((n, t) => n + estimateTokens(t.content), 0);
  let start = 0;
  while (total > MAX_HISTORY_TOKENS && start < recent.length - 1) {
    total -= estimateTokens(recent[start].content);
    start += 1;
  }

  return recent.slice(start);
}
```

- [ ] **Step 5: Run the tests**

```bash
npm test -- limits && npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/chat/types.ts lib/chat/limits.ts lib/chat/__tests__/limits.test.ts
git commit -m "feat(chat): the length cap, the rate window, and history trimming"
```

---

## Task 6: `lib/rag/search-tool.ts`

**Files:**
- Create: `lib/rag/search-tool.ts`
- Test: `lib/rag/__tests__/search-tool.test.ts`

**Interfaces:**
- Consumes: `QueryEmbedder` from `@/lib/rag/query-embed`; `SearchHit` from `@/lib/chat/types`.
- Produces: `export interface SearchPorts { embedQuery: QueryEmbedder; rpc: (vector: string, text: string) => Promise<unknown[]> }`; `export const MAX_SEARCH_RESULTS = 25`; `export async function searchNotes(query: string, ports: SearchPorts): Promise<SearchHit[]>`; `export function createSearchTool(ports: SearchPorts)` returning an AI SDK `tool({...})` whose key is `searchNotes` at the call site.

- [ ] **Step 1: Write the failing test**

Create `lib/rag/__tests__/search-tool.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  searchNotes,
  MAX_SEARCH_RESULTS,
  type SearchPorts,
} from "@/lib/rag/search-tool";

const row = (i: number) => ({
  chunk_id: `chunk-${i}`,
  note_id: `note-${i}`,
  note_title: `Note ${i}`,
  chunk_type: "transcript_segment",
  content: `content ${i}`,
  ts_start: "04:12",
  seq: i,
  score: 1 / (i + 1),
});

const ports = (rows: unknown[]): SearchPorts => ({
  embedQuery: vi.fn(async () => [0.1, 0.2, 0.3]),
  rpc: vi.fn(async () => rows),
});

describe("searchNotes", () => {
  it("sends the vector as a pgvector text literal, not a JSON array", async () => {
    // The vector crosses PostgREST as JSON.stringify(vector) — pgvector's own
    // text input format. A raw array serialises as a JSON array, which is a
    // different type and is rejected.
    const p = ports([row(1)]);
    await searchNotes("pricing", p);

    expect(p.rpc).toHaveBeenCalledWith("[0.1,0.2,0.3]", "pricing");
  });

  it("embeds the query exactly once", async () => {
    const p = ports([row(1)]);
    await searchNotes("pricing", p);
    expect(p.embedQuery).toHaveBeenCalledTimes(1);
  });

  it("maps snake_case rows to camelCase hits", async () => {
    const p = ports([row(1)]);
    const [hit] = await searchNotes("q", p);

    expect(hit).toEqual({
      chunkId: "chunk-1",
      noteId: "note-1",
      noteTitle: "Note 1",
      chunkType: "transcript_segment",
      content: "content 1",
      tsStart: "04:12",
      seq: 1,
      score: 0.5,
    });
  });

  it("caps at 25 even if the database somehow returns more", async () => {
    // The function's own `limit 25` is the real bound. This is the second one,
    // because "all notes" must never be able to fill a context window no
    // matter what happens on the other side of the RPC.
    expect(MAX_SEARCH_RESULTS).toBe(25);
    const p = ports(Array.from({ length: 40 }, (_, i) => row(i)));
    expect(await searchNotes("q", p)).toHaveLength(25);
  });

  it("returns an empty array for no matches — this is not an error", async () => {
    const p = ports([]);
    await expect(searchNotes("q", p)).resolves.toEqual([]);
  });

  it("tolerates a null title and a null ts_start", async () => {
    // Note auto-titling does not exist, so most rows have a null title. A
    // structured chunk has no timestamp at all.
    const p = ports([
      { ...row(1), note_title: null, ts_start: null, chunk_type: "takeaway" },
    ]);
    const [hit] = await searchNotes("q", p);

    expect(hit.noteTitle).toBeNull();
    expect(hit.tsStart).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npm test -- search-tool
```

Expected: FAIL — cannot resolve `@/lib/rag/search-tool`.

- [ ] **Step 3: Write the implementation**

Create `lib/rag/search-tool.ts`:

```ts
/** The search_notes tool: the ONLY retrieval consumer in this app.
 *
 *  It exists only in all-notes mode, which is why it takes no scope
 *  parameter — a parameter would be a second way to say something the tool's
 *  presence already says.
 *
 *  Reads no environment variable, like every module under lib/rag/. The
 *  caller supplies the embedder and the RPC.
 */

import { tool } from "ai";
import { z } from "zod";
import type { QueryEmbedder } from "./query-embed";
import type { SearchHit } from "@/lib/chat/types";

/** The second cap. search_note_chunks already limits to 25; this holds even
 *  if that function is edited, because "all notes" must never be able to fill
 *  a context window. */
export const MAX_SEARCH_RESULTS = 25;

export interface SearchPorts {
  embedQuery: QueryEmbedder;
  /** Runs search_note_chunks. `vector` is already a pgvector text literal. */
  rpc: (vector: string, text: string) => Promise<unknown[]>;
}

interface SearchRow {
  chunk_id: string;
  note_id: string;
  note_title: string | null;
  chunk_type: string;
  content: string;
  ts_start: string | null;
  seq: number | null;
  score: number;
}

export async function searchNotes(
  query: string,
  ports: SearchPorts,
): Promise<SearchHit[]> {
  const vector = await ports.embedQuery(query);

  // pgvector's own text input format. A raw array would serialise as a JSON
  // array, which PostgREST hands over as a different type entirely.
  const rows = (await ports.rpc(JSON.stringify(vector), query)) as SearchRow[];

  return rows.slice(0, MAX_SEARCH_RESULTS).map((r) => ({
    chunkId: r.chunk_id,
    noteId: r.note_id,
    noteTitle: r.note_title,
    chunkType: r.chunk_type,
    content: r.content,
    tsStart: r.ts_start,
    seq: r.seq,
    score: r.score,
  }));
}

/** The AI SDK tool. Register it under the key `searchNotes`, which is what
 *  makes the client-side part type `tool-searchNotes`. */
export function createSearchTool(ports: SearchPorts) {
  return tool({
    description:
      "Search the user's own notes for passages relevant to a question. " +
      "Returns numbered results; cite one by writing [[cite:cN]] where N is " +
      "the result number. Returns an empty list when nothing matches, which " +
      "means the notes genuinely do not cover it.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("A natural-language search query, in the user's own words."),
    }),
    execute: async ({ query }) => {
      const hits = await searchNotes(query, ports);
      return {
        resultCount: hits.length,
        results: hits.map((hit, i) => ({
          n: i + 1,
          citeKey: `c${i + 1}`,
          noteTitle: hit.noteTitle ?? "Untitled note",
          chunkType: hit.chunkType,
          tsStart: hit.tsStart,
          content: hit.content,
          // Carried so onFinish can build the persisted citation map without
          // a second lookup.
          chunkId: hit.chunkId,
          noteId: hit.noteId,
        })),
      };
    },
  });
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test -- search-tool && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rag/search-tool.ts lib/rag/__tests__/search-tool.test.ts
git commit -m "feat(rag): the search_notes tool, capped at 25 on both sides"
```

---

## Task 7: Context building and history flattening

**Files:**
- Create: `lib/chat/context.ts`
- Test: `lib/chat/__tests__/context.test.ts`

**Interfaces:**
- Consumes: `ChatTurn`, `ChatScope` from `@/lib/chat/types`; `Segment` from `@/lib/notes/view-types`.
- Produces: `export interface NoteContext { rawTranscript: string | null; segments: { seq: number; time: string; speaker: string; text: string }[]; summary: string[]; takeaways: string[]; actionItems: string[] }`; `export function buildTranscriptBlock(ctx: NoteContext): string`; `export function flattenHistory(turns: ChatTurn[]): { role: "user" | "assistant"; content: string }[]`; `export const THIS_NOTE_SYSTEM: string`; `export const ALL_NOTES_SYSTEM: string`.

- [ ] **Step 1: Write the failing test**

Create `lib/chat/__tests__/context.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildTranscriptBlock,
  flattenHistory,
  THIS_NOTE_SYSTEM,
  ALL_NOTES_SYSTEM,
  type NoteContext,
} from "@/lib/chat/context";
import type { ChatTurn } from "@/lib/chat/types";

const ctx = (over: Partial<NoteContext> = {}): NoteContext => ({
  rawTranscript: "Alice: we should raise the price.",
  segments: [
    { seq: 1, time: "00:00", speaker: "Alice", text: "we should raise it" },
    { seq: 8, time: "04:12", speaker: "Bob", text: "by how much though" },
  ],
  summary: ["Pricing was discussed."],
  takeaways: ["Raise the price."],
  actionItems: ["Bob to model the change."],
  ...over,
});

const turn = (
  role: "user" | "assistant",
  content: string,
  scope: ChatTurn["scope"] = "this_note",
): ChatTurn => ({
  id: Math.random().toString(),
  role,
  content,
  scope,
  citations: [],
  createdAt: "2026-09-03T00:00:00.000Z",
});

describe("buildTranscriptBlock", () => {
  it("numbers each segment so Claude has a stable id to cite", () => {
    const block = buildTranscriptBlock(ctx());
    expect(block).toContain("[1] 00:00 Alice:");
    expect(block).toContain("[8] 04:12 Bob:");
  });

  it("is byte-stable across calls — nothing volatile may enter it", () => {
    // The cache is a prefix match. A timestamp, a turn counter or a random id
    // anywhere in this block means cache_read_input_tokens is zero forever
    // and the 5-minute breakpoint buys nothing.
    expect(buildTranscriptBlock(ctx())).toBe(buildTranscriptBlock(ctx()));
  });

  it("works with NO generated notes at all", () => {
    // The whole point of the single-note path: it depends on the transcript
    // and nothing else. notegen may be null, 'generating' or 'failed'.
    const block = buildTranscriptBlock(
      ctx({ summary: [], takeaways: [], actionItems: [] }),
    );
    expect(block).toContain("[1] 00:00 Alice:");
    expect(block.length).toBeGreaterThan(0);
  });

  it("includes generated notes when they exist", () => {
    const block = buildTranscriptBlock(ctx());
    expect(block).toContain("Raise the price.");
    expect(block).toContain("Bob to model the change.");
  });

  it("never mentions notegen status", () => {
    const block = buildTranscriptBlock(ctx());
    expect(block).not.toMatch(/notegen|generating|failed/i);
  });
});

describe("flattenHistory", () => {
  it("keeps role and content and nothing else", () => {
    const flat = flattenHistory([turn("user", "hi"), turn("assistant", "hey")]);
    expect(flat).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hey" },
    ]);
  });

  it("carries no tool scaffolding from an all-notes turn", () => {
    // A thread that ran all-notes turns and then switches to this-note must
    // not carry tool blocks forward, and vice versa. Flattening to plain text
    // is what makes "re-derive per turn" true rather than aspirational.
    const flat = flattenHistory([
      turn("user", "what did we say about pricing", "all_notes"),
      turn("assistant", "You raised it [[cite:c1]].", "all_notes"),
      turn("user", "and in this meeting?", "this_note"),
    ]);

    expect(flat.every((m) => typeof m.content === "string")).toBe(true);
    expect(JSON.stringify(flat)).not.toContain("tool");
    expect(JSON.stringify(flat)).not.toContain("searchNotes");
  });

  it("leaves citation markers in the text", () => {
    // They are prose to Claude and data to the renderer. Stripping them here
    // would make the model think its earlier answer had no sources.
    const [, assistant] = flattenHistory([
      turn("user", "q"),
      turn("assistant", "yes [[cite:t8]]."),
    ]);
    expect(assistant.content).toContain("[[cite:t8]]");
  });

  it("drops a blank turn rather than sending an empty message", () => {
    const flat = flattenHistory([turn("user", "  "), turn("assistant", "hi")]);
    expect(flat).toEqual([{ role: "assistant", content: "hi" }]);
  });
});

describe("system prompts", () => {
  it("tells Claude not to answer from general knowledge on an empty search", () => {
    // Genuinely-empty retrieval is a normal answer, not an error — but only
    // if Claude says so instead of filling the gap.
    expect(ALL_NOTES_SYSTEM).toMatch(/general knowledge/i);
    expect(ALL_NOTES_SYSTEM).toMatch(/\[\[cite:cN\]\]|\[\[cite:c/);
  });

  it("teaches the this-note marker form and not the cross-note one", () => {
    expect(THIS_NOTE_SYSTEM).toMatch(/\[\[cite:t/);
    expect(THIS_NOTE_SYSTEM).not.toMatch(/\[\[cite:c/);
  });

  it("names no brand", () => {
    for (const s of [THIS_NOTE_SYSTEM, ALL_NOTES_SYSTEM]) {
      expect(s).not.toMatch(/squid|ink/i);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npm test -- context
```

Expected: FAIL — cannot resolve `@/lib/chat/context`.

- [ ] **Step 3: Write the implementation**

Create `lib/chat/context.ts`:

```ts
/** Per-turn context construction. Called fresh on every request, from that
 *  turn's OWN scope — never carried forward.
 */

import type { ChatTurn } from "./types";

export interface NoteContext {
  rawTranscript: string | null;
  segments: { seq: number; time: string; speaker: string; text: string }[];
  summary: string[];
  takeaways: string[];
  actionItems: string[];
}

/** The cached block. MUST be byte-stable across turns of one conversation:
 *  prompt caching is a prefix match, so a timestamp, a turn counter or any
 *  other volatile value in here means the cache never hits and the 5-minute
 *  breakpoint buys nothing at all.
 *
 *  Segments carry their `seq` in square brackets so Claude has a stable id to
 *  cite as [[cite:tN]].
 *
 *  Generated notes are included when they exist and simply absent when they
 *  do not. There is deliberately NO branch on notegen_status — that absence
 *  is what makes "single-note chat works the instant transcription finishes"
 *  structural rather than a claim. */
export function buildTranscriptBlock(ctx: NoteContext): string {
  const parts: string[] = ["<transcript>"];

  for (const s of ctx.segments) {
    parts.push(`[${s.seq}] ${s.time} ${s.speaker}: ${s.text}`);
  }

  // Only when there are no diarized segments at all — an undiarized note
  // still has a raw transcript, and answering from it beats answering from
  // nothing.
  if (ctx.segments.length === 0 && ctx.rawTranscript) {
    parts.push(ctx.rawTranscript);
  }

  parts.push("</transcript>");

  const section = (label: string, items: string[]) => {
    if (items.length === 0) return;
    parts.push(`<${label}>`);
    for (const item of items) parts.push(`- ${item}`);
    parts.push(`</${label}>`);
  };

  section("summary", ctx.summary);
  section("takeaways", ctx.takeaways);
  section("action_items", ctx.actionItems);

  return parts.join("\n");
}

/** History → plain text messages. Tool scaffolding is DROPPED, not carried.
 *
 *  This is what lets a thread switch between this-note and all-notes without
 *  leaking the other mode's shape into the request. Citation markers are left
 *  in the text on purpose: they are prose to Claude and data to the renderer,
 *  and stripping them would make the model believe its earlier answer had no
 *  sources. */
export function flattenHistory(
  turns: ChatTurn[],
): { role: "user" | "assistant"; content: string }[] {
  return turns
    .filter((t) => t.content.trim().length > 0)
    .map((t) => ({ role: t.role, content: t.content }));
}

export const THIS_NOTE_SYSTEM = [
  "You answer questions about ONE meeting note. The full transcript and any",
  "generated notes are provided in the user message.",
  "",
  "Cite the transcript. Write [[cite:tN]] immediately after a claim, where N",
  "is the bracketed segment number from the transcript — [[cite:t8]] for the",
  "line marked [8]. Cite only numbers that appear in the transcript.",
  "",
  "If the transcript does not cover something, say so plainly. Do not answer",
  "from general knowledge and do not invent a segment number.",
  "",
  "Be concise. This is a reading surface, not a chat toy.",
].join("\n");

export const ALL_NOTES_SYSTEM = [
  "You answer questions across the user's own notes. You have one tool,",
  "search_notes. Call it whenever the question is about what was said,",
  "decided or agreed — you cannot see any note until you do.",
  "",
  "Cite results. Write [[cite:cN]] immediately after a claim, where N is the",
  "result number from the search results. Cite only numbers that were",
  "actually returned.",
  "",
  "If a search returns no results, say that nothing in the user's notes",
  "matches, and stop. Do NOT answer from general knowledge — an empty search",
  "is a real and useful answer, and filling the gap makes it a wrong one.",
  "",
  "Be concise. This is a reading surface, not a chat toy.",
].join("\n");
```

- [ ] **Step 4: Run the tests**

```bash
npm test -- context && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/chat/context.ts lib/chat/__tests__/context.test.ts
git commit -m "feat(chat): per-turn context, and history flattened to plain text"
```

---

## Task 8: The streaming route

**Files:**
- Create: `lib/chat/ports.ts`
- Create: `lib/chat/citations.ts`
- Create: `app/api/chat/route.ts`
- Test: `lib/chat/__tests__/citations.test.ts`
- Test: `app/api/chat/__tests__/route.test.ts`
- Modify: `components/note-detail/__tests__/project-conventions.test.ts` (unskip)

**Interfaces:**
- Consumes: everything from Tasks 4–7.
- Produces: `POST /api/chat` accepting `{ noteId: string; scope: ChatScope; text: string }` and returning a UI message stream, `400`, `401`, `429`, or `500`. `lib/chat/ports.ts` exports `createChatPorts(supabase)` with `readHistory(noteId)`, `countRecentUserMessages()`, `insertUserMessage(...)`, `insertAssistantMessage(...)`, `readNoteContext(noteId)`, `searchRpc(vector, text)`. `lib/chat/citations.ts` exports `citationsFromSteps(steps: unknown[]): Citation[]`.

- [ ] **Step 1: Write the failing citations test**

Create `lib/chat/__tests__/citations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { citationsFromSteps } from "@/lib/chat/citations";

const step = (results: unknown[]) => ({
  toolResults: [{ toolName: "searchNotes", output: { results } }],
});

describe("citationsFromSteps", () => {
  it("builds one citation per returned result", () => {
    const got = citationsFromSteps([
      step([
        {
          n: 1,
          citeKey: "c1",
          chunkId: "ch-1",
          noteId: "n-1",
          noteTitle: "Pricing sync",
          chunkType: "transcript_segment",
          tsStart: "04:12",
        },
      ]),
    ]);

    expect(got).toEqual([
      {
        key: "c1",
        chunkId: "ch-1",
        noteId: "n-1",
        noteTitle: "Pricing sync",
        chunkType: "transcript_segment",
        tsStart: "04:12",
      },
    ]);
  });

  it("returns an empty array when no tool ran — the this-note path", () => {
    expect(citationsFromSteps([{ toolResults: [] }])).toEqual([]);
    expect(citationsFromSteps([])).toEqual([]);
  });

  it("merges results across several tool calls, keeping later keys distinct", () => {
    // Claude may search twice in one turn. Each call restarts its own
    // numbering, so the second call's c1 must not overwrite the first's.
    const got = citationsFromSteps([
      step([{ n: 1, citeKey: "c1", chunkId: "a", noteId: "n", noteTitle: null, chunkType: "takeaway", tsStart: null }]),
      step([{ n: 1, citeKey: "c1", chunkId: "b", noteId: "n", noteTitle: null, chunkType: "takeaway", tsStart: null }]),
    ]);

    expect(got).toHaveLength(1);
    expect(got[0].chunkId).toBe("a");
  });

  it("survives a malformed tool result without throwing", () => {
    expect(citationsFromSteps([{ toolResults: [{ output: null }] }])).toEqual([]);
    expect(citationsFromSteps([{}])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npm test -- citations
```

Expected: FAIL — cannot resolve `@/lib/chat/citations`.

- [ ] **Step 3: Write `lib/chat/citations.ts`**

```ts
/** Turn a finished run's tool results into the citation map persisted onto
 *  the assistant row.
 *
 *  This is what makes a `c<n>` chip still resolve after a page reload, when
 *  the tool result that produced it no longer exists anywhere.
 *
 *  Defensive by design: this runs in onFinish, AFTER the answer has already
 *  streamed to the user. Throwing here would lose a persisted message over a
 *  shape mismatch, so every branch degrades to "no citations" instead. */

import type { Citation } from "./types";

interface ToolResultShape {
  toolResults?: { output?: unknown }[];
}

interface ResultRow {
  citeKey?: unknown;
  chunkId?: unknown;
  noteId?: unknown;
  noteTitle?: unknown;
  chunkType?: unknown;
  tsStart?: unknown;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function citationsFromSteps(steps: unknown[]): Citation[] {
  const byKey = new Map<string, Citation>();

  for (const step of steps as ToolResultShape[]) {
    for (const result of step?.toolResults ?? []) {
      const output = result?.output as { results?: unknown } | null | undefined;
      const rows = Array.isArray(output?.results) ? output.results : [];

      for (const raw of rows as ResultRow[]) {
        const key = str(raw?.citeKey);
        const chunkId = str(raw?.chunkId);
        const noteId = str(raw?.noteId);
        if (!key || !chunkId || !noteId) continue;

        // First write wins. Claude may search twice in one turn and each call
        // restarts its numbering at c1; the earlier result is the one its
        // earlier prose cites.
        if (byKey.has(key)) continue;

        byKey.set(key, {
          key,
          chunkId,
          noteId,
          noteTitle: str(raw?.noteTitle),
          chunkType: str(raw?.chunkType) ?? "unknown",
          tsStart: str(raw?.tsStart),
        });
      }
    }
  }

  return [...byKey.values()];
}
```

- [ ] **Step 4: Run it**

```bash
npm test -- citations
```

Expected: PASS.

- [ ] **Step 5: Write `lib/chat/ports.ts`**

The one Supabase implementation, kept out of the route for the same reason `lib/transcription/supabase-ports.ts` is.

```ts
/** The one Supabase implementation of everything chat reads and writes.
 *
 *  Kept out of the route for the same reason lib/transcription/
 *  supabase-ports.ts is: the route should be readable as a sequence of gates,
 *  and the queries should be testable and greppable in one place.
 *
 *  NO QUERY HERE FILTERS ON user_id. RLS supplies it. A redundant filter
 *  would mask an RLS failure instead of exposing it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatScope, ChatTurn, Citation } from "./types";
import { RATE_WINDOW_MS } from "./limits";
import type { NoteContext } from "./context";

export function createChatPorts(supabase: SupabaseClient) {
  return {
    /** Full history for display and for the model. Oldest first. */
    async readHistory(noteId: string): Promise<ChatTurn[]> {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id, role, content, scope, metadata, created_at")
        .eq("note_id", noteId)
        .order("created_at", { ascending: true });
      if (error) throw error;

      return (data ?? []).map((row) => ({
        id: row.id as string,
        role: row.role as "user" | "assistant",
        content: row.content as string,
        scope: (row.scope as ChatScope | null) ?? null,
        citations:
          ((row.metadata as { citations?: Citation[] } | null)?.citations ??
            []),
        createdAt: row.created_at as string,
      }));
    },

    /** The rate limit. RLS scopes it to the caller — no user_id filter. */
    async countRecentUserMessages(): Promise<number> {
      const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
      const { count, error } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("role", "user")
        .gt("created_at", since);
      if (error) throw error;
      return count ?? 0;
    },

    async insertUserMessage(
      noteId: string,
      userId: string,
      content: string,
      scope: ChatScope,
    ): Promise<void> {
      const { error } = await supabase.from("chat_messages").insert({
        note_id: noteId,
        user_id: userId,
        role: "user",
        content,
        scope,
      });
      if (error) throw error;
    },

    async insertAssistantMessage(
      noteId: string,
      userId: string,
      content: string,
      scope: ChatScope,
      citations: Citation[],
    ): Promise<void> {
      const { error } = await supabase.from("chat_messages").insert({
        note_id: noteId,
        user_id: userId,
        role: "assistant",
        content,
        scope,
        metadata: { citations },
      });
      if (error) throw error;
    },

    /** The single-note context. Reads the transcript and the generated
     *  chunks; deliberately does NOT read notegen_status. */
    async readNoteContext(noteId: string): Promise<NoteContext | null> {
      const { data: note, error: noteError } = await supabase
        .from("notes")
        .select("raw_transcript")
        .eq("id", noteId)
        .maybeSingle();
      if (noteError) throw noteError;
      if (!note) return null;

      const { data: chunks, error: chunkError } = await supabase
        .from("note_chunks")
        .select("chunk_type, content, metadata")
        .eq("note_id", noteId);
      if (chunkError) throw chunkError;

      const rows = chunks ?? [];
      const ofType = (t: string) =>
        rows.filter((r) => r.chunk_type === t).map((r) => r.content as string);

      const segments = rows
        .filter((r) => r.chunk_type === "transcript_segment")
        .map((r) => {
          const m = (r.metadata ?? {}) as {
            seq?: number;
            ts_start?: string;
            speaker?: { name?: string };
          };
          return {
            seq: m.seq ?? 0,
            time: m.ts_start ?? "00:00",
            speaker: m.speaker?.name ?? "Unknown",
            text: r.content as string,
          };
        })
        .sort((a, b) => a.seq - b.seq);

      return {
        rawTranscript: (note.raw_transcript as string | null) ?? null,
        segments,
        summary: ofType("summary"),
        takeaways: ofType("takeaway"),
        actionItems: ofType("action_item"),
      };
    },

    async searchRpc(vector: string, text: string): Promise<unknown[]> {
      const { data, error } = await supabase.rpc("search_note_chunks", {
        query_embedding: vector,
        query_text: text,
      });
      if (error) throw error;
      return (data ?? []) as unknown[];
    },
  };
}

export type ChatPorts = ReturnType<typeof createChatPorts>;
```

- [ ] **Step 6: Write the failing route test**

Create `app/api/chat/__tests__/route.test.ts`. It reads the route's source text for the invariants that are about *what the route does not do* — the same blunt-but-decisive style `project-conventions.test.ts` already uses — and unit-tests the gate ordering through the exported helper.

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE = readFileSync(
  path.resolve(import.meta.dirname, "../route.ts"),
  "utf8",
);

describe("app/api/chat/route.ts invariants", () => {
  it("never forwards reasoning to the client", () => {
    // Reasoning is a separate part type, and the renderer ignores it — but
    // sendReasoning: true would put chain-of-thought on the wire beside
    // "Searching your notes…". Three layers; this is the second.
    expect(SOURCE).not.toMatch(/sendReasoning/);
  });

  it("uses isStepCount, not the older stepCountIs name", () => {
    // stepCountIs does not exist in ai 7.x. Without a working stop condition
    // the run halts after the tool call and never writes an answer.
    expect(SOURCE).toMatch(/isStepCount\(/);
    expect(SOURCE).not.toMatch(/stepCountIs/);
  });

  it("never sends budget_tokens — Sonnet 5 answers 400", () => {
    expect(SOURCE).not.toMatch(/budget_tokens/);
  });

  it("pins the model id exactly, with no date suffix", () => {
    expect(SOURCE).toMatch(/"claude-sonnet-5"/);
    expect(SOURCE).not.toMatch(/claude-sonnet-5-\d/);
  });

  it("sets the ephemeral cache breakpoint on the transcript block", () => {
    expect(SOURCE).toMatch(/cacheControl:\s*\{\s*type:\s*"ephemeral"\s*\}/);
  });

  it("does not filter any query on user_id", () => {
    // RLS supplies it. A redundant filter masks an RLS failure.
    expect(SOURCE).not.toMatch(/user_id/);
  });

  it("checks length and rate BEFORE embedding or streaming", () => {
    const lengthAt = SOURCE.indexOf("overLengthCap");
    const rateAt = SOURCE.indexOf("countRecentUserMessages");
    const streamAt = SOURCE.indexOf("streamText");

    expect(lengthAt).toBeGreaterThan(-1);
    expect(rateAt).toBeGreaterThan(-1);
    expect(lengthAt).toBeLessThan(streamAt);
    expect(rateAt).toBeLessThan(streamAt);
  });

  it("reads history from the database, not from the request body", () => {
    // The client posts its whole message array. Trusting it would let a
    // forged 500-turn history walk past trimHistory — one of the two cost
    // ceilings this feature exists to hold.
    expect(SOURCE).toMatch(/readHistory/);
    expect(SOURCE).toMatch(/trimHistory/);
    expect(SOURCE).not.toMatch(/body\.messages|\bmessages\s*\}\s*=\s*await req/);
  });
});
```

- [ ] **Step 7: Run it and confirm it fails**

```bash
npm test -- api/chat
```

Expected: FAIL — `../route.ts` does not exist.

- [ ] **Step 8: Write the route**

Create `app/api/chat/route.ts`:

```ts
/** Ask-your-notes chat.
 *
 *  Gates in cheapest-first order, so an abusive or broken client is refused
 *  before anything is spent. See docs/superpowers/specs/
 *  2026-09-03-ask-your-notes-chat-design.md § 4.
 *
 *  This is the ONLY shipped file that reads ANTHROPIC_API_KEY, and the third
 *  and last that reads VOYAGE_API_KEY. project-conventions.test.ts fails the
 *  build if either stops being true.
 */

import {
  streamText,
  isStepCount,
  createUIMessageStreamResponse,
  toUIMessageStream,
} from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createClient } from "@/lib/supabase/server";
import { createChatPorts } from "@/lib/chat/ports";
import { citationsFromSteps } from "@/lib/chat/citations";
import {
  overLengthCap,
  trimHistory,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES_PER_WINDOW,
} from "@/lib/chat/limits";
import {
  buildTranscriptBlock,
  flattenHistory,
  THIS_NOTE_SYSTEM,
  ALL_NOTES_SYSTEM,
} from "@/lib/chat/context";
import { createVoyageQueryEmbedder } from "@/lib/rag/query-embed";
import { createSearchTool } from "@/lib/rag/search-tool";
import type { ChatScope } from "@/lib/chat/types";

/** A chat turn is seconds, not minutes. Well inside Vercel Hobby's 300 s
 *  hard ceiling — see docs/DEPLOYMENT.md for how that number was measured. */
export const maxDuration = 60;

const MODEL = "claude-sonnet-5";

const bad = (status: number, message: string) =>
  Response.json({ error: message }, { status });

export async function POST(req: Request) {
  // 1. Auth. The session middleware already protects this path; this is the
  //    in-route half, so a fetch gets JSON rather than a login page's HTML.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return bad(401, "Sign in to use chat.");

  // The client posts its whole message array. We take the newest message and
  // the scope, and NOTHING else — history is re-read from the database below.
  const body = (await req.json().catch(() => null)) as {
    noteId?: string;
    scope?: ChatScope;
    text?: string;
  } | null;

  const noteId = body?.noteId;
  const text = body?.text ?? "";
  const scope: ChatScope = body?.scope === "all_notes" ? "all_notes" : "this_note";

  if (!noteId) return bad(400, "Missing note.");
  if (text.trim().length === 0) return bad(400, "Ask a question first.");

  // 2. Length cap, before any embedding and any model call.
  if (overLengthCap(text)) {
    return bad(
      400,
      `That message is too long. Keep it under ${MAX_MESSAGE_CHARS} characters.`,
    );
  }

  const ports = createChatPorts(supabase);

  // 3. Rate limit. One query against a table this feature already creates.
  const recent = await ports.countRecentUserMessages();
  if (recent >= MAX_MESSAGES_PER_WINDOW) {
    return bad(
      429,
      "You are sending messages faster than this can answer them. " +
        "Wait a minute and try again.",
    );
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return bad(500, "Chat is not configured.");

  // 4. Persist the user's turn, then read history back. The insert lands
  //    first so the newest message is part of the history we send.
  await ports.insertUserMessage(noteId, user.id, text, scope);
  const history = trimHistory(await ports.readHistory(noteId));

  // 5. Build this turn's context from THIS turn's scope. Nothing is carried.
  const anthropic = createAnthropic({ apiKey: anthropicKey });
  const flat = flattenHistory(history);

  let system = ALL_NOTES_SYSTEM;
  let messages: Parameters<typeof streamText>[0]["messages"] = flat;
  let tools: Record<string, unknown> | undefined;

  if (scope === "this_note") {
    const ctx = await ports.readNoteContext(noteId);
    if (!ctx) return bad(404, "Note not found.");

    system = THIS_NOTE_SYSTEM;
    const older = flat.slice(0, -1);
    const newest = flat.at(-1);

    messages = [
      ...older,
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildTranscriptBlock(ctx),
            // The 5-minute breakpoint. Byte-stable across turns, so a
            // multi-turn conversation pays full input price for the
            // transcript once.
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral" } },
            },
          },
          { type: "text", text: newest?.content ?? text },
        ],
      },
    ] as typeof messages;
  } else {
    const voyageKey = process.env.VOYAGE_API_KEY;
    if (!voyageKey) return bad(500, "Search is not configured.");

    tools = {
      searchNotes: createSearchTool({
        embedQuery: createVoyageQueryEmbedder(voyageKey),
        rpc: (vector, query) => ports.searchRpc(vector, query),
      }),
    };
  }

  const result = streamText({
    model: anthropic(MODEL),
    system,
    messages,
    // Sonnet 5 removed budget_tokens and answers 400 if it is sent.
    providerOptions: { anthropic: { thinking: { type: "adaptive" } } },
    ...(tools ? { tools, stopWhen: isStepCount(5) } : {}),
    onFinish: async ({ text: answer, steps }) => {
      try {
        await ports.insertAssistantMessage(
          noteId,
          user.id,
          answer,
          scope,
          citationsFromSteps(steps ?? []),
        );
      } catch (error) {
        // The answer has already streamed. Losing the persisted copy is bad;
        // throwing here would also break the stream, which is worse.
        console.error("[chat] failed to persist the assistant turn", error);
      }
    },
  });

  // sendReasoning is deliberately NOT set. Reasoning is a separate part type
  // and the renderer ignores it, but leaving it off keeps chain-of-thought
  // off the wire entirely.
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
```

- [ ] **Step 9: Run the route tests**

```bash
npm test -- api/chat && npm run typecheck
```

Expected: PASS. If typecheck complains about the `messages` union, narrow with the SDK's own `ModelMessage[]` type rather than widening to `any`.

- [ ] **Step 10: Unskip the conventions guards from Task 1**

Remove the `.skip` and the "UNSKIP IN TASK 8" comments from both reader tests in `components/note-detail/__tests__/project-conventions.test.ts`.

- [ ] **Step 11: Run the full suite**

```bash
npm test && npm run typecheck && npm run build
```

Expected: PASS, nothing skipped.

- [ ] **Step 12: Commit**

```bash
git add lib/chat/ports.ts lib/chat/citations.ts app/api/chat lib/chat/__tests__/citations.test.ts components/note-detail/__tests__/project-conventions.test.ts
git commit -m "feat(chat): the streaming route, gated cheapest-check-first"
```

---

## Task 9: Citation parsing and the ungrounded floor

**Files:**
- Create: `components/note-detail/chat/parse-citations.ts`
- Test: `components/note-detail/chat/__tests__/parse-citations.test.ts`

**Interfaces:**
- Consumes: `Citation` from `@/lib/chat/types`; `CiteRun` from `@/lib/notes/view-types`.
- Produces: `export interface ChatCiteRun { text: string; cite?: { kind: "segment"; segmentId: number; time: string } | { kind: "note"; noteId: string; noteTitle: string; label: string } }`; `export interface ParsedAnswer { runs: ChatCiteRun[]; markerCount: number; resolvedCount: number; ungrounded: boolean }`; `export function parseAnswer(text: string, citations: Citation[], segments: { id: number; time: string }[]): ParsedAnswer`.

- [ ] **Step 1: Write the failing test**

Create `components/note-detail/chat/__tests__/parse-citations.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { parseAnswer } from "@/components/note-detail/chat/parse-citations";
import type { Citation } from "@/lib/chat/types";

const segments = [
  { id: 1, time: "00:00" },
  { id: 8, time: "04:12" },
];

const cite = (over: Partial<Citation> = {}): Citation => ({
  key: "c1",
  chunkId: "ch-1",
  noteId: "n-1",
  noteTitle: "Pricing sync",
  chunkType: "transcript_segment",
  tsStart: "04:12",
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("parseAnswer — this-note markers", () => {
  it("splits prose around a [[cite:t8]] marker", () => {
    const { runs } = parseAnswer("We raised it [[cite:t8]] last week.", [], segments);

    expect(runs).toHaveLength(2);
    expect(runs[0].text).toBe("We raised it ");
    expect(runs[0].cite).toEqual({ kind: "segment", segmentId: 8, time: "04:12" });
    expect(runs[1].text).toBe(" last week.");
    expect(runs[1].cite).toBeUndefined();
  });

  it("drops a segment marker that is not on this page", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runs, resolvedCount } = parseAnswer(
      "Nope [[cite:t99]] here.",
      [],
      segments,
    );

    expect(runs.map((r) => r.text).join("")).toBe("Nope  here.");
    expect(runs.every((r) => r.cite === undefined)).toBe(true);
    expect(resolvedCount).toBe(0);
    expect(warn).toHaveBeenCalled();
  });
});

describe("parseAnswer — cross-note markers", () => {
  it("resolves [[cite:c1]] to a note link", () => {
    const { runs } = parseAnswer("They agreed [[cite:c1]].", [cite()], segments);

    expect(runs[0].cite).toEqual({
      kind: "note",
      noteId: "n-1",
      noteTitle: "Pricing sync",
      label: "Pricing sync 04:12",
    });
  });

  it("labels a structured chunk by type, not by a timestamp it lacks", () => {
    const { runs } = parseAnswer(
      "They agreed [[cite:c1]].",
      [cite({ chunkType: "takeaway", tsStart: null })],
      segments,
    );

    expect(runs[0].cite).toMatchObject({ label: "Pricing sync · Takeaway" });
  });

  it("falls back to 'Untitled note' — auto-titling does not exist yet", () => {
    const { runs } = parseAnswer(
      "See [[cite:c1]].",
      [cite({ noteTitle: null })],
      segments,
    );

    expect(runs[0].cite).toMatchObject({ noteTitle: "Untitled note" });
  });
});

describe("parseAnswer — the ungrounded floor", () => {
  it("warns on every dropped marker", () => {
    // Silent is right for a malformed marker. It is WRONG when the cause is a
    // deleted chunk or a removed note — the failure must stay visible to
    // whoever is debugging it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    parseAnswer("a [[cite:c9]] b [[cite:t99]] c", [], segments);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("flags ungrounded when a message's citations ALL fail", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // The note was deleted mid-conversation. Rendering this as a clean answer
    // would make it read as better-sourced than it is.
    const parsed = parseAnswer("They agreed [[cite:c1]].", [], segments);

    expect(parsed.markerCount).toBe(1);
    expect(parsed.resolvedCount).toBe(0);
    expect(parsed.ungrounded).toBe(true);
  });

  it("does NOT flag ungrounded when some citations resolve", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Drawing a warning on a mostly-grounded answer trains it to be ignored.
    const parsed = parseAnswer(
      "One [[cite:c1]] and two [[cite:c9]].",
      [cite()],
      segments,
    );

    expect(parsed.resolvedCount).toBe(1);
    expect(parsed.ungrounded).toBe(false);
  });

  it("does NOT flag ungrounded for an answer with no markers at all", () => {
    // "Nothing in your notes matches that" is a legitimate, correct answer.
    const parsed = parseAnswer("Nothing in your notes matches that.", [], segments);

    expect(parsed.markerCount).toBe(0);
    expect(parsed.ungrounded).toBe(false);
  });

  it("still returns the prose when everything fails", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Withholding the answer would be worse than showing it unsourced.
    const parsed = parseAnswer("They agreed [[cite:c1]].", [], segments);
    expect(parsed.runs.map((r) => r.text).join("")).toContain("They agreed");
  });
});

describe("parseAnswer — streaming safety", () => {
  it("leaves a half-arrived marker as plain text rather than eating it", () => {
    // Mid-stream the text can end in "[[cite:c". Consuming it would make the
    // last words of every answer flicker.
    const { runs } = parseAnswer("We agreed [[cite:c", [cite()], segments);
    expect(runs.map((r) => r.text).join("")).toBe("We agreed [[cite:c");
  });

  it("handles an empty string", () => {
    expect(parseAnswer("", [], segments).runs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npm test -- parse-citations
```

Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

Create `components/note-detail/chat/parse-citations.ts`:

```ts
/** Marker text in, renderable runs out.
 *
 *  The marker's key says WHERE the cited content lives, which is what decides
 *  what the chip can do:
 *    t<seq>  a transcript segment on the page being viewed -> scroll to it
 *    c<n>    result n from a tool call, usually another note -> navigate
 *
 *  Keying on chunk_type instead would have no answer for a transcript_segment
 *  chunk returned by the search tool in all-notes mode: "jump to its
 *  timestamp" would land on the wrong recording's timeline.
 */

import type { Citation } from "@/lib/chat/types";

export interface ChatCiteRun {
  text: string;
  cite?:
    | { kind: "segment"; segmentId: number; time: string }
    | { kind: "note"; noteId: string; noteTitle: string; label: string };
}

export interface ParsedAnswer {
  runs: ChatCiteRun[];
  markerCount: number;
  resolvedCount: number;
  /** True only when the message HAD markers and NONE of them resolved. */
  ungrounded: boolean;
}

/** Complete markers only. A half-arrived "[[cite:c" mid-stream does not match
 *  and stays as plain text, so the tail of a streaming answer does not
 *  flicker. */
const MARKER = /\[\[cite:([tc])(\d+)\]\]/g;

const TYPE_LABEL: Record<string, string> = {
  summary: "Summary",
  takeaway: "Takeaway",
  action_item: "Action item",
  transcript_segment: "Transcript",
  imported_doc: "Document",
};

function labelFor(citation: Citation, title: string): string {
  if (citation.tsStart) return `${title} ${citation.tsStart}`;
  return `${title} · ${TYPE_LABEL[citation.chunkType] ?? "Note"}`;
}

export function parseAnswer(
  text: string,
  citations: Citation[],
  segments: { id: number; time: string }[],
): ParsedAnswer {
  const byKey = new Map(citations.map((c) => [c.key, c]));
  const byId = new Map(segments.map((s) => [s.id, s]));

  const runs: ChatCiteRun[] = [];
  let markerCount = 0;
  let resolvedCount = 0;
  let cursor = 0;

  MARKER.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = MARKER.exec(text)) !== null) {
    markerCount += 1;
    const [whole, kind, digits] = match;
    const before = text.slice(cursor, match.index);
    cursor = match.index + whole.length;

    let cite: ChatCiteRun["cite"];

    if (kind === "t") {
      const segment = byId.get(Number(digits));
      if (segment) {
        cite = { kind: "segment", segmentId: segment.id, time: segment.time };
      }
    } else {
      const citation = byKey.get(`c${digits}`);
      if (citation) {
        const title = citation.noteTitle ?? "Untitled note";
        cite = {
          kind: "note",
          noteId: citation.noteId,
          noteTitle: title,
          label: labelFor(citation, title),
        };
      }
    }

    if (cite) {
      resolvedCount += 1;
      runs.push({ text: before, cite });
    } else {
      // Silent is right for a malformed marker; it is WRONG when the cause is
      // a deleted chunk or a removed note. Warn so the failure stays visible
      // to whoever is debugging, and let `ungrounded` carry the user-facing
      // half.
      console.warn(
        `[chat] dropped an unresolvable citation marker: ${whole}`,
      );
      runs.push({ text: before });
    }
  }

  const tail = text.slice(cursor);
  if (tail.length > 0) runs.push({ text: tail });

  return {
    runs,
    markerCount,
    resolvedCount,
    ungrounded: markerCount > 0 && resolvedCount === 0,
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test -- parse-citations && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/note-detail/chat/parse-citations.ts components/note-detail/chat/__tests__/parse-citations.test.ts
git commit -m "feat(chat): parse citations, and refuse to look grounded when none resolve"
```

---

## Task 10: The chat panel

**Files:**
- Create: `components/note-detail/chat/scope-toggle.tsx`
- Create: `components/note-detail/chat/cite-runs.tsx`
- Create: `components/note-detail/chat/chat-message.tsx`
- Create: `components/note-detail/chat/chat-panel.tsx`
- Delete: `components/note-detail/chat-composer.tsx`
- Modify: `components/note-detail/note-detail-shell.tsx`
- Modify: `app/notes/[id]/page.tsx`
- Modify: `lib/notes/view-types.ts`

**Interfaces:**
- Consumes: `parseAnswer`, `ChatCiteRun` from `./parse-citations`; `ChatTurn`, `ChatScope`, `Citation` from `@/lib/chat/types`; `CitationChip` from `../citation-chip`.
- Produces: `<ChatPanel note={note} history={history} activeSegmentId={n} onCitationSelect={fn} />`.

Before writing components, invoke the `web-design-guidelines` and `vercel-react-best-practices` skills against this task's files, as the prompt pack requires.

- [ ] **Step 1: `scope-toggle.tsx`**

```tsx
"use client";

import type { ChatScope } from "@/lib/chat/types";

const OPTIONS: { value: ChatScope; label: string }[] = [
  { value: "this_note", label: "This note" },
  { value: "all_notes", label: "All notes" },
];

export function ScopeToggle({
  value,
  disabled,
  onChange,
}: {
  value: ChatScope;
  disabled: boolean;
  onChange: (scope: ChatScope) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Search scope" className="flex gap-px">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={
            "font-mono text-[9px] tracking-[0.06em] uppercase px-[7px] py-[3px] " +
            "border transition-colors disabled:cursor-not-allowed disabled:text-faint " +
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent " +
            (value === option.value
              ? "border-accent bg-tint text-accent-text"
              : "border-rule text-meta hover:text-ink-2")
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `cite-runs.tsx`**

```tsx
"use client";

import Link from "next/link";
import { CitationChip } from "../citation-chip";
import type { ChatCiteRun } from "./parse-citations";

export function CiteRuns({
  runs,
  activeSegmentId,
  onCitationSelect,
}: {
  runs: ChatCiteRun[];
  activeSegmentId: number;
  onCitationSelect: (segmentId: number) => void;
}) {
  return (
    <>
      {runs.map((run, i) => (
        <span key={i}>
          {run.text}
          {run.cite?.kind === "segment" ? (
            <CitationChip
              time={run.cite.time}
              segmentId={run.cite.segmentId}
              active={activeSegmentId === run.cite.segmentId}
              onSelect={onCitationSelect}
            />
          ) : null}
          {run.cite?.kind === "note" ? (
            // A cross-note citation cannot scroll to anything on this page —
            // it lives in another recording. Navigating is the only thing
            // that lets the reader actually follow it.
            <Link
              href={`/notes/${run.cite.noteId}`}
              aria-label={`Open ${run.cite.label}`}
              className={
                "inline-block px-[5px] py-px mx-0.5 align-[1px] font-mono " +
                "text-[10px] bg-tint text-accent-text hover:bg-tint-hover " +
                "focus-visible:outline-2 focus-visible:outline-offset-1 " +
                "focus-visible:outline-accent"
              }
            >
              {run.cite.label}
            </Link>
          ) : null}
        </span>
      ))}
    </>
  );
}
```

- [ ] **Step 3: `chat-message.tsx`**

```tsx
"use client";

import { parseAnswer } from "./parse-citations";
import { CiteRuns } from "./cite-runs";
import type { Citation } from "@/lib/chat/types";

export function ChatMessage({
  role,
  content,
  citations,
  segments,
  activeSegmentId,
  onCitationSelect,
}: {
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  segments: { id: number; time: string }[];
  activeSegmentId: number;
  onCitationSelect: (segmentId: number) => void;
}) {
  if (role === "user") {
    return (
      <div className="flex items-baseline gap-[9px] pb-2">
        <span className="flex-none font-mono text-[9px] text-meta">YOU</span>
        <span className="text-[13px] text-ink-2">{content}</span>
      </div>
    );
  }

  const parsed = parseAnswer(content, citations, segments);

  return (
    <div className="flex items-baseline gap-[9px] pb-2">
      <span className="flex-none font-mono text-[9px] text-accent">NOTE</span>
      <span className="text-[13px] leading-[1.55] text-ink-2">
        <CiteRuns
          runs={parsed.runs}
          activeSegmentId={activeSegmentId}
          onCitationSelect={onCitationSelect}
        />
        {/* Every source this answer named has gone. Showing it as a clean
            answer would make it read as better-grounded than it is. */}
        {parsed.ungrounded ? (
          <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.06em] text-meta">
            Sources unavailable — the notes this cited may have been deleted.
          </span>
        ) : null}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: `chat-panel.tsx`**

```tsx
"use client";

import { useCallback, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { ChatScope, ChatTurn } from "@/lib/chat/types";
import { MAX_MESSAGE_CHARS } from "@/lib/chat/limits";
import { ChatMessage } from "./chat-message";
import { ScopeToggle } from "./scope-toggle";

export function ChatPanel({
  noteId,
  personaLabel,
  history,
  segments,
  activeSegmentId,
  onCitationSelect,
}: {
  noteId: string;
  personaLabel: string;
  history: ChatTurn[];
  segments: { id: number; time: string }[];
  activeSegmentId: number;
  onCitationSelect: (segmentId: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<ChatScope>("this_note");

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      // The server takes the newest message and the scope and nothing else.
      // History is re-read from the database, so a forged client payload
      // cannot walk past the trim.
      prepareSendMessagesRequest: ({ messages }) => ({
        body: {
          noteId,
          scope,
          text: messages.at(-1)?.parts.find((p) => p.type === "text")?.text ?? "",
        },
      }),
    }),
  });

  const busy = status === "submitted" || status === "streaming";
  const tooLong = draft.length > MAX_MESSAGE_CHARS;
  const canSubmit = draft.trim().length > 0 && !tooLong && !busy;

  const submit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (!canSubmit) return;
      sendMessage({ text: draft });
      setDraft("");
    },
    [canSubmit, draft, sendMessage],
  );

  const searching = messages
    .at(-1)
    ?.parts.some(
      (p) => p.type === "tool-searchNotes" && p.state !== "output-available",
    );

  return (
    <div className="border-t border-rule bg-dock px-[26px] pt-3 pb-3.5">
      <div className="max-h-[220px] overflow-y-auto">
        {history.map((turn) => (
          <ChatMessage
            key={turn.id}
            role={turn.role}
            content={turn.content}
            citations={turn.citations}
            segments={segments}
            activeSegmentId={activeSegmentId}
            onCitationSelect={onCitationSelect}
          />
        ))}

        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            role={message.role === "user" ? "user" : "assistant"}
            content={message.parts
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("")}
            // Live citations come out of this turn's own tool result.
            citations={message.parts.flatMap((p) =>
              p.type === "tool-searchNotes" && p.state === "output-available"
                ? ((p.output as { results?: { citeKey: string; chunkId: string; noteId: string; noteTitle: string; chunkType: string; tsStart: string | null }[] })
                    .results ?? []).map((r) => ({
                    key: r.citeKey,
                    chunkId: r.chunkId,
                    noteId: r.noteId,
                    noteTitle: r.noteTitle,
                    chunkType: r.chunkType,
                    tsStart: r.tsStart,
                  }))
                : [],
            )}
            segments={segments}
            activeSegmentId={activeSegmentId}
            onCitationSelect={onCitationSelect}
          />
        ))}

        {searching ? (
          <p
            aria-live="polite"
            className="pb-2 font-mono text-[9px] uppercase tracking-[0.06em] text-meta"
          >
            Searching your notes…
          </p>
        ) : null}

        {/* A pipeline failure, NOT an empty search. An empty search is a
            normal answer and arrives as prose. */}
        {error ? (
          <p
            role="alert"
            className="mb-2 border border-danger bg-danger-tint px-2 py-1 text-[11px] text-danger-text"
          >
            Something went wrong answering that. Try again.
          </p>
        ) : null}
      </div>

      <form
        onSubmit={submit}
        className="mt-[11px] flex items-center gap-[9px] border border-rule bg-paper px-2.5 py-2 focus-within:border-accent"
      >
        <input
          type="text"
          name="note-question"
          autoComplete="off"
          enterKeyHint="send"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={scope === "this_note" ? "Ask this note" : "Ask all notes"}
          aria-invalid={tooLong}
          placeholder={scope === "this_note" ? "Ask this note…" : "Ask all notes…"}
          className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-placeholder"
        />
        <ScopeToggle value={scope} disabled={busy} onChange={setScope} />
        <span className="font-mono text-[9px] tracking-[0.06em] uppercase text-accent">
          {personaLabel}
        </span>
        <button
          type="submit"
          disabled={!canSubmit}
          className="font-mono text-[9px] tracking-[0.06em] uppercase text-accent-pressed disabled:cursor-not-allowed disabled:text-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          Ask
        </button>
      </form>

      {tooLong ? (
        <p role="alert" className="pt-1 font-mono text-[9px] text-danger-text">
          Too long — keep it under {MAX_MESSAGE_CHARS} characters.
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Add the tokens the panel needs, if they are missing**

`danger`, `danger-tint`, `danger-text` may not exist. Check:

```bash
grep -n "danger" app/globals.css
```

If absent, add them to `app/globals.css` **only** — light on `:root`, dark on `.dark` and inside `@media (prefers-color-scheme: dark) { :root:not(.light) }`, then expose through `@theme inline`, exactly as the existing tokens are. Never name a colour in a component. If equivalent tokens already exist under another name, use those instead of adding new ones.

- [ ] **Step 6: Wire the shell**

In `components/note-detail/note-detail-shell.tsx`:
- Replace `import { ChatComposer } from "./chat-composer";` with `import { ChatPanel } from "./chat/chat-panel";`
- Add `history` to the props: `export function NoteDetailShell({ note, history }: { note: Note; history: ChatTurn[] })`, importing `ChatTurn` from `@/lib/chat/types`.
- Replace the `<ChatComposer ... />` element with:

```tsx
        <ChatPanel
          noteId={note.id}
          personaLabel={persona.name}
          history={history}
          segments={note.segments}
          activeSegmentId={activeSegmentId}
          onCitationSelect={handleCitationSelect}
        />
```

- [ ] **Step 7: Load history on the page**

In `app/notes/[id]/page.tsx`, read the note's chat history server-side and pass it down. Use `createChatPorts(await createClient()).readHistory(id)`. Pass `history={history}` to `<NoteDetailShell />`. This is what makes a refresh mid-conversation restore the full thread.

- [ ] **Step 8: Delete the old composer**

```bash
git rm components/note-detail/chat-composer.tsx
```

`note.sampleExchange` is now unrendered. **Leave the type and its data in place** — deleting them is churn beyond this task's scope, and component tests may still use them. Confirm nothing else imports the deleted file:

```bash
grep -rn "chat-composer\|ChatComposer" app components lib
```

Expected: no matches outside `__tests__`. If a test imports it, update that test to import `ChatPanel`.

- [ ] **Step 9: Run everything**

```bash
npm test && npm run typecheck && npm run build
```

Expected: PASS. In particular the colour-literal and 400-line conventions tests must stay green.

- [ ] **Step 10: Verify in a real browser**

Start the dev server through the Browser pane (never `npm run dev` in Bash), then:

1. Ask a this-note question. Confirm the answer streams with no refresh.
2. Click a transcript citation. Confirm the transcript pane scrolls to that timestamp. Screenshot.
3. Switch to All notes and ask a cross-note question. Confirm "Searching your notes…" appears while the tool runs and disappears after.
4. Click a cross-note citation. Confirm it navigates to the other note. Screenshot.
5. Refresh mid-conversation. Confirm the full thread is still there.
6. Check the console for errors and the network tab for a `429`/`400` on a deliberate over-length paste.

- [ ] **Step 11: Commit**

```bash
git add components/note-detail/chat app/notes components/note-detail/note-detail-shell.tsx lib/notes/view-types.ts app/globals.css
git rm --cached components/note-detail/chat-composer.tsx 2>/dev/null || true
git commit -m "feat(chat): the chat panel, with a scope toggle and two kinds of citation"
```

---

## Task 11: Live verification, `impeccable`, and the documentation

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/ROADMAP.md`
- Modify: `CLAUDE.md`
- Modify: `docs/KNOWN_GAPS.md`

- [ ] **Step 1: Run `/impeccable critique` on the chat panel**

Target `components/note-detail/chat/`. Apply what it finds that is in scope; record anything it raises that is out of scope rather than silently widening the task.

- [ ] **Step 2: Run `/impeccable polish` on the same files**

- [ ] **Step 3: Re-run the full gate after any polish edits**

```bash
npm test && npm run typecheck && npm run build
```

- [ ] **Step 4: Run both live scripts and capture the output**

```bash
node scripts/verify-chat-rls.mjs
VOYAGE_MIN_CALL_INTERVAL_MS=0 node scripts/verify-chat-search.mjs
```

Keep the full stdout. The reporting contract requires the exact command and its output pasted back, not a claim that it passed.

- [ ] **Step 5: Prove the two abuse ceilings against the running route**

With the dev server up:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/chat \
  -H 'content-type: application/json' \
  --data "$(node -e "process.stdout.write(JSON.stringify({noteId:'<a real note id>',scope:'this_note',text:'x'.repeat(4001)}))")"
```

Expected: `400`. Repeat with `4000` characters and expect a stream, not a `400`. Then send 21 messages in under 60 seconds and confirm the 21st returns `429`. **Paste both results into the report** — the DoD names them specifically.

- [ ] **Step 6: Prove single-note chat against a broken notegen row**

Set one note to `notegen_status = 'generating'` and another to `'failed'`, both with `processing_status = 'completed'` and a real transcript. Ask each a question in the browser. Both must answer. Screenshot both.

```bash
npx supabase db query --linked --project-ref <ref> --query "update public.notes set notegen_status = 'generating' where id = '<id>'"
```

- [ ] **Step 7: Append to `docs/DECISIONS.md`**

Append **verbatim** under the existing `**RAG**` bullet list, after the bullet ending "Adding a note-level lock would buy nothing and add a second mechanism to get wrong." — the three bullets given in the prompt pack (retrieval architecture split by scope; chat abuse/cost ceiling; chat history persists server-side). Adjust the date only if this ships on a different day.

- [ ] **Step 8: Append to `docs/ROADMAP.md` §4**

Append **verbatim** after the existing "Cross-note chat" paragraph — the "Single-note vs cross-note retrieval" paragraph and the `chat_messages` table block given in the prompt pack.

- [ ] **Step 9: Add a `## Chat` section to `CLAUDE.md`**

Follow the tone of the existing `## Embeddings` section: state the rule, then the reason, then the command. Cover at minimum — the scope split and why single-note has no notegen dependency; that the search function is not `SECURITY DEFINER` and that no app code filters on `user_id`; the two `search_path = ''` traps (`operator(extensions.<=>)` and `'pg_catalog.english'::regconfig`); that history is re-read from the database and never trusted from the client; the two ceilings and their exact numbers; that `isStepCount` is the correct name and `stepCountIs` does not exist; that Sonnet 5 rejects `budget_tokens`; that `sendReasoning` must stay unset; the citation marker scheme and the ungrounded floor; and the two verify commands.

Update the `**Last updated:**` line at the top of `CLAUDE.md`.

- [ ] **Step 10: Update `docs/KNOWN_GAPS.md`**

- Close the "Cross-note chat is correctly absent" entry (line ~329) — it is no longer absent.
- Update the entry at line ~151 that reads "The composer accepts and clears input but sends nothing."
- Strengthen the auto-titling entry (line ~1916): it now has a live consumer, since a cross-note citation chip renders `notes.title` and falls back to "Untitled note".
- Add a new gap: **persona-aware filtering of cross-note search is unbuilt**, by instruction rather than oversight, and nobody has decided whether an active lens should narrow retrieval.

- [ ] **Step 11: Re-run the whole gate one last time**

```bash
npm test && npm run typecheck && npm run build
```

- [ ] **Step 12: Commit**

```bash
git add docs CLAUDE.md components/note-detail/chat
git commit -m "docs: record the chat retrieval split, the ceilings, and two open items"
```

- [ ] **Step 13: Request code review**

Invoke `superpowers:requesting-code-review`, then `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: §1 → Tasks 7, 8; §2.1 → Task 2; §2.2 → Task 3; §2.3 → Tasks 2, 3; §3.1 → Task 9; §3.2 → Tasks 9, 10 (and the RLS script's step 6); §3.3 → Tasks 2, 8; §4 → Task 8; §4.1 → Task 8 (route test asserts it); §4.2 → Task 7; §4.3 → Tasks 7, 10; §4.4 → Task 8 (route test) and Task 10 (renderer); §5.1 → Task 7; §5.2 → Tasks 6, 8; §6 → all; §7 → every task's test steps plus Task 11; §8 → nothing built; §9 → Task 11 step 10.

**Type consistency.** `Citation` is defined once in `lib/chat/types.ts` and consumed unchanged by `citations.ts`, `ports.ts`, `parse-citations.ts`, `chat-message.tsx`, `chat-panel.tsx`. `SearchHit` is defined there and produced by `searchNotes`. `ChatTurn` is produced by `readHistory` and consumed by `trimHistory`, `flattenHistory`, `ChatPanel`. The tool key is `searchNotes` in Task 6, Task 8 and Task 10's `tool-searchNotes` part type. `MAX_SEARCH_RESULTS` (Task 6) and the SQL `limit 25` (Task 3) are the same number stated in two places on purpose, and both are tested.

**Known risk, called out rather than hidden.** Task 8's `messages` construction mixes a plain `{role, content}` array with a multi-part user message. If TypeScript rejects the union, narrow with the SDK's exported `ModelMessage[]` type — do **not** reach for `any`, which would silently discard the `providerOptions` that carry the cache breakpoint.
