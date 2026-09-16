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
