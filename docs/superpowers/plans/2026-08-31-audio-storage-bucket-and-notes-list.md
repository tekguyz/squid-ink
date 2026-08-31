# Audio Storage Bucket + Throwaway Notes List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a private Supabase Storage bucket with owner-scoped RLS on
`storage.objects` (INSERT + SELECT + UPDATE, no DELETE), and give the root route a
bare list of the signed-in user's notes linking to `/notes/[id]`.

**Architecture:** Ownership is encoded structurally in the object path as
`{user_id}/{note_id}`, so each policy checks
`(storage.foldername(name))[1] = (select auth.uid())::text` against a path the policy
itself enforces — the same "don't trust what a client can influence" reasoning that
made `note_chunks.persona_id` a composite foreign key. The bucket and its policies
live in a declarative schema file applied with `db query --file`, then hand-copied
into a migration and verified byte-identical with `git hash-object`. The notes list is
a server component reading through RLS with no `user_id` filter.

**Tech Stack:** Postgres 17 (hosted Supabase, project ref `pbwvvakzbrimmdntqxxn`),
Supabase CLI 2.115.0, `@supabase/supabase-js` 2.112.4, `@supabase/ssr` 0.12.5,
Next.js 16.3.3 App Router, Tailwind v4, Vitest 4.1.11.

**Spec:** The user prompt "Audio Storage bucket + throwaway notes list" (in-session).
Supporting sources of truth: `CLAUDE.md`, `docs/KNOWN_GAPS.md` line 204.

## Global Constraints

- Bucket id is `audio-recordings`. No product/working name anywhere in code
  (`CLAUDE.md` § Naming) — this applies to the bucket id too.
- Bucket is private (`public = false`). `anon` gets zero grants and zero policies.
- Policies: INSERT + SELECT + UPDATE only. **No DELETE policy.** Storage upsert needs
  all three of the first set together; granting INSERT alone makes replacement fail
  silently (`docs/KNOWN_GAPS.md:208`).
- Predicate is always `(select auth.uid())` wrapped, never bare `auth.uid()`.
- Every policy carries `to authenticated` **and** an ownership predicate, **and** a
  `bucket_id = 'audio-recordings'` scope so it cannot leak into a future bucket.
- UPDATE policy needs both `using` and `with check`.
- Schema-file-first. Never inline DDL into `db query`. Inline `db query` is for
  `select` verification only. Every statement idempotent so the whole file re-applies.
- Never call `apply_migration`. Migration is hand-authored + `migration repair
  --status applied`.
- No colour literal (`#`, `oklch(`, `rgb(`, `hsl(`) in any file touched — project-wide,
  including `app/`.
- Never filter on `user_id` in application code. RLS supplies it.
- Do not touch: `lib/notes/get-note.ts`, `lib/notes/note-view-model.ts`, anything under
  `components/note-detail/`, `supabase/schemas/notes.sql`, `personas.sql`,
  `note_chunks.sql`, `persona_provisioning.sql`.

## Measured facts (queried live, 2026-08-31, before writing this plan)

These drive Task 1 and must not be re-derived from assumption:

- `storage.objects` and `storage.buckets` are owned by `supabase_storage_admin`, and
  both have `relrowsecurity = true`, `relforcerowsecurity = false`.
- `pg_policies where schemaname = 'storage'` returns **zero rows**. No storage policy
  exists yet.
- `anon`, `authenticated` **and** `service_role` each hold
  `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` on **both**
  `storage.objects` and `storage.buckets`. This is more generous than the `public`
  schema defaults the other schema files revoke, so the same `revoke all` discipline
  applies and is not optional.
- Because RLS is on with no policies, nothing is currently reachable — but the grants
  still hand `anon` TRUNCATE, which RLS does not constrain at all.
