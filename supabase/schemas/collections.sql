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
  with check ((select auth.uid()) = user_id);

-- Rename goes through this policy, so it needs both clauses. Without
-- with check, a user could rewrite user_id and hand the collection away.
drop policy if exists collections_update_own on public.collections;
create policy collections_update_own on public.collections
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists collections_delete_own on public.collections;
create policy collections_delete_own on public.collections
  for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists note_collections_select_own on public.note_collections;
create policy note_collections_select_own on public.note_collections
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists note_collections_insert_own on public.note_collections;
create policy note_collections_insert_own on public.note_collections
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists note_collections_update_own on public.note_collections;
create policy note_collections_update_own on public.note_collections
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists note_collections_delete_own on public.note_collections;
create policy note_collections_delete_own on public.note_collections
  for delete to authenticated
  using ((select auth.uid()) = user_id);

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
