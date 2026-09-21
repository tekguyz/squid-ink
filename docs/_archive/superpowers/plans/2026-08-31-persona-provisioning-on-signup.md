# Persona Provisioning on Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking. Subagent budget for this plan is **zero** — execute inline.

**Goal:** Every new `auth.users` row is provisioned, in the same transaction, with
the same four default personas the seed owner has, so a brand-new signup can pick
between all four lenses with no application code involved.

**Architecture:** A `SECURITY DEFINER` function in the `public` schema, owned by
`postgres` (which carries `BYPASSRLS`), inserts four `public.personas` rows for
`NEW.id`. An `AFTER INSERT ... FOR EACH ROW` trigger on `auth.users` calls it.
RLS on `public.personas` is untouched — the function bypasses it by ownership, not
by a new policy. The four rows' column values are copied verbatim out of
`supabase/seed.sql`, which is the only place they exist today.

**Tech Stack:** Postgres 17 on hosted Supabase, declarative schema files applied
through `npx supabase db query --linked --file`, hand-authored migrations (no
Docker on this machine so `db diff` / `db pull` are unavailable),
`@supabase/supabase-js` 2.112.4 admin API for the verification script.

**Spec:** the user's "Provision default personas on signup" prompt, reproduced in
the conversation that produced this plan. Section numbers below refer to it.

## Global Constraints

- **Do not modify** `lib/notes/default-persona.ts`, anything under `components/`,
  anything under `lib/mock/`, `supabase/schemas/personas.sql`'s existing content,
  `supabase/schemas/note_chunks.sql`, or `supabase/seed.sql`.
- **Schema-file-first, no exceptions.** Never pass DDL to `db query` as an inline
  `--query` argument. Edit the `.sql` file, then apply that exact file with
  `--file`. Inline `db query` is for `select` verification only.
- **Never call `apply_migration`** while iterating — it writes a migration history
  entry on every call and blocks further diffing.
- Every statement in a schema file is **idempotent**: `create or replace function`,
  `drop trigger if exists` then `create trigger`.
- **RLS is untouched.** The four per-operation policies on `public.personas`
  (`for select|insert|update|delete to authenticated`, predicate
  `(select auth.uid()) = user_id`) do not change. Do **not** add an
  `authenticated`-can-insert-any-`user_id` policy.
- **`anon` is granted nothing**, on any object this plan creates.
- The trigger fires on `auth.users` **INSERT only**. No backfill of existing
  accounts.
- Project ref: `pbwvvakzbrimmdntqxxn`. Secret key and fixture credentials live in
  the gitignored `.env.local`; the worktree copy was made by hand at setup.
- Persona column values are **copied verbatim** from `supabase/seed.sql`. Do not
  invent a column name, a `sub` string, a `depth`, or a `quick_actions` entry.

### The four persona rows, verbatim from `supabase/seed.sql`

| slug | name | sub | depth | quick_actions | sort_order |
|---|---|---|---|---|---|
| `neutral-analyst` | `Neutral Analyst` | `dense · no framing` | `dense` | `Extract decisions only`, `Timeline of blockers`, `Unanswered questions`, `Diff against last call` | 0 |
| `sales-coach` | `Sales Coach` | `coaching · direct` | `dense` | `Score objection handling`, `Draft follow-up email`, `Next-call agenda`, `Concessions made` | 1 |
| `investor` | `Investor` | `economics · risk` | `dense` | `Unit-economics read`, `Expansion risk memo`, `Diligence questions`, `Quantified risks` | 2 |
| `engineering-lead` | `Engineering Lead` | `scope · sequencing` | `dense` | `Scope the mapping work`, `Risk register entry`, `Sequencing plan`, `Handoff brief` | 3 |

`id` is **not** copied. `seed.sql` pins `66666666-0000-4000-8000-00000000000N`
because it needs `on conflict (id) do nothing` re-runnability for one known owner.
A trigger runs for every user, so a pinned `id` would collide on the primary key
for the second signup. The trigger lets the column default `gen_random_uuid()`
supply it. `created_at` / `updated_at` also take their defaults.

---

## File Structure

- **Create** `supabase/schemas/persona_provisioning.sql` — the function and the
  trigger. Separate from `personas.sql` because it depends on the table existing,
  and `config.toml`'s `schema_paths` is an ordered list, not a glob.
- **Modify** `supabase/config.toml:64` — append the new file to `schema_paths`
  after `./schemas/personas.sql`. It must come after `personas.sql`; its position
  relative to `note_chunks.sql` is free, so put it last, which keeps the existing
  entries' order untouched.
- **Create** `supabase/migrations/20260831HHMMSS_persona_provisioning.sql` — a
  header comment block explaining the hand-authoring, then the new schema file
  **verbatim and in full**. Same discipline as
  `20260830223821_personas_and_chunk_attribution.sql`.
