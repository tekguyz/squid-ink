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

-- attendee_emails: who was on the call, as email addresses. Added 2026-09-11
-- for auto-file rules, which match on the DOMAIN half of each address.
--
-- NOTHING POPULATES IT YET, and that is stated rather than hidden. This app
-- has no calendar integration and no invite import, so every existing row is
-- null and every new row is null until something writes one. The column ships
-- now because the rule engine in lib/collection-rules/ reads it and a rule
-- kind with nowhere to read from is worse than an empty column — see
-- docs/KNOWN_GAPS.md.
--
-- text[], not a join table. An attendee is a string on a note, not an entity:
-- nothing else in this app points at one, nothing renames one, and a join
-- table would be three more objects and four more policies carrying no fact
-- the array does not already carry. Nullable with no default: null means "we
-- were never told", which is different from an empty array meaning "nobody".
alter table public.notes
  add column if not exists attendee_emails text[];

-- The target of note_tags' composite foreign key, and the same shape
-- personas_id_user_id_key takes for note_chunks and notes.persona_id. A
-- foreign key is validated as the referenced table's owner and is NOT subject
-- to RLS, so a plain references notes (id) would let one user attach their
-- own row to another user's note. Carrying user_id into the key makes the
-- database refuse it.
--
-- Guarded rather than drop-then-add: note_tags_note_id_fkey depends on this
-- constraint's index, so a plain drop fails with 2BP01 once that foreign key
-- exists, and this file must stay re-appliable. Same guard personas.sql uses.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.notes'::regclass
      and conname = 'notes_id_user_id_key'
  ) then
    alter table public.notes
      add constraint notes_id_user_id_key unique (id, user_id);
  end if;
end $$;

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

-- Whether the CALLER signed in anonymously. This is demo mode's write block,
-- and it is the reason every write policy in this schema carries a second
-- clause.
--
-- Supabase gives an anonymous sign-in the `authenticated` role, not a role of
-- its own. The dashboard says so when the setting is enabled, and it is not a
-- footnote: `to authenticated` cannot tell a demo visitor from the owner, so
-- without this function a stranger holds the owner's own INSERT rights. They
-- could not READ another account's rows — every select policy is still scoped
-- by user_id, and an anonymous visitor's auth.uid() matches none of them — but
-- they could create notes, upload audio and trigger transcription and note
-- generation, which spends real money on Gemini and Claude.
--
-- Read from the JWT, not from auth.users, so it costs no table read. coalesce
-- because a token minted before anonymous sign-ins were enabled carries no
-- such claim: a null there must mean "not anonymous", never "unknown, so
-- allow".
--
-- It lives in notes.sql because config.toml applies this file first and the
-- write policies in every later schema file call it. set_updated_at() above
-- is here for the same reason.
create or replace function public.is_anon_session()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
$$;

alter table public.notes enable row level security;

-- Four per-operation policies, not one blanket rule.
--
-- auth.uid() is wrapped in a select so the planner evaluates it once per
-- query instead of once per row. `to authenticated` alone would be
-- authentication without authorization, so every policy also carries an
-- ownership predicate.
--
-- The three WRITE policies carry a second predicate as well:
-- `not public.is_anon_session()`, demo mode's write block. See the function
-- above for why `to authenticated` is not enough on its own. SELECT does not
-- carry it — a demo visitor reads their own seeded copies, and ownership
-- already scopes that to rows nobody else can see.

drop policy if exists notes_select_own on public.notes;
create policy notes_select_own on public.notes
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists notes_insert_own on public.notes;
create policy notes_insert_own on public.notes
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

-- UPDATE needs both clauses. Without with check, a user could rewrite
-- user_id and hand their own row to somebody else.
drop policy if exists notes_update_own on public.notes;
create policy notes_update_own on public.notes
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  )
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists notes_delete_own on public.notes;
create policy notes_delete_own on public.notes
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

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
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

-- Without with check, a user could rewrite user_id and hand the row away.
drop policy if exists personas_update_own on public.personas;
create policy personas_update_own on public.personas
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  )
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

-- This policy permits a delete; nothing in the app performs one yet. See the
-- guard rail above note_chunks_persona_id_fkey in note_chunks.sql — deleting a
-- persona re-attributes its takeaways to the default persona rather than
-- orphaning them, and that behaviour must be chosen deliberately before any
-- delete surface ships.
drop policy if exists personas_delete_own on public.personas;
create policy personas_delete_own on public.personas
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

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
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

