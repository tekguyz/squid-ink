# Conventions

**Last updated:** 2026-09-09
Update this line whenever this file changes — don't let it drift from reality.

## Stack

Next.js App Router with React Server Components, TypeScript, and Tailwind CSS v4.
Chosen because the design is a dense, mostly-static reading surface with three
small islands of interactivity — the App Router lets the page stay a server
component and pushes only the interactive shell to the client. Tailwind v4 is
used for its native CSS-variable `@theme`, which is what makes one token file
drive both themes without any component branching on theme.

## Pinned versions

Exact pins, no `^` or `~` ranges. Verified against the live npm registry
`latest` dist-tags (`npm view <pkg> dist-tags`) on 2026-08-30; `zustand`,
`fake-indexeddb` and `@google/genai` on 2026-08-31; `ai`, `@ai-sdk/anthropic`,
`@ai-sdk/react` and `zod` on 2026-09-04, all four still `latest` that day.

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
| zustand | 5.0.15 |
| fake-indexeddb | 6.2.5 |
| @google/genai | 2.19.0 |
| ai | 7.0.92 |
| @ai-sdk/anthropic | 4.0.49 |
| @ai-sdk/react | 4.0.95 |
| zod | 4.5.4 |

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

**`canvas` is not a button fill.** In dark theme `--canvas` and `--paper`
resolve to the same value, so a control filled with `bg-canvas` on a `bg-paper`
sheet has no fill at all — measured 2026-09-01, and the reason `audio-player.tsx`
and `transcribe-button.tsx` both moved to `bg-raised`, which is what
DESIGN.md § Components → Buttons specifies anyway. Two tokens looking distinct
in light theme is not evidence they differ in dark; check both.

**`--control-edge` is the boundary of an INTERACTIVE control; `--rule-2` is
the edge of a decorative frame. Do not use one for the other, and do not
"fix" either on a single component.** The split shipped 2026-09-05 and was the
second of the three options `docs/KNOWN_GAPS.md` § "Framed controls sit at
~1.4:1" laid out — the entry is now RESOLVED and carries the measurements.
`--control-edge` clears WCAG 1.4.11's 3:1 against **every sheet a control sits
on**, worst case 3.34:1 light (`rail`/`pane`) and 3.44:1 dark (`raised`);
`--rule-2` stays at ~1.4:1 on the insight cards, the status pills and the
transcript pane, deliberately.

Contrast is measured against the sheet a thing actually sits on, never against
`paper` alone — `rail` and `raised` are the worst cases in the two themes and
neither is `paper`. Verify against the **built** CSS, not the source: Tailwind
emits a hex fallback beside the `oklch()`, and the fallback is what a browser
without `lab()` renders.

`record-hud`'s `role="status"` and `role="alert"` pills are not controls and
keep `rule-2`.

**The accent family splits the same way. `border-accent` is a control edge;
`bg-tint-hover` is a fill; `border-tint-hover` is neither and is no longer
used on a control.** Measured the same day: `tint-hover` against the `tint`
fill it sits on is 1.15:1 light, so the hover border on the Transcribe and
audio-player buttons was very nearly not drawn. All three accent-edged
controls — those two plus `record-hud`'s Resume — now use `border-accent`, at
5.28:1 worst case light and 8.03:1 dark. **Do not darken `--tint-hover` to
"fix" a border**: it is the hover and active FILL under `citation-chip` and
`cite-runs`, and `accent-text` sits on it.

## Type

Three faces, no others:

- **Bitter** (`font-header`) — headers, names, numerals
- **Archivo** (`font-body`) — body prose and UI labels
- **IBM Plex Mono** (`font-mono`) — time, counts, metadata

Loaded via `next/font/google` in `app/layout.tsx`.

## File layout

Purpose-named, and **grouped by feature, at most one folder deep**. No FSD or
atomic layering, and no generic `parts/`, `utils/`, or `common/` dumping
ground — a file that has no better name than "utils" is a file whose
responsibility has not been decided yet.

