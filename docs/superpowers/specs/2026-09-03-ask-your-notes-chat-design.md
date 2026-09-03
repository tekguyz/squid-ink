# Ask-your-notes chat — design

**Date:** 2026-09-03
**Status:** approved, ready for an implementation plan
**Closes:** "the retrieval side is not built" from the last handoff
**Amends:** `docs/DECISIONS.md` § RAG, `docs/ROADMAP.md` §4

---

## 1. The split that drives everything

Retrieval architecture is decided by **scope**, not by one uniform RAG path.

| | This note | All notes |
|---|---|---|
| Retrieval | **none** | `search_notes` tool, model's own judgment |
| Context source | raw transcript + this note's generated chunks | tool results only |
| Prompt cache | one 5-minute `cache_control` breakpoint on the transcript block | none — tool results differ every turn |
| Depends on | `notes.raw_transcript` existing, nothing else | `note_chunks.embedding` being populated |

The payoff of the left column is that single-note chat works **the instant transcription
finishes**. It does not care whether note generation ever ran, is mid-run, or failed —
`notegen_status` is not read on that path at all. This is a deliberate deviation from
the original "RAG + tool use, single-note and cross-note" framing in DECISIONS.md, which
undersold the split.

The `search_notes` tool takes **no scope parameter**. It only exists in all-notes mode,
so a parameter would be a second way to express something the tool's presence already
says.

---

## 2. Database

### 2.1 `supabase/schemas/chat_messages.sql` (new)

```sql
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  scope text check (scope in ('this_note','all_notes')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_note_id_created_at_idx
  on public.chat_messages (note_id, created_at);
create index if not exists chat_messages_user_id_created_at_idx
  on public.chat_messages (user_id, created_at);
```

Four per-operation RLS policies — select / insert / update / delete — each `to
authenticated` with predicate `(select auth.uid()) = user_id`, UPDATE carrying both
`using` and `with check`. `revoke all` from `anon, authenticated, service_role` first,
then `grant select, insert, update, delete to authenticated`. `anon` gets nothing.
`service_role` gets nothing — no cron or background job touches this table.

Two deviations from the ROADMAP snippet, both tightenings, both deliberate:

- `user_id` gains `on delete cascade`, matching `notes` and `note_chunks`. Without it a
  deleted account leaves rows that fail every RLS predicate — invisible and undeletable.
- `metadata` becomes `not null default '{}'::jsonb`, matching `note_chunks.metadata`, so
  every read is null-guard-free.

**`note_id` is not null even in all-notes mode.** Chat is a Note Detail surface: an
all-notes conversation still happens *on* a note's page, and `note_id` records which page.
`scope` records what the turn actually searched. They are different facts and both are kept.

**`chat_messages_user_id_created_at_idx` is the rate limit's index**, not decoration. The
limiter counts the caller's rows in the last 60 seconds on every send; without it that is
a sequential scan that gets slower with every message ever sent.

### 2.2 `supabase/schemas/search_note_chunks.sql` (new)

A Postgres function. **Not `SECURITY DEFINER`** — it runs as the caller, so RLS on
`notes` and `note_chunks` does the owner-scoping. There is deliberately **no
`user_id = auth.uid()` filter** in the function body or around it in app code: a
redundant filter would mask an RLS failure rather than expose it, which is the standing
rule in CLAUDE.md § Supabase → RLS rules.

```
search_note_chunks(query_embedding extensions.vector(1024), query_text text)

candidates := select id from public.notes
              where created_at > now() - interval '90 days'
              order by created_at desc
              limit 25

vector arm := note_chunks joined to candidates, embedding is not null,
              order by embedding <=> query_embedding, limit 50
text arm   := note_chunks joined to candidates,
              to_tsvector('english', content) @@ plainto_tsquery('english', query_text),
              order by ts_rank desc, limit 50

fuse       := full outer join on chunk id
              score = coalesce(1.0/(60 + vector_rank), 0)
                    + coalesce(1.0/(60 + text_rank), 0)

return     := order by score desc limit 25
```