- `storage.buckets` needs **no** grant to `authenticated`: vanilla Supabase projects
  have zero policies on it and private-bucket uploads work, which proves the Storage
  API resolves buckets as `supabase_storage_admin`, not as the caller's role. Task 3
  verifies this empirically rather than trusting it.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/schemas/storage_audio.sql` (create) | Bucket row, grant lockdown on `storage.objects`/`storage.buckets`, three per-operation policies. Sole authority on Storage privileges. |
| `supabase/migrations/<ts>_storage_audio.sql` (create) | Byte-identical hand copy of the schema file, recorded in migration history. |
| `scripts/verify-storage-rls.mjs` (create) | Two-real-user proof of upload/read/overwrite for the owner, denial in both cross-tenant directions, anon denial, and cleanup in a `finally`. |
| `lib/notes/list-notes.ts` (create) | `listNotes()` — the signed-in user's notes, newest first, through RLS. One query, no `user_id` filter. |
| `lib/notes/__tests__/list-notes.test.ts` (create) | Unit test mirroring `get-latest-note-id.test.ts`'s stub-client pattern. |
| `supabase/config.toml` (modify) | Append `./schemas/storage_audio.sql` to `schema_paths`, last. |
| `app/page.tsx` (modify) | Replace the redirect with a bare list; keep the existing empty state; comment it as a throwaway scaffold. |
| `docs/KNOWN_GAPS.md` (modify) | Close the "Audio Storage bucket" entry with a dated resolution naming what is resolved vs still open. |

---

### Task 1: Schema file — bucket, grant lockdown, three policies

**Files:**
- Create: `supabase/schemas/storage_audio.sql`
- Modify: `supabase/config.toml` (the `schema_paths` line under `[db.migrations]`)

**Interfaces:**
- Consumes: nothing.
- Produces: bucket id `audio-recordings`; object path convention `{user_id}/{note_id}`;
  policy names `audio_recordings_select_own`, `audio_recordings_insert_own`,
  `audio_recordings_update_own` on `storage.objects`. Task 3 asserts these exact names.

- [ ] **Step 1: Write the schema file**

Create `supabase/schemas/storage_audio.sql` with exactly this content:

```sql
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

-- Grants are separate from RLS, and Storage's defaults are MORE generous than
-- the public schema's. Measured on this project before this file was written:
-- anon, authenticated and service_role each held
-- DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on both
-- storage.objects and storage.buckets. TRUNCATE is the one that matters --
-- it is not row-level, so RLS does not constrain it, and anon held it.
--
-- Revoke first, then grant, so this file is the sole authority rather than a
-- layer on top of whatever the project shipped with. service_role is left
-- alone: it is the Storage API's own role and revoking it breaks the service.
revoke all on storage.objects from anon, authenticated;
revoke all on storage.buckets from anon, authenticated;

-- authenticated gets exactly the three verbs the policies below cover. No
-- DELETE grant, so no path to deletion even if a policy were added by mistake.
grant select, insert, update on storage.objects to authenticated;

-- storage.buckets is granted to nobody. The Storage API resolves buckets as
-- supabase_storage_admin, not as the caller -- which is why a vanilla project
-- with zero policies on storage.buckets still serves private buckets.
-- scripts/verify-storage-rls.mjs proves this rather than assuming it.

-- Three per-operation policies, not one blanket rule.
--
-- auth.uid() is wrapped in a select so the planner evaluates it once per query
-- instead of once per row. Each policy also pins bucket_id: storage.objects is
-- one table for every bucket, so an unscoped predicate would silently govern
-- any bucket added later.

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
```

- [ ] **Step 2: Register the file in config.toml**

In `supabase/config.toml`, under `[db.migrations]`, change the `schema_paths` line to:

```toml
schema_paths = ["./schemas/notes.sql", "./schemas/personas.sql", "./schemas/note_chunks.sql", "./schemas/persona_provisioning.sql", "./schemas/storage_audio.sql"]
```

Last in the list. It is not a glob, for the reason `CLAUDE.md` gives.

- [ ] **Step 3: Apply the schema file**

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn --file supabase/schemas/storage_audio.sql
```

Expected: success. If it fails with `must be owner of table objects` (42501), the
`postgres` role lacks membership in `supabase_storage_admin` on this project. Do NOT
work around it with inline DDL or by relaxing the policy. Report the exact error and
stop — creating the policies through the dashboard would leave the schema file unable
to reproduce the database, which breaks the whole declarative workflow.

- [ ] **Step 4: Re-apply to prove idempotence**