-- Without with check, a user could rewrite user_id and hand the row away.
drop policy if exists note_chunks_update_own on public.note_chunks;
create policy note_chunks_update_own on public.note_chunks
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  )
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists note_chunks_delete_own on public.note_chunks;
create policy note_chunks_delete_own on public.note_chunks
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

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

-- The two write policies also refuse an anonymous (demo) session. An upload is
-- the most expensive thing a stranger could reach: the object itself costs
-- storage, and a stored recording is what the transcription sweep picks up, so
-- an unguarded insert here spends Gemini money on audio nobody asked for.
-- SELECT is not guarded — a demo visitor plays the sample recording that the
-- demo copied into their own folder, which the ownership predicate already
-- scopes to them.
drop policy if exists audio_recordings_insert_own on storage.objects;
create policy audio_recordings_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not public.is_anon_session()
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
    and not public.is_anon_session()
  )
  with check (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not public.is_anon_session()
  );
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

-- This is the ONE write in the whole schema that an anonymous (demo) session
-- is still allowed to make, and the omission of `not public.is_anon_session()`
-- here is deliberate rather than an oversight: asking a question is the feature
-- the demo exists to show. Every other write policy in every other file
-- carries that clause. UPDATE and DELETE below carry it too — a visitor may
-- add to their thread and may not rewrite or erase it.
--
-- What bounds the cost is not this policy but two counts in
-- app/api/chat/route.ts: the per-visitor cap, and the global monthly cap that
-- demo_questions_this_month() below answers.
drop policy if exists chat_messages_insert_own on public.chat_messages;
create policy chat_messages_insert_own on public.chat_messages
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- Without with check, a user could rewrite user_id and hand the row away.
drop policy if exists chat_messages_update_own on public.chat_messages;
create policy chat_messages_update_own on public.chat_messages
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  )
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists chat_messages_delete_own on public.chat_messages;
create policy chat_messages_delete_own on public.chat_messages
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

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

-- The GLOBAL demo cap's one query: every question asked this calendar month by
-- any anonymous visitor, across all of them.
--
-- security definer, and that is not a shortcut. Every policy above scopes this
-- table to the caller, so a demo visitor counting rows sees only their own —
-- which is exactly the number the PER-VISITOR cap wants and exactly the wrong
-- one for a shared ceiling. Counting across visitors has to step outside RLS,
-- and a definer function is the narrowest way to do it: it returns one integer
-- and exposes no rows to anybody.
--
-- NOT a new table. .claude/rules/chat.md forbids a rate-limit table on the
-- grounds that chat_messages already answers the question; a monthly ceiling is
-- that same question over a longer window, so it gets the same answer.
--
-- Scoped three ways, each load-bearing:
--   u.is_anonymous          the owner's own questions must never be charged to
--                           the demo's budget
--   c.role = 'user'         an assistant row is an answer, not a question
--   date_trunc('month')     the budget resets on the 1st, in UTC
--
-- search_path is empty, so both tables are schema-qualified. date_trunc, now
-- and count need no qualification: pg_catalog is searched implicitly whatever
-- search_path says.
create or replace function public.demo_questions_this_month()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.chat_messages c
  join auth.users u on u.id = c.user_id
  where u.is_anonymous
    and c.role = 'user'
    and c.created_at >= date_trunc('month', now());
$$;

-- A definer function is reachable by whoever holds EXECUTE, so the grant is the
-- whole access control. anon gets nothing, matching the table above.
revoke all on function public.demo_questions_this_month() from public, anon;
grant execute on function public.demo_questions_this_month() to authenticated;
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
-- tags + note_tags: flat, many-to-many labels on a note.
--
-- App Surfaces 07 draws two systems side by side and they are NOT the same
-- thing. Tags are cheap, colourful and applied by hand; collections carry
-- auto-file rules. Only the tag half exists here. Nothing in this file knows
-- about a collection, a rule or a match, and none of that belongs here later
-- either — a rule engine is its own table and its own decision.
--
-- Applied AFTER notes.sql, which is where notes_id_user_id_key lives. Read the
-- order out of config.toml, not from here.
--
-- Every statement is idempotent so the whole file can be re-applied.

