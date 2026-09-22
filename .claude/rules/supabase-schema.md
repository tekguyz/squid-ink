---
paths:
  - "supabase/**"
  - "scripts/verify-rls.mjs"
  - "scripts/verify-storage-rls.mjs"
  - "scripts/verify-persona-provisioning.mjs"
---

# Declarative schema workflow

Hosted project only. There is no local stack — **Docker is not installed on
this machine**, and `supabase db pull` / `supabase db dump` both fail without
it because they build a shadow database. Everything below runs against the
linked project through the management API, needing neither Docker nor the
database password.

`supabase/schemas/*.sql` is the source of truth. `config.toml` lists them in
dependency order — **not** a glob, which would sort `note_chunks.sql` before
`notes.sql` and break the foreign key. The order is `notes.sql`,
`personas.sql`, `note_chunks.sql`, `persona_provisioning.sql`,
`storage_audio.sql`: personas needs `set_updated_at()` from notes, note_chunks
carries a foreign key to personas, and persona_provisioning's trigger writes
into personas. `storage_audio.sql` depends on none of them and sits last.
Read the list out of `config.toml` rather than from here.

**Schema-file-first, no exceptions.** Never paste DDL into `db query` as an
inline argument. Edit the `.sql` file, then apply that exact file. Every
statement is idempotent, so iterating means re-running the whole file. Inline
`db query` is for `select` verification only.

    npx supabase db query --linked --project-ref <ref> --file supabase/schemas/notes.sql
    npx supabase db advisors --linked --project-ref <ref> --type all --level info

Never call `apply_migration` while iterating — it writes a migration history
entry on every call and blocks further diffing.

When the shape is final: `supabase migration new <name>`, fill it with `cat`
of the schema files in order, `supabase migration repair --status applied`,
then confirm with `supabase migration list --linked`. Verify with
`git hash-object` that the migration and the concatenated schema files match,
and read the live catalog back — `pg_policies`, `pg_indexes`,
`information_schema.columns`, `pg_constraint` — since `db diff` is unavailable.

## Composite foreign keys

The hard rule is in `CLAUDE.md` § Supabase → RLS rules. The mechanics: a
foreign key between two user-owned tables carries `user_id`, so
`note_chunks.persona_id` references `personas (id, user_id)`, not
`personas (id)`. Foreign keys are validated as the referenced table's owner and
are **not** subject to RLS, so a single-column reference lets one user point
their row at another user's row. The referenced table needs a matching
`unique (id, user_id)` for this. `on delete set null` then names the nullable
column — `on delete set null (persona_id)`, Postgres 15 and later — or it would
try to null `user_id` too.

## Grants are separate from RLS

This project was created with "Automatically expose new tables" off, so each
table grants `authenticated` explicitly. Schema files `revoke all` first: the
project defaults hand `anon` and `authenticated` TRUNCATE, which is not
row-level and which RLS does not constrain. `anon` is granted nothing.

`service_role` is granted `select, insert, update, delete` on `public.notes`
and `public.note_chunks`, and nothing else — see the grant blocks in both
schema files. Before 2026-08-31 it held only `REFERENCES, TRIGGER, TRUNCATE`,
so every cron read failed with `permission denied for table notes`. A grant is
not a policy: `service_role` already bypasses RLS, what it lacked was
reachability.
