# Structured Note Generation — Design

Turn a completed transcript into `summary` / `takeaway` / `action_item` rows in
`note_chunks`. One Gemini call per note, text-only input, depth carried by
`thinking_level` plus a prompt-scope change, chained automatically off
transcription reaching `'completed'`.

This is the **second instance of a pattern already proven once**, not a new
one. Every structural decision below is "the same as `lib/transcription/`",
and where it is not, the difference is stated and argued.

## Why now

`docs/KNOWN_GAPS.md` § "`Persona.depth` exists but nothing consumes it" has
been open since 2026-08-30. The shape shipped; the behaviour did not.
`docs/DECISIONS.md` § "Structured note generation" resolved the model question
on 2026-09-01 (single model, Flash, no Pro). Nothing else blocks the build.

## What this is not

Out of scope, and deliberately so:

- Embeddings. `note_chunks.embedding` stays `null`. Separate track.
- Persona selection at capture, persona-editing UI, custom personas.
- Any Note Detail rendering component, `lib/notes/get-note.ts`,
  `note-view-model.ts`, `view-types.ts`. The chunk-rendering path was built
  against seed data before this pipeline existed and already displays these
  chunk types. This populates them for real; it does not change how they render.
- Any UI for `notegen_status`. A "Generating notes…" indicator is a real Core
  UX/UI follow-up — named here, not built.
- Action-item owner / due date / priority. Bare text only, per ROADMAP §5.
- Quick-actions, draft-follow-up generation, audio-native input.
- Renaming `app/api/cron/transcribe/route.ts` or its URL. `vercel.json`,
  `docs/DEPLOYMENT.md`'s curl recipes and existing scripts all reference it
  verbatim; a rename is a coordinated multi-file and dashboard change this
  work does not own.

Because the recorder does not select a persona at capture, every note this
pipeline touches carries `persona_id = null`. **The Neutral Analyst / default
lens is the only one live verification can exercise today.** That is expected,
not a defect, and it is not a reason to build persona-selection UI.

## Corrections to the originating brief

The prompt pack this design implements contained four things that did not
survive contact with the repo or the live API. Each was checked, not assumed.

### 1. `DEFAULT_PERSONA_ID` is a slug, not a uuid

The brief said it was "a pinned UUID valid only for the seed owner's rows" and
forbade its use. It is in fact the string `"neutral-analyst"`
(`lib/notes/default-persona.ts:5`), which is a `personas.slug` value.

The brief's *conclusion* — never match on `personas.id` — is right, and for a
stronger reason than it gave: `id` is `uuid` and `DEFAULT_PERSONA_ID` is
`text`, so the comparison is a type error, not a quiet miss.

But the brief's chosen replacement column, `name`, is the weaker one.
`personas.sql` declares and indexes `unique (user_id, slug)` and says in its
own header that slug is the key chosen to survive a reseed. `name` carries
neither a unique constraint nor an index, and the custom-persona phase that
`DECISIONS.md` § Personas already defers is exactly the thing that would let a
user rename or duplicate a display name and break a `name`-scoped query
silently.

**Resolution: filter on `slug`.** Recorded in `CLAUDE.md` § Data (`ec2293e`)
and `docs/DECISIONS.md` § Personas (`cc85fcf`).

### 2. `service_role` cannot read `personas`

The brief said "no RLS or grant changes… the existing `service_role` grants
already cover this column", which is true of the new `notes` column and false
of the `personas` read this pipeline performs. Read from the live catalog on
2026-09-02:

```
personas | service_role | REFERENCES, TRIGGER, TRUNCATE
```

No `SELECT`. The cron path runs as `service_role` and would fail with
`permission denied for table personas` — the identical failure `notes.sql`
records from 2026-08-31, found the identical way.

**Resolution: `revoke all … from service_role` then `grant select on
public.personas to service_role` in `personas.sql`,** following that file's
existing revoke-then-grant shape. `select` only; this pipeline never writes a
persona.

**This crosses the brief's "must not touch `personas.sql`" fence.** That fence
existed to stop lens-text-as-column scope creep. It did not anticipate a grant
gap, and cron note-gen is dead without the grant. The crossing is deliberate
and is named as such in the build report rather than passing as an unremarked
file touch.

### 3. The model id and its context window

`gemini-3.7-flash` exists. Read from the live models endpoint on 2026-09-02:

```
gemini-3.7-flash    in=1048576   out=65536
```

