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