- **Create** `scripts/verify-persona-provisioning.mjs` — a service-role script in
  the shape of `scripts/verify-rls.mjs`: same `loadEnv` helper, same
  `console.log` / `failed` / `process.exit` reporting style.

No TypeScript, React, or CSS file changes. `npm run build`, `npm run typecheck`
and `npm test` are regression gates here, not the proof; the proof is the
verification script.

---

### Task 1: The schema file and the `config.toml` wiring

**Files:**
- Create: `supabase/schemas/persona_provisioning.sql`
- Modify: `supabase/config.toml:64`

**Interfaces:**
- Consumes: `public.personas` from `supabase/schemas/personas.sql` — columns
  `id uuid pk default gen_random_uuid()`, `user_id uuid not null references
  auth.users(id) on delete cascade`, `slug text not null`, `name text not null`,
  `sub text not null`, `depth text not null default 'dense' check (depth in
  ('brief','dense','exhaustive'))`, `quick_actions text[] not null default '{}'`,
  `sort_order integer not null default 0`, `created_at`, `updated_at`, plus
  `unique (user_id, slug)`.
- Produces: `public.provision_default_personas()` returning `trigger`, and the
  trigger `on_auth_user_created_provision_personas` on `auth.users`. Task 2 embeds
  this file byte-for-byte; Task 3 asserts against the rows it writes.

- [ ] **Step 1: Write `supabase/schemas/persona_provisioning.sql`**

Full content is given in the execution notes below the task list — it is long
enough that repeating it here would obscure the step sequence. Key requirements
that the reviewer must check line by line:

  - `create or replace function public.provision_default_personas()` —
    `returns trigger`, `language plpgsql`, `security definer`,
    **`set search_path = ''`**. An unqualified `search_path` on a
    `security definer` function is the `function_search_path_mutable` advisor
    WARN and a genuine privilege-escalation path: the caller controls
    `search_path`, so an unqualified `personas` could resolve to a table they
    created. Every identifier in the body is therefore schema-qualified
    (`public.personas`, `pg_catalog.array[...]`).
  - The body is a single `insert into public.personas (user_id, slug, name, sub,
    depth, quick_actions, sort_order) values (...), (...), (...), (...)` with
    `NEW.id` as `user_id`, then `on conflict (user_id, slug) do nothing`,
    then `return NEW`.
  - `revoke all on function public.provision_default_personas() from public;` then
    `grant execute ... to supabase_auth_admin;`. `supabase_auth_admin` is the role
    GoTrue inserts `auth.users` as — including for the admin API `createUser` call
    the verification script makes — and `EXECUTE` on a `SECURITY DEFINER` function
    is still checked against the *caller*. `anon` and `authenticated` are granted
    nothing, matching this project's revoke-then-grant discipline.
  - `drop trigger if exists on_auth_user_created_provision_personas on auth.users;`
    followed by `create trigger ... after insert on auth.users for each row
    execute function public.provision_default_personas();`. `after insert`, not
    `before`: `personas.user_id` has a foreign key to `auth.users (id)`, so the
    row must exist first. Drop-then-create rather than a bare `create trigger`,
    which errors 42710 on re-apply.
  - No `alter policy`, no `create policy`, no `alter table ... enable row level
    security` — nothing in this file touches `public.personas`' RLS.

- [ ] **Step 2: Append the file to `schema_paths` in `supabase/config.toml`**

```toml
schema_paths = ["./schemas/notes.sql", "./schemas/personas.sql", "./schemas/note_chunks.sql", "./schemas/persona_provisioning.sql"]
```

- [ ] **Step 3: Apply the schema file to the linked project**

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn --file supabase/schemas/persona_provisioning.sql
```

Expected: success, no error. If it fails on `create trigger ... on auth.users`
with `must be owner of relation users`, the management-API role lacks
`supabase_auth_admin` membership — stop and report; do not work around it with a
policy.

- [ ] **Step 4: Apply it a second time, unchanged**

Run the identical command again. Expected: success again, proving idempotency.
A failure here means a `create` is missing its `if not exists` / `or replace` /
`drop ... if exists` guard.

- [ ] **Step 5: Read the catalog back**

`db diff` is unavailable, so verify by `select`. Run each of these as an inline
`--query` (verification selects are the one permitted inline use):

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select tgname, tgenabled, pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal"
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select p.proname, p.prosecdef, p.proconfig, r.rolname as owner from pg_proc p join pg_roles r on r.oid = p.proowner where p.proname = 'provision_default_personas'"
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select policyname, cmd, roles, qual, with_check from pg_policies where tablename = 'personas' order by cmd"
```