**The candidate clause is one statement on purpose.** `where created_at > now() -
interval '90 days' order by created_at desc limit 25` naturally yields whichever bound is
smaller — an account with 200 notes this month gets 25, an account with 6 notes last year
gets 0. No separate branch, nothing to keep in sync.

**The result cap is unconditional.** 25 chunks post-RRF, whatever the pool size.

`k = 60` is the standard RRF constant. Both arms cap at 50 before fusion so the fuse
input is bounded independently of the archive.

Returned columns: `chunk_id`, `note_id`, `note_title`, `chunk_type`, `content`,
`ts_start`, `seq`, `score`. `note_title` comes from the join to `notes`, which the
candidate CTE already performs.

Both indexes the function needs already exist in `note_chunks.sql`:
`note_chunks_embedding_idx` (hnsw, `vector_cosine_ops`) and
`note_chunks_content_fts_idx` (gin, `to_tsvector('english', content)`). No new index on
`note_chunks`, and no write path to it is touched.

### 2.3 `supabase/config.toml`

Both files are appended in dependency order, after the existing five:
`chat_messages.sql` then `search_note_chunks.sql`. `chat_messages` references
`public.notes`; the function references both tables. The list stays an explicit ordering,
never a glob.

---

## 3. Citations

### 3.1 The marker scheme

Claude writes inline markers. The key is **where the cited content lives**, not what
`chunk_type` it is:

| Marker | Means | Chip behaviour |
|---|---|---|
| `[[cite:t<seq>]]` | transcript segment `<seq>` **on the page being viewed** | today's behaviour — set `activeSegmentId`, transcript pane scrolls to it |
| `[[cite:c<n>]]` | result `<n>` from **this turn's tool call** | shows note title + time; navigates to `/notes/<note_id>` |

This supersedes the chunk-type keying in the original prompt pack
(`transcript_segment` → timestamp jump, structured → scroll-to-block). That axis has no
answer for the common all-notes case: a `transcript_segment` chunk returned by
`search_notes` belongs to a *different* note, so "jump to its timestamp" would jump to the
wrong recording's timeline. Location is the axis that decides what the chip can do;
chunk type only decides what the chip *says*.

Within the `c<n>` form, `chunk_type` still selects the label:
`transcript_segment` renders "«Note title» 04:12", the structured types render
"«Note title» · Summary / Takeaway / Action item". Same navigation either way.

In this-note mode there is no tool call, so only `t<seq>` markers can appear. In
all-notes mode only `c<n>` can. The renderer accepts both in both modes rather than
branching on scope — a mode-conditional parser is a second place for the scope rule to
drift.

### 3.2 Resolution, and the floor under a failed resolve

The client resolves `t<seq>` against `note.segments` (already on the page) and `c<n>`
against the tool result part. A marker that resolves to nothing is **not rendered as a
chip** — the surrounding prose still renders.

A silent drop is right for a malformed marker. It is **wrong** when the cause is real —
a chunk deleted, or a note removed mid-conversation — because eating the citation makes
the answer read as better-grounded than it is. So:

1. **Every drop logs a `console.warn`** naming the unresolved key and the message id.
   Not user-facing; this exists so the failure does not vanish during debugging.
2. **If a message carries at least one marker and *none* of them resolve**, the message
   renders with a visible ungrounded notice, not as a clean answer. The prose is still
   shown — withholding it would be worse — but it is not allowed to look sourced.
3. A message with *some* citations resolving renders normally. Partial loss is logged
   only; drawing a warning on a mostly-grounded answer would train the notice to be
   ignored.

This is a tested path, not a defensive comment. See §7.

### 3.3 Surviving a reload

`chat_messages.content` stores the raw marker text. The resolved source table for a turn
is written to `chat_messages.metadata` at `onFinish`:

```json
{ "citations": [ { "key": "c1", "chunkId": "...", "noteId": "...",
                   "noteTitle": "...", "chunkType": "...", "tsStart": "04:12" } ] }
```

So a reloaded `c<n>` chip resolves from persisted metadata rather than from a tool result
that no longer exists in the session. `t<seq>` needs nothing persisted — the segments are
on the page.

A citation whose underlying note was deleted after persistence still fails to resolve on
reload, and falls into the §3.2 floor. That is the intended behaviour, and it is what the
delete-a-cited-note test exercises.

