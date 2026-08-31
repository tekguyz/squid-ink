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