-- slug, not name, is the identity — the same choice personas.sql made and for
-- the same reason. The client never sees a uuid: a uuid is per-user and does
-- not survive a reseed, so lib/notes/tags.ts exposes the slug as the tag id.
--
-- color_token is a TOKEN NAME, never a colour. 'tag-1'..'tag-5' resolve in
-- app/globals.css, which is the only file in this project that names a colour.
-- It is stored rather than computed at render time so a tag keeps its hue even
-- if the derivation in lib/notes/tags.ts is ever changed.
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Normalised: lower case, spaces collapsed to single hyphens. The key.
  slug text not null,
  -- What the user typed, rendered on the badge.
  name text not null,
  color_token text not null default 'tag-5'
    check (color_token in ('tag-1', 'tag-2', 'tag-3', 'tag-4', 'tag-5')),
  created_at timestamptz not null default now(),
  -- One "pricing" per user, never two. This is also what makes creation
  -- implicit and idempotent: typing an existing name conflicts and resolves to
  -- the row that is already there.
  unique (user_id, slug)
);

-- The target of note_tags' composite foreign key. Same reasoning as
-- personas_id_user_id_key: a foreign key is not subject to RLS, so a
-- single-column references tags (id) would let one user attach another user's
-- tag to their own note.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tags'::regclass
      and conname = 'tags_id_user_id_key'
  ) then
    alter table public.tags
      add constraint tags_id_user_id_key unique (id, user_id);
  end if;
end $$;

-- The join. A composite primary key, not a surrogate id: a note either carries
-- a tag or it does not, and (note_id, tag_id) says exactly that. It is also
-- what makes application IDEMPOTENT in the database rather than in the action
-- — a second insert of the same pair conflicts instead of doubling the badge.
--
-- user_id is carried rather than derived. It is what both foreign keys pin
-- against, and it is what the four RLS policies below predicate on.
create table if not exists public.note_tags (
  note_id uuid not null,
  tag_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, tag_id)
);

-- Both foreign keys are COMPOSITE, for the reason stated above. on delete
-- cascade: removing a note or a tag removes the attachment, which is the whole
-- meaning of a join row — there is nothing left to point at.
--
-- Drop-then-add rather than add-if-not-exists: Postgres has no if-not-exists
-- for constraints, and both statements are idempotent, which is what lets this
-- file be re-applied after an edit.
alter table public.note_tags
  drop constraint if exists note_tags_note_id_fkey;
alter table public.note_tags
  add constraint note_tags_note_id_fkey
  foreign key (note_id, user_id) references public.notes (id, user_id)
  on delete cascade;

alter table public.note_tags
  drop constraint if exists note_tags_tag_id_fkey;
alter table public.note_tags
  add constraint note_tags_tag_id_fkey
  foreign key (tag_id, user_id) references public.tags (id, user_id)
  on delete cascade;

-- Postgres does not index foreign keys automatically, and on delete cascade
-- has to find the rows it is deleting. The primary key already covers note_id.
create index if not exists note_tags_tag_id_idx on public.note_tags (tag_id);

alter table public.tags enable row level security;
alter table public.note_tags enable row level security;

-- Four per-operation policies per table, matching notes, note_chunks and
-- personas. Never one blanket `for all`. auth.uid() is wrapped in a select so
-- the planner evaluates it once per query rather than once per row, and every
-- policy carries an ownership predicate as well as `to authenticated` —
-- `to authenticated` alone is authentication without authorization.

drop policy if exists tags_select_own on public.tags;
create policy tags_select_own on public.tags
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists tags_insert_own on public.tags;
create policy tags_insert_own on public.tags
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

-- Without with check, a user could rewrite user_id and hand the row away.
drop policy if exists tags_update_own on public.tags;
create policy tags_update_own on public.tags
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  )
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists tags_delete_own on public.tags;
create policy tags_delete_own on public.tags
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists note_tags_select_own on public.note_tags;
create policy note_tags_select_own on public.note_tags
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists note_tags_insert_own on public.note_tags;
create policy note_tags_insert_own on public.note_tags
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists note_tags_update_own on public.note_tags;
create policy note_tags_update_own on public.note_tags
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  )
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists note_tags_delete_own on public.note_tags;
create policy note_tags_delete_own on public.note_tags
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

