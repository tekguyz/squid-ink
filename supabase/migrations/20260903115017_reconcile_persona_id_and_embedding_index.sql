-- Reconcile the migration chain with the live database.
--
-- Two pieces of applied DDL were never written into the chain:
--   * notes.persona_id, its composite foreign key and its index (2026-09-02,
--     per-note persona selection)
--   * note_chunks_pending_embedding_idx, the partial index (2026-09-03,
--     the embeddings pipeline)
--
-- Both were applied through `db query --file` on the schema file, which is the
-- workflow CLAUDE.md § Declarative schema workflow mandates. What was skipped
-- is that section's last step. This migration is that step, run late.
--
-- It is the verbatim concatenation of every file in config.toml's
-- schema_paths, in that order — not a curated subset. Every statement in those
-- files is idempotent, so re-applying the whole set is a no-op against a
-- database that already matches, and a full rebuild against a fresh one. That
-- also restores the `git hash-object` check: this file must equal
-- `cat` of the five schema files in schema_paths order.
--
-- The live database was NOT changed by this migration. It was already correct;
-- only the paper trail was behind.

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
  -- The Storage key for the recording, `{user_id}/{note_id}` — two segments,
  -- that order, no extension, because that is what the three policies in
  -- storage_audio.sql check. Written by the recorder when the upload starts,
  -- not when it finishes, because the path is deterministic.
  --
  -- Corrected 2026-09-03. This read "Placeholder for the deferred Storage
  -- bucket. No bucket, no policies and no upload code ship with this column",
  -- which was true the day it was written and stopped being true on
  -- 2026-08-31, when the bucket, its policies and the upload path all shipped.
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

-- persona_id: which lens this note generates under. Nullable, and null keeps
-- meaning exactly what it means on note_chunks — the default persona. Every
-- note written before 2026-09-02 is null and generates as it always did; there
-- is no backfill, matching the persona provisioning trigger's own deliberate
-- no-backfill decision.
--
-- THE FOREIGN KEY IS NOT HERE. config.toml applies this file BEFORE
-- personas.sql, so a reference to public.personas would not resolve on a fresh
-- apply. The constraint is declared at the end of personas.sql instead. The
-- column is declared here because this is the notes table.
alter table public.notes
  add column if not exists persona_id uuid;

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
-- there is no model routing and no UI control — but it is a property of a
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

-- The target of note_chunks' composite foreign key. A foreign key is
-- validated as the referenced table's owner and is not subject to RLS, so a
-- plain references personas (id) would let one user attribute a chunk to
-- another user's persona. Carrying user_id into the key makes the database
-- refuse that.
--
-- Guarded rather than drop-then-add: note_chunks_persona_id_fkey depends on
-- this constraint's index, so a plain drop fails with 2BP01 once that
-- foreign key exists, and this file must stay re-appliable.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.personas'::regclass
      and conname = 'personas_id_user_id_key'
  ) then
    alter table public.personas
      add constraint personas_id_user_id_key unique (id, user_id);
  end if;
end $$;

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

-- This policy permits a delete; nothing in the app performs one yet. See the
-- guard rail above note_chunks_persona_id_fkey in note_chunks.sql — deleting a
-- persona re-attributes its takeaways to the default persona rather than
-- orphaning them, and that behaviour must be chosen deliberately before any
-- delete surface ships.
drop policy if exists personas_delete_own on public.personas;
create policy personas_delete_own on public.personas
  for delete to authenticated
  using ((select auth.uid()) = user_id);

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
-- reason -- TRUNCATE is not row-level, so RLS does not constrain it.
--
-- SELECT ONLY. Nothing in this project writes a persona as service_role:
-- provisioning is a security definer trigger running as supabase_auth_admin,
-- and every user-facing edit runs as authenticated under RLS.
grant select on public.personas to service_role;

-- notes.persona_id's foreign key — which lens a note generates under.
--
-- DECLARED HERE, NOT IN notes.sql, and that is not a filing preference.
-- config.toml applies notes.sql first, so a reference to public.personas
-- written there would not resolve on a fresh apply. The column itself is
-- declared in notes.sql, where the notes table lives; only the constraint has
-- to wait for this file. Read the order out of config.toml, not from memory.
--
-- COMPOSITE, for the reason note_chunks_persona_id_fkey is composite: a
-- foreign key is validated as the referenced table's owner and is NOT subject
-- to row level security, so a plain references personas (id) would happily let
-- one user's note point at another user's lens. Carrying user_id into the key
-- makes the database refuse it. personas_id_user_id_key above is the unique
-- constraint this requires, which is why it is declared before the grants.
--
-- MATCH SIMPLE (the default) means a null persona_id satisfies the constraint
-- with no lookup at all — null still means "the default persona", exactly as
-- it does on note_chunks.
--
-- set null names persona_id explicitly (Postgres 15 and later). Without the
-- column list, deleting a persona would try to null notes.user_id too, which
-- is not null. Same trap note_chunks.sql documents.
--
-- Drop-then-add rather than add-if-not-exists: Postgres has no if-not-exists
-- for constraints, and both statements are idempotent, which is what lets this
-- whole file be re-applied after an edit.
alter table public.notes
  drop constraint if exists notes_persona_id_fkey;