A 60-minute transcript — the ceiling `diarization-policy.ts` already enforces
upstream — is roughly 9,000 words at 150 wpm, near 12,000 tokens with speaker
tags. Against a 1,048,576-token input limit that is not close to a constraint.
**Checked, not assumed.**

### 4. The SDK's actual field placement

Read from `node_modules/@google/genai/dist/genai.d.ts` at the pinned 2.19.0,
not from published samples:

- `generation_config.thinking_level` — snake_case, on `GenerationConfig_2`
  (`:6251`). Values are the lowercase union `"minimal" | "low" | "medium" |
  "high"` (`:14439`), **not** the `ThinkingLevel` enum's SCREAMING_CASE
  members, which belong to the camelCase `models.generateContent` surface.
- `response_format` — **top level on `interactions.create`**, not inside
  `generation_config` (`CreateModelInteraction`, `:2803`). Shape is
  `{ type: "text", mime_type: "application/json", schema }`
  (`TextResponseFormat_2`, `:14365`).
- The top-level `response_mime_type` is `@deprecated` in these same types.
  Not used.

This matches the casing split `lib/transcription/gemini-client.ts` already
documents: the `interactions` surface is snake_case, the Files API is camelCase.

## Architecture

Seven files under `lib/notegen/`, mirroring `lib/transcription/` one for one.
The mapping is the design — a reader who knows one knows the other.

| `lib/notegen/` | mirrors | responsibility |
|---|---|---|
| `depth-policy.ts` | `diarization-policy.ts` | pure: depth → `thinking_level` + scope |
| `lens-prompts.ts` | `speaker-colors.ts` | static lookup by slug, neutral fallback |
| `gemini-client.ts` | `gemini-client.ts` | the only module knowing the wire format |
| `notegen-ports.ts` | `supabase-ports.ts` | the one Supabase implementation |
| `generate-note.ts` | `transcribe-note.ts` | claim + generate, shared by both callers |
| `persist-result.ts` | `persist-result.ts` | delete-then-insert, then the flip |
| `sweep.ts` | `sweep.ts` | phase-two loop and the stale sweep |

### The column

```sql
notegen_status text check (notegen_status in ('generating','completed','failed'))
```

Nullable, no default. **`null` means "not eligible yet"** — the column's
nullability already says that, so there is no `'pending'` string to invent.

No new policy and no new grant on `notes`. The four existing policies and the
existing `service_role` grant cover an added column on an already-covered
table. (The `personas` grant in § 2 above is a different table.)

### The claim

One statement, one implementation, two callers:

```sql
UPDATE notes SET notegen_status = 'generating'
WHERE id = $1 AND processing_status = 'completed' AND notegen_status IS NULL
RETURNING id
```

The `processing_status = 'completed'` clause is load-bearing: it makes "cannot
generate notes before a transcript exists" true **by construction**, not by
caller discipline.

A zero-row claim must not spend a Gemini call. That is a cost guarantee, and
it is proved by **counting calls**, not by reading code — the standard
`scripts/verify-manual-transcribe.mjs` already set.

A whitespace-only `raw_transcript` is guarded before the call. Cheap, and a
completed-but-blank transcript is a real if rare case not worth paying for.

### Failure and staleness

No retry on `'failed'` — matching every other terminal-failure decision here.
A `'generating'` row older than one hour is swept to `'failed'` by the same
query shape `lib/transcription/sweep.ts` uses for stale `'analyzing'` rows,
**reimplemented inside `lib/notegen/sweep.ts`** scoped to `notegen_status`.
`lib/transcription/sweep.ts` owns `processing_status` and is not touched.

Chunk writes precede the `'completed'` flip. A partial insert leaves the row
at `'generating'` and the staleness sweep fails it an hour later. **That
existing net is the rollback.** No transaction, no compensating write — a
second mechanism for one failure is a second thing to get wrong, which is the
same reasoning `lib/transcription/persist-result.ts` records.

### Chaining

Both call sites reach the one shared function through injected ports.

**Cron.** A phase two after the existing transcription loop, using the
`db` client already in scope and **what remains of the same `RUN_BUDGET_MS`**.
Not a second 240 s budget — the two phases share one 300 s hard ceiling.

