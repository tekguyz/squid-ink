---
paths:
  - "lib/notes/**"
  - "lib/notegen/**"
  - "lib/mock/**"
  - "app/notes/actions/**"
  - "components/note-detail/**"
  - "supabase/schemas/notes.sql"
  - "supabase/schemas/personas.sql"
  - "supabase/schemas/note_chunks.sql"
  - "supabase/schemas/persona_provisioning.sql"
---

# Data layer and personas

Note Detail reads from Supabase. `lib/notes/get-note.ts` fetches the note, its
chunks and the user's personas through the server client and
`lib/notes/note-view-model.ts` shapes them into what the components render.
There is still no `fetch` and no API client — the Supabase SDK is the only data
path, and it is called from server components.

The view types the components consume live in `lib/notes/view-types.ts`.
`lib/notes/types.ts` holds the database row shapes that mirror
`supabase/schemas/*.sql`. The old mock types module under `lib/mock/` is gone.

All four personas are rows in `public.personas`; there is no hardcoded persona
array. A new account gets its four rows from the database, not from app code:
`supabase/schemas/persona_provisioning.sql` puts a `security definer` trigger on
`auth.users` that inserts them. Accounts created before that trigger shipped
(2026-08-31) are deliberately not backfilled, which is why the fallback below is
still live code.

**One exception, and it is copy, not data:** the landing page
(`components/landing/persona-table.tsx`, issue #60) lists the four personas by
name for a visitor with no session, who has no rows to read. It is never used
to generate or resolve anything, and `components/landing/__tests__/specimen.test.ts`
fails if it drifts from `persona_provisioning.sql`. `components/landing/specimen.ts`
quotes the demo fixture the same way, under the same test.

`note_chunks.persona_id` attributes a takeaway to a lens, and a null
`persona_id` means the default persona — which is why chunks written before the
table existed still render under Neutral Analyst. `DEFAULT_PERSONA_ID` and the
one fallback persona for a user with no rows live in
`lib/notes/default-persona.ts`, which is client-safe by design: the shell is a
client component and must not pull in the server Supabase client.

## Which persona row a generation pipeline reads its config from

Locked 2026-09-02, amended the same day when per-note selection shipped.
`resolvePersonaFor` lives in `lib/notegen/resolve-persona.ts` (it moved out of
`notegen-ports.ts`, which re-exports it) and resolves in three steps:

1. **`notes.persona_id`, when the note carries one** — `id = <persona_id> and
   user_id = <note.user_id>`. Scoped by **both**, the same composite ownership
   `notes_persona_id_fkey` enforces, because neither a foreign key nor
   `service_role` is subject to RLS. Reports `source: "note"`.
2. **The slug**, when it does not, or when that id resolves to no row —
   `user_id = <note.user_id> and slug = 'neutral-analyst'`, the slug being
   `DEFAULT_PERSONA_ID`. Reports `source: "row"`.
3. **`DEFAULT_PERSONA_FALLBACK`** on zero rows. Reports `source: "fallback"`.

A set `persona_id` that resolves to nothing **falls through to step 2 rather
than throwing** — a lens deleted between selection and generation is a real
sequence, and refusing to generate over it is worse than generating under the
default.

Slug at step 2, not `name`: `unique (user_id, slug)` is the constraint
`personas.sql` declares and indexes, `name` carries neither, and that file's
own header says slug is the key chosen to survive a reseed. Never match
`personas.id` against `DEFAULT_PERSONA_ID` — the former is a per-user
`gen_random_uuid()` and the latter a slug string, so it is a type error rather
than a quiet miss. Step 1 matches on `id` because it has a real uuid to match.

**The client never sees a uuid.** `Persona.id` and `Note.personaId` are both
slugs; `note-view-model.ts` translates one way and
`app/notes/actions/persona.ts` the other. A uuid is per-user and does not
survive a reseed.

## `notes.persona_id`'s foreign key is declared in `personas.sql`, not `notes.sql`

`config.toml` applies `notes.sql` first, so a reference to `public.personas`
written there does not resolve on a fresh apply. The column stays with its
table; only the constraint waits. It is composite —
`(persona_id, user_id) references personas (id, user_id) on delete set null
(persona_id)` — for the reason `note_chunks.persona_id` is, and a cross-tenant
write was proved refused with `23503` on 2026-09-02.

Zero rows means an account created before the 2026-08-31 provisioning trigger
and deliberately not backfilled; it falls back to `DEFAULT_PERSONA_FALLBACK`.
Either path, a generated chunk still writes `note_chunks.persona_id = null`.
The resolved row supplies `name` and `depth` to the generator and is never
persisted onto the chunk, so the "null means default persona" convention above
is unchanged.

## The cron path is the one place that filters on `user_id`

The cron path filters on `user_id` in application code. That is the one
deliberate exception to `CLAUDE.md` § Supabase → RLS rules' standing "queries
never filter on `user_id`", and it is not a lapse: cron runs as `service_role`,
which bypasses RLS entirely, so an unfiltered lookup can return another
account's row. The Server Action path filters identically — there RLS already
scopes it, so the filter is defence in depth and one shared query shape, not a
requirement.

## Mock data and determinism

`lib/mock/note.ts` is no longer rendered. `mockNote` has no importer outside
component tests, which use it as a fixture. Do not add new mock rows — new data
goes in the database.

Nothing calls `Math.random()` or `Date.now()` in a render path — the waveform bar
heights are precomputed constants.
