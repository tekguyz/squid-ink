-- notes: one row per recording.
--
-- Structured content (summaries, takeaways, action items) deliberately does
-- NOT get a column here — ROADMAP.md §4 assigns it to note_chunks rows keyed
-- by chunk_type. There is no second home for it.
--
-- Every statement is idempotent so the whole file can be re-applied after an
-- edit. That is the only iteration loop: edit this file, re-apply this file.

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  processing_status text not null default 'local'
    check (processing_status in ('local', 'uploading', 'analyzing', 'completed')),
  raw_transcript text,
  -- Processing outcome, not a user setting. Diarization is on by default and
  -- auto-disables past ~28 min (DECISIONS.md). No UI toggle is or should be
  -- wired to this column.
  diarization_enabled boolean not null default true,
  audio_duration_seconds integer,
  -- Placeholder for the deferred Storage bucket. No bucket, no policies and
  -- no upload code ship with this column — see docs/KNOWN_GAPS.md.
  audio_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Serves feed ordering, and indexes the column every RLS policy below
-- filters on. Postgres does not index foreign keys automatically.
create index if not exists notes_user_id_created_at_idx
  on public.notes (user_id, created_at desc);

-- updated_at is maintained by the database. The client never sets it.
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

-- Four per-operation policies, not one blanket rule.
--
-- auth.uid() is wrapped in a select so the planner evaluates it once per
-- query instead of once per row. `to authenticated` alone would be
-- authentication without authorization, so every policy also carries an
-- ownership predicate.

drop policy if exists notes_select_own on public.notes;
create policy notes_select_own on public.notes
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists notes_insert_own on public.notes;
create policy notes_insert_own on public.notes
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- UPDATE needs both clauses. Without with check, a user could rewrite
-- user_id and hand their own row to somebody else.
drop policy if exists notes_update_own on public.notes;
create policy notes_update_own on public.notes
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists notes_delete_own on public.notes;
create policy notes_delete_own on public.notes
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- The project was created with "Automatically expose new tables" off, so
-- Data API access is granted explicitly. This is separate from RLS: grants
-- decide whether the table is reachable at all, RLS decides which rows come
-- back once it is.
--
-- Revoke first, then grant, so this file is the sole authority on privileges
-- rather than layering on top of whatever the project defaults happen to be.
-- Those defaults hand anon and authenticated TRUNCATE, REFERENCES and
-- TRIGGER on every new public table. TRUNCATE matters: it is not row-level,
-- so RLS does not constrain it at all. Neither role needs any of the three.
revoke all on public.notes from anon, authenticated;

-- anon is deliberately granted nothing — this app has no public reads.
grant select, insert, update, delete on public.notes to authenticated;
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

-- Postgres does not index foreign keys automatically. This composite also
-- serves the main read pattern: every chunk of one note, of one type.
create index if not exists note_chunks_note_id_chunk_type_idx
  on public.note_chunks (note_id, chunk_type);

-- Indexes the column every RLS policy below filters on.
create index if not exists note_chunks_user_id_idx
  on public.note_chunks (user_id);

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