-- Grants are separate from RLS. Revoke first, then grant, so this file is the
-- sole authority on privileges: the project defaults hand anon and
-- authenticated TRUNCATE, which is not row-level and which RLS does not
-- constrain. anon is deliberately granted nothing — this app has no public
-- reads.
revoke all on public.tags from anon, authenticated, service_role;
revoke all on public.note_tags from anon, authenticated, service_role;

grant select, insert, update, delete on public.tags to authenticated;
grant select, insert, update, delete on public.note_tags to authenticated;

-- service_role is granted NOTHING here, and that is the deliberate choice.
-- Tagging is manual: no cron path and no generation pipeline reads or writes a
-- tag. The moment one does, it needs a grant, not a policy — service_role
-- already bypasses RLS and what it would lack is reachability.
-- collections + note_collections: named, hand-filled folders over notes.
--
-- App Surfaces 07 draws tags and collections side by side and they are NOT the
-- same thing. A tag is a cheap coloured label; a collection is a named place a
-- note is FILED into, and the drawing gives it auto-file rules. Only the manual
-- half exists here. Nothing in this file knows about a rule, a condition or a
-- match — a rule engine is its own table and its own decision, and it does not
-- get bolted onto these two tables later by widening a column.
--
-- Applied AFTER notes.sql, which is where notes_id_user_id_key lives. Read the
-- order out of config.toml, not from here.
--
-- Every statement is idempotent so the whole file can be re-applied.

-- slug, not name, is the identity — the same choice personas.sql and tags.sql
-- made and for the same reason. The client never sees a uuid: a uuid is
-- per-user and does not survive a reseed, so lib/notes/collections.ts exposes
-- the slug as the collection id, and the slug is what /collections/<slug>
-- routes on.
--
-- No colour column, unlike tags. A tag's hue is the whole point of a tag — the
-- badge has no other way to say which one it is at 9px. A collection is read
-- as a name in a rail, so a hue would be decoration with nothing to carry.
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Normalised: lower case, runs of non-alphanumerics collapsed to a single
  -- hyphen. The key, and the URL segment.
  slug text not null,
  -- What the user typed, rendered in the rail and on the detail page.
  name text not null,
  created_at timestamptz not null default now(),
  -- One "Q3 Planning" per user, never two. This is also what makes a rename
  -- into an existing name a 23505 the action can report rather than a silent
  -- merge of two collections.
  unique (user_id, slug)
);

-- The target of note_collections' composite foreign key. Same reasoning as
-- tags_id_user_id_key: a foreign key is not subject to RLS, so a single-column
-- references collections (id) would let one user file their note into another
-- user's collection.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.collections'::regclass
      and conname = 'collections_id_user_id_key'
  ) then
    alter table public.collections
      add constraint collections_id_user_id_key unique (id, user_id);
  end if;
end $$;

-- The join, and the reason this feature is many-to-many rather than a
-- collection_id column on notes. A note sits in as many collections as the
-- user files it into; "Q3 Planning" and "Hiring" are both true of the same
-- conversation, and a single column would force one of them to be a lie.
--
-- A composite primary key, not a surrogate id: a note either sits in a
-- collection or it does not, and (note_id, collection_id) says exactly that.
-- It is also what makes filing IDEMPOTENT in the database rather than in the
-- action — a second insert of the same pair conflicts instead of doubling the
-- membership.
--
-- user_id is carried rather than derived. It is what both foreign keys pin
-- against, and it is what the four RLS policies below predicate on.
create table if not exists public.note_collections (
  note_id uuid not null,
  collection_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, collection_id)
);

-- Both foreign keys are COMPOSITE, for the reason stated above. on delete
-- cascade: deleting a note or a collection removes the membership, which is
-- the whole meaning of a join row — there is nothing left to point at. Note
-- what it does NOT do: deleting a collection deletes memberships, never notes.
--
-- Drop-then-add rather than add-if-not-exists: Postgres has no if-not-exists
-- for constraints, and both statements are idempotent, which is what lets this
-- file be re-applied after an edit.
alter table public.note_collections
  drop constraint if exists note_collections_note_id_fkey;
alter table public.note_collections
  add constraint note_collections_note_id_fkey
  foreign key (note_id, user_id) references public.notes (id, user_id)
  on delete cascade;

alter table public.note_collections
  drop constraint if exists note_collections_collection_id_fkey;