Expected: the trigger exists and is enabled (`tgenabled = 'O'`); `prosecdef = t`
and `proconfig = {search_path=}`; owner is a role with `BYPASSRLS`; the four
persona policies are byte-identical to what they were before this plan.

- [ ] **Step 6: Record the pre-change row counts (needed by the report)**

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select u.email, count(p.id) as personas from auth.users u left join public.personas p on p.user_id = u.id group by u.email order by u.email"
```

Expected: `squid-ink-owner@example.test` = 4 (it is both the seed owner and the
RLS fixture owner — the same account), `squid-ink-intruder@example.test` = 1 (the
`rls-probe` persona `scripts/verify-rls.mjs` inserts). Capture the exact output;
the same query is re-run in Task 4 and the two must match.

- [ ] **Step 7: Commit**

```bash
git add supabase/schemas/persona_provisioning.sql supabase/config.toml
git commit -m "db: provision the four default personas on auth.users insert"
```

---

### Task 2: The hand-authored migration

**Files:**
- Create: `supabase/migrations/<timestamp>_persona_provisioning.sql`

**Interfaces:**
- Consumes: `supabase/schemas/persona_provisioning.sql` from Task 1, byte-for-byte.
- Produces: a migration history entry named `persona_provisioning`.

- [ ] **Step 1: Create the migration file**

```bash
npx supabase migration new persona_provisioning
```

This writes an empty timestamped file. Note the exact filename.

- [ ] **Step 2: Fill it — header comment, then the schema file verbatim**

Write the header block by hand (explaining that this is hand-authored because
`db diff` needs a Docker shadow database, and that the whole schema file is the
delta because the file is new and every statement in it is idempotent), then
append the schema file with `cat`, unmodified:

```bash
cat supabase/schemas/persona_provisioning.sql >> supabase/migrations/<timestamp>_persona_provisioning.sql
```

- [ ] **Step 3: Prove the embedded SQL matches the schema file byte-for-byte**

The migration has a header the schema file does not, so hash the migration with
its header stripped. The header ends at the last line before the schema file's
own first line. Use the schema file's byte length to slice the tail:

```bash
git hash-object supabase/schemas/persona_provisioning.sql
tail -c $(wc -c < supabase/schemas/persona_provisioning.sql) supabase/migrations/<timestamp>_persona_provisioning.sql | git hash-object --stdin
```

Expected: the two hashes are identical. If they differ, the `cat` was edited
after the fact, or line endings were rewritten — fix the migration, never the
schema file.

- [ ] **Step 4: Mark it applied and confirm**

The DDL is already live from Task 1 Step 3, so this repairs history rather than
pushing:

```bash
npx supabase migration repair --linked --project-ref pbwvvakzbrimmdntqxxn --status applied <timestamp>
npx supabase migration list --linked --project-ref pbwvvakzbrimmdntqxxn
```

Expected: three rows, all with matching Local and Remote columns:
`20260830134926`, `20260830223821`, `<timestamp>`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations
git commit -m "db: hand-author the persona_provisioning migration"
```

---

### Task 3: The verification script

**Files:**
- Create: `scripts/verify-persona-provisioning.mjs`

**Interfaces:**
- Consumes: `.env.local` keys `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
  `RLS_TEST_OWNER_EMAIL`, `RLS_TEST_INTRUDER_EMAIL`. Reuses the `loadEnv` helper
  verbatim from `scripts/verify-rls.mjs` (copied, not imported — that file is a
  top-level script with side effects, so importing it would run the RLS proof).
- Produces: exit code 0 on pass, 1 on fail, and a printed transcript that is the
  evidence the reporting contract requires.

- [ ] **Step 1: Write the script**

Required behaviour, in order:

  1. Build a service-role admin client from `SUPABASE_SECRET_KEY`.
  2. Count personas for the seed owner and both fixture accounts **before**
     anything else, by email, and print them.
  3. `admin.auth.admin.createUser({ email, password, email_confirm: true })` with
     a unique-per-run email — `provisioning-probe-${Date.now()}@example.test`.
     A fresh address every run, so the script can never collide with a leftover
     account and can never be confused for a fixture.
  4. Immediately `select` all persona columns for that new user id, ordered by
     `sort_order`, through the **admin** client. RLS is irrelevant here; the point
     under test is the trigger, and the script has no password-grant session for a
     user it is about to delete.
  5. Assert `rows.length === 4`.
  6. Assert each row against an `EXPECTED` array holding the four rows' `slug`,
     `name`, `sub`, `depth`, `quick_actions` and `sort_order` copied verbatim from
     the table in Global Constraints. Compare `quick_actions` with
     `JSON.stringify`, which is order-sensitive — rail order is part of the
     contract. Assert `user_id === newUserId` on every row.
  7. Print every created row as JSON. A count is not evidence; the values are.
  8. `admin.auth.admin.deleteUser(newUserId)`, then re-`select` personas for that
     id and assert zero rows remain — which also proves the
     `on delete cascade` on `personas.user_id`.
  9. Re-count personas for the seed owner and both fixture accounts **after**, and
     assert each is unchanged from step 2.
  10. Run the delete inside a `finally`, so a failed assertion still cleans up the
      test account. No orphaned users, no dashboard step.
  11. `console.log(failed ? "FAIL" : "PASS")` and `process.exit(failed ? 1 : 0)`.

- [ ] **Step 2: Run it**

```bash
node scripts/verify-persona-provisioning.mjs
```

Expected: `PASS`, four rows printed with the exact seed values, `deleted=true`,
`remaining=0`, and identical before/after counts.

- [ ] **Step 3: Run it a second time**

Expected: `PASS` again, with a different probe email and identical before/after
counts — proving the first run left nothing behind.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-persona-provisioning.mjs
git commit -m "scripts: prove signup provisions the four default personas"
```

