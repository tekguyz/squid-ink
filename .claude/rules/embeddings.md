---
paths:
  - "lib/rag/**"
  - "scripts/verify-embeddings-pipeline.mjs"
---

# Embeddings

**`note_chunks.embedding IS NULL` IS the queue**, the same rule as
`processing_status` and `notegen_status` — at **chunk** grain, because
embeddings are per chunk, not per note. There is no new status column and no
job table. `lib/rag/sweep.ts` owns this column and nothing else; do not edit
`lib/transcription/sweep.ts` or `lib/notegen/sweep.ts` to handle it.

**There is deliberately NO claim.** The inline trigger and the cron sweep may
both reach one note, and the loser costs a duplicate **Voyage call**, never a
duplicate **write** — the per-row guard
`update(embedding) ... eq(id) ... is(embedding, null)` in
`lib/rag/supabase-ports.ts` is atomic. That is the whole difference from the
other two pipelines: their claim exists because a lost race would cost a Gemini
call. At $0.06/M tokens against a 200-million-token free allowance a Voyage
call is a rounding error. **Do not add a note-level lock.**

**The model is `voyage-4`, not `voyage-3-large`.** Changed 2026-09-03 on cost:
the older model is Voyage's legacy tier at $0.18/M with no free allowance. The
two are otherwise identical for our purposes. Vendor specifics, all read from
the live docs that day, never from memory:

- `POST https://api.voyageai.com/v1/embeddings`, `Authorization: Bearer`.
- **`input_type` is always `"document"`.** Voyage is asymmetric; the retrieval
  side owes `"query"` on the question. Sending the wrong one degrades ranking
  silently rather than erroring.
- **`output_dimension: 1024` and `output_dtype: "float"` are PINNED on every
  call.** The column is a fixed `extensions.vector(1024)`. `voyage-4` also
  offers 2048/512/256 and five dtypes; a moved default would start writing
  vectors the column refuses, or integers it silently accepts as nonsense.
- Caps: **1,000 texts and 320,000 tokens per request**; `VOYAGE_MAX_BATCH_TEXTS`
  is 128 and `VOYAGE_MAX_BATCH_TOKENS` 100,000, both well under.
- **The rate limit depends on billing, and this account is now billed.** Tier 1
  for `voyage-4` is 2,000 RPM / 8,000,000 TPM, but only with a payment method
  on file. Without one Voyage holds the account at **3 RPM / 10,000 TPM** and
  says so in the 429 body — measured 2026-09-03. A card went on file the same
  day and the lift was measured, not assumed: 30 concurrent requests all
  returned 200 in 0.62 s. See `docs/KNOWN_GAPS.md` § "The Voyage account was on
  the unbilled tier", RESOLVED. Re-measure with a burst before trusting the
  headroom again — spread-out calls cannot tell the two tiers apart.
- The vector crosses PostgREST as `JSON.stringify(vector)` — pgvector's own
  text input format. A raw array serialises as a JSON array, a different type.
- **`VoyageError` uses plain fields, not constructor parameter properties.**
  `scripts/verify-embeddings-pipeline.mjs` loads the shipped module through
  Node's strip-only type stripping, which rejects `readonly kind:` in a
  parameter list. Keep every shipped module a verify script imports loadable
  that way.

**Only a chunk that fails ON ITS OWN is charged an attempt.** A `429`/`5xx`/
network failure is transient and increments nothing; a `401`/`403` aborts the
run rather than burning every chunk's counter; only a `400`/`422` counts.

**The one-at-a-time fallback fires on a CONTENT error only, never a transient
one — corrected 2026-09-03 in code review.** Retrying each member alone is how
one poison chunk is isolated so it cannot spend its siblings' attempts, and a
`400` is the only error that says nothing about *which* text was at fault. A
`429` says nothing about any text at all, so calling each member alone cannot
produce a different answer — it turns one rejected request into `1 + N`
rejected requests aimed at the limit that just rejected it. On the unbilled
3 RPM tier this account was held at that day, that was ~101 requests per long
note. A transient batch now defers
whole, every member still eligible, counters untouched; a test pins the call
count at one. Three charged attempts and the chunk is left null
permanently. **Nothing retries it, but since 2026-09-05 something reports it:**
`app/api/cron/transcribe/route.ts` runs one read-only count after its three
phases and adds `stuckChunks: { count, chunks }` to its JSON response — the key
present ONLY when the count is above zero, so a healthy run's body is unchanged.
See `docs/KNOWN_GAPS.md` § "An unembeddable chunk gives up silently", RESOLVED,
for the filter's TEXT-typed equality and the direction the cap may move.

Attempts live in `note_chunks.metadata`, **merged, never overwritten** — a
`transcript_segment` row carries `speaker`, `ts_start`, `ts_end` and `seq` in
that same object. PostgREST cannot send `metadata || jsonb_build_object(...)`,
so `withEmbedAttempt()` merges the object the listing query already returned and
the guarded UPDATE writes the merged whole.

The eligibility filter enumerates attempt values (`in.(0,1,2)`) rather than
comparing them. PostgREST reads `metadata->>embed_attempts` as **text**, so
`lt.3` would be a lexicographic comparison — right for one digit, wrong the
moment the cap reaches ten. The list is generated from `MAX_EMBED_ATTEMPTS`.

**Blank content is terminal, not skipped.** A whitespace chunk is taken straight
to the attempt cap with no Voyage call. Skipping would leave it eligible
forever and a handful could starve real work out of the per-run cap — the same
reasoning as note generation's blank-transcript guard.

`VOYAGE_API_KEY` is **server-only** and read in exactly three shipped files —
`app/notes/actions/transcription.ts`, `app/api/cron/transcribe/route.ts` and
`app/api/chat/route.ts`, which embeds the QUESTION at `input_type: "query"`
(`.claude/rules/chat.md`).
`lib/rag/*` reads no environment variable at all; the caller supplies the key,
which is what keeps it out of every client component's import graph.
`project-conventions.test.ts` fails the build if either stops being true. An
unset key **skips** rather than throws in both places: the cron sweep is also
the backfill, so nothing is lost but latency.

**Three phases, one clock.** The cron route reads one `startedAt` and hands
`startedAt + RUN_BUDGET_MS` to phase two and phase three alike. Embedding runs
last because it is the only phase with a standing backstop.
`MAX_EMBED_NOTES_PER_RUN = 10` bounds cost; the shared budget bounds wall-clock.
The cap counts **notes**, because a note is the batching unit, and it is sized
against the write-back — one guarded UPDATE per chunk, since PostgREST cannot
set a different value per row in one statement — not against the Voyage call,
which is fast.

`note_chunks_pending_embedding_idx` is a **partial** index on `(created_at)
where embedding is null` — the sweep's query, and nothing else. It shrinks
towards empty as the table fills, which is the opposite of what a full index
would do here. `EXPLAIN` against the live project confirms the planner uses it.

    node scripts/verify-embeddings-pipeline.mjs   # no dev server needed:
                                                  # six proofs, Voyage calls
                                                  # counted, cosine ranking
                                                  # measured, the 3-attempt cap
                                                  # exercised with a healthy
                                                  # sibling alongside it.
                                                  # Paces itself 21 s apart for
                                                  # a throttled account. A card
                                                  # is on file as of 2026-09-03,
                                                  # so run it with
                                                  # VOYAGE_MIN_CALL_INTERVAL_MS=0
                                                  # -- seconds, not minutes.
                                                  # Keep the default: it is what
                                                  # makes the script runnable on
                                                  # an account throttled again.