alter table public.note_collections
  add constraint note_collections_collection_id_fkey
  foreign key (collection_id, user_id) references public.collections (id, user_id)
  on delete cascade;

-- Postgres does not index foreign keys automatically, and on delete cascade
-- has to find the rows it is deleting. The primary key already covers note_id.
-- This index is also the one the collection detail page reads on.
create index if not exists note_collections_collection_id_idx
  on public.note_collections (collection_id);

alter table public.collections enable row level security;
alter table public.note_collections enable row level security;

-- Four per-operation policies per table, matching notes, note_chunks, personas
-- and tags. Never one blanket `for all`. auth.uid() is wrapped in a select so
-- the planner evaluates it once per query rather than once per row, and every
-- policy carries an ownership predicate as well as `to authenticated` —
-- `to authenticated` alone is authentication without authorization.

drop policy if exists collections_select_own on public.collections;
create policy collections_select_own on public.collections
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists collections_insert_own on public.collections;
create policy collections_insert_own on public.collections
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

-- Rename goes through this policy, so it needs both clauses. Without
-- with check, a user could rewrite user_id and hand the collection away.
drop policy if exists collections_update_own on public.collections;
create policy collections_update_own on public.collections
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  )
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists collections_delete_own on public.collections;
create policy collections_delete_own on public.collections
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists note_collections_select_own on public.note_collections;
create policy note_collections_select_own on public.note_collections
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists note_collections_insert_own on public.note_collections;
create policy note_collections_insert_own on public.note_collections
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists note_collections_update_own on public.note_collections;
create policy note_collections_update_own on public.note_collections
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  )
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists note_collections_delete_own on public.note_collections;
create policy note_collections_delete_own on public.note_collections
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

-- Grants are separate from RLS. Revoke first, then grant, so this file is the
-- sole authority on privileges: the project defaults hand anon and
-- authenticated TRUNCATE, which is not row-level and which RLS does not
-- constrain. anon is deliberately granted nothing — this app has no public
-- reads.
revoke all on public.collections from anon, authenticated, service_role;
revoke all on public.note_collections from anon, authenticated, service_role;

grant select, insert, update, delete on public.collections to authenticated;
grant select, insert, update, delete on public.note_collections to authenticated;

-- service_role is granted NOTHING here, and that is the deliberate choice.
-- Filing is manual: no cron path and no generation pipeline reads or writes a
-- membership. An auto-file rule engine would be the first thing that does, and
-- when it ships it needs a GRANT, not a policy — service_role already bypasses
-- RLS and what it would lack is reachability.
-- collection_rules + collection_rule_conditions + collection_rule_matches:
-- auto-file rules over collections.
--
-- The foot of collections.sql said an auto-file rule engine would be "its own
-- table and its own decision, and it does not get bolted onto these two tables
-- later by widening a column". This is that table. collections.sql is unchanged
-- by this file except for the service_role GRANT it predicted, which lives with
-- the table it applies to.
--
-- THE WRITE SURFACE IS MEMBERSHIP ONLY. A rule reads notes.title and
-- notes.attendee_emails and writes note_collections plus a match record here.
-- It never edits note content, never touches note_chunks, and never moves
-- notegen_status. That is a boundary, not a style preference: there is no
-- statement anywhere in this feature that writes to notes or note_chunks, and
-- service_role is granted nothing here that would let one.
--
-- Applied AFTER collections.sql, which is where collections_id_user_id_key and
-- note_collections live. Read the order out of config.toml, not from here.
--
-- Every statement is idempotent so the whole file can be re-applied.

-- A rule belongs to one collection. A collection may carry several, each with
-- its own counters -- the mockup prints three counts per RULE, not per
-- collection, so one rule per collection would make the counters ambiguous the
-- moment a second condition set was wanted.
--
-- No enabled flag and no name. A rule the user does not want is deleted; a
-- rule is read as its conditions, which are the only thing there is to name.
create table if not exists public.collection_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  collection_id uuid not null,
  created_at timestamptz not null default now()
);

alter table public.collection_rules
  drop constraint if exists collection_rules_collection_id_fkey;
alter table public.collection_rules
  add constraint collection_rules_collection_id_fkey
  foreign key (collection_id, user_id) references public.collections (id, user_id)
  on delete cascade;

