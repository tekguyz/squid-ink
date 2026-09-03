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
--
--   * <=> lives in extensions, not pg_catalog, so with an empty search path
--     it is unresolvable. It is written operator(extensions.<=>).
--
--   * 'english'::regconfig ALSO resolves through the search path. It is
--     written 'pg_catalog.english'::regconfig, which is the same OID
--     note_chunks_content_fts_idx was built with -- an index expression is
--     matched by OID, not by spelling, so this is what keeps the gin index
--     in play. Proved with EXPLAIN rather than assumed; a mismatch here does
--     not error, it silently sequential-scans every chunk ever written.
--
-- Every statement is idempotent so the whole file can be re-applied.

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
      -- Reciprocal rank fusion, k = 60. A chunk found by both arms scores the
      -- sum, which is what makes hybrid beat either arm alone: pure embedding
      -- similarity misses proper nouns and dollar figures, and pure full text
      -- misses paraphrase.
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
-- grants EXECUTE on new functions to PUBLIC by default, which would hand anon
-- a retrieval endpoint -- RLS would return them nothing, but an
-- unauthenticated caller should not reach the function at all.
revoke all on function public.search_note_chunks(extensions.vector(1024), text)
  from public, anon, authenticated, service_role;

grant execute on function public.search_note_chunks(extensions.vector(1024), text)
  to authenticated;
