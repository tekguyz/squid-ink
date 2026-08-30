# Conventions

## Stack

Next.js App Router with React Server Components, TypeScript, and Tailwind CSS v4.
Chosen because the design is a dense, mostly-static reading surface with three
small islands of interactivity — the App Router lets the page stay a server
component and pushes only the interactive shell to the client. Tailwind v4 is
used for its native CSS-variable `@theme`, which is what makes one token file
drive both themes without any component branching on theme.

## Pinned versions

Exact pins, no `^` or `~` ranges. Verified against the live npm registry
`latest` dist-tags (`npm view <pkg> dist-tags`) on 2026-08-30.

| Package | Version |
|---|---|
| next | 16.3.3 |
| react | 19.2.8 |
| react-dom | 19.2.8 |
| typescript | 7.0.2 |
| tailwindcss | 4.3.3 |
| @tailwindcss/postcss | 4.3.3 |
| @types/react | 19.2.18 |
| @types/react-dom | 19.2.5 |
| @types/node | 26.4.0 |
| vitest | 4.1.11 |
| @vitejs/plugin-react | 6.1.1 |
| @testing-library/react | 16.3.3 |
| @testing-library/user-event | 14.6.6 |
| @testing-library/jest-dom | 7.0.1 |
| jsdom | 30.0.1 |

Built and verified on Node v24.18.0 / npm 11.16.0.

When bumping any of these, check the registry again — do not take a version
from memory, and do not loosen a pin to a range.

## Colour

**Every colour is a `var()` into `app/globals.css`. Zero `oklch()`, hex, `rgb()`,
or `hsl()` anywhere in `components/` or `lib/`.**

`app/globals.css` is the only file that names a colour. It defines each token
twice — light on `:root`, dark on `.dark` and again inside
`@media (prefers-color-scheme: dark) { :root:not(.light) }` — and exposes them to
Tailwind through `@theme inline`. Components use the generated utilities
(`bg-paper`, `text-ink-2`, `border-rule`) and never know which theme is active.

Tailwind cannot build class names at runtime, so per-speaker colours map through
the static lookup in `components/note-detail/speaker-colors.ts`. Mock data carries
a token *name* (`speaker-1`), never a colour value.

The guard in `components/note-detail/__tests__/project-conventions.test.ts` fails
the build if a colour literal appears in `components/` or `lib/`.

## Type

Three faces, no others:

- **Bitter** (`font-header`) — headers, names, numerals
- **Archivo** (`font-body`) — body prose and UI labels
- **IBM Plex Mono** (`font-mono`) — time, counts, metadata

Loaded via `next/font/google` in `app/layout.tsx`.

## File layout

Flat and purpose-named. `components/note-detail/` holds one file per piece of the
screen. No FSD or atomic layering, and no generic `parts/`, `utils/`, or `common/`
dumping ground — a file that has no better name than "utils" is a file whose
responsibility has not been decided yet.

**Soft ceiling 250 lines, hard ceiling 400.** A file approaching the ceiling gets a
purpose-named extraction, never a raised ceiling. The convention test enforces 400.

## Data

Note Detail reads from Supabase. `lib/notes/get-note.ts` fetches the note, its
chunks and the user's personas through the server client and
`lib/notes/note-view-model.ts` shapes them into what the components render.
There is still no `fetch` and no API client — the Supabase SDK is the only data
path, and it is called from server components.

The view types the components consume live in `lib/notes/view-types.ts`.
`lib/notes/types.ts` holds the database row shapes that mirror
`supabase/schemas/*.sql`. `lib/mock/types.ts` is gone.

All four personas are rows in `public.personas`; there is no hardcoded persona
array. `note_chunks.persona_id` attributes a takeaway to a lens, and a null
`persona_id` means the default persona — which is why chunks written before the
table existed still render under Neutral Analyst. `DEFAULT_PERSONA_ID` and the
one fallback persona for a user with no rows live in
`lib/notes/default-persona.ts`, which is client-safe by design: the shell is a
client component and must not pull in the server Supabase client.

`lib/mock/note.ts` is no longer rendered. `mockNote` has no importer outside
component tests, which use it as a fixture. Do not add new mock rows — new data
goes in the database.

Nothing calls `Math.random()` or `Date.now()` in a render path — the waveform bar
heights are precomputed constants.

## Naming

The application has no confirmed public name. **Do not put a name string —
working or otherwise — anywhere in code.** User-facing copy stays generic
("your notes", page titles with no brand). The only exception is the
`package.json` `name` field.

## Supabase

Hosted project only. There is no local stack — **Docker is not installed on
this machine**, and `supabase db pull` / `supabase db dump` both fail without
it because they build a shadow database. Everything below runs against the
linked project through the management API, needing neither Docker nor the
database password.

### Pinned versions

Exact pins, verified against the live npm registry on 2026-08-30.

| Package | Version |
|---|---|
| @supabase/ssr | 0.12.5 |
| @supabase/supabase-js | 2.112.4 |
| supabase (CLI, installed) | 2.115.0 |

`@supabase/ssr` 0.12.5 takes the `getAll` / `setAll` cookie API. The
`get` / `set` / `remove` form is deprecated and will be removed.

### Declarative schema workflow

`supabase/schemas/*.sql` is the source of truth. `config.toml` lists them in
dependency order — **not** a glob, which would sort `note_chunks.sql` before
`notes.sql` and break the foreign key. The order is `notes.sql`,
`personas.sql`, `note_chunks.sql`: personas needs `set_updated_at()` from
notes, and note_chunks carries a foreign key to personas.

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

### RLS rules

Four per-operation policies per table — select, insert, update, delete. Never
one blanket `for all`.

- Predicate is always `(select auth.uid()) = user_id`, wrapped. Bare
  `auth.uid()` is re-evaluated per row.
- Every policy carries `to authenticated` **and** an ownership predicate.
  `to authenticated` alone is authentication without authorization.
- UPDATE needs both `using` and `with check`. Without `with check` a user can
  reassign `user_id` and hand their row to somebody else.
- Grants are separate from RLS. This project was created with "Automatically
  expose new tables" off, so each table grants `authenticated` explicitly.
  Schema files `revoke all` first: the project defaults hand `anon` and
  `authenticated` TRUNCATE, which is not row-level and which RLS does not
  constrain. `anon` is granted nothing.
- Queries never filter on `user_id` in application code. RLS supplies it, and
  a redundant filter would mask an RLS failure instead of exposing it.

### Keys

Publishable key only in app code, via `NEXT_PUBLIC_SUPABASE_*`. The secret key
bypasses RLS and appears in exactly one place: `scripts/verify-rls.mjs`, read
from the gitignored `.env.local`. Never give it a `NEXT_PUBLIC_` prefix —
Next.js ships every such variable to the browser.

### Proving RLS

`node scripts/verify-rls.mjs` after any change to a policy, a grant, or a
`user_id` column. It signs in two real users and runs the identical query as
each; the second must get a genuine empty result, not `permission denied`.
That proves the database. It does **not** prove the app's cookie plumbing —
that needs a request through `proxy.ts` with a real session. Run both.

## Commands

    npm run dev        # dev server
    npm run build      # production build
    npm run typecheck  # tsc --noEmit
    npm test           # vitest run
    node scripts/verify-rls.mjs   # two-user RLS proof, needs .env.local

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