-- The target of collection_rule_conditions' and collection_rule_matches'
-- composite foreign keys. Same reasoning as collections_id_user_id_key: a
-- foreign key is not subject to RLS, so a single-column references
-- collection_rules (id) would let one user hang a condition off another user's
-- rule.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.collection_rules'::regclass
      and conname = 'collection_rules_id_user_id_key'
  ) then
    alter table public.collection_rules
      add constraint collection_rules_id_user_id_key unique (id, user_id);
  end if;
end $$;

create index if not exists collection_rules_user_id_idx
  on public.collection_rules (user_id);
create index if not exists collection_rules_collection_id_idx
  on public.collection_rules (collection_id);

-- One clause of a rule. position 0 is the WHEN clause and every position above
-- it is an OR-WHEN clause -- the two names the mockup uses are ORDER, not two
-- kinds of thing, which is why one column carries both. The clauses of a rule
-- are OR'd: a rule matches when ANY of its conditions matches.
--
-- `kind` is a closed check constraint, not a lookup table and not free text.
-- Two condition types ship and adding a third is a schema decision with a
-- matching branch in lib/collection-rules/rule-engine.ts -- a rule kind the
-- engine cannot evaluate must not be storable.
create table if not exists public.collection_rule_conditions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  rule_id uuid not null,
  kind text not null
    check (kind in ('attendee_email_domain', 'title_keyword')),
  -- Stored already normalised by lib/collection-rules/rule-engine.ts: lower
  -- case, trimmed, and for a domain with any leading "@" removed. Normalising
  -- on write rather than on read is what makes the domain comparison an exact
  -- equality rather than a per-row transform.
  value text not null check (length(btrim(value)) > 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  -- The same clause twice in one rule is not two clauses. This is also what
  -- makes condition writes idempotent in the database rather than in the
  -- action.
  unique (rule_id, kind, value)
);

alter table public.collection_rule_conditions
  drop constraint if exists collection_rule_conditions_rule_id_fkey;
alter table public.collection_rule_conditions
  add constraint collection_rule_conditions_rule_id_fkey
  foreign key (rule_id, user_id) references public.collection_rules (id, user_id)
  on delete cascade;

create index if not exists collection_rule_conditions_rule_id_idx
  on public.collection_rule_conditions (rule_id);

-- THE MATCH RECORD, and the reason there is no counter column anywhere in this
-- file.
--
-- The mockup prints three counts per rule over a trailing 30-day window:
-- matched, needed review, false positives. Every one of them is a COUNT over
-- these rows with a matched_at cutoff predicate. An incrementing integer
-- column would be a second source of truth that can desync from the
-- memberships it claims to describe -- and a trailing window cannot be
-- maintained by incrementing at all, because rows leave the window with the
-- passage of time and nothing fires an event when they do.
--
-- unique (rule_id, note_id) is the "runs once" guarantee, held by the
-- database. A rule evaluates a note exactly once, ever: the cron sweep and the
-- Server Action can both reach the same note and the loser's insert conflicts
-- rather than doubling a count or re-filing a membership the user has already
-- removed.
create table if not exists public.collection_rule_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  rule_id uuid not null,
  note_id uuid not null,
  -- Denormalised from the rule so a match reads without a join and so the
  -- false-positive action knows which membership to remove without
  -- re-resolving the rule.
  collection_id uuid not null,
  -- Which condition kind actually fired. This is what the auto-file /
  -- needs-review split is decided from, and storing it means the split can be
  -- re-read later rather than inferred from a disposition.
  condition_kind text not null
    check (condition_kind in ('attendee_email_domain', 'title_keyword')),
  -- 'filed'          the membership was written automatically.
  -- 'needs_review'   matched, membership deliberately NOT written, waiting on
  --                  a human. See lib/collection-rules/rule-engine.ts for why
  --                  a title keyword lands here and a domain does not.
  -- 'false_positive' was 'filed', the user said it was wrong, and the
  --                  membership has been removed.
  disposition text not null default 'needs_review'
    check (disposition in ('filed', 'needs_review', 'false_positive')),
  matched_at timestamptz not null default now(),
  unique (rule_id, note_id)
);

alter table public.collection_rule_matches
  drop constraint if exists collection_rule_matches_rule_id_fkey;