Run the identical command a second time. Expected: success again, no error. Every
statement is `on conflict` / `drop ... if exists` / `revoke`+`grant`, so a second run
is a no-op.

- [ ] **Step 5: Read the live catalog back**

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname='storage' and tablename='objects' order by policyname;"
```

Expected: exactly three rows — `audio_recordings_insert_own` (INSERT),
`audio_recordings_select_own` (SELECT), `audio_recordings_update_own` (UPDATE), each
with `roles = {authenticated}`. INSERT has `qual = null` and a non-null `with_check`;
UPDATE has both non-null.

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) as privs from information_schema.role_table_grants where table_schema='storage' and table_name in ('objects','buckets') and grantee in ('anon','authenticated','service_role') group by grantee, table_name order by table_name, grantee;"
```

Expected: no `anon` row at all for either table. `authenticated` appears only for
`objects`, with exactly `INSERT,SELECT,UPDATE`. `service_role` unchanged.

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select id, name, public, created_at from storage.buckets;"
```

Expected: one row, `audio-recordings`, `public = false`.

- [ ] **Step 6: Commit**

```bash
git add supabase/schemas/storage_audio.sql supabase/config.toml
git commit -m "db: private audio bucket with owner-scoped storage policies"
```

---

### Task 2: Hand-authored migration, verified byte-identical

**Files:**
- Create: `supabase/migrations/<timestamp>_storage_audio.sql`

**Interfaces:**
- Consumes: `supabase/schemas/storage_audio.sql` from Task 1, unchanged.
- Produces: a migration history entry named `<timestamp>_storage_audio`.

- [ ] **Step 1: Create the empty migration**

```bash
npx supabase migration new storage_audio
```

Note the generated path — the timestamp is minted at run time.

- [ ] **Step 2: Fill it from the schema file**

The migration is the verbatim schema file. Only one schema file is new, so this is a
straight copy, not a concatenation:

```bash
cat supabase/schemas/storage_audio.sql > supabase/migrations/<timestamp>_storage_audio.sql
```

Do not hand-edit the copy afterwards. Any divergence fails Step 4.

- [ ] **Step 3: Repair the migration history**

The statements are already applied to the live database from Task 1, so the history
records them as applied rather than re-running them:

```bash
npx supabase migration repair --linked --project-ref pbwvvakzbrimmdntqxxn --status applied <timestamp>
```

```bash
npx supabase migration list --linked --project-ref pbwvvakzbrimmdntqxxn
```

Expected: four rows, each with matching Local and Remote columns —
`20260830134926`, `20260830223821`, `20260831043837`, and the new `<timestamp>`.

- [ ] **Step 4: Prove byte parity**

```bash
git hash-object supabase/schemas/storage_audio.sql supabase/migrations/<timestamp>_storage_audio.sql
```

Expected: two identical hashes. If they differ, the copy was edited — redo Step 2.
Paste both the command and its output into the final report.

- [ ] **Step 5: Run the advisors**

```bash
npx supabase db advisors --linked --project-ref pbwvvakzbrimmdntqxxn --type all --level info
```

Read every finding. Report any that is new since the last run — do not dismiss one
silently. A pre-existing finding unrelated to Storage is still reported as
pre-existing.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/
git commit -m "db: hand-author the storage_audio migration"
```

---

### Task 3: Two-user Storage RLS proof

**Files:**
- Create: `scripts/verify-storage-rls.mjs`

**Interfaces:**
- Consumes: bucket `audio-recordings`, path convention `{user_id}/{note_id}`, and the
  three policies from Task 1. Fixture accounts come from `.env.local`:
  `RLS_TEST_OWNER_EMAIL/PASSWORD`, `RLS_TEST_INTRUDER_EMAIL/PASSWORD` — the same two
  accounts `scripts/verify-rls.mjs` uses. Do not create new fixtures.
- Produces: `node scripts/verify-storage-rls.mjs`, exit 0 on pass, 1 on fail.

- [ ] **Step 1: Write the script**

Create `scripts/verify-storage-rls.mjs` with the content given below (Task 3 Appendix,
at the end of this plan — it is reproduced there in full so this task body stays
readable). Copy it verbatim.