---

## 4. The route

`app/api/chat/route.ts`. Cheapest check first, so an abusive or broken client is refused
before it costs anything:

1. **Auth.** Cookie client via `lib/supabase/server.ts`, `getUser()`. No user → `401`
   JSON. `/api/chat` is deliberately **not** added to `PUBLIC_PREFIXES` — the session
   middleware protects it, and this check is the in-route half so a fetch gets JSON
   rather than a redirect to an HTML login page.
2. **Length cap.** Message over 4,000 characters → `400` with a clear message. Before any
   embedding call and before any Claude call.
3. **Rate limit.** `count(*)` on `chat_messages` where `role = 'user'` and
   `created_at > now() - interval '60 seconds'`. RLS supplies the user scope; no
   `user_id` filter is written. At 20 or more → `429` with a clear message. One query
   against a table this design already creates — **no rate-limit table**.
4. **Persist the user message**, with its `scope`.
5. **Trim history** to the last 20 turns, and further to ~8,000 tokens if those 20 exceed
   it, oldest dropped first. The token figure is an estimate — `ceil(chars / 4)`,
   computed locally in the route rather than by calling a tokenizer, because it bounds a
   budget and does not need to be exact. Full history stays in `chat_messages` for
   display regardless of what is sent.
6. **Build this turn's context** from this turn's own `scope` (§5).
7. **Stream.** `streamText` → `toUIMessageStream` → `createUIMessageStreamResponse`.
   `onFinish` persists the assistant message and its citation map.

Model `claude-sonnet-5`. `thinking: { type: 'adaptive' }` — Sonnet 5 removed
`budget_tokens` and answers 400 if it is sent.

### 4.1 History comes from the database, not from the client

`useChat` posts the client's whole message array on every send. The route reads **only
the newest user message text and the requested scope** out of that payload. The
conversation history it sends to Claude is re-read from `chat_messages`, scoped by RLS.

This is not tidiness. The client payload is attacker-controlled: trusting it would let a
compromised session or a buggy client post a forged 500-turn history and walk straight
past the trimming in step 5 — which is one of the two cost ceilings this design exists to
hold. Reading history server-side makes the 20-turn bound structural.

### 4.2 History flattening

That server-read history is flattened to plain `{ role, content }` text before it reaches
Claude. Tool-call scaffolding is **dropped entirely**, not carried forward.

This is what makes "re-derive context per turn" true rather than aspirational. A thread
that ran three all-notes turns and then switches to this-note sends no tool blocks and no
stale transcript block — just prose history, plus a freshly built context block for the
current scope. The inverse holds too.

### 4.3 Empty retrieval is not an error

Two outcomes that look alike and must not be rendered alike:

- **Genuinely empty.** `search_notes` ran and matched nothing. This is a normal answer.
  The system prompt states explicitly that Claude must say nothing in the user's notes
  matches, and must **not** fill the gap from general knowledge.
- **Broken.** The RPC threw, Voyage failed, or the Claude call errored. A real failure,
  surfaced as a visible banner in the panel.

### 4.4 Reasoning never reaches the transcript

Three independent layers, in order of how much they are relied on:

1. **Structural.** Reasoning streams as `part.type === 'reasoning'`, a distinct part type
   from `'text'`. The renderer switches on `'text'` and `'tool-searchNotes'` only, so
   reasoning has no path to the screen even if it arrives.
2. **Route.** `sendReasoning: false` is passed explicitly to
   `toUIMessageStream`. **Corrected 2026-09-03 in code review:** this said
   the flag is opt-in and should be left unset. It defaults to `true` in
   `ai` 7.0.92, so omitting it opted in. A test now pins the explicit
   `false`.
3. **Model.** Sonnet 5 defaults `thinking.display` to `"omitted"`, so the thinking text is
   empty unless `"summarized"` is explicitly requested. It is not.

The concern this closes is real: without layer 1, "Searching your notes…" could sit
beside visible chain-of-thought.

---

## 5. Context construction

### 5.1 This note

One user content block, cached:

```
[ { type: 'text', text: TRANSCRIPT_AND_NOTES,
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
  { type: 'text', text: userQuestion } ]
```