alter table public.collection_rule_matches
  add constraint collection_rule_matches_rule_id_fkey
  foreign key (rule_id, user_id) references public.collection_rules (id, user_id)
  on delete cascade;

alter table public.collection_rule_matches
  drop constraint if exists collection_rule_matches_note_id_fkey;
alter table public.collection_rule_matches
  add constraint collection_rule_matches_note_id_fkey
  foreign key (note_id, user_id) references public.notes (id, user_id)
  on delete cascade;

alter table public.collection_rule_matches
  drop constraint if exists collection_rule_matches_collection_id_fkey;
alter table public.collection_rule_matches
  add constraint collection_rule_matches_collection_id_fkey
  foreign key (collection_id, user_id) references public.collections (id, user_id)
  on delete cascade;

-- The index the counters read on: every count is (rule_id, window) and then a
-- group by disposition, so rule_id leads and matched_at follows it.
create index if not exists collection_rule_matches_rule_id_matched_at_idx
  on public.collection_rule_matches (rule_id, matched_at desc);
-- The index the note detail page reads on, and what the note_id foreign key's
-- cascade finds its rows with.
create index if not exists collection_rule_matches_note_id_idx
  on public.collection_rule_matches (note_id);

alter table public.collection_rules enable row level security;
alter table public.collection_rule_conditions enable row level security;
alter table public.collection_rule_matches enable row level security;

-- Four per-operation policies per table, matching notes, note_chunks,
-- personas, tags and collections. Never one blanket `for all`. auth.uid() is
-- wrapped in a select so the planner evaluates it once per query rather than
-- once per row, and every policy carries an ownership predicate as well as
-- `to authenticated` -- `to authenticated` alone is authentication without
-- authorization.

drop policy if exists collection_rules_select_own on public.collection_rules;
create policy collection_rules_select_own on public.collection_rules
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists collection_rules_insert_own on public.collection_rules;
create policy collection_rules_insert_own on public.collection_rules
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists collection_rules_update_own on public.collection_rules;
create policy collection_rules_update_own on public.collection_rules
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  )
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists collection_rules_delete_own on public.collection_rules;
create policy collection_rules_delete_own on public.collection_rules
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists collection_rule_conditions_select_own
  on public.collection_rule_conditions;
create policy collection_rule_conditions_select_own
  on public.collection_rule_conditions
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists collection_rule_conditions_insert_own
  on public.collection_rule_conditions;
create policy collection_rule_conditions_insert_own
  on public.collection_rule_conditions
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists collection_rule_conditions_update_own
  on public.collection_rule_conditions;
create policy collection_rule_conditions_update_own
  on public.collection_rule_conditions
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  )
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists collection_rule_conditions_delete_own
  on public.collection_rule_conditions;
create policy collection_rule_conditions_delete_own
  on public.collection_rule_conditions
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists collection_rule_matches_select_own
  on public.collection_rule_matches;
create policy collection_rule_matches_select_own
  on public.collection_rule_matches
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists collection_rule_matches_insert_own
  on public.collection_rule_matches;
create policy collection_rule_matches_insert_own
  on public.collection_rule_matches
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

-- Marking a false positive is an UPDATE of disposition, so this one carries
-- real traffic. Both clauses: without with check a user could rewrite user_id
-- and hand the match row away.
drop policy if exists collection_rule_matches_update_own
  on public.collection_rule_matches;
create policy collection_rule_matches_update_own
  on public.collection_rule_matches
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  )
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists collection_rule_matches_delete_own
  on public.collection_rule_matches;
create policy collection_rule_matches_delete_own
  on public.collection_rule_matches
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

-- Grants are separate from RLS. Revoke first, then grant, so this file is the
-- sole authority on privileges: the project defaults hand anon and
-- authenticated TRUNCATE, which is not row-level and which RLS does not
-- constrain. anon is deliberately granted nothing.
revoke all on public.collection_rules from anon, authenticated, service_role;
revoke all on public.collection_rule_conditions from anon, authenticated, service_role;
revoke all on public.collection_rule_matches from anon, authenticated, service_role;

grant select, insert, update, delete on public.collection_rules to authenticated;
grant select, insert, update, delete on public.collection_rule_conditions to authenticated;
grant select, insert, update, delete on public.collection_rule_matches to authenticated;