`components/note-detail/` holds one file per piece of the screen. When a single
piece grows past about three files, it earns its own subfolder named after that
piece — `note-detail/transcript/`, not `note-detail/components/`. One level,
never two: the rule exists so a flat list stops growing without inventing a
hierarchy nobody can navigate.

Server Actions follow the same shape. `app/notes/actions/` holds one file per
track — `recording.ts` (createRecordedNote, markUploadFailed) and
`transcription.ts` (triggerTranscription). They were a single actions.ts file until
2026-09-01. It was split because the two are genuinely different tracks that
share nothing but the Supabase client, not because of the line count; the
ceiling is what made the split due, and the seam was already there.

Each file under `app/notes/actions/` needs its own `"use server"` — the
directive is per module, and a folder of actions has no shared entry point to
put it in. Type exports are fine alongside the async functions; they are erased
before Next sees them.

**Soft ceiling 250 lines, hard ceiling 400 — on SHIPPED files.** A file
approaching the ceiling gets a purpose-named extraction, never a raised
ceiling. The convention test enforces 400, and its `sourceFiles()` walk skips
`__tests__` entirely.

That exclusion is deliberate, not an oversight, and the reason is worth stating
because the ceiling reads like it applies to everything. A long source file is
coupled: line 300 cannot be read without holding the first 299 in your head,
which is the actual cost the ceiling exists to stop. A test file is a flat list
of independent cases — test 12 needs nothing from tests 1 through 11 — so its
length is quantity, not complexity, and splitting it buys nothing but churn.
`lib/recorder/__tests__/use-recorder.test.tsx` is 431 lines for that reason and
is fine. What is NOT fine in a test file is a shared harness that tests mutate
between them; that is coupling, and it earns a split whatever the line count.

## Data

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
still live code. `note_chunks.persona_id` attributes a takeaway to a lens, and a null
`persona_id` means the default persona — which is why chunks written before the
table existed still render under Neutral Analyst. `DEFAULT_PERSONA_ID` and the
one fallback persona for a user with no rows live in
`lib/notes/default-persona.ts`, which is client-safe by design: the shell is a
client component and must not pull in the server Supabase client.

**Which persona row a generation pipeline reads its config from — locked
2026-09-02, amended the same day when per-note selection shipped.**
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

**`notes.persona_id`'s foreign key is declared in `personas.sql`, not
`notes.sql`.** `config.toml` applies `notes.sql` first, so a reference to
`public.personas` written there does not resolve on a fresh apply. The column
stays with its table; only the constraint waits. It is composite —
`(persona_id, user_id) references personas (id, user_id) on delete set null
(persona_id)` — for the reason `note_chunks.persona_id` is, and a cross-tenant
write was proved refused with `23503` on 2026-09-02.

Zero rows means an account created before the 2026-08-31 provisioning trigger
and deliberately not backfilled; it falls back to `DEFAULT_PERSONA_FALLBACK`.
Either path, a generated chunk still writes `note_chunks.persona_id = null`.
The resolved row supplies `name` and `depth` to the generator and is never
persisted onto the chunk, so the "null means default persona" convention above
is unchanged.

The cron path filters on `user_id` in application code. That is the one
deliberate exception to § Supabase → RLS rules' standing "queries never filter
on `user_id`", and it is not a lapse: cron runs as `service_role`, which
bypasses RLS entirely, so an unfiltered lookup can return another account's
row. The Server Action path filters identically — there RLS already scopes it,
so the filter is defence in depth and one shared query shape, not a
requirement.

`lib/mock/note.ts` is no longer rendered. `mockNote` has no importer outside
component tests, which use it as a fixture. Do not add new mock rows — new data
goes in the database.

Nothing calls `Math.random()` or `Date.now()` in a render path — the waveform bar
heights are precomputed constants.

## Feature rules — loaded on demand, not here

