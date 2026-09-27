-- demo_visitors: demo mode's door and its cleanup (issue #19, docs/adr/0001).
--
-- A demo visitor is an anonymous auth identity, created when someone presses
-- "Try the demo" on the landing page. It owns only its chat. Seven days after
-- it was created, it is deleted, and its chat_messages go with it by the
-- cascade on chat_messages.user_id. Nothing else is theirs to delete: they
-- own no notes, no chunks, no personas and no Storage objects, because every
-- write policy refuses an anonymous session and persona_provisioning.sql
-- skips them.
--
-- pg_cron, in the database, rather than the Vercel cron path. The job is one
-- statement against auth.users; a route would need the secret key, a bearer
-- secret and a schedule in vercel.json to run the same statement.
--
-- Applied last in config.toml: it depends on nothing but auth.users.
--
-- Every statement is idempotent so the whole file can be re-applied.

-- ---------------------------------------------------------------------------
-- The door: anonymous signups only
-- ---------------------------------------------------------------------------
--
-- Supabase refuses signInAnonymously while "Allow new users to sign up" is
-- off — measured 2026-09-26, `Signups not allowed for this instance`, and the
-- auth server's anonymous handler checks DisableSignup before anything else.
-- So the switch is ON, and this hook is what keeps public signup closed
-- (docs/DECISIONS.md § Auth → Signup access model, still permanent).
--
-- It runs before the auth server creates a user on every signup path — email,
-- phone, OAuth, anonymous — and refuses every one that is not anonymous. The
-- admin API does not call it (read in supabase/auth internal/api/admin.go on
-- 2026-09-26), so the dashboard's "Add user", the dev-login route and
-- scripts/load-demo-owner.mjs still create real accounts.
--
-- Registered as the project's before-user-created hook in the dashboard
-- (Authentication → Hooks), mirrored in config.toml. The hook must exist
-- before signup is switched on, or there is a window with the door open.
create or replace function public.hook_only_anonymous_signups(event jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when coalesce((event -> 'user' ->> 'is_anonymous')::boolean, false)
      then '{}'::jsonb
    else jsonb_build_object(
      'error', jsonb_build_object(
        'message', 'Signups not allowed for this instance',
        'http_code', 403
      )
    )
  end;
$$;

-- Only the auth server calls it.
revoke all on function public.hook_only_anonymous_signups(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.hook_only_anonymous_signups(jsonb)
  to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- The cleanup
-- ---------------------------------------------------------------------------

-- Supabase installs pg_cron into pg_catalog; its objects live in schema cron.
create extension if not exists pg_cron with schema pg_catalog;

-- ANONYMOUS ONLY, and that predicate is the whole safety of this function.
-- `is_anonymous` is the auth server's own column, the same fact the JWT's
-- is_anonymous claim carries into public.is_anon_session(). A real account is
-- never anonymous, so no age makes it eligible.
--
-- created_at, not last_sign_in_at: a visit is seven days long from the press
-- of the button, however often the visitor returns inside it.
--
-- security definer because no caller role can delete from auth.users; the
-- owner (postgres) can. Nobody but the cron job calls it — EXECUTE is revoked
-- from every API role below, so it is not reachable through PostgREST.
--
-- Returns how many identities it removed, which is what the cron run log and
-- scripts/verify-demo-rls.mjs read.
create or replace function public.delete_expired_demo_visitors()
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with gone as (
    delete from auth.users
    where is_anonymous
      and created_at < now() - interval '7 days'
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.delete_expired_demo_visitors()
  from public, anon, authenticated, service_role;

-- Daily at 04:17 UTC, an arbitrary quiet minute. cron.schedule with a job name
-- replaces the job of that name, so re-applying this file does not add a
-- second one.
select cron.schedule(
  'delete-expired-demo-visitors',
  '17 4 * * *',
  $$select public.delete_expired_demo_visitors()$$
);