alter table public.notes
  add constraint notes_persona_id_fkey
  foreign key (persona_id, user_id) references public.personas (id, user_id)
  on delete set null (persona_id);

-- Postgres does not index foreign keys automatically, and on delete set null
-- has to find the rows it is nulling.
create index if not exists notes_persona_id_idx
  on public.notes (persona_id);
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
  -- voyage-4 output width, pinned on every call in lib/rag/voyage-client.ts
  -- rather than taken from the API default — 1024 is that model's default
  -- today, but it also offers 2048/512/256 and this column is FIXED.
  -- Populated since 2026-09-03; null means "not embedded yet", which is the
  -- queue itself (CLAUDE.md § Embeddings). The model changed from
  -- voyage-3-large on cost grounds the same day; see docs/DECISIONS.md § RAG.
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

-- The embedding QUEUE, as opposed to the retrieval index above.
--
-- lib/rag/sweep.ts asks one question on every cron run: "which chunks, across
-- every user, still have no vector?" Without this the answer is a sequential
-- scan of the whole table, and it gets slower with every note ever recorded --
-- while the set it is looking for shrinks towards empty. A partial index
-- inverts that: it holds only the rows that are actually pending, so a fully
-- embedded table is answered from an index with no entries in it.
--
-- Keyed on created_at because that is the sweep's ORDER BY: oldest chunk
-- first, so the note that has waited longest is taken up first.
--
-- `embedding is null` is immutable, which is what a partial index predicate
-- requires. The attempt cap is deliberately NOT in the predicate: it reads
-- metadata, and a chunk that has given up permanently is a rounding error in
-- the index while a jsonb predicate would make every UPDATE re-evaluate it.
create index if not exists note_chunks_pending_embedding_idx
  on public.note_chunks (created_at)
  where embedding is null;

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
-- provision_default_personas: give every new account the four default lenses.
--
-- Before this trigger, only the seed owner had persona rows. Every other
-- account read zero personas and the shell fell back to the single
-- DEFAULT_PERSONA_FALLBACK in lib/notes/default-persona.ts. That fallback is
-- a crash floor, not the intended experience: a new signup could see one lens
-- where the product has four.
--
-- The values below are copied verbatim from supabase/seed.sql, which is where
-- the owner's four rows come from. id is deliberately NOT copied: seed.sql
-- pins 66666666-...-N so it can be re-run for one known owner, but a trigger
-- runs for every user and a pinned id would collide on the primary key at the
-- second signup. gen_random_uuid() supplies it, as does the column default.
--
-- security definer, not a new RLS policy. The four per-operation policies on
-- public.personas stay exactly as personas.sql leaves them. The alternative --
-- letting authenticated insert rows with any user_id -- is the same class of
-- hole the composite foreign key on note_chunks.persona_id exists to close.
--
-- search_path is pinned empty, so every identifier here is schema-qualified.
-- A security definer function that inherits the caller's search_path lets the
-- caller decide which "personas" it writes to; it is also the advisor's
-- function_search_path_mutable WARN.
--
-- Every statement is idempotent so the whole file can be re-applied.

create or replace function public.provision_default_personas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.personas (user_id, slug, name, sub, depth, quick_actions, sort_order)
  values
    (new.id, 'neutral-analyst', 'Neutral Analyst', 'dense · no framing', 'dense',
      array['Extract decisions only', 'Timeline of blockers', 'Unanswered questions', 'Diff against last call'], 0),
    (new.id, 'sales-coach', 'Sales Coach', 'coaching · direct', 'dense',
      array['Score objection handling', 'Draft follow-up email', 'Next-call agenda', 'Concessions made'], 1),
    (new.id, 'investor', 'Investor', 'economics · risk', 'dense',
      array['Unit-economics read', 'Expansion risk memo', 'Diligence questions', 'Quantified risks'], 2),
    (new.id, 'engineering-lead', 'Engineering Lead', 'scope · sequencing', 'dense',
      array['Scope the mapping work', 'Risk register entry', 'Sequencing plan', 'Handoff brief'], 3)
  -- Re-provisioning an account that already has a lens leaves it alone rather
  -- than erroring. unique (user_id, slug) is the constraint personas.sql
  -- declares, so this names it by its columns.
  on conflict (user_id, slug) do nothing;

  return new;
end;
$$;

-- EXECUTE on a security definer function is still checked against the CALLER.
-- supabase_auth_admin is the role GoTrue inserts auth.users as, including for
-- the admin API. anon and authenticated are granted nothing: no application
-- code calls this, only the trigger does.
revoke all on function public.provision_default_personas() from public;
grant execute on function public.provision_default_personas() to supabase_auth_admin;

