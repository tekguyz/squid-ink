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
