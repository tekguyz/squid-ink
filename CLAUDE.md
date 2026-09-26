# Conventions

**Last updated:** 2026-09-26
Update this line whenever this file changes — don't let it drift from reality.

**This file states standing rules and pointers. It loads into every message.**
Bulk lives in `.claude/rules/` with `paths:` frontmatter, which costs nothing
until Claude reads a matching file, or in `docs/`, read on demand. Reasoning,
corrections and dated measurements: `docs/CONVENTIONS_DETAIL.md`.

## Stack

Next.js App Router with React Server Components, TypeScript, Tailwind CSS v4.
The App Router keeps a dense, mostly-static reading surface as a server
component and ships only the three interactive islands to the client. Tailwind
v4 is used for its native CSS-variable `@theme`, which is what makes one token
file drive both themes without any component branching on theme.

## Pinned versions

**Exact pins, no `^` or `~` ranges.** When bumping, check the live npm registry
again (`npm view <pkg> dist-tags`) — never take a version from memory, never
loosen a pin to a range. `scripts/check-docs.mjs` check 1 parses this table from
this file against `package.json`, so it does not move and a second copy anywhere
is the drift it exists to catch. Verified 2026-08-30 / 08-31 / 09-04; built on
Node v24.18.0, npm 11.16.0.

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


## Colour

**Every colour is a `var()` into `app/globals.css`. Zero `oklch()`, hex,
`rgb()`, or `hsl()` anywhere in `components/` or `lib/`.** `app/globals.css` is
the only file that names a colour, and
`components/note-detail/__tests__/project-conventions.test.ts` fails the build
if a literal appears elsewhere.

**Contrast is measured against the sheet a thing actually sits on, never
against `paper` alone, and against the BUILT CSS, not the source.**

Detail — both theme definitions, the speaker lookup, `canvas` vs `raised`,
`--control-edge` vs `--rule-2`, the accent family, the measurements:
`.claude/rules/design-tokens.md`.

## Type

Three faces, no others: **Bitter** (`font-header`) for headers, names and
numerals; **Archivo** (`font-body`) for body prose and UI labels; **IBM Plex
Mono** (`font-mono`) for time, counts and metadata. Loaded via
`next/font/google` in `app/layout.tsx`.

## File layout

Purpose-named and **grouped by feature, at most one folder deep**. No FSD or
atomic layering, and no generic `parts/`, `utils/` or `common/` dumping ground.
When a piece grows past about three files it earns its own subfolder named
after that piece — `note-detail/transcript/`, not `note-detail/components/`.
Server Actions follow the same shape under `app/notes/actions/`, and **each
file there needs its own `"use server"`**.

**Soft ceiling 250 lines, hard ceiling 400 — on SHIPPED files.** A file near
the ceiling gets a purpose-named extraction, never a raised ceiling. The
convention test enforces 400 and deliberately skips `__tests__`. Why:
`docs/CONVENTIONS_DETAIL.md`.

## Data

Supabase is the only data path — no `fetch`, no API client, called from server
components. **The client never sees a uuid:** `Persona.id` and `Note.personaId`
are slugs. **Nothing calls `Math.random()` or `Date.now()` in a render path.**
**Do not add new mock rows** — `lib/mock/` is a test fixture only; new data goes
in the database.

Persona resolution, the view-model seam, the composite foreign keys and the one
deliberate `user_id` filter: `.claude/rules/data-layer.md`.

## Feature rules — loaded on demand, not here

A path-scoped rule file enters context only when Claude reads a file it governs.

| Rule file | Governs |
|---|---|
| `recorder.md` | `lib/recorder/`, `components/recorder/`, `app/notes/actions/recording.ts` |
| `transcription.md` | `lib/transcription/`, `lib/audio/`, `app/api/cron/transcribe/` |
| `note-generation.md` | `lib/notegen/`, `lib/notes/`, `components/note-detail/` |
| `embeddings.md` | `lib/rag/` |
| `chat.md` | `app/api/chat/`, `lib/chat/`, `components/note-detail/chat/` |
| `data-layer.md` | `lib/notes/`, `lib/notegen/`, `app/notes/actions/`, note + persona schemas |
| `design-tokens.md` | `app/globals.css`, `components/`, `lib/` |
| `supabase-schema.md` | `supabase/`, the RLS verify scripts |
| `auth.md` | `lib/auth/`, `app/auth/`, `lib/supabase/`, `proxy.ts` |
| `layout-checks.md` | `components/`, `app/`, `scripts/verify-layout.mjs` |

