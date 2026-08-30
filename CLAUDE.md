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

Mock only. No `fetch`, no API client, no environment variables, no backend.
Everything the screen renders comes from `lib/mock/note.ts`.

Nothing calls `Math.random()` or `Date.now()` in a render path — the waveform bar
heights are precomputed constants.

## Naming

The application has no confirmed public name. **Do not put a name string —
working or otherwise — anywhere in code.** User-facing copy stays generic
("your notes", page titles with no brand). The only exception is the
`package.json` `name` field.

## Commands

    npm run dev        # dev server
    npm run build      # production build
    npm run typecheck  # tsc --noEmit
    npm test           # vitest run

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
