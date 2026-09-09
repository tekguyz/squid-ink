---
paths:
  - "app/api/chat/**"
  - "lib/chat/**"
  - "lib/rag/search-tool.ts"
  - "components/note-detail/chat/**"
  - "scripts/verify-chat-search.mjs"
  - "scripts/verify-chat-rls.mjs"
---

# Chat

**Retrieval splits by SCOPE, and single-note chat uses none of it.** A meeting
transcript is small against Claude's context window, so the this-note path
feeds the raw transcript plus this note's generated chunks straight in, behind
one 5-minute cache breakpoint. Cross-note is the only retrieval consumer.

**The single-note path never reads `notegen_status`, and that absence is the
feature.** `buildTranscriptBlock` in `lib/chat/context.ts` includes generated
notes when they exist and omits them when they do not — there is no branch,
which is what makes "chat works the instant transcription finishes" true by
construction rather than by discipline. Proved in a browser on 2026-09-03
against a note at `'generating'` and one at `'failed'`; both answered. A test
asserts the block never contains the words notegen, generating or failed.

**The cached block must stay byte-stable across turns.** Prompt caching is a
prefix match, so one timestamp, turn counter or random id in that block leaves
`cache_read_input_tokens` at zero forever while everything still looks
correct. A test asserts two calls produce an identical string.

**And it must sit AHEAD of the history, not after it — found in code review
2026-09-03.** Byte stability is necessary and NOT sufficient: caching
matches a prefix from the start of the request, so a block placed after the
conversation diverges from turn 1's prefix the moment a second turn exists,
and the cache never reads. The transcript therefore leads `messages` as its
own user block and the history follows; the provider merges consecutive
same-role messages, so it coalesces with the first question. A route test
asserts the ordering, because the byte-stability test passes either way and
would have let this ship.

**MEASURED 2026-09-03, and the numbers are in the log on purpose.** The route
prints `[chat] scope=… in=… cacheRead=… cacheWrite=… out=…` on every turn.
A 5,700-token transcript gave `cacheWrite=7483` on turn 1 and
`cacheRead=7483` on turn 2 — the whole prefix served from cache. Keep the log
line: the cache can stop hitting from a change nowhere near the route, and
nothing fails when it does. Only the bill moves.

**A short note will never cache, and that is correct.** Anthropic declines to
cache a prefix under roughly 1,024 tokens and says nothing about it. A
six-line transcript measured `in=554 cacheWrite=0` — there is nothing worth
saving there, so this is not a bug and must not be "fixed". It does mean a
small fixture cannot prove the cache works; measure with a realistic
transcript or you are testing nothing. The breakpoint
is `providerOptions.anthropic.cacheControl: { type: "ephemeral" }`, whose
default TTL is the 5 minutes this design wants — read from the AI SDK's
Anthropic provider docs on 2026-09-03, not assumed.

**`search_note_chunks` is NOT `security definer`, and app code adds no
`user_id` filter around it.** RLS on `notes` and `note_chunks` does the
owner-scoping; a redundant filter would mask an RLS failure instead of
exposing it. `prosecdef = false` was read back from `pg_proc`.

**`set search_path = ''` costs two things that do not announce themselves.**
The linter wants it; both consequences are silent:

- `<=>` lives in `extensions`, so an empty search path cannot resolve it.
  Write `operator(extensions.<=>)`.
- `'english'::regconfig` resolves through the search path too. Write
  `'pg_catalog.english'::regconfig` — the same OID
  `note_chunks_content_fts_idx` was built with, so the gin index still
  matches. Getting this wrong does **not** error; it sequential-scans every
  chunk ever written. `EXPLAIN` confirmed a Bitmap Index Scan on 2026-09-03,
  and the planner normalises the qualified form straight back to
  `'english'::regconfig`. Re-run the `EXPLAIN` rather than trusting this line.

The candidate pool is **one clause** — `created_at > now() - interval '90
days' order by created_at desc limit 25` — which naturally yields whichever
bound is smaller. The result cap is 25 post-RRF, unconditionally, and it is
stated twice on purpose: the SQL `limit 25` is the real bound, and
`MAX_SEARCH_RESULTS` in `lib/rag/search-tool.ts` holds if that function is
ever edited. `scripts/verify-chat-search.mjs` proves both pool bounds
separately, because a change that broke one while leaving the other would
pass a combined test.

**History is re-read from `chat_messages` every turn, never taken from the
request body.** `useChat` posts its whole message array; the route reads only
the newest text and the scope out of it. That is what makes the 20-turn bound
structural rather than cooperative — a forged 500-turn payload cannot walk
past `trimHistory` because `trimHistory` never sees it. A route test pins it.

**The two ceilings, in cheapest-first order.** 4,000 characters (a string
compare) then 20 user messages per rolling 60 seconds (one `count` against
`chat_messages`, RLS-scoped, no `user_id` filter). Both run before any
embedding and any model call. **Do not add a rate-limit table** — the table
this feature already creates answers the question.