---

### Task 4: Regression gates and advisors

**Files:** none modified.

- [ ] **Step 1: Confirm the untouched accounts**

Re-run the Task 1 Step 6 query. Expected: byte-identical output to what Task 1
captured.

- [ ] **Step 2: Prove RLS still holds**

```bash
node scripts/verify-rls.mjs
```

Expected: `PASS`. This is required because the plan added an object that writes
to `public.personas`; the RLS proof is what shows it did not open a read path.

- [ ] **Step 3: Run the advisors**

```bash
npx supabase db advisors --linked --project-ref pbwvvakzbrimmdntqxxn --type all --level info
```

Compare against the pre-change output. Any **new** WARN-or-higher finding is
reported in the summary, not dismissed. The one to watch for is
`function_search_path_mutable` — if it appears, the `set search_path = ''` is
missing from the function and Task 1 must be revisited.

- [ ] **Step 4: Run the three npm gates**

```bash
npm run typecheck
npm test
npm run build
```

Expected: `tsc` clean, 59 tests passing (the pre-change baseline), build
succeeds.

- [ ] **Step 5: Commit any doc updates, then stop for review**

---

## Execution notes: full text of `supabase/schemas/persona_provisioning.sql`

The file the executor writes in Task 1 Step 1. Comments are part of the file —
this codebase's schema files explain *why*, and the migration embeds this text
verbatim.

```sql
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
```

**Deliberate omission — no exception handler.** Wrapping the insert in
`exception when others then return new` would keep a broken trigger from
blocking signups, but it would also make provisioning silently fail and hand
every new account the one-lens fallback with no signal. The insert's only
realistic failure is the unique constraint, which `on conflict do nothing`
already absorbs. Anything else is a bug that should surface loudly rather than
degrade quietly. If this changes, it is a deliberate decision recorded here,
not a default.

---

## Self-review

**Spec coverage.** §3 in-scope items map to Tasks 1 (function + trigger + schema
file + `config.toml`), 2 (migration), 3 (verification script). §3 out-of-scope
items are all covered by the Global Constraints "do not modify" list — no task
touches persona deletion, custom personas, `default-persona.ts`, the seed owner's
rows, or the two fixture accounts. §5's five constraints map to: verbatim seed
values (Global Constraints table + Task 1 Step 1), RLS untouched (Task 1 Step 1
last bullet + Task 1 Step 5 policy read-back + Task 4 Step 2), idempotency
(Task 1 Step 4), grants (Task 1 Step 1 grant bullet, proven by the script's real
admin-API signup in Task 3), never-touch-existing-rows (Task 1 Step 6 and Task 4
Step 1 before/after counts). §6's eight done criteria map to Task 1 Step 2,
Task 2 Step 4, Task 2 Step 3, Task 3 Steps 1–3, Task 4 Step 1, Task 4 Step 3,
Task 4 Step 4. No gaps found.

**Placeholders.** None. Task 1 Step 1 and Task 3 Step 1 describe requirements
rather than inlining the artifact at the point of the step, but both have their
full content elsewhere in the document — the SQL in Execution notes, the script
behaviour as a numbered eleven-item contract with exact API calls and exact
assertions.

**Type consistency.** The function name `public.provision_default_personas` and
the trigger name `on_auth_user_created_provision_personas` are spelled the same
in Task 1's Interfaces block, Task 1 Step 5's catalog query, and the Execution
notes SQL. Column names used by the script in Task 3 (`slug`, `name`, `sub`,
`depth`, `quick_actions`, `sort_order`, `user_id`) all appear in Task 1's
Consumes block, which was read out of `personas.sql` rather than recalled.