-- service_role reads the rules and writes the match records, because the cron
-- path in app/api/cron/transcribe/route.ts carries no user session and
-- therefore no RLS identity. A grant is not a policy: service_role already
-- bypasses RLS, and what it would otherwise lack is reachability. That is also
-- why the cron path filters on user_id in application code -- the one standing
-- exception CLAUDE.md names.
--
-- SELECT on the two rule tables, never insert or update: the cron evaluates
-- rules, it does not author them. INSERT on matches, never delete: a match
-- record is the audit trail the counters are derived from, and an automated
-- path that could delete one could rewrite history. UPDATE is the user's, and
-- only through the Server Action -- marking a false positive is a human
-- judgement.
grant select on public.collection_rules to service_role;
grant select on public.collection_rule_conditions to service_role;
grant select, insert on public.collection_rule_matches to service_role;

-- The membership grant collections.sql predicted. It lives here, with the
-- feature that needs it, rather than in collections.sql: manual filing needs
-- nothing from service_role, and this is the first and only path that does.
-- SELECT and INSERT, never UPDATE or DELETE. The rule engine files a note; it
-- never unfiles one. Removing a membership is the false-positive action, which
-- runs as the user.
grant select on public.collections to service_role;
grant select, insert on public.note_collections to service_role;
-- user_settings: one row of per-account preferences, read and written by
-- /settings (App Surfaces 06).
--
-- ONE ROW PER USER, keyed by user_id. There is no surrogate id because there is
-- nothing a second row could mean — this product is single-owner
-- (docs/DECISIONS.md § Multi-tenancy), so an account has exactly one set of
-- preferences. A missing row is not an error: it is an account that has never
-- saved, and lib/settings/settings-types.ts supplies the defaults for it. That
-- is why nothing provisions a row on signup.
--
-- Applied AFTER notes.sql, which defines public.set_updated_at(). Read the
-- order out of config.toml, not from here.
--
-- Every statement is idempotent so the whole file can be re-applied. That
-- includes the drop below: `create table if not exists` never removes a column
-- from a table that already exists, so a dropped column is dropped here too.
--
-- WHAT IS DELIBERATELY NOT A COLUMN, because each would be a setting for a
-- behaviour this repo does not have:
--   - a diarization toggle. docs/DECISIONS.md § Speaker diarization: automatic
--     past ~28 minutes, "no manual toggle needed". Locked, not a gap.
--   - "keep local audio". No retention or deletion job exists.
--   - theme. Theme is a per-browser choice in localStorage, owned by
--     components/theme-toggle.tsx. A second copy here would be a second source
--     of truth that could disagree with the one the page actually paints.
--   - any Google connection or token. Connect ships as a UI stub.
--   - require_citations. Grounding is always on, so the switch could never
--     change an answer. Dropped 2026-09-26 (issue #3) by migration
--     20260926120000_drop_user_settings_require_citations.sql. The table stays
--     as the place the next real preference lands (docs/DECISIONS.md
--     § Settings); today it holds no preference column at all.
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings drop column if exists require_citations;

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

alter table public.user_settings enable row level security;

-- Four per-operation policies, matching every other table in this schema.
-- Never one blanket `for all`. auth.uid() is wrapped in a select so the planner
-- evaluates it once per query rather than once per row, and every policy
-- carries an ownership predicate as well as `to authenticated`.

drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own on public.user_settings
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- The first save is an insert (the Server Action upserts). with check is what
-- stops a user inserting a row that names somebody else's user_id.
drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own on public.user_settings
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

-- Both clauses. Without with check a user could rewrite user_id and hand their
-- preferences row to another account.
drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own on public.user_settings
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  )
  with check (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

drop policy if exists user_settings_delete_own on public.user_settings;
create policy user_settings_delete_own on public.user_settings
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and not public.is_anon_session()
  );

-- Grants are separate from RLS. Revoke first so this file is the sole
-- authority on privileges: the project defaults hand anon and authenticated
-- TRUNCATE, which is not row-level and which RLS does not constrain. anon is
-- granted nothing.
revoke all on public.user_settings from anon, authenticated, service_role;

grant select, insert, update, delete on public.user_settings to authenticated;

-- service_role is granted NOTHING. No cron path and no generation pipeline
-- reads a preference. A future preference read by chat would still not need
-- one — chat runs as the signed-in user, not as service_role.
