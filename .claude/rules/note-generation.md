---
paths:
  - "lib/notegen/**"
  - "lib/notes/**"
  - "app/notes/actions/persona.ts"
  - "app/notes/actions/transcription.ts"
  - "components/note-detail/**"
  - "scripts/verify-notegen-pipeline.mjs"
  - "scripts/verify-persona-provisioning.mjs"
  - "scripts/verify-persona-selection.mjs"
---

# Note generation

**`notegen_status` IS the queue**, exactly as `processing_status` is
transcription's, and for the same reason: a second table would be a second
source of truth. It is nullable with no default, and **null means "not
eligible yet"** — there is no `'pending'` string, because the column's
nullability already says it.

The claim is one statement with **two** conditions:

    UPDATE notes SET notegen_status = 'generating'
    WHERE id = <id> AND processing_status = 'completed'
      AND notegen_status IS NULL RETURNING id, persona_id

**`persona_id` rides out on that RETURNING — added 2026-09-02 — and it is not
a convenience.** A second `select` after the claim could read a write that
landed between the two, so the note would generate under a lens its owner had
already moved away from. The returned value is the one on the row this
statement row-locked, which is the only version that cannot change underneath
the generation it feeds. Never replace it with a follow-up read.

`claimForGeneration` therefore returns a **tagged union**, `ClaimResult`:
`{ status: "claimed"; personaId: string | null } | { status: "lost" }`, and
`claimNoteForGeneration` returns `ClaimResolution` in the same shape. Do not
collapse either into a nullable boolean — "claimed with no persona" and "lost
the race" are both falsy-adjacent, and a nullable return leaves them
distinguishable only by a caller checking `!== null` against two different
nullable things. This file's own history includes a data-loss bug from one
missing clause in this area.

The `processing_status` clause is load-bearing, not belt-and-braces. It is
what makes "cannot generate notes before a transcript exists" true **by
construction** rather than by caller discipline. A zero-row claim must not
spend a Gemini call, and that is proved by **counting calls** in
`scripts/verify-notegen-pipeline.mjs`, never by reading the code.

The blank-transcript guard runs **after** the claim, not before. Checking
first would leave the row eligible forever, so every sweep would re-examine it
and a handful of permanently blank rows could starve real work out of the
per-run cap. Claiming then failing is terminal and self-clearing, and it is
still before any model call — which is the guarantee that actually matters. It
also means a lost claim never reaches that branch, so a blank row this process
does not own can never be failed over the winner's `'generating'`.

**Age alone IS terminal here**, unlike transcription. There, age could not
fail a row on its own because an upload might still be arriving and object
existence was the real check. Nothing is still arriving here — the transcript
was written onto the row before it ever became eligible.

`lib/notegen/sweep.ts` owns `notegen_status` and nothing else. Its stale
pass is the same query *shape* as `lib/transcription/sweep.ts`'s
stale-`'analyzing'` pass, deliberately reimplemented rather than reached
across for. **Do not edit `lib/transcription/sweep.ts` to handle this
column.**

**Two triggers, one claim.** `claimAndGenerate` in
`lib/notegen/generate-note.ts` is the shared unit;
`lib/notegen/notegen-ports.ts` holds the one Supabase implementation of the
claim. The cron route calls it through `notegenSweep` as a second phase, and
`app/notes/actions/transcription.ts` calls it once inside its existing
`after()` block. If they race, the loser takes a contended zero-row claim.

**One clock, two phases.** `notegenSweep` takes `deadlineAt` as a
parameter rather than computing a budget. The route reads one `startedAt`
and hands phase two `startedAt + RUN_BUDGET_MS` — imported read-only from
the transcription sweep, not redeclared. Two 240 s budgets under Hobby's 300 s
hard ceiling is a run killed mid-write.

**One deferred client, hoisted.** The manual path builds
`createDeferredClient(...)` once inside `after()` and passes the same
instance to both port factories. A second construction is a second client that
can refresh, and a refresh after the response has been sent rotates the user's
refresh token into a cookie write that is silently dropped — the bug
`lib/supabase/deferred-client.ts` documents and that was fixed on
2026-09-01. That path also **re-reads the note row**: `raw_transcript` is
what transcription has just written, so the row carried in from the claim
predates it.

`MAX_NOTEGEN_PER_RUN = 5`, above transcription's 3, because a text-only call
on roughly 12,000 tokens returns in seconds where an audio transcription takes
minutes. The cap bounds cost; the shared budget bounds wall-clock. The cap
counts **model attempts**, so a contended claim and a blank transcript spend
no slot.

Gemini specifics, all read from `genai.d.ts` at the pinned 2.19.0 and from
the live models endpoint on 2026-09-02, never from samples:

- **`response_format` is TOP LEVEL on `interactions.create`**, not inside
  `generation_config`. Shape is
  `{ type: "text", mime_type: "application/json", schema }`. The sibling
  top-level `response_mime_type` is `@deprecated` — do not send it.
- **`generation_config.thinking_level` takes the lowercase union**
  `"minimal" | "low" | "medium" | "high"`. The SCREAMING_CASE
  `ThinkingLevel` enum belongs to the camelCase `models.generateContent`
  surface and is a 400 here. `depth-policy.ts` owns the mapping and a test
  asserts the casing.
- **`gemini-3.7-flash`, `inputTokenLimit` 1,048,576.** A 60-minute
  transcript — the ceiling `diarization-policy.ts` enforces upstream — is
  near 12,000 tokens. Context is not a constraint and no chunking path is owed.
- **Text only.** This pipeline never fetches, re-sends or sees the audio.

