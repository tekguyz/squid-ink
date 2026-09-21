# Runbook — resuming the ask-your-notes chat plan

**Plan:** `docs/superpowers/plans/2026-09-03-ask-your-notes-chat.md`
**Spec:** `docs/superpowers/specs/2026-09-03-ask-your-notes-chat-design.md`
**Branch:** `feat/ask-your-notes-chat`

Open a new session in `C:\Projects\tekguyz-squid-ink` and paste the prompt
below as the first message. It verifies the claimed state itself before doing
any work.

---

## The resume prompt

```
Resume docs/superpowers/plans/2026-09-03-ask-your-notes-chat.md on branch feat/ask-your-notes-chat.

Use the superpowers:executing-plans skill.

STEP 0 — VERIFY, do not trust. A previous session claims Tasks 1, 2 and 4 are done and committed, and that Task 3's SQL is done but its verify script has never been run. Check that yourself before touching anything:

  git branch --show-current          # expect feat/ask-your-notes-chat
  git status --short                 # expect clean
  git log --oneline -6
  npm test && npm run typecheck      # expect green, with exactly 2 skipped

  ls lib/rag/query-embed.ts lib/chat 2>&1
  npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select proname, prosecdef from pg_proc where proname='search_note_chunks'"
  npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select count(*) from information_schema.tables where table_name='chat_messages'"

The 2 skipped tests are deliberate: project-conventions.test.ts skips two server-key guards until Task 8 creates app/api/chat/route.ts. They carry an "UNSKIP IN TASK 8" comment. Task 8 Step 10 unskips them.

Report what you actually found before proceeding. If anything contradicts the claim above, stop and say so rather than working around it.

STEP 1 — READ. Read the plan's header, its Global Constraints section, and its File Structure section in full. Every task implicitly includes Global Constraints, and it holds the version pins, the isStepCount-not-stepCountIs warning, the colour-token rule and the RLS rules. Then read the spec. Then read each task's own section as you reach it, including its Interfaces block, which is how you learn the names neighbouring tasks use.

STEP 2 — FINISH TASK 3. Run:
  VOYAGE_MIN_CALL_INTERVAL_MS=0 node scripts/verify-chat-search.mjs
It has never been executed and may need fixing. It proves six things; all six must pass. Commit, then continue from Task 5.

Then work Tasks 5 through 11 in order. Do not spawn subagents. Stop cleanly after any task's commit if you run low on context, and say which task you finished.

Known corrections already applied to the plan, so do not re-derive them:
  * `supabase db query` takes SQL as a positional argument. There is no --query flag.
  * Modules under lib/rag/ must import through the "@/" alias, never a relative path. Node ESM refuses an extensionless relative specifier and the verify scripts' resolve hook only maps "@/".
```

---

## State as of the handoff

Verified by the session that wrote this, but verify it again — that is what
Step 0 is for.

| Task | State |
|---|---|
| 1. Deps + key guards | committed `93a8467` |
| 2. `chat_messages` + RLS proof | committed `08c9d52`, 5 proofs passed |
| 3. `search_note_chunks` | SQL committed `a95dce5`; verify script committed `aec968b` but **never run** |
| 4. `query-embed.ts` | committed `bb3763f`, 8 tests pass |
| 5–11 | not started |

Live database objects confirmed present at handoff time: `public.chat_messages`
with four RLS policies and two indexes; `public.search_note_chunks` with
`prosecdef = false` and `search_path = ""`, EXECUTE granted to `authenticated`
only. `EXPLAIN` confirmed `note_chunks_content_fts_idx` is used.

## Before Task 8

`ANTHROPIC_API_KEY` is **not** in `.env.local` yet. Task 8 is the first thing
that needs it. No `NEXT_PUBLIC_` prefix.

## Still open, by instruction — not oversight

- **Note auto-titling.** Cross-note citation chips render `notes.title`, which
  is null for most rows, so they read "Untitled note".
- **Persona-aware filtering of search results.** Nothing filters on
  `persona_id`, and nobody has decided whether an active lens should.