-- after insert, not before: personas.user_id carries a foreign key to
-- auth.users (id), so the row has to exist before the personas insert.
--
-- Dropped then created rather than a bare create trigger, which raises 42710
-- on re-apply. There is no create trigger if not exists in Postgres 17.
drop trigger if exists on_auth_user_created_provision_personas on auth.users;
create trigger on_auth_user_created_provision_personas
  after insert on auth.users
  for each row execute function public.provision_default_personas();
-- storage_audio: the private bucket recordings are uploaded to, and the
-- owner-only policies that guard it.
--
-- Ownership lives in the object PATH, not in metadata: every object is stored
-- at {user_id}/{note_id}. storage.objects.owner_id exists, but it records who
-- uploaded a row rather than constraining who may write one, and a client
-- picks its own destination path. Encoding the owner as the first path segment
-- lets the policy check the very thing it enforces. Same reasoning as the
-- composite foreign key on note_chunks.persona_id.
--
-- INSERT + SELECT + UPDATE, deliberately no DELETE. Supabase's upsert path
-- replaces an object in place, which needs UPDATE as well as INSERT; granting
-- INSERT alone makes replacement fail silently (docs/KNOWN_GAPS.md). DELETE is
-- left out because note deletion is not a decided feature -- there is nothing
-- for a delete policy to serve yet, and a speculative one is a hole with no
-- consumer.
--
-- Every statement is idempotent so the whole file can be re-applied after an
-- edit. That is the only iteration loop: edit this file, re-apply this file.

-- The bucket. public = false means no anonymous object URLs; reads go through
-- an authenticated request that RLS filters, or a signed URL nothing issues yet.
insert into storage.buckets (id, name, public)
values ('audio-recordings', 'audio-recordings', false)
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------------
-- Grants: NOT ours to control here, and this file must not pretend otherwise.
-- ---------------------------------------------------------------------------
--
-- notes.sql, personas.sql and note_chunks.sql each open with `revoke all` and
-- then grant explicitly, so the file is the sole authority on privileges. That
-- pattern does not transfer to the storage schema, and the difference was
-- measured on this project rather than assumed:
--
--   * storage.objects and storage.buckets are owned by supabase_storage_admin,
--     not postgres.
--   * anon, authenticated and service_role each already hold
--     DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on both
--     tables, and information_schema.role_table_grants names the grantor of
--     every one of them as supabase_storage_admin.
--   * Postgres only lets a role revoke grants that role itself made. Running
--     `revoke all on storage.objects from anon` as postgres raises NO error --
--     it emits a warning and changes nothing. A probe confirmed the privilege
--     was still present afterwards. A revoke here would therefore be a no-op
--     that reads like a lockdown, which is worse than no line at all.
--   * The obvious workaround does not exist either: postgres is not a member
--     of supabase_storage_admin, and `set role` to supabase_storage_admin,
--     supabase_privileged_role and supabase_admin all fail with 42501. The
--     dashboard SQL editor connects as this same postgres role, so there is no
--     path from this project to those grants at all.
--
-- What actually keeps anon out is therefore RLS, not grants. storage.objects
-- has relrowsecurity = true, and the three policies below are the only
-- policies on it -- all of them `to authenticated`. A role with no policy
-- matches no rows, so anon reads nothing, writes nothing and updates nothing.
--
-- The one privilege RLS genuinely does not constrain is TRUNCATE, which anon
-- holds. It is not reachable: config.toml exposes only the `public` and
-- `graphql_public` schemas to the Data API, so PostgREST cannot address
-- storage.objects under any role, and the Storage API never issues TRUNCATE.
-- This is recorded in docs/KNOWN_GAPS.md rather than silently accepted.
--
-- No grant statement here either. authenticated already holds SELECT, INSERT
-- and UPDATE from supabase_storage_admin, so a grant from postgres would only
-- add a duplicate catalog entry alongside the owner's. The revoke below is
-- narrow and deliberate: it removes grants POSTGRES made, which is exactly the
-- duplicate an earlier revision of this file left behind, and nothing else.
revoke all on storage.objects from anon, authenticated;
revoke all on storage.buckets from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
--
-- Three per-operation policies, not one blanket rule.
--
-- auth.uid() is wrapped in a select so the planner evaluates it once per query
-- instead of once per row. Each policy also pins bucket_id: storage.objects is
-- one table for every bucket, so an unscoped predicate would silently govern
-- any bucket added later.
--
-- There is no DELETE policy. authenticated does hold the DELETE privilege from
-- supabase_storage_admin and that cannot be revoked from here, but a privilege
-- without a policy matches no rows on an RLS-enabled table, so no authenticated
-- user can delete an object. RLS is the layer where "no deletion this pass" is
-- actually enforceable, and it is enforced.

drop policy if exists audio_recordings_select_own on storage.objects;
create policy audio_recordings_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists audio_recordings_insert_own on storage.objects;
create policy audio_recordings_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- UPDATE needs both clauses. using decides which rows may be replaced; without
-- with check, a user could overwrite their own object and move it under
-- somebody else's prefix in the same statement.
drop policy if exists audio_recordings_update_own on storage.objects;
create policy audio_recordings_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