`cacheControl: { type: 'ephemeral' }` is the 5-minute TTL — verified against the AI SDK
Anthropic provider docs on 2026-09-03, not assumed.

**Corrected 2026-09-03 in code review:** the block above must be the FIRST
message, ahead of the history, not the last. Caching matches a prefix from
the start of the request; with the block after the conversation, turn 2
diverges from turn 1's cached prefix immediately and the cache never reads,
silently falsifying the "pays full input price once" claim this whole
section exists to make. A multi-turn conversation pays full
input price for the transcript once.

The block is built from `notes.raw_transcript` plus this note's `summary`, `takeaway` and
`action_item` chunks when they exist. Transcript segments are rendered with their `seq`
so Claude has a stable id to cite: `[8] 04:12 Speaker 1: …`. **The block is byte-stable
across turns** — nothing volatile (no timestamp, no turn counter) goes into it, or the
cache never hits.

Missing generated chunks are simply absent from the block. There is no branch on
`notegen_status`, which is what makes the independence claim structural.

### 5.2 All notes

No transcript block and no cache breakpoint — tool results differ every turn, so there is
no stable prefix to cache. Claude gets `search_notes` and calls it at its own judgment.
Results are rendered into the tool result as a numbered list matching the `c<n>` markers.

---

## 6. Files

### New

```
supabase/schemas/chat_messages.sql
supabase/schemas/search_note_chunks.sql
lib/rag/query-embed.ts            Voyage wrapper, input_type: "query"
lib/rag/search-tool.ts            search_notes definition + RPC handler
app/api/chat/route.ts
components/note-detail/chat/chat-panel.tsx      useChat, scope toggle, list
components/note-detail/chat/chat-message.tsx    one turn
components/note-detail/chat/cite-runs.tsx       CiteRun[] -> CitationChip
components/note-detail/chat/parse-citations.ts  pure, unit-tested
components/note-detail/chat/scope-toggle.tsx
scripts/verify-chat-rls.mjs
scripts/verify-chat-search.mjs
```

`components/note-detail/chat/` is a subfolder because the panel exceeds the 250-line soft
ceiling as one file. One level, named after the piece — the rule in CLAUDE.md § File
layout, the same shape as `note-detail/transcript/`.

**`lib/rag/query-embed.ts` is a new file beside `voyage-client.ts`, not an edit to it.**
Voyage is asymmetric: stored content is embedded `input_type: "document"`, a question must
be embedded `input_type: "query"`. Reusing the document embedder degrades ranking
**silently, with no error**. The existing document path, the embedding trigger, and every
`note_chunks` write path are untouched.

`query-embed.ts` reuses `VOYAGE_ENDPOINT`, `VOYAGE_MODEL`, `VOYAGE_OUTPUT_DIMENSION` and
`VoyageError` from `voyage-client.ts` — the pins stay stated once — and takes the API key
from its caller, exactly as `lib/rag/*` does today. It reads no environment variable.

### Modified

```
supabase/config.toml                             two files appended, in order
package.json                                     four new exact pins
app/notes/[id]/page.tsx                          load chat history, pass to shell
lib/notes/view-types.ts                          ChatMessage view type
components/note-detail/note-detail-shell.tsx     ChatComposer -> ChatPanel
components/note-detail/__tests__/project-conventions.test.ts
                                                 ANTHROPIC_API_KEY single-reader guard
docs/DECISIONS.md, docs/ROADMAP.md, CLAUDE.md    per the reporting contract
```

`components/note-detail/chat-composer.tsx` is replaced by the `chat/` folder and deleted.
`note.sampleExchange` stops being rendered; the type and its data stay in place rather
than being ripped out.

### Pins

Verified against the live npm registry on 2026-09-03. Exact, no `^` or `~`.

| Package | Version |
|---|---|
| ai | 7.0.92 |
| @ai-sdk/anthropic | 4.0.49 |
| @ai-sdk/react | 4.0.95 |
| zod | 4.5.4 |

`zod` is a real dependency, not incidental: the AI SDK takes tool `inputSchema` as a Zod
schema.

Model id `claude-sonnet-5`, confirmed against Anthropic's current model list on
2026-09-03 rather than recalled.

