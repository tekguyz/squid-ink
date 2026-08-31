-- storage_audio: the private bucket recordings are uploaded to, and the
-- owner-only policies that guard it.
--
-- Ownership lives in the object PATH, not in metadata: every object is stored
-- at {user_id}/{note_id}. storage.objects.owner_id exists, but it records who
-- uploaded a row rather than constraining who may write one, and a client
-- picks its own destination path. Encoding the owner as the first path segment
-- lets the policy check the very thing it enforces. Same reasoning as the
-- composite foreign key on note_chunks.persona_id.
--
-- INSERT + SELECT + UPDATE, deliberately no DELETE. Supabase's upsert path
-- replaces an object in place, which needs UPDATE as well as INSERT; granting
-- INSERT alone makes replacement fail silently (docs/KNOWN_GAPS.md). DELETE is
-- left out because note deletion is not a decided feature -- there is nothing
-- for a delete policy to serve yet, and a speculative one is a hole with no
-- consumer.
--
-- Every statement is idempotent so the whole file can be re-applied after an
-- edit. That is the only iteration loop: edit this file, re-apply this file.

-- The bucket. public = false means no anonymous object URLs; reads go through
-- an authenticated request that RLS filters, or a signed URL nothing issues yet.
insert into storage.buckets (id, name, public)
values ('audio-recordings', 'audio-recordings', false)
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------------
-- Grants: NOT ours to control here, and this file must not pretend otherwise.
-- ---------------------------------------------------------------------------
--
-- notes.sql, personas.sql and note_chunks.sql each open with `revoke all` and
-- then grant explicitly, so the file is the sole authority on privileges. That
-- pattern does not transfer to the storage schema, and the difference was
-- measured on this project rather than assumed:
--
--   * storage.objects and storage.buckets are owned by supabase_storage_admin,
--     not postgres.
--   * anon, authenticated and service_role each already hold
--     DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on both
--     tables, and information_schema.role_table_grants names the grantor of
--     every one of them as supabase_storage_admin.
--   * Postgres only lets a role revoke grants that role itself made. Running
--     `revoke all on storage.objects from anon` as postgres raises NO error --
--     it emits a warning and changes nothing. A probe confirmed the privilege
--     was still present afterwards. A revoke here would therefore be a no-op
--     that reads like a lockdown, which is worse than no line at all.
--   * The obvious workaround does not exist either: postgres is not a member
--     of supabase_storage_admin, and `set role` to supabase_storage_admin,
--     supabase_privileged_role and supabase_admin all fail with 42501. The
--     dashboard SQL editor connects as this same postgres role, so there is no
--     path from this project to those grants at all.
--
-- What actually keeps anon out is therefore RLS, not grants. storage.objects
-- has relrowsecurity = true, and the three policies below are the only
-- policies on it -- all of them `to authenticated`. A role with no policy
-- matches no rows, so anon reads nothing, writes nothing and updates nothing.
--
-- The one privilege RLS genuinely does not constrain is TRUNCATE, which anon
-- holds. It is not reachable: config.toml exposes only the `public` and
-- `graphql_public` schemas to the Data API, so PostgREST cannot address
-- storage.objects under any role, and the Storage API never issues TRUNCATE.
-- This is recorded in docs/KNOWN_GAPS.md rather than silently accepted.
--
-- No grant statement here either. authenticated already holds SELECT, INSERT
-- and UPDATE from supabase_storage_admin, so a grant from postgres would only
-- add a duplicate catalog entry alongside the owner's. The revoke below is
-- narrow and deliberate: it removes grants POSTGRES made, which is exactly the
-- duplicate an earlier revision of this file left behind, and nothing else.
revoke all on storage.objects from anon, authenticated;
revoke all on storage.buckets from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
--
-- Three per-operation policies, not one blanket rule.
--
-- auth.uid() is wrapped in a select so the planner evaluates it once per query
-- instead of once per row. Each policy also pins bucket_id: storage.objects is
-- one table for every bucket, so an unscoped predicate would silently govern
-- any bucket added later.
--
-- There is no DELETE policy. authenticated does hold the DELETE privilege from
-- supabase_storage_admin and that cannot be revoked from here, but a privilege
-- without a policy matches no rows on an RLS-enabled table, so no authenticated
-- user can delete an object. RLS is the layer where "no deletion this pass" is
-- actually enforceable, and it is enforced.

drop policy if exists audio_recordings_select_own on storage.objects;
create policy audio_recordings_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists audio_recordings_insert_own on storage.objects;
create policy audio_recordings_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- UPDATE needs both clauses. using decides which rows may be replaced; without
-- with check, a user could overwrite their own object and move it under
-- somebody else's prefix in the same statement.
drop policy if exists audio_recordings_update_own on storage.objects;
create policy audio_recordings_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'audio-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