Five feature areas used to sit in this file and cost ~10.4k tokens on every
prompt, whether or not the session went near them. They now live in
`.claude/rules/`, each with `paths:` frontmatter, so a rule enters context
only when Claude reads a file it governs.

| Rule file | Loads when you touch |
|---|---|
| `.claude/rules/recorder.md` | `lib/recorder/`, `components/recorder/`, `app/notes/actions/recording.ts` |
| `.claude/rules/transcription.md` | `lib/transcription/`, `lib/audio/`, `app/api/cron/transcribe/` |
| `.claude/rules/note-generation.md` | `lib/notegen/`, `lib/notes/`, `components/note-detail/` |
| `.claude/rules/embeddings.md` | `lib/rag/` |
| `.claude/rules/chat.md` | `app/api/chat/`, `lib/chat/`, `components/note-detail/chat/` |

These are rules, not notes. A rule file that has not loaded is still binding —
**read the matching file before writing code in its area**, and do not infer the
rule from the code, which is what the rule exists to constrain.

They are not `@` imports on purpose. An `@file.md` import expands at launch and
enters context whether or not it is relevant, so it saves nothing; Anthropic's
own memory documentation says so directly.

## Naming

The application's public name is **Squid Ink**, locked 2026-09-07
(`docs/DECISIONS.md` § Locked decisions → Branding, `docs/ROADMAP.md` § 9).
It may appear in user-facing copy, page titles and code.

This section previously read "The application has no confirmed public name.
Do not put a name string — working or otherwise — anywhere in code", which
was correct while naming was reopened between 2026-08-30 and the lock. That
restriction no longer applies.

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
- A foreign key between two user-owned tables is composite, carrying
  `user_id`: `note_chunks.persona_id` references `personas (id, user_id)`,
  not `personas (id)`. Foreign keys are validated as the referenced table's
  owner and are **not** subject to RLS, so a single-column reference lets one
  user point their row at another user's row. The referenced table needs a
  matching `unique (id, user_id)` for this. `on delete set null` then names
  the nullable column — `on delete set null (persona_id)`, Postgres 15 and
  later — or it would try to null `user_id` too.

### Deployment

`main` auto-deploys to Vercel (`tekguyz/squid-ink`, `https://squid-ink.vercel.app`).
Vercel's own link and config files are absent from the tree, so this is
invisible from the repo — **`docs/DEPLOYMENT.md` is the source of truth** for the Supabase Site URL,
the redirect allowlist, the Vercel environment variables, and the `curl` recipes
that re-measure them without a dashboard. Read it before changing anything about
auth redirects, and never test sign-in on a raw deployment URL without checking
that file first.

### Keys

Publishable key only in app code, via `NEXT_PUBLIC_SUPABASE_*`. Never give the
secret key a `NEXT_PUBLIC_` prefix — Next.js ships every such variable to the
browser.

The secret key bypasses RLS. **Exactly one file in shipped application code
reads it:** `app/api/cron/transcribe/route.ts`, from the Vercel environment.
That is the amendment this project made on 2026-08-31, and it is deliberate: a
cron invocation carries no user session and therefore no RLS identity, so it
must read and write rows belonging to whichever user recorded them. The route
refuses every request that does not carry `Authorization: Bearer $CRON_SECRET`
before it touches the database or the Gemini API.

**Nine local-only** scripts also read it from the gitignored `.env.local` —
`verify-rls.mjs`, `verify-storage-rls.mjs`, `verify-recorder-upload.mjs`,
`verify-persona-provisioning.mjs`, `verify-transcription-pipeline.mjs`,
`verify-manual-transcribe.mjs`, `verify-notegen-pipeline.mjs`,
`verify-persona-selection.mjs` and `print-signin-link.mjs`. None ships.