- [ ] **Step 2: Run it**

```bash
node scripts/verify-storage-rls.mjs
```

Expected: every line `ok`, final line `PASS`, exit 0.

If `bucket is private` or the owner INSERT fails with a bucket-resolution error
(`Bucket not found`), the Storage API *does* resolve buckets as the caller. In that
case — and only then — add to `supabase/schemas/storage_audio.sql` a
`grant select on storage.buckets to authenticated;` plus a matching
`for select to authenticated using (id = 'audio-recordings')` policy on
`storage.buckets`, re-apply the file, and redo Task 2 Steps 2–4 so the migration stays
byte-identical. Record the branch taken in the final report.

- [ ] **Step 3: Confirm cleanup independently**

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select count(*) as objects from storage.objects where bucket_id = 'audio-recordings';"
```

Expected: `0`.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-storage-rls.mjs
git commit -m "scripts: prove owner-only RLS on the audio bucket"
```

---

### Task 4: `listNotes()` and the throwaway root list

**Files:**
- Create: `lib/notes/list-notes.ts`
- Create: `lib/notes/__tests__/list-notes.test.ts`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`.
- Produces:
  ```ts
  export interface NoteListItem { id: string; title: string | null; createdAt: string }
  export async function listNotes(): Promise<NoteListItem[]>
  ```

- [ ] **Step 1: Write the failing test**

Create `lib/notes/__tests__/list-notes.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; title: string | null; created_at: string };
type Result = { data: Row[] | null; error: { message: string } | null };

function stubClient(result: Result) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    order: () => Promise.resolve(result),
  };
  return { from: vi.fn(() => chain) };
}

const client = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => client.current,
}));

const { listNotes } = await import("../list-notes");

