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
