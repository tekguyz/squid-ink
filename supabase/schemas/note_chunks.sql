-- note_chunks: multi-granularity RAG chunks, per ROADMAP.md §4.
--
-- Structured chunks (summary, takeaway, action_item) and transcript segments
-- share one table so retrieval is uniform across both. Because RLS here is
-- scoped to user_id rather than note_id, cross-note retrieval already works
-- with no schema change.
--
-- Four columns are tightened against the ROADMAP snippet, which was
-- illustrative. Each tightening is recorded in the plan and the final report:
--   note_id    -> not null  (a chunk with no note is unowned and unreachable)
--   user_id    -> not null, on delete cascade  (a null user_id fails every
--                 RLS predicate, becoming invisible, undeletable data)
--   chunk_type -> not null  (a null type breaks every consumer's switch)
--   metadata   -> not null default '{}'  (removes null-guards from reads)
--
-- Every statement is idempotent so the whole file can be re-applied.

-- Installed into extensions, not public. An extension in public trips the
-- database linter's extension_in_public warning.
create extension if not exists vector with schema extensions;

create table if not exists public.note_chunks (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  chunk_type text not null check (chunk_type in
    ('summary', 'takeaway', 'action_item', 'transcript_segment', 'imported_doc')),
  -- Which lens produced this chunk. Null means "belongs to the default
  -- persona" — every chunk written before personas existed reads that way,
  -- which is what keeps the rendered page unchanged.
  --
  -- on delete set null, never cascade: deleting a lens must not delete the
  -- takeaways written through it.
  persona_id uuid references public.personas (id) on delete set null,
  content text not null,
  -- voyage-3-large output width (ROADMAP.md §3). Null until the embedding
  -- pipeline ships — no embedding code is in scope for this prompt.
  embedding extensions.vector(1024),
  -- {speaker, ts_start, ts_end, source_url, seq} plus per-type extras:
  -- runs (summary), owner/due (action_item), segment_id (citations),
  -- and speaker.initials / speaker.token for the transcript pane.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The table already exists in the linked project, so create-table-if-not-
-- exists above is a no-op there. This is how the new column actually lands.
alter table public.note_chunks
  add column if not exists persona_id uuid references public.personas (id) on delete set null;

-- Postgres does not index foreign keys automatically. This composite also
-- serves the main read pattern: every chunk of one note, of one type.
create index if not exists note_chunks_note_id_chunk_type_idx
  on public.note_chunks (note_id, chunk_type);

-- Indexes the column every RLS policy below filters on.
create index if not exists note_chunks_user_id_idx
  on public.note_chunks (user_id);

-- Postgres does not index foreign keys automatically, and the takeaway read
-- groups by exactly this column.
create index if not exists note_chunks_persona_id_idx
  on public.note_chunks (persona_id);

-- Hybrid retrieval (ROADMAP.md §4): vector cosine similarity plus Postgres
-- full text, fused later by reciprocal rank fusion. Pure embedding
-- similarity misses proper nouns and dollar figures too often for meeting
-- content, so both indexes are load-bearing, not alternatives.
create index if not exists note_chunks_embedding_idx
  on public.note_chunks using hnsw (embedding extensions.vector_cosine_ops);

create index if not exists note_chunks_content_fts_idx
  on public.note_chunks using gin (to_tsvector('english', content));

alter table public.note_chunks enable row level security;

-- Four per-operation policies, matching notes. auth.uid() is wrapped in a
-- select so the planner evaluates it once per query, not once per row.

drop policy if exists note_chunks_select_own on public.note_chunks;
create policy note_chunks_select_own on public.note_chunks
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists note_chunks_insert_own on public.note_chunks;
create policy note_chunks_insert_own on public.note_chunks
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- Without with check, a user could rewrite user_id and hand the row away.
drop policy if exists note_chunks_update_own on public.note_chunks;
create policy note_chunks_update_own on public.note_chunks
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists note_chunks_delete_own on public.note_chunks;
create policy note_chunks_delete_own on public.note_chunks
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Revoke first, then grant, so this file is the sole authority on
-- privileges. The project defaults hand anon and authenticated TRUNCATE,
-- REFERENCES and TRIGGER on every new public table; TRUNCATE is not
-- row-level, so RLS does not constrain it.
revoke all on public.note_chunks from anon, authenticated;

-- anon is deliberately granted nothing — this app has no public reads.
grant select, insert, update, delete on public.note_chunks to authenticated;