All live in `.claude/rules/`. These are rules, not notes. A rule file that has
not loaded is still binding — **read the matching file before writing code in
its area**, and never infer the rule from the code, which is what the rule
exists to constrain. Not `@` imports, on purpose
(`docs/CONVENTIONS_DETAIL.md`).

## Naming

The application's public name is **Squid Ink**, locked 2026-09-07
(`docs/DECISIONS.md` § Locked decisions → Branding, `docs/ROADMAP.md` § 9). It
may appear in user-facing copy, page titles and code.

## Supabase

Hosted project only. **Docker is not installed on this machine**, so there is no
local stack and `db pull` / `db dump` both fail. Everything runs against the
linked project through the management API. Schema workflow, apply and migration
recipes, grant blocks: `.claude/rules/supabase-schema.md`.

### Pinned versions

Exact pins, verified against the live npm registry on 2026-08-30.

| Package | Version |
|---|---|
| @supabase/ssr | 0.12.5 |
| @supabase/supabase-js | 2.112.4 |
| supabase (CLI, installed) | 2.115.0 |

`@supabase/ssr` 0.12.5 takes the `getAll` / `setAll` cookie API. The
`get` / `set` / `remove` form is deprecated and will be removed.

### RLS rules

Four per-operation policies per table — select, insert, update, delete. Never
one blanket `for all`.

- Predicate is always `(select auth.uid()) = user_id`, wrapped. Bare
  `auth.uid()` is re-evaluated per row.
- Every policy carries `to authenticated` **and** an ownership predicate.
  `to authenticated` alone is authentication without authorization.
- UPDATE needs both `using` and `with check`. Without `with check` a user can
  reassign `user_id` and hand their row to somebody else.
- Grants are separate from RLS. Each table `revoke all` first, then grants
  `authenticated` explicitly. `anon` is granted nothing.
- **Queries never filter on `user_id` in application code.** RLS supplies it; a
  redundant filter masks an RLS failure instead of exposing it. The cron path
  is the one deliberate exception — `.claude/rules/data-layer.md`.
- **A foreign key between two user-owned tables is composite, carrying
  `user_id`.** Foreign keys are validated as the referenced table's owner and
  are **not** subject to RLS, so a single-column reference lets one user point
  their row at another user's row. Mechanics:
  `.claude/rules/supabase-schema.md`.

### Auth

Email + password sign-in. Emailed **links**, not codes, and only for account
confirmation and password reset. Magic-link sign-in is retired (2026-09-14).
Two rules bite from anywhere, so they stay here:

- **Every Supabase client writes cookies through `withPersistence`**
  (`lib/auth/session-persistence.ts`) — server, proxy and browser. A client on
  the library's default cookie handling turns an unchecked "Keep me signed in"
  into a 400-day session on its first token refresh.
- **`verifyOtp` is called in one place**, the POST behind `/auth/confirm`.
  Never verify on a GET.

Detail, templates and local sign-in testing: `.claude/rules/auth.md`.

### Deployment

`main` auto-deploys to Vercel (`tekguyz/squid-ink`). Vercel's own files are
absent from the tree, so **`docs/DEPLOYMENT.md` is the source of truth** for the
Site URL, the redirect allowlist, the environment variables and the `curl`
recipes that re-measure them. Read it before changing auth redirects, and never
test sign-in on a raw deployment URL without checking it first.

### Keys

Publishable key only in app code, via `NEXT_PUBLIC_SUPABASE_*`. **Never give the
secret key a `NEXT_PUBLIC_` prefix** — Next.js ships every such variable to the
browser.

The secret key bypasses RLS. **Exactly two files in shipped application code
read it.** `app/api/cron/transcribe/route.ts` reads it from the Vercel
environment. A cron invocation carries no user session and therefore no RLS
identity, so it must read and write rows belonging to whichever user recorded
them. The route refuses every request that does not carry
`Authorization: Bearer $CRON_SECRET` before it touches the database or the
Gemini API. `app/api/dev-login/route.ts` reads it only to create or repair the
dev account, and answers 404 before reading anything unless `NODE_ENV` is
`development`.

**Ten local-only** scripts also read it from the gitignored `.env.local` —
`verify-rls.mjs`, `verify-storage-rls.mjs`, `verify-recorder-upload.mjs`,
`verify-persona-provisioning.mjs`, `verify-transcription-pipeline.mjs`,
`verify-manual-transcribe.mjs`, `verify-notegen-pipeline.mjs`,
`verify-persona-selection.mjs`, `verify-chat-rls.mjs` and
`verify-depth-and-fallback.mjs`. None ships.

