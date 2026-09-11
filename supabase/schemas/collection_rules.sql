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
  with check ((select auth.uid()) = user_id);

drop policy if exists collection_rules_update_own on public.collection_rules;
create policy collection_rules_update_own on public.collection_rules
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists collection_rules_delete_own on public.collection_rules;
create policy collection_rules_delete_own on public.collection_rules
  for delete to authenticated
  using ((select auth.uid()) = user_id);

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
  with check ((select auth.uid()) = user_id);

drop policy if exists collection_rule_conditions_update_own
  on public.collection_rule_conditions;
create policy collection_rule_conditions_update_own
  on public.collection_rule_conditions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists collection_rule_conditions_delete_own
  on public.collection_rule_conditions;
create policy collection_rule_conditions_delete_own
  on public.collection_rule_conditions
  for delete to authenticated
  using ((select auth.uid()) = user_id);

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
  with check ((select auth.uid()) = user_id);

-- Marking a false positive is an UPDATE of disposition, so this one carries
-- real traffic. Both clauses: without with check a user could rewrite user_id
-- and hand the match row away.
drop policy if exists collection_rule_matches_update_own
  on public.collection_rule_matches;
create policy collection_rule_matches_update_own
  on public.collection_rule_matches
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists collection_rule_matches_delete_own
  on public.collection_rule_matches;
create policy collection_rule_matches_delete_own
  on public.collection_rule_matches
  for delete to authenticated
  using ((select auth.uid()) = user_id);

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
