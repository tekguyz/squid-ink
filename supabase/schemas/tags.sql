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
  with check ((select auth.uid()) = user_id);

-- Without with check, a user could rewrite user_id and hand the row away.
drop policy if exists tags_update_own on public.tags;
create policy tags_update_own on public.tags
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists tags_delete_own on public.tags;
create policy tags_delete_own on public.tags
  for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists note_tags_select_own on public.note_tags;
create policy note_tags_select_own on public.note_tags
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists note_tags_insert_own on public.note_tags;
create policy note_tags_insert_own on public.note_tags
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists note_tags_update_own on public.note_tags;
create policy note_tags_update_own on public.note_tags
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists note_tags_delete_own on public.note_tags;
create policy note_tags_delete_own on public.note_tags
  for delete to authenticated
  using ((select auth.uid()) = user_id);

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
