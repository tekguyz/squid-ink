-- Second migration: the personas table and takeaway attribution.
--
-- Hand-authored, not generated. `supabase db diff` builds a shadow database
-- in Docker, which is not installed on this machine (docs/KNOWN_GAPS.md), so
-- the delta is assembled here from the declarative schema files instead:
--
--   * supabase/schemas/personas.sql, verbatim and in full. The file is new,
--     and every statement in it is idempotent, so the whole file IS the
--     delta.
--   * the persona_id column, its foreign key and its index, lifted from
--     supabase/schemas/note_chunks.sql. Nothing else in that file changed;
--     migration 20260830134926 already carries the rest.
--
-- Ordering matters: personas must exist before note_chunks references it.
--
-- Verified after applying by reading pg_constraint, pg_indexes, pg_policies
-- and information_schema.columns back from the linked project, since
-- `db diff` is unavailable. The seed data is NOT here — seeding is
-- supabase/seed.sql, not schema.

-- ---------------------------------------------------------------------------
-- supabase/schemas/personas.sql
-- ---------------------------------------------------------------------------

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

drop policy if exists personas_delete_own on public.personas;
create policy personas_delete_own on public.personas
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Revoke first, then grant, so this file is the sole authority on
-- privileges. The project defaults hand anon and authenticated TRUNCATE,
-- REFERENCES and TRIGGER on every new public table; TRUNCATE is not
-- row-level, so RLS does not constrain it.
revoke all on public.personas from anon, authenticated;

-- anon is deliberately granted nothing — this app has no public reads.
grant select, insert, update, delete on public.personas to authenticated;

-- ---------------------------------------------------------------------------
-- supabase/schemas/note_chunks.sql — the persona_id delta only
-- ---------------------------------------------------------------------------

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
alter table public.note_chunks
  drop constraint if exists note_chunks_persona_id_fkey;
alter table public.note_chunks
  add constraint note_chunks_persona_id_fkey
  foreign key (persona_id, user_id) references public.personas (id, user_id)
  on delete set null (persona_id);

-- Postgres does not index foreign keys automatically, and the takeaway read
-- groups by exactly this column.
create index if not exists note_chunks_persona_id_idx
  on public.note_chunks (persona_id);
