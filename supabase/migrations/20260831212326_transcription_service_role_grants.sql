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
  -- 'failed' is terminal, and is reached two ways: a stale 'uploading' row
  -- whose Storage object never appeared, and a stale 'analyzing' row whose
  -- transcription function died mid-flight. Both are written by the sweep in
  -- lib/transcription/sweep.ts. There is deliberately no error-message column
  -- — failures are logged to the Vercel function log, and no UI consumes them
  -- at single-owner scale.
  processing_status text not null default 'local'
    check (processing_status in
      ('local', 'uploading', 'analyzing', 'completed', 'failed')),
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

-- The table already exists in the linked project, so the inline check above is
-- a no-op there. This is how 'failed' actually lands. Postgres has no
-- if-not-exists for constraints, so drop-then-add — both statements are
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
revoke all on public.notes from anon, authenticated, service_role;

-- anon is deliberately granted nothing — this app has no public reads.
grant select, insert, update, delete on public.notes to authenticated;

-- service_role, for app/api/cron/transcribe. MEASURED 2026-08-31: before this
-- line, role_table_grants showed service_role holding only REFERENCES, TRIGGER
-- and TRUNCATE here, so every read from the cron route failed with
-- "permission denied for table notes". The project was created with
-- "Automatically expose new tables" off, so no role is granted anything it is
-- not granted here.
--
-- This is a GRANT, not a policy. service_role already bypasses RLS; what it
-- lacked was reachability. A cron invocation carries no user session and so
-- has no RLS identity — it must read and write rows belonging to whichever
-- user recorded them, which is the whole reason the secret key exists.
--
-- The revoke above now includes service_role, which also strips the TRUNCATE
-- it held for no reason. TRUNCATE is not row-level and RLS does not constrain
-- it; nothing in this project truncates.
grant select, insert, update, delete on public.notes to service_role;
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
