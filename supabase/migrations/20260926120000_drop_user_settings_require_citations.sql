-- Issue #3: "Require a citation for every claim" was saved but nothing read it.
-- Grounding is always on, so the setting is removed rather than wired. This
-- drops its column; the table and its policies stay (supabase/schemas/
-- user_settings.sql).
--
-- `if exists` on the table too: no earlier migration in this directory creates
-- public.user_settings (it was applied from the schema file), so a replay from
-- an empty database must not fail here.
alter table if exists public.user_settings drop column if exists require_citations;
