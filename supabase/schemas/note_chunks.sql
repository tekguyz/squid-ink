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
  -- takeaways written through it. The foreign key itself is declared below,
  -- as a composite, so that it is stated in exactly one place.
  persona_id uuid,
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
  add column if not exists persona_id uuid;

-- The foreign key, stated once for both the fresh and the existing table.
--
-- It is composite on purpose. Foreign keys are validated as the referenced
-- table's owner and are not subject to row level security, so a plain
-- references personas (id) would happily let one user point a chunk at
-- another user's persona. Carrying user_id into the key makes the database
-- refuse it.
--
-- The key is MATCH SIMPLE (the default), so a null persona_id satisfies the
-- constraint without any lookup — null still means "the default persona".
--
-- set null names persona_id explicitly (Postgres 15 and later). Without the
-- column list, deleting a persona would try to null note_chunks.user_id too,
-- which is not null.
--
-- Drop-then-add rather than add-if-not-exists: Postgres has no
-- if-not-exists for constraints, and both statements are idempotent. This
-- also replaces the earlier single-column form of the same constraint.
--
-- GUARD RAIL, read before building persona deletion. on delete set null does
-- not orphan a takeaway: a null persona_id reads as the default persona, so
-- deleting Sales Coach silently re-attributes its takeaways to Neutral
-- Analyst, where they render as that lens's output. Nothing can delete a
-- personas row today (no UI, no API route, no server action, no script).
-- Whoever adds a delete button must choose explicitly, and say which in the
-- delete confirmation: accept the re-attribution, or soft-delete the persona
-- and orphan its chunks. Do not ship the button before that choice is made.
alter table public.note_chunks
  drop constraint if exists note_chunks_persona_id_fkey;
alter table public.note_chunks
  add constraint note_chunks_persona_id_fkey
  foreign key (persona_id, user_id) references public.personas (id, user_id)
  on delete set null (persona_id);

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
revoke all on public.note_chunks from anon, authenticated, service_role;

-- anon is deliberately granted nothing — this app has no public reads.
grant select, insert, update, delete on public.note_chunks to authenticated;

-- service_role, for app/api/cron/transcribe, which writes transcript_segment
-- rows on behalf of whichever user recorded the note. Same reasoning as the
-- matching grant in notes.sql, and measured the same way: before this line
-- service_role held only REFERENCES, TRIGGER and TRUNCATE here.
--
-- A GRANT, not a policy. service_role already bypasses RLS; it simply could
-- not reach the table. The revoke above now also strips its stray TRUNCATE.
grant select, insert, update, delete on public.note_chunks to service_role;