describe("listNotes", () => {
  beforeEach(() => {
    client.current = null;
  });

  it("maps rows to view items in the order the query returned them", async () => {
    client.current = stubClient({
      data: [
        { id: "note-2", title: "Newer", created_at: "2026-08-31T10:00:00Z" },
        { id: "note-1", title: null, created_at: "2026-08-30T10:00:00Z" },
      ],
      error: null,
    });

    await expect(listNotes()).resolves.toEqual([
      { id: "note-2", title: "Newer", createdAt: "2026-08-31T10:00:00Z" },
      { id: "note-1", title: null, createdAt: "2026-08-30T10:00:00Z" },
    ]);
  });

  it("returns an empty array when the user has no notes", async () => {
    // Also the shape a second user sees: RLS filters everything out, which
    // is an empty result rather than an error.
    client.current = stubClient({ data: [], error: null });
    await expect(listNotes()).resolves.toEqual([]);
  });

  it("returns an empty array when the query yields null data", async () => {
    client.current = stubClient({ data: null, error: null });
    await expect(listNotes()).resolves.toEqual([]);
  });

  it("throws when the query errors", async () => {
    client.current = stubClient({ data: null, error: { message: "boom" } });
    await expect(listNotes()).rejects.toThrow(/boom/);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npx vitest run lib/notes/__tests__/list-notes.test.ts
```

Expected: FAIL — cannot resolve `../list-notes`.

- [ ] **Step 3: Write the implementation**

Create `lib/notes/list-notes.ts`:

```ts
import { createClient } from "@/lib/supabase/server";

/** One row of the notes list. Deliberately not the Note Detail view type —
 *  a list item needs an id, a label and a date, and nothing else. */
export interface NoteListItem {
  id: string;
  title: string | null;
  createdAt: string;
}

/**
 * The signed-in user's notes, newest first.
 *
 * No user_id filter — RLS supplies it, and the
 * notes_user_id_created_at_idx index serves exactly this ordering. A
 * redundant filter here would mask an RLS failure instead of exposing it.
 */
export async function listNotes(): Promise<NoteListItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notes")
    .select("id, title, created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to load notes: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run lib/notes/__tests__/list-notes.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Rewrite the root route**

Replace `app/page.tsx` entirely with:

```tsx
import Link from "next/link";
import { listNotes } from "@/lib/notes/list-notes";

/**
 * THROWAWAY SCAFFOLD — not a finished screen, and not the Dashboard.
 *
 * This exists so Track 2 (Recorder HUD) and Track 3 (transcription) have a way
 * to see that a note was created and to open it. The real dashboard/feed is
 * App Surface 01 in the design file and belongs to the Core UX/UI phase; when
 * that lands, this file is replaced wholesale. Deliberately no design pass:
 * minimal layout, existing tokens only, no new components.
 *
 * It previously redirected to the newest note. A redirect hides every other
 * note, which is exactly what needed to become visible.
 */
export default async function Home() {
  const notes = await listNotes();

  if (notes.length === 0) {
    return (
      <main className="bg-paper text-ink mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-3 p-6">
        <h1 className="font-header text-ink">No notes yet</h1>
        <p className="font-body text-ink-2">
          Once a recording finishes processing, it will show up here.
        </p>
      </main>
    );
  }

  return (
    <main className="bg-paper text-ink mx-auto flex min-h-screen max-w-sm flex-col gap-4 p-6">
      <h1 className="font-header text-ink">Your notes</h1>
      <ul className="flex flex-col gap-2">
        {notes.map((note) => (
          <li key={note.id}>
            <Link href={`/notes/${note.id}`} className="font-body text-ink block">
              {note.title ?? "Untitled"}
            </Link>
            <span className="font-mono text-ink-2 block text-xs">{note.createdAt}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

Note: `getLatestNoteId` is now unreferenced by application code. It is **not** deleted —
it is outside this prompt's file scope. Flag it in the final report and in
`docs/KNOWN_GAPS.md` as now-unused rather than removing it silently.

- [ ] **Step 6: Full verification**

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build
```

Expected: all pass. `npm test` should report 63 tests (59 baseline + 4 new).

Also run the colour guard on its own and paste the result:

```bash
npx vitest run components/note-detail/__tests__/project-conventions.test.ts
```

Note honestly in the report: that guard scans only `components/` and `lib/`, **not**
`app/`. It therefore does not in fact police `app/page.tsx`. The rule was still
followed (every colour above is a token utility), but the guard is not the thing
proving it — say so rather than implying coverage that does not exist.

- [ ] **Step 7: Commit**

```bash
git add lib/notes/list-notes.ts lib/notes/__tests__/list-notes.test.ts app/page.tsx
git commit -m "feat: bare notes list at the root route"
```

---

### Task 5: Prove the root route against a real note, and close the gap

**Files:**
- Modify: `docs/KNOWN_GAPS.md` (the "Audio Storage bucket" bullet at line 204)

**Interfaces:**
- Consumes: `listNotes()` from Task 4; the fixture owner account from `.env.local`.

- [ ] **Step 1: Re-run the existing RLS proof**

Nothing in this branch touched `public` schema policies, but the grant statements ran
against the same database. Confirm no regression:

```bash
node scripts/verify-rls.mjs
```

Expected: `PASS`.

- [ ] **Step 2: Prove the list against a real note through a real session**

`verify-rls.mjs` and `verify-storage-rls.mjs` prove the database. They do not prove the
app's cookie plumbing. Do this as a documented step:

1. Find out what notes the real signed-in account already owns:

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select id, title, created_at, user_id from notes order by created_at desc limit 5;"
```

2. Start the dev server with the Browser pane (`preview_start`, never `Bash`), sign in
   as the real account, and load `/`.
3. Record what rendered: how many links, their order, that each `href` is
   `/notes/<uuid>`, and that clicking one reaches Note Detail.
4. If a note was inserted purely for this proof, delete it afterwards and confirm `/`
   renders the zero-notes empty state.

Report exactly which notes existed, what rendered, and whether anything was cleaned up.
If the account already had notes and none needed inserting, say that instead of
inventing a cleanup step.

- [ ] **Step 3: Close the KNOWN_GAPS entry**

In `docs/KNOWN_GAPS.md`, leave the existing "Audio Storage bucket" bullet text intact
and append a resolution beneath it, in the same shape as the persona-provisioning
entry:

```markdown
  **RESOLVED 2026-08-31, for storage only.** `supabase/schemas/storage_audio.sql`
  creates the private `audio-recordings` bucket and three per-operation policies on
  `storage.objects` — `audio_recordings_select_own`, `audio_recordings_insert_own`,
  `audio_recordings_update_own` — each `to authenticated`, each scoped to
  `bucket_id = 'audio-recordings'`, each checking
  `(storage.foldername(name))[1] = (select auth.uid())::text`. Ownership lives in the
  object path (`{user_id}/{note_id}`) rather than in `owner_id`, so the policy checks
  the thing it enforces. Shipped as migration `<timestamp>_storage_audio`.

  Storage's grant defaults were measured, not assumed, and were **more** generous than
  the `public` schema's: `anon`, `authenticated` and `service_role` each held
  `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` on both
  `storage.objects` and `storage.buckets`. The schema file revokes all of it from
  `anon` and `authenticated` on both tables and re-grants `authenticated` exactly
  `select, insert, update` on `storage.objects`. `anon` now holds nothing, and
  `storage.buckets` is granted to neither role.
  `node scripts/verify-storage-rls.mjs` proves the whole thing with the two existing
  fixture accounts.

  **Still open: no upload code, no playback UI.** Nothing writes
  `notes.audio_storage_path` yet — that is Track 2 (Recorder HUD), which uploads
  directly client-to-Storage under these policies. Playback is later still.
  **No DELETE policy and no DELETE grant**, deliberately.
```

- [ ] **Step 4: Record the two side-effects of this branch**

Also in `docs/KNOWN_GAPS.md`, under "Incompleteness in what did ship", add entries for
`lib/notes/get-latest-note-id.ts` now being uncalled, and for the colour-literal guard
not covering `app/`.

- [ ] **Step 5: Commit**

```bash
git add docs/KNOWN_GAPS.md
git commit -m "docs: close the audio Storage bucket gap, record what is still open"
```

---

## Task 3 Appendix — full text of `scripts/verify-storage-rls.mjs`

```js
/**
 * Proves owner-only RLS on the audio-recordings Storage bucket with two real
 * auth users.
 *
 * Same proof path as scripts/verify-rls.mjs: both users sign in for real, the
 * returned JWT is attached to a PUBLISHABLE-key client, and every token's role
 * claim is checked to read "authenticated" before any result is trusted. The
 * secret key is used only to create the fixtures and to clean up afterwards --
 * never to produce a result the proof depends on.
 *
 * Ownership here is the object PATH: {user_id}/{file}. A denial therefore has
 * to be distinguished from a plain miss, because Storage answers an
 * RLS-filtered download with "Object not found" -- the same words it uses for
 * an object that was never written. Every cross-tenant read below is run
 * against an object the admin client has just confirmed exists, and is paired
 * with a list() whose admin-visible count is compared to the caller's.
 *
 * Not part of `npm test` -- it needs network access and the secret key.
 * Run with: node scripts/verify-storage-rls.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "audio-recordings";
const PROBE = "verify-storage-rls.bin";
const FIRST = "first write";
const SECOND = "second write, same path";

function loadEnv(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
}

/** Read the role claim without verifying -- we only need to prove we are NOT
 *  running as service_role. Storage does the real verification. */
function roleClaim(jwt) {
  const payload = jwt.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role;
}

async function ensureUser(admin, email, password) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!error) return data.user.id;
  if (!/already|exists|registered/i.test(error.message)) throw error;

  const { data: list, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listError) throw listError;
  const found = list.users.find((u) => u.email === email);
  if (!found) throw new Error(`${email} reported as existing but not listed`);
  return found.id;
}

async function signIn(url, publishableKey, email, password) {
  const anon = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);

  const token = data.session.access_token;
  const role = roleClaim(token);
  if (role !== "authenticated") {
    throw new Error(
      `refusing to trust a result from role "${role}" -- the proof requires ` +
        `the authenticated role, not service_role or a superuser`,
    );
  }

  return {
    email,
    userId: data.user.id,
    role,
    client: createClient(url, publishableKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

const body = (text) => new Blob([text], { type: "application/octet-stream" });

let failed = false;
function check(label, ok, detail) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failed = true;
}

const env = loadEnv(".env.local");
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const admin = createClient(url, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

await ensureUser(admin, env.RLS_TEST_OWNER_EMAIL, env.RLS_TEST_OWNER_PASSWORD);
await ensureUser(admin, env.RLS_TEST_INTRUDER_EMAIL, env.RLS_TEST_INTRUDER_PASSWORD);

const owner = await signIn(url, publishableKey, env.RLS_TEST_OWNER_EMAIL, env.RLS_TEST_OWNER_PASSWORD);
const intruder = await signIn(
  url,
  publishableKey,
  env.RLS_TEST_INTRUDER_EMAIL,
  env.RLS_TEST_INTRUDER_PASSWORD,
);

const ownerPath = `${owner.userId}/${PROBE}`;
const intruderPath = `${intruder.userId}/${PROBE}`;
const anonPath = `${owner.userId}/anon-probe.bin`;

console.log("proof path : A - real password-grant JWT via Authorization header");
console.log(`bucket     : ${BUCKET}`);
console.log(`owner      : ${owner.email}  ${owner.userId}  role=${owner.role}`);
console.log(`second user: ${intruder.email}  ${intruder.userId}  role=${intruder.role}`);
console.log(`paths      : ${ownerPath}`);
console.log(`             ${intruderPath}`);
console.log("");

try {
  // --- The bucket is private -------------------------------------------
  console.log("--- bucket is private ---");
  const { data: buckets } = await admin.storage.listBuckets();
  const found = buckets?.find((b) => b.id === BUCKET);
  check("bucket exists", Boolean(found), `id=${found?.id ?? "none"}`);
  check("bucket is private", found?.public === false, `public=${found?.public}`);
  console.log("");

  // --- Owner: insert, read, overwrite ----------------------------------
  console.log("--- owner writes and reads their own path ---");

  const ins = await owner.client.storage.from(BUCKET).upload(ownerPath, body(FIRST));
  check("INSERT at own path", !ins.error, `error=${JSON.stringify(ins.error?.message ?? null)}`);

  const readBack = await owner.client.storage.from(BUCKET).download(ownerPath);
  const readText = readBack.data ? await readBack.data.text() : null;
  check(
    "SELECT reads it back",
    readText === FIRST,
    `got=${JSON.stringify(readText)} error=${JSON.stringify(readBack.error?.message ?? null)}`,
  );

  // upsert replaces the object in place. This is the step that fails
  // silently when only INSERT is granted -- it is the whole reason the
  // UPDATE policy exists.
  const upd = await owner.client.storage
    .from(BUCKET)
    .upload(ownerPath, body(SECOND), { upsert: true });
  check("UPDATE overwrites same path", !upd.error, `error=${JSON.stringify(upd.error?.message ?? null)}`);

  const reRead = await owner.client.storage.from(BUCKET).download(ownerPath);
  const reText = reRead.data ? await reRead.data.text() : null;
  check("overwrite actually took", reText === SECOND, `got=${JSON.stringify(reText)}`);
  console.log("");

  // Second user writes their own object, so the cross-tenant reads below
  // are denials of something that exists rather than misses.
  const seed = await intruder.client.storage.from(BUCKET).upload(intruderPath, body(FIRST));
  check(
    "second user can write their OWN path",
    !seed.error,
    `error=${JSON.stringify(seed.error?.message ?? null)}`,
  );
  console.log("");

  // --- Cross-tenant, both directions -----------------------------------
  for (const [label, actor, foreignPath] of [
    ["owner -> second user's path", owner, intruderPath],
    ["second user -> owner's path", intruder, ownerPath],
  ]) {
    console.log(`--- ${label} ---`);
    const foreignPrefix = foreignPath.split("/")[0];

    const write = await actor.client.storage.from(BUCKET).upload(foreignPath, body("intrusion"));
    check("INSERT refused", Boolean(write.error), `error=${JSON.stringify(write.error?.message ?? null)}`);

    const over = await actor.client.storage
      .from(BUCKET)
      .upload(foreignPath, body("intrusion"), { upsert: true });
    check("UPDATE refused", Boolean(over.error), `error=${JSON.stringify(over.error?.message ?? null)}`);

    const read = await actor.client.storage.from(BUCKET).download(foreignPath);
    check(
      "SELECT refused",
      Boolean(read.error) || read.data === null,
      `error=${JSON.stringify(read.error?.message ?? null)}`,
    );

    // A download error alone could be a plain miss. list() separates the
    // two: the admin sees the object, the caller must see nothing.
    const adminList = await admin.storage.from(BUCKET).list(foreignPrefix);
    const actorList = await actor.client.storage.from(BUCKET).list(foreignPrefix);
    check(
      "the object really is there (admin sees it)",
      (adminList.data?.length ?? 0) === 1,
      `admin rows=${adminList.data?.length ?? 0}`,
    );
    check(
      "LIST returns empty, not permission-denied",
      !actorList.error && (actorList.data?.length ?? 0) === 0,
      `rows=${actorList.data?.length ?? 0} error=${JSON.stringify(actorList.error?.message ?? null)}`,
    );
    console.log("");
  }

  // --- anon has nothing ------------------------------------------------
  console.log("--- anon (publishable key, no session) ---");
  const anon = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anonRead = await anon.storage.from(BUCKET).download(ownerPath);
  check("anon SELECT refused", Boolean(anonRead.error), `error=${JSON.stringify(anonRead.error?.message ?? null)}`);

  const anonWrite = await anon.storage.from(BUCKET).upload(anonPath, body("anon"));
  check("anon INSERT refused", Boolean(anonWrite.error), `error=${JSON.stringify(anonWrite.error?.message ?? null)}`);

  const anonList = await anon.storage.from(BUCKET).list(owner.userId);
  check(
    "anon LIST sees nothing",
    (anonList.data?.length ?? 0) === 0,
    `rows=${anonList.data?.length ?? 0} error=${JSON.stringify(anonList.error?.message ?? null)}`,
  );
  console.log("");
} finally {
  // Cleanup runs pass or fail. authenticated holds no DELETE grant by
  // design, so removal is the admin client's job -- that is the policy
  // working, not a shortcut around it.
  console.log("--- cleanup ---");
  const { data: removed, error: removeError } = await admin.storage
    .from(BUCKET)
    .remove([ownerPath, intruderPath, anonPath]);
  console.log(
    `  removed ${removed?.length ?? 0} object(s)  error=${JSON.stringify(removeError?.message ?? null)}`,
  );

  let leftovers = 0;
  for (const prefix of [owner.userId, intruder.userId]) {
    const { data } = await admin.storage.from(BUCKET).list(prefix);
    leftovers += data?.length ?? 0;
  }
  check("bucket has no leftover probe objects", leftovers === 0, `leftovers=${leftovers}`);
  console.log("");
}

console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
```

---

## Self-Review

**Spec coverage.** Every "in scope" bullet maps to a task: private bucket + three
policies → Task 1; schema file + hand-authored migration → Tasks 1–2; verification
script → Task 3; bare notes list → Task 4. Every "definition of done" bullet maps to a
step: migration list + `git hash-object` → Task 2 Steps 3–4; the storage assertions →
Task 3; no leftover objects → Task 3 Steps 1 (`finally`) and 3; `anon` evidence → Task 1
Step 5 plus Task 3's anon block; root route proof → Task 5 Step 2; convention guard →
Task 4 Step 6; build/typecheck/test/both scripts → Task 4 Step 6 and Task 5 Step 1;
advisors → Task 2 Step 5; KNOWN_GAPS → Task 5 Steps 3–4.

**Out-of-scope discipline.** No upload code, no Zustand, no playback, no design pass, no
DELETE policy, no signed URLs. None appears in any task.

**Type consistency.** `NoteListItem { id, title, createdAt }` is defined in Task 4
Step 3 and consumed with those exact field names in Task 4 Step 5. `listNotes` is named
identically in the test, the module and the route. The three policy names are spelled
identically in Task 1, Task 1 Step 5's expectation, and Task 5 Step 3.

**Honesty items to carry into the final report, not hide:** the convention guard does
not scan `app/`; `getLatestNoteId` becomes uncalled; Task 3 Step 2 has an empirical
branch whose outcome must be stated either way.
