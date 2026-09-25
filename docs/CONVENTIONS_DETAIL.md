# Conventions — detail and history

**Last updated:** 2026-09-21

`CLAUDE.md` holds the standing rules and loads into every message. This file
holds the reasoning, the corrections and the dated measurements behind those
rules. Read it on demand; nothing here is a rule that `CLAUDE.md` does not
already state.

Split out of `CLAUDE.md` on 2026-09-21 (Job 4 of
`C:\Projects\tekguyz-one\docs\WORKFLOW-PLAN-2026-09-20.md`).

## Why the file-size ceiling exempts tests

`CLAUDE.md` § File layout sets a soft ceiling of 250 lines and a hard ceiling of
400 on **shipped** files, and the convention test's `sourceFiles()` walk skips
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

## Why `app/notes/actions/` is a folder

Server Actions follow the same feature-grouped shape as components.
`app/notes/actions/` holds one file per track — `recording.ts`
(createRecordedNote, markUploadFailed) and `transcription.ts`
(triggerTranscription). They were a single `actions.ts` file until 2026-09-01.
It was split because the two are genuinely different tracks that share nothing
but the Supabase client, not because of the line count; the ceiling is what made
the split due, and the seam was already there.

Each file under `app/notes/actions/` needs its own `"use server"` — the
directive is per module, and a folder of actions has no shared entry point to
put it in. Type exports are fine alongside the async functions; they are erased
before Next sees them.

## Why the feature rules are not `@` imports

Five feature areas used to sit in `CLAUDE.md` and cost ~10.4k tokens on every
prompt, whether or not the session went near them. They moved to
`.claude/rules/` on 2026-09-09, each with `paths:` frontmatter, so a rule enters
context only when Claude reads a file it governs.

They are not `@` imports on purpose. An `@file.md` import expands at launch and
enters context whether or not it is relevant, so it saves nothing; Anthropic's
own memory documentation says so directly.

## Naming — what this section used to say

`CLAUDE.md` § Naming previously read "The application has no confirmed public
name. Do not put a name string — working or otherwise — anywhere in code",
which was correct while naming was reopened between 2026-08-30 and the lock on
2026-09-07. That restriction no longer applies. The name is **Squid Ink**
(`docs/DECISIONS.md` § Locked decisions → Branding, `docs/ROADMAP.md` § 9).

## Secret-key allowlist — the correction history

`CLAUDE.md` § Supabase → Keys carries the live allowlist, and
`scripts/check-docs.mjs` parses it from that section. Its count has drifted
three times; this is the record.

**Changed 2026-09-25 (issue #44)**, a deliberate move, not a correction: the
shipped-reader count went from one to two. `app/api/dev-login/route.ts` reads
the key to create or repair the dev account, and only in development — the
route answers 404 before reading anything otherwise.

**Corrected 2026-09-14**, measured with the second grep in that section:
`verify-chat-rls.mjs` had read the key since the chat pack and was never listed,
and the deleted `print-signin-link.mjs` went with magic-link sign-in. The count
stayed nine by coincidence, not because the list was right.

**Corrected 2026-09-03**, measured the same way. The section read "Six" and
named six, having missed the four scripts added between 2026-09-01 and
2026-09-02. The paragraph already said a new script moves this number; it did,
four times, and nothing moved it. An earlier version claimed "exactly one place,
`scripts/verify-rls.mjs`", which was already wrong when written. Run the greps
rather than trusting a count — a new script moves the second number.

## Two machines — the hook and the line endings

The hard rule is in `CLAUDE.md` § Two machines, one repo. The automation:

`.claude/hooks/git-behind.sh` runs on `SessionStart`, fetches, and warns when
HEAD is behind its upstream — naming the count, and adding a stop when the tree
is dirty. It **warns only**: it never pulls and never touches the working tree,
because a pull into uncommitted work is the one way this check could cause harm.
Offline or with no upstream it exits silently rather than nagging.

The hook is wired into `~/.claude/settings.json`, which is per-machine and which
git does not carry, so **each laptop runs `bash .claude/hooks/install.sh`
once**. The script it installs lives in this repo, so a later fix to the check
reaches both machines by pull. The installer is idempotent and merges into
existing settings rather than replacing them.

`.gitattributes` pins `*.sh` to `eol=lf` for this reason and no other:
`core.autocrlf` is true on these Windows machines, so without it the hook
scripts check out with CRLF and bash fails at the shebang with
`bad interpreter: /usr/bin/env bash^M`. The check that exists to warn a second
machine would be the one thing that does not run there.

## Why the dev server is started through `.claude/launch.json`

The entry is named `dev` and it runs `npm run dev` on port 3000; an agent starts
it with the preview tool and reads its output with the preview log tool. Started
from a shell instead, the process is owned by whichever shell started it: its
stdout goes to a scratch file nobody reads, stopping it means hunting `next dev`
and its Turbopack child by pid, and a second start silently collides on port
3000. All three happened on 2026-09-07.