**Corrected 2026-09-03**, measured with the second grep below. This read "Six"
and named six, having missed the four scripts added between 2026-09-01 and
2026-09-02. The paragraph already said a new script moves this number; it did,
four times, and nothing moved it. An earlier version of this section claimed
"exactly one place, `scripts/verify-rls.mjs`", which was already wrong when
written; the greps below are the check that settles it. Run them rather than
trusting the counts here — a new script moves the second number.

    grep -rn "SUPABASE_SECRET_KEY" --include=*.ts --include=*.tsx app lib components
    grep -rln "SUPABASE_SECRET_KEY" scripts

`service_role` is granted `select, insert, update, delete` on `public.notes`
and `public.note_chunks`, and nothing else — see the grant blocks in both
schema files. Before 2026-08-31 it held only `REFERENCES, TRIGGER, TRUNCATE`,
so every cron read failed with `permission denied for table notes`. A grant is
not a policy: `service_role` already bypasses RLS, what it lacked was
reachability.

### Proving RLS

`node scripts/verify-rls.mjs` after any change to a policy, a grant, or a
`user_id` column. It signs in two real users and runs the identical query as
each; the second must get a genuine empty result, not `permission denied`.
That proves the database. It does **not** prove the app's cookie plumbing —
that needs a request through `proxy.ts` with a real session. Run both.

## Commands

**The dev server is started through `.claude/launch.json`, not through a
shell.** The entry is named `dev` and it runs `npm run dev` on port 3000; an
agent starts it with the preview tool and reads its output with the preview log
tool. Started from a shell instead, the process is owned by whichever shell
started it: its stdout goes to a scratch file nobody reads, stopping it means
hunting `next dev` and its Turbopack child by pid, and a second start silently
collides on port 3000. All three happened on 2026-09-07. The line below is what
a human types; it is not the path for an agent.

    npm run dev        # dev server — agents: use .claude/launch.json instead
    npm run build      # production build
    npm run typecheck  # tsc --noEmit
    npm test           # vitest run
    node scripts/verify-rls.mjs   # two-user RLS proof, needs .env.local
    node scripts/verify-persona-provisioning.mjs   # signup-trigger proof, needs .env.local
    node scripts/verify-transcription-pipeline.mjs # live transcription proof, needs `npm run dev`
    node scripts/verify-embeddings-pipeline.mjs    # live embeddings proof, needs .env.local
                                                   # (VOYAGE_API_KEY); paces itself, minutes
    node scripts/verify-layout.mjs                 # screen-level layout proof, needs
                                                   # `npm run dev` and .env.local

## Layout

**Every other check in this repo is file-shaped; this class of defect is
screen-shaped.** `npm test` renders in jsdom, which has no layout engine, so
every rect there is zeros. `project-conventions.test.ts` reads source text.
The impeccable detector lints class strings. All three are correct and all
three are blind to two files that are each right alone and wrong on the same
pixels.

`scripts/verify-layout.mjs` is the check that is not. It drives the Chrome
already installed over the DevTools Protocol — **no new dependency**, using
Node's built-in `WebSocket` — signs in through the same `generateLink` path
`print-signin-link.mjs` documents, and measures real boxes on `/` and a real
note at 1440px and 1280px, in **both themes**, six assertions each:

- no two fixed elements overlap,
- no fixed element covers flow text,
- every fixed element is inside the viewport,
- no horizontal page overflow,
- every scroll container is themed in **both** rendering engines
  (`scrollbar-width` AND `::-webkit-scrollbar`),
- no OS arrow buttons on any scrollbar.

It was proved to fail before it was trusted: restoring `theme-toggle.tsx` to
its original `right-3 bottom-3` turns 48 green into 40 green and 8 failures
naming both colliding elements. A layout assertion nobody has watched fail is
an assertion about a walk nobody watched — the same reasoning
`project-conventions.test.ts` states about its own file walk.

Widths are `1440` and `1280` only, because no responsive breakpoint work has
shipped. Add widths when breakpoints do, not before. Next's dev-tools badge is
a real fixed element in the bottom-left corner and is excluded by name; it
does not ship.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
