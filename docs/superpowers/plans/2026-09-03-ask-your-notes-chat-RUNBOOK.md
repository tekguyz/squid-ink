# Runbook — executing the ask-your-notes chat plan

Three fresh sessions, one per batch. Each starts at full context and ends on a
green suite. Copy the prompt for the batch you are on, paste it as the first
message of a NEW session opened in `C:\Projects\tekguyz-squid-ink`.

**Plan:** `docs/superpowers/plans/2026-09-03-ask-your-notes-chat.md`
**Spec:** `docs/superpowers/specs/2026-09-03-ask-your-notes-chat-design.md`

---

## Before you start

1. **Branch, not a worktree.** A worktree is one more path to remember across
   three sessions, and nothing here runs in parallel, so it buys nothing.
   Batch 1's prompt creates the branch. Batches 2 and 3 just continue on it.

2. **Add `ANTHROPIC_API_KEY` to `.env.local` before batch 3.** Batch 3 is the
   first thing that calls Claude. No `NEXT_PUBLIC_` prefix — Next.js ships
   every such variable to the browser.

3. **Have your Supabase project ref to hand.** Batches 1 and 3 run
   `npx supabase db query --linked --project-ref <ref>`. The plan writes it as
   `<ref>` on purpose; the session will ask, or read it from `.env.local`.

4. **The `supabase` MCP server is not authorized** and cannot be authorized
   from a non-interactive session. It is not needed — the CLI and the verify
   scripts do everything. Ignore any prompt about it.

---

## Batch 1 — database (Tasks 1–3)

Deps, both SQL files, both verify scripts. Ends with real tables and a real
function in the linked project.

```
Execute Tasks 1 through 3 of docs/superpowers/plans/2026-09-03-ask-your-notes-chat.md.

Use the superpowers:executing-plans skill. Read the plan's header and its
Global Constraints section first, then read the spec it names
(docs/superpowers/specs/2026-09-03-ask-your-notes-chat-design.md) before
touching anything.

First: create and switch to a branch named feat/ask-your-notes-chat.

Do only Tasks 1, 2 and 3. Stop after Task 3's commit and report back — do not
start Task 4.

Task 3 has two traps that the plan spells out and that will silently produce
a working-looking but wrong function if you skip them: `set search_path = ''`
makes `<=>` and `'english'::regconfig` unresolvable, so they must be written
`operator(extensions.<=>)` and `'pg_catalog.english'::regconfig`. Task 3
Step 5 proves the FTS index still matches with EXPLAIN — actually run it and
paste the plan output, do not assume it.

Paste the full output of both verify scripts in your report. A claim that they
passed is not enough.
```

---

## Batch 2 — the pure modules (Tasks 4–7)

Four `lib/` modules, all test-first. No database, no network, no UI. This is
the batch most likely to finish comfortably.

```
Execute Tasks 4 through 7 of docs/superpowers/plans/2026-09-03-ask-your-notes-chat.md.

Use the superpowers:executing-plans skill. Read the plan's header and its
Global Constraints section first, then read the spec it names
(docs/superpowers/specs/2026-09-03-ask-your-notes-chat-design.md).

You are on branch feat/ask-your-notes-chat. Tasks 1-3 are already done and
committed — do not redo them.

Do only Tasks 4, 5, 6 and 7. Stop after Task 7's commit and report back.

These are test-first tasks. Write each failing test, RUN it and confirm it
fails for the stated reason, then implement. Do not write the implementation
first and back-fill the test.

Two things the tests exist to pin, so do not "simplify" them away: Voyage's
input_type must be "query" and never "document", and the AI SDK step-loop
helper is isStepCount, not stepCountIs.

End with `npm test && npm run typecheck` green and paste the output.
```

---

## Batch 3 — route, UI, docs (Tasks 8–11)

The biggest batch. If it runs out of room, it is safe to stop after Task 9 or
Task 10 and start a fourth session for the rest — every task ends on a commit.

```
Execute Tasks 8 through 11 of docs/superpowers/plans/2026-09-03-ask-your-notes-chat.md.

Use the superpowers:executing-plans skill. Read the plan's header and its
Global Constraints section first, then read the spec it names
(docs/superpowers/specs/2026-09-03-ask-your-notes-chat-design.md).

You are on branch feat/ask-your-notes-chat. Tasks 1-7 are already done and
committed — do not redo them.

Task 8 Step 10 unskips two tests that Task 1 deliberately skipped. Do not
forget it; the whole point of skipping them was that the guard could not be
silently lost.

Task 10 needs a real browser. Use the Browser pane tools (preview_start),
never `npm run dev` in a shell. Screenshot the two citation behaviours — a
transcript citation jumping to its timestamp, and a cross-note citation
navigating to the other note.

Task 11 Step 5 proves the two abuse ceilings with curl against the running
route. Paste the actual HTTP status codes.

Tasks 7, 8 and 9 of the DECISIONS/ROADMAP doc edits must be applied VERBATIM
as the plan quotes them, only adjusting the date if it is no longer
2026-09-03.

If you run low on context, stop cleanly after any task's commit and say which
task you finished. Do not rush the remainder.
```

---

## After batch 3

Ask that session to run `superpowers:requesting-code-review`, then
`superpowers:finishing-a-development-branch`.

## Still open, by instruction — not oversight

- **Note auto-titling.** Cross-note citation chips render `notes.title`, which
  is null for most rows, so they read "Untitled note". The feature works
  without it; it is just weaker.
- **Persona-aware filtering of search results.** Chunks carry `persona_id` and
  nothing filters on it. Nobody has decided whether an active lens should
  narrow cross-note retrieval.