**The user's turn is persisted BEFORE the model call, and rolled back if that
call fails — added 2026-09-04.** The ordering is not incidental: the rate
limit above counts rows in `chat_messages`, so a question that is not a row is
a question that is not counted. The cost is that a failed model call used to
leave the question in the thread forever, re-sent as history on every later
turn — found in production when a malformed `ANTHROPIC_WORKSPACE_ID` 400'd
three turns in a row.

`insertUserMessage` therefore returns the new row's id, and
`consumeStream`'s `onError` deletes **that id**, never "the newest row" — a
concurrent turn could have written one. The `answered` flag, set at the top of
`onFinish`, is what stops the rollback firing on a stream that died after text
arrived: deleting a question under a persisted answer trades one orphan for a
worse one. **Do not move the insert after the model call** to avoid needing
the rollback; that silently un-gates the rate limit. Four tests in
`route-gates.test.ts` pin all of it, and the rate-limit consequence is recorded
in `docs/KNOWN_GAPS.md`.

**`note_chunks.embedding IS NULL` is still the embedding queue and nothing
here touches it.** Chat is read-only against `note_chunks`.

Gemini is not involved. Claude specifics, all measured against the live API on
2026-09-03 rather than recalled:

- **The model id is `claude-sonnet-5`**, exact, no date suffix.
- **Sonnet 5 removed `budget_tokens` and answers 400 if it is sent.** Use
  `thinking: { type: "adaptive" }`. A route test asserts the string never
  appears.
- **Pass a stop condition, or the tool loop never answers.** `stopWhen:
  isStepCount(5)`. Without one the run halts after the tool call and no
  text is ever written.

  **Corrected 2026-09-03, in code review.** This read "the step-loop helper
  is `isStepCount(n)`, NOT `stepCountIs(n)` — the older name does not exist
  in `ai` 7.x". It does exist: `index.d.ts` exports `isStepCount as
  stepCountIs`, so the two are the same function and either name works. The
  claim was written from the docs' prose rather than from the installed
  `.d.ts`, which is exactly what `.claude/rules/transcription.md`'s own rule forbids.
- **`sendReasoning: false` must be passed EXPLICITLY** to
  `toUIMessageStream`. It **defaults to `true`** in `ai` 7.0.92 —
  `node_modules/ai/dist/index.js:7932` — so omitting it opts IN and
  forwards reasoning deltas to the browser. A test pins the explicit
  `false`.

  **Corrected 2026-09-03, in code review.** This read "`sendReasoning` must
  stay unset … leaving the flag off keeps chain-of-thought off the wire",
  which is the opposite of what the installed version does. The test
  asserted the same mistake and therefore forbade the fix. Layers 1 and 3
  (the renderer ignores `reasoning` parts; Sonnet 5 defaults
  `thinking.display` to `"omitted"`) held throughout, so nothing leaked —
  but an inverted defence-in-depth layer is worse than a missing one,
  because it is believed.
- **An identity-linked API key needs `anthropic-workspace-id` on every
  request** or the API answers 400. `ANTHROPIC_WORKSPACE_ID` is sent only when
  set, because a plain workspace-scoped key must not send it. Confirmed by the
  response echoing the header back.

**Citations key on WHERE the cited content lives, not on `chunk_type`.**
`[[cite:t<seq>]]` is a transcript segment on the page being viewed and scrolls
to it; `[[cite:c<n>]]` is result n from a tool call, usually another note, and
**navigates**. Chunk type only chooses the label. The chunk-type axis was
rejected because it has no answer for a `transcript_segment` chunk returned by
the search tool — "jump to its timestamp" would land on the wrong recording's
timeline.

**An unresolvable marker warns and drops, and a message that loses ALL of its
citations must not render as grounded.** Silent is right for a malformed
marker and wrong when the cause is a deleted chunk or a removed note. A
partially-resolving message is deliberately not flagged — a warning on a
mostly-sourced answer trains the warning to be ignored. `parse-citations.ts`
builds its regex per call, not at module scope: a `/g` regex carries
`lastIndex` and this runs on every streamed token.

`ANTHROPIC_API_KEY` and `ANTHROPIC_WORKSPACE_ID` are **server-only** and read
in exactly one shipped file, `app/api/chat/route.ts`, which is also
`VOYAGE_API_KEY`'s third and last reader. `project-conventions.test.ts` fails
the build if any of that stops being true, and separately if any server key
ever gains a `NEXT_PUBLIC_` prefix.

    node scripts/verify-chat-rls.mjs                  # five proofs: two-user
                                                      # RLS, the forged
                                                      # user_id, the with-check
                                                      # handoff, and a cited
                                                      # note deleted under a
                                                      # live citation
    VOYAGE_MIN_CALL_INTERVAL_MS=0 \
      node scripts/verify-chat-search.mjs             # six proofs: both chunk
                                                      # types, the 25-cap
                                                      # biting, BOTH pool
                                                      # bounds, Voyage calls
                                                      # counted