### Environment

`ANTHROPIC_API_KEY`, **server-only**, no `NEXT_PUBLIC_` prefix, read in exactly one
shipped file — `app/api/chat/route.ts`. `project-conventions.test.ts` is extended to fail
the build if a second shipped file reads it, the same guard `VOYAGE_API_KEY` already has.
`lib/rag/*` continues to read no environment variable at all; the route supplies the
Voyage key to `query-embed.ts`, which is what keeps it out of every client component's
import graph.

---

## 7. Testing

### Unit (vitest, TDD — written before the implementation)

Scoped to logic, not to static markup:

- **RRF ranking** — a chunk ranked by both arms outscores one ranked by either alone;
  ordering is stable; the 25-cap holds.
- **Rate limit** — 20 messages pass, the 21st inside 60 seconds is refused; the window
  rolls off.
- **Length cap** — 4,000 characters pass, 4,001 is refused, and no embed or model call
  fires on the refusal (calls are counted, not assumed).
- **Citation parsing** — `t<seq>` and `c<n>` produce the right `CiteRun[]`; a malformed
  marker is dropped and warns; an unresolvable key is dropped and warns; a message whose
  citations *all* fail resolves to the ungrounded-notice branch; a partially-resolving
  message does not.
- **`input_type: "query"`** — `query-embed.ts` sends `"query"`, and asserts it is not
  `"document"`.
- **History flattening** — an all-notes turn followed by a this-note turn sends no tool
  blocks and no transcript block from the earlier turn, and vice versa.
- **History provenance** — a request posting a forged 500-turn client history is answered
  from the database's history, trimmed to 20 turns. The forged turns never reach Claude.
- **Reasoning** — the route does not set `sendReasoning`; the renderer ignores a
  `reasoning` part.

Static composer markup is deliberately not unit-tested.

### Live verification scripts

Both follow the project's established shape: real sessions, no dev server needed, calls
counted, rows deleted as the owner.

`scripts/verify-chat-rls.mjs` — signs in two real users with a genuine `auth.users`
session JWT (not password-grant, not `service_role`), writes chat rows as each, and
proves the second gets a genuine empty result rather than `permission denied`. Also
exercises the §3.2 floor: delete a cited note mid-session and confirm the client neither
crashes nor overclaims.

`scripts/verify-chat-search.mjs` — seeds notes spanning the 90-day and 25-note
boundaries and proves: a query hitting a `transcript_segment` chunk returns it; a query
hitting a structured chunk returns it; the result count never exceeds 25; a note outside
the window is never considered; and single-note chat answers against a note with
`notegen_status = 'generating'` and one with `'failed'`.

### Manual, in a running browser

A `t<seq>` citation jumps to its timestamp. A `c<n>` citation navigates to the other
note. A page refresh mid-conversation restores full history from `chat_messages`.

### Gates

`npm run build`, `npm run typecheck`, `npm test` all pass. No literal colour values in new
UI — `var()` tokens only, which the existing conventions guard already enforces. New files
stay inside the 250-line soft / 400-line hard ceiling.

---

## 8. Explicitly out of scope

Not built here, and not partially built here:

- **Note auto-titling.** Logged separately in `docs/KNOWN_GAPS.md`.
- Left-rail collapse, transcript-pane resize/detach, theme-toggle / Record-HUD collision.
- Google OAuth / Calendar, live voice assistant, MCP bridge.
- **Persona-aware filtering of search results.** Chunks carry `persona_id`; this design
  does not filter on it.
- The embedding population pipeline, `notegen_status` semantics, `processing_status`
  semantics — read-only dependencies throughout.

## 9. Open, needing a human decision

- **Note auto-titling blocks good cross-note citations.** A `c<n>` chip is labelled with
  `notes.title`, which is nullable and is null for most rows today. Those chips will read
  "Untitled note", which is a weak citation. The feature ships and works without it; it
  is worse than it should be until titling exists. Recorded here rather than surfaced at
  the end.
- **Persona-aware filtering** stays unbuilt by instruction, not by oversight. Whether an
  active lens should narrow cross-note retrieval is a product decision nobody has made.