**Which lens a note generates under is chosen on Note Detail, and freezes
wider than you would guess — shipped 2026-09-02.** `app/notes/actions/persona.ts`
writes `notes.persona_id` behind

    UPDATE notes SET persona_id = <uuid>
    WHERE id = <id> AND processing_status IN ('local','uploading')
      AND notegen_status IS NULL RETURNING id

The `processing_status` clause is the load-bearing one. Pressing Transcribe
moves the row to `'analyzing'` while `notegen_status` stays **null for the
whole transcription**, because generation only claims afterwards inside
`after()`. Guarding on `notegen_status` alone would leave a minutes-long window
in which the rail shows one lens and generation picks up another. The rail's
`disabled` attribute is UX; **this guard is the enforcement**, because a Server
Action is a public HTTP endpoint. `seedNotePersona` adds `persona_id IS NULL`
so a seed can never overwrite a real choice.

Seeding on mount is a **real write, not a visual default** — the rail must
never highlight a lens the database does not hold. A frozen note is never
seeded: writing a lens onto one that already generated under a different lens
would make the rail lie. The user's last choice is remembered as a **slug** in
Auth user metadata (`updateUser({ data: { last_persona_id } })`), not a table;
one preference field does not earn a schema addition. Only an explicit choice
writes it — seeding does not.

Regeneration stays rejected (`docs/DECISIONS.md` § Personas, 2026-08-30). The
lock is what makes that true in the UI rather than merely unimplemented.

Lens framings are a **static lookup keyed by slug** in
`lib/notegen/lens-prompts.ts`, not a column — the same category as
`components/note-detail/speaker-colors.ts`, not the same category as the
deleted `persona-presets.ts`. An unrecognised slug falls back to neutral
rather than throwing. Which persona row supplies `name` and `depth` is
settled in § Data above; do not re-derive that rule here.

**The note's TITLE is one more field on this same call — shipped 2026-09-05.**
`title` sits alongside `summary`, `takeaways` and `action_items` in
`responseSchemaFor`, and is `required` at **every** depth including Brief: a
title names the note rather than forming part of its body, so the
summary/no-summary split does not reach it. There is no second model call and
there must never be one — `scripts/verify-notegen-pipeline.mjs` counts Gemini
calls, and that count is the proof.

The write is `setTitleIfUnset` in `notegen-ports.ts`, one statement:
`update({ title }) ... eq('id', …) ... is('title', null)`. **`is('title',
null)` IS the overwrite guard.** `notes.title` is `text`, nullable, with no
default — "Untitled note" is a render-time fallback in
`lib/notes/note-view-model.ts`, `lib/rag/search-tool.ts` and
`components/note-detail/chat/parse-citations.ts`, never a stored string — so
null is an exact test for "nobody has named this note" and a hand-typed title
matches zero rows. Proved against the live database, not a fake: proof 6 of
that script seeds a hand-typed title and reads it back unchanged.

It sits with the chunks, before the `'completed'` flip, and **the staleness
sweep is NOT a rollback for it** — the sweep flips `notegen_status` only and
never nulls a title, so a run that titles a note and then loses
`completeNotegen` leaves a `'failed'` note wearing that title, permanently.
Accepted: a content-derived title beats "Untitled note" either way.

A store error there is **logged and swallowed**, never thrown — failing a
generation that actually succeeded, over a label, would send the row to the
sweep for nothing. `persistGeneratedNote` therefore returns
`{ title: "written" | "kept" | "none" }` and the log line prints it, because
what the model returned and what the row carries are different facts.
**Nothing backfills the notes that are already untitled** — see
`docs/KNOWN_GAPS.md`.

Generated chunks always write `persona_id: null` and `embedding: null`. The
embedding stays null only until the embedding phase runs, which since
2026-09-03 is the very next step in the same `after()` chain — `.claude/rules/embeddings.md`
below. This pipeline still writes null and must keep doing so: null is what
puts the chunk on the embedding queue.
Chunk writes precede the `'completed'` flip, and the staleness sweep is the
rollback — no transaction, no compensating write.

**The delete scope must match the insert scope, and `persona_id IS NULL` is
what makes that true.** `deleteGeneratedChunks` filters on three things:
`note_id`, `chunk_type` in the three generated types, and `persona_id IS
NULL`. The third was missing until 2026-09-02 and the omission was a data-loss
bug, not a tidiness one: this pipeline only ever *writes* default-lens rows, so
a delete without that clause is wider than the insert and takes out every
lens-attributed takeaway on the note. Those rows cannot be rewritten — nothing
sets a persona at capture — so the Sales Coach, Investor and Engineering Lead
rails would have rendered empty. The seeded note carries nine of them, three
per lens. Two tests in `notegen-ports.test.ts` pin the clause, and both were
confirmed to fail without it.

**First run replaces the seed note's hand-written takeaways.** The claim guard
matches every already-`'completed'` note, and the delete-then-insert is
idempotency rather than cleanup. This is designed behaviour: those seed rows
were a fixture standing in for this pipeline.

    node scripts/verify-notegen-pipeline.mjs   # no dev server needed:
                                               # six proofs, Gemini calls
                                               # counted, rows deleted as owner.
                                               # Proof 1 reads back a generated
                                               # title, proof 6 proves a
                                               # hand-typed one survives.
    node scripts/verify-persona-selection.mjs  # no dev server needed:
                                               # six proofs — seeding, the
                                               # guarded write, the frozen
                                               # refusal, and the SAME
                                               # transcript generated under
                                               # two lenses so the framings
                                               # can be read side by side