**Manual.** One call inside the existing `after()` block in
`app/notes/actions/transcription.ts`, immediately after transcription
succeeds, on **the same deferred client instance**. That client is currently
constructed inline inside `createTranscriptionPorts(...)` at
`transcription.ts:157`; it is hoisted to a named `const` so both port
factories share it. Constructing a second one would reopen the refresh-token
rotation bug fixed on 2026-09-01 and documented in
`lib/supabase/deferred-client.ts`.

If the two race, the loser takes a contended zero-row claim. No new
coordination.

### Lens prompts

`lens-prompts.ts` is a static lookup keyed by **slug**, with a neutral
fallback for any unrecognised one, since custom personas are a documented
later phase and an early arrival must not throw.

This is prompt-engineering configuration, the same category as
`components/note-detail/speaker-colors.ts` — not the same category as the
deleted `persona-presets.ts`, which duplicated full preset objects the
database now owns. It is not a new column.

### Idempotency

Delete-then-insert the note's `summary` / `takeaway` / `action_item` chunks
before writing new ones, mirroring `lib/transcription/persist-result.ts`.

**First-run side effect, flagged not prevented:** the claim guard matches
every already-completed note the first time this runs, including the seeded
note carrying hand-written seed takeaways at `persona_id = null`. Those are
deleted and replaced with generated ones. This is correct behaviour. It is
stated plainly in the report rather than buried.

## Persona resolution

1. Query `personas` for the note's owner: `user_id = <note.user_id> and slug =
   'neutral-analyst'` (`DEFAULT_PERSONA_ID`).
2. A row → use its `name` and `depth`.
3. Zero rows → `DEFAULT_PERSONA_FALLBACK` from `lib/notes/default-persona.ts`,
   read-only import. An unprovisioned account predating the 2026-08-31 trigger;
   `4tekguyz@gmail.com` is the known one.
4. Never `personas.id`. See § Corrections 1.
5. Whichever path resolved it, **generated chunks write `persona_id = null`**,
   matching the existing null-means-default convention. The resolved row
   supplies config only and is never persisted onto a chunk.

The `user_id` filter is application-level, which the standing rule in
`CLAUDE.md` § Supabase → RLS rules forbids. **This is the one deliberate
exception**, because cron runs as `service_role` and bypasses RLS entirely, so
an unfiltered lookup can return another account's row. The Server Action
filters identically — there RLS already scopes it, so the filter is defence in
depth and one shared query shape rather than a requirement.

## Depth

| `PersonaDepth` | `thinking_level` | scope |
|---|---|---|
| `brief` | `low` | decisions + action items only |
| `dense` | `medium` | all three, balanced |
| `exhaustive` | `high` | all three, plus cross-referencing and deeper action-item inference |

Depth changes **scope, not just length**. Exhaustive does more analytical work
than a longer Dense.

## Sizing

`MAX_NOTEGEN_PER_RUN = 5`, above transcription's 3. A text-only call on ~12k
tokens takes seconds where an audio transcription takes minutes, and the
shared `RUN_BUDGET_MS` check already stops phase two early on a run where
transcription consumed the clock. The cap bounds cost; the budget bounds
wall-clock. Both still apply.

## Testing

Unit, with injected ports and no network:

- a zero-row claim makes zero Gemini calls
- a `'generating'` row past one hour is swept to `'failed'`
- an empty / whitespace transcript never reaches the Gemini call
- the lens lookup falls back for an unrecognised slug
- zero-persona-row resolution reaches `DEFAULT_PERSONA_FALLBACK` and completes
  generation rather than throwing

Live, `scripts/verify-notegen-pipeline.mjs`, against the real project and real
Gemini, importing the shipped modules rather than re-implementing them:

- a completed note reaches `notegen_status = 'completed'` with real chunks
- exactly one Gemini call, counted
- a repeat claim is contended with zero additional calls
- a concurrent double-claim yields exactly one winner

## Definition of done

- Live `pg_constraint` and grant read-back show both the three-value check
  constraint and `service_role`'s `SELECT` on `personas`. Read back, not claimed.
- Every `lib/notegen/` file under the 400-line hard ceiling.
- `npm run typecheck`, `npm run build`, `npm test` green.
- `project-conventions.test.ts` green — no second file reads
  `SUPABASE_SECRET_KEY`.
- `docs/KNOWN_GAPS.md`'s depth entry closed, dated.
- The report names the `personas.sql` fence crossing explicitly, states which
  lenses live verification actually exercised, states which persona-resolution
  path each generated note took, and confirms the seed note's takeaways were
  regenerated.