`scripts/check-docs.mjs` PARSES that allowlist out of this section, so the two
paragraphs above are load-bearing prose, not a note. Run the greps rather than
trusting the count — a new script moves it. Correction history:
`docs/CONVENTIONS_DETAIL.md`.

    grep -rn "SUPABASE_SECRET_KEY" --include=*.ts --include=*.tsx app lib components
    grep -rln "SUPABASE_SECRET_KEY" scripts

`service_role` is granted `select, insert, update, delete` on `public.notes`
and `public.note_chunks`, and nothing else. A grant is not a policy:
`service_role` already bypasses RLS; what it lacked was reachability.

### Proving RLS

`node scripts/verify-rls.mjs` after any change to a policy, a grant, or a
`user_id` column. Two real users run the identical query; the second must get a
genuine empty result, not `permission denied`. That proves the database, **not**
the cookie plumbing — that needs a request through `proxy.ts` with a real
session. Run both.

## Commands

**The dev server is started through `.claude/launch.json`, not through a
shell** — an agent uses the preview tool and the preview log tool. The line
below is what a human types. Why it matters: `docs/CONVENTIONS_DETAIL.md`.

    npm run dev        # dev server — agents: use .claude/launch.json instead
    npm run build      # production build
    npm run typecheck  # tsc --noEmit
    npm run test:unit         # unit tests; CI runs them on every PR
    npm run test:integration  # database tests in supabase/tests/, serially;
                              # none yet — DB proofs are scripts/verify-*.mjs
    npm test                  # refuses on purpose: prints the two above, exits 1
    node scripts/check-docs.mjs                    # doc drift; 0 clean, 1 findings,
                                                   # 2 could not run — NOT a pass
    node scripts/verify-rls.mjs                    # two-user RLS proof, .env.local
    node scripts/verify-persona-provisioning.mjs   # signup-trigger proof, .env.local
    node scripts/verify-transcription-pipeline.mjs # live, needs `npm run dev`
    node scripts/verify-depth-and-fallback.mjs     # live notegen at Brief, Exhaustive
                                                   # and fallback; .env.local, no dev server
    node scripts/verify-embeddings-pipeline.mjs    # live, .env.local (VOYAGE_API_KEY);
                                                   # paces itself, minutes
    node scripts/verify-layout.mjs                 # layout proof, needs `npm run dev`
                                                   # and .env.local
    node scripts/capture-og-image.mjs              # re-shoots app/opengraph-image.png from
                                                   # the landing page; needs `npm run dev`
    node scripts/verify-email-templates.mjs        # hosted auth email templates vs
                                                   # repo; SUPABASE_ACCESS_TOKEN
    bash .claude/hooks/install.sh                  # once per machine

**UI work has one extra gate.** `npm run test:unit` runs in jsdom, which has no layout
engine, so every rect there is zeros. Any change to fixed positioning, a scroll
container or a corner overlay ends with `node scripts/verify-layout.mjs`
exiting 0. What it asserts: `.claude/rules/layout-checks.md`.

**Signed-in pages: open `/api/dev-login` in the browser pane.** An agent may not
type a password there, and this route removes the need. In development it signs
in `dev@squid-ink.test` for real — RLS applies — and redirects to `/`, or to
`?next=/some/path` on the same origin. It creates the account (confirmed and
onboarded) when it is missing, and writes a random `DEV_LOGIN_PASSWORD` into
`.env.local` when that is missing. Outside development it answers 404.

## Two machines, one repo

**This repo is worked from two laptops. `git fetch` before trusting any git
state, and never report a tree as current without one.** `origin/main` is a
cached local ref: without a fetch, `git status -sb` says "in sync with
origin/main" while the remote is many commits ahead — a confident, wrong,
measured-looking claim that produced a bad handoff on 2026-09-09.

`.claude/hooks/git-behind.sh` warns on `SessionStart` and never pulls. **Each
laptop runs `bash .claude/hooks/install.sh` once.** The hook, the per-machine
settings file and the `.gitattributes` `eol=lf` pin that keeps it runnable:
`docs/CONVENTIONS_DETAIL.md`.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


## Agent skills

### Issue tracker

New work goes to GitHub Issues (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root, created lazily as terms/decisions resolve. See `docs/agents/domain.md`.
