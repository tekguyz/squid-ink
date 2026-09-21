# Persona selection per note — design

**Date:** 2026-09-02
**Status:** approved by the owner, 2026-09-02
**Closes:** `docs/KNOWN_GAPS.md` § "Persona timing is decided" — the
"persona **selection at capture time**" half. Leaves the depth-exposure half
open, untouched.

## Problem

`resolvePersonaFor` resolves `slug = 'neutral-analyst'` for every note,
unconditionally. There is no column to select anything else and no surface to
select it from. So Sales Coach, Investor and Engineering Lead are shipped in
`lib/notegen/lens-prompts.ts`, unit-tested, and have never framed a single real
generation.

This adds the column, the surface, and the resolution precedence that connects
them.

## What this is NOT

- **Not regeneration.** `docs/DECISIONS.md` § Personas, "Regeneration —
  considered and rejected, 2026-08-30" stands. No regenerate control is added
  and that decision is not reopened. The lock in § 5 is what makes the
  rejection true in the UI rather than merely unimplemented.
- **Not a recorder change.** Capture stays one click. A note is still created
  with `persona_id` null. Selection happens on Note Detail.
- **Not depth exposure.** `personas.depth` still has no UI control. That is the
  other half of the same gap entry and stays open.
- **Not custom persona authoring.** `+ New lens` stays inert.
- **Not a change to `lib/notes/default-persona.ts`.** Read-only here. The
  zero-persona-rows fallback was proved live on `4tekguyz@gmail.com` on
  2026-09-02 and its behaviour must not move.

## 1. Schema — `notes.persona_id`

A nullable uuid on `public.notes`, with a **composite** foreign key:

```sql
alter table public.notes add column if not exists persona_id uuid;

alter table public.notes drop constraint if exists notes_persona_id_fkey;
alter table public.notes
  add constraint notes_persona_id_fkey
  foreign key (persona_id, user_id) references public.personas (id, user_id)
  on delete set null (persona_id);

create index if not exists notes_persona_id_idx on public.notes (persona_id);
```

Composite for the reason `note_chunks.persona_id` is composite, stated in
`note_chunks.sql` and CLAUDE.md § Supabase → RLS rules: **a foreign key is
validated as the referenced table's owner and is not subject to RLS.** A bare
`references personas (id)` would let one user's note point at another user's
persona. `personas_id_user_id_key` is the matching unique constraint and
already exists.

`on delete set null (persona_id)` names the column explicitly — Postgres 15+.
Without the column list, deleting a persona would try to null `user_id`, which
is `not null`.

MATCH SIMPLE (the default) means a null `persona_id` satisfies the constraint
with no lookup. Null keeps meaning what it means everywhere else in this
project: **the default persona**.

Indexed because Postgres does not index foreign keys automatically, and
`on delete set null` has to find the rows.

**Ordering note.** `config.toml` lists schema files in dependency order and
`notes.sql` currently sits *before* `personas.sql`. This foreign key reverses
that for one statement: notes now references personas. The constraint is
therefore declared in `personas.sql`, after the personas table exists, not in
`notes.sql`. The column itself stays in `notes.sql`. This mirrors nothing else
in the tree and so is called out here explicitly rather than left to be
rediscovered.

**No backfill.** Every note that exists today keeps `persona_id` null and
generates exactly as it does now. That matches the standing no-backfill pattern
for personas (`persona_provisioning.sql`, 2026-08-31).

## 2. Server Action — `app/notes/actions/persona.ts`

A new module with its own `"use server"`. The directive is per module and a
folder of actions has no shared entry point (CLAUDE.md § File layout). This is
the third track file alongside `recording.ts` and `transcription.ts`.

```ts
export type PersonaWriteOutcome =
  | "written"    // the guarded UPDATE matched
  | "locked"     // zero rows: generation already started or finished
  | "no-persona" // the slug resolves to no row for this user
  | "not-found";

export async function setNotePersona(
  noteId: string,
  slug: string,
): Promise<PersonaWriteOutcome>;

export async function seedNotePersona(
  noteId: string,
): Promise<PersonaWriteOutcome>;
```

### The guarded write

Both functions write through one shared statement:

```
UPDATE notes SET persona_id = <uuid>
WHERE id = <noteId>
  AND processing_status IN ('local','uploading')
  AND notegen_status IS NULL
RETURNING id
```

Zero rows back means the lens is already frozen — the caller gets `"locked"`.

**This is enforcement, not decoration.** A Server Action is a public HTTP
endpoint; the client-side `disabled` in § 5 is UX only. The guard is the same
atomic-claim shape the rest of this codebase uses, for the same reason: no
read-then-write window.

`seedNotePersona` additionally carries `AND persona_id IS NULL`, so a seed can
never overwrite a real choice.

### No `user_id` filter

Neither function filters on `user_id`. RLS supplies the owner. That is the
standing rule in CLAUDE.md § Supabase → RLS rules; the cron path is the one
documented exception and this is not cron. The action runs on the authenticated
cookie client, so `app/api/cron/transcribe/route.ts` remains the only shipped
file reading `SUPABASE_SECRET_KEY` — `project-conventions.test.ts` enforces that
and must keep passing.

### Slug to uuid

The rail hands over a **slug**. The action resolves it:

```
select id from personas where slug = <slug>   -- RLS scopes to the owner
```

Zero rows means the user owns no such persona — the zero-row account described
in `default-persona.ts`. The action returns `"no-persona"` and **writes
nothing**, leaving `persona_id` null so the existing fallback path runs
untouched. This is why the client needs no "does this user have personas" flag:
the server decides.

### The preference

`setNotePersona` also writes the user's last choice:

```ts
await supabase.auth.updateUser({ data: { last_persona_id: slug } });
```

- **A slug, not a uuid** — same reseed-survival reason `personas.sql` gives.
- **Auth user metadata, not a table.** One preference field does not earn a
  schema addition.
- **Only on an explicit choice.** `seedNotePersona` does not write it. Seeding
  is not a decision the user made.
- Written only after the note write succeeds. A `"locked"` write must not move
  the default for future notes.

`seedNotePersona` reads it back from `supabase.auth.getUser()` →
`user.user_metadata.last_persona_id`, falling back to `DEFAULT_PERSONA_ID` when
absent or when the remembered slug no longer resolves to a row.

Both actions `revalidatePath('/notes/' + noteId)` on a successful write.

## 3. Resolution precedence

`resolvePersonaFor` moves out of `lib/notegen/notegen-ports.ts` into a new
`lib/notegen/resolve-persona.ts`. That file is 227 lines and this change adds
roughly 60; the soft ceiling is 250 and CLAUDE.md § File layout says a file
approaching it gets a purpose-named extraction, never a raised ceiling. "Which
persona config a note generates under" is a genuine separate responsibility
from the store and the ports factory. `notegen-ports.ts` re-exports it so no
caller outside the track has to know it moved.

New signature:

```ts
export async function resolvePersonaFor(
  db: SupabaseClient,
  userId: string,
  personaId: string | null,
): Promise<ResolvedPersona>;
```

Precedence:

1. **`personaId` is set** → `select slug, name, depth from personas where
   id = <personaId> and user_id = <userId>`. Scoped by **both** columns, the
   same composite-ownership check the foreign key enforces, because the cron
   caller runs as `service_role` and bypasses RLS.
2. **A set `personaId` that resolves to no row** → fall through to step 3
   rather than throwing. A persona deleted between selection and generation is
   a real sequence, and `on delete set null` means the column would normally
   already be null; this is the belt for the window where it is not.
3. **`personaId` is null** → today's path, unchanged byte for byte:
   `slug = DEFAULT_PERSONA_ID` scoped by `user_id`, then
   `DEFAULT_PERSONA_FALLBACK` on zero rows.

`ResolvedPersona.source` gains a `"note"` member so the log line in
`generate-note.ts` says which branch ran. It already prints
`persona from ${persona.source}` and the build report has to answer that
question with evidence rather than inference.

Errors still throw rather than falling back — "permission denied for table
personas" must not hide behind output that looks correct.

## 4. Reading the persona at claim time

The claim in `notegen-ports.ts` already ends `.select("id")`, which is
`RETURNING id`. It widens to `.select("id, persona_id")`. **There is no second
select.** The value generation uses is the one on the row the claim's own
`UPDATE` locked, so a write landing a moment later cannot change what this run
generates under.

`claimForGeneration` therefore stops returning `boolean` and returns a **tagged
union**:

```ts
export type ClaimResult =
  | { status: "claimed"; personaId: string | null }
  | { status: "lost" };
```

Tagged deliberately. "Claimed, with no persona" and "lost the race" are both
falsy-adjacent, and collapsing them into `boolean | string | null` would make
them distinguishable only by a caller checking `!== null` against two different
nullable things. `notegen-ports.ts` already carries a documented data-loss
incident caused by exactly one missing clause in this area
(`deleteGeneratedChunks`, 2026-09-02); ambiguity here is not worth the
keystrokes it saves.

That value flows: `claimForGeneration` → `claimNoteForGeneration` →
`generateClaimedNote` → `resolvePersona`.

`claimNoteForGeneration` returns a result object rather than a bare string, for
the same reason:

```ts
export type ClaimResolution =
  | { outcome: "claimed"; personaId: string | null }
  | { outcome: "contended" }
  | { outcome: "blank" };
```

`generateClaimedNote(ports, row, personaId)` takes the value explicitly.
`claimAndGenerate` threads it and its `NotegenOutcome` return type is unchanged,
so `sweep.ts` and its counters need no edit beyond the port type.

`GeneratableRow` and the `listGeneratable` select are **unchanged** — the
persona is read from the claim, not from the listing, which is the whole point.

## 5. The lock

The rail is non-interactive once the lens is frozen. Frozen means:

```
notegenStatus !== null  ||  processingStatus is not 'local' and not 'uploading'
```

The second clause is the load-bearing one and was added over the original spec.
Without it there is a window: pressing Transcribe moves `processing_status` to
`'analyzing'` while `notegen_status` stays null for the whole minutes-long
transcription, because generation only claims afterwards inside `after()`. A
user switching lens in that window would get an unpredictable result. The
feature's entire premise is that the lens shown is the lens that generated the
note, so that window has to close.

`'failed'` is included in "frozen". A failed note can never generate, so there
is nothing to choose.

The same condition is expressed twice, on purpose: as `disabled` in the rail
(UX), and as the `processing_status IN ('local','uploading') AND notegen_status
IS NULL` guard on the write (enforcement). Client state is never the authority.

## 6. View model

`Note` gains two fields in `lib/notes/view-types.ts`:

```ts
/** The slug of the lens this note is set to generate under, or null when
 *  nothing has been chosen. Never a uuid — the client speaks slugs. */
personaId: string | null;
/** Structured note generation's queue state. Read by the rail's lock. */
notegenStatus: NotegenStatus | null;
```

`note-view-model.ts` translates `NoteRow.persona_id` (uuid) into the matching
row's **slug** by looking it up in the `personaRows` it already receives. An
unmatched uuid yields null. `NoteRow` already needs a `persona_id: string | null`
field added in `lib/notes/types.ts`.

`get-note.ts` needs no query change — it already does `select("*")`.

The rail highlights `note.personaId ?? DEFAULT_PERSONA_ID`. So every existing
note, which is locked and null, still highlights Neutral Analyst — which is the
truth about how it generated.

## 7. Rail and shell

`PersonaRail` gains one prop, `locked: boolean`. When locked, each lens button
gets `disabled`, loses `cursor-pointer` and the hover rule, and dims through an
existing token. **Every colour stays a `var()`-backed utility** — the guard in
`project-conventions.test.ts` fails the build on any literal.

`aria-selected` still reports the resolved lens when locked. The rail shows what
generated the note; it just cannot change it.

`+ New lens` and the quick-action buttons are untouched.

`NoteDetailShell` owns the calls. On mount it invokes `seedNotePersona(note.id)`
**only when the note is unlocked and `note.personaId` is null**. A locked note
is never seeded: writing a lens onto a note that already generated under a
different one would make the rail lie, which is the exact failure this design
exists to prevent.

Selection is optimistic in local state and reconciled by `router.refresh()`
after the action settles, matching how `transcribe-button.tsx` already drives a
Server Action from a client component (`useTransition` + `useRouter`).

## 8. Definition of done

- Migration applied to the linked project and read back from `pg_constraint`
  and `pg_indexes` — not merely a passing local build.
- A note with `persona_id` null owned by an account with zero persona rows
  generates exactly as before. Re-run against `4tekguyz@gmail.com`.
- A fresh note's `persona_id` in the database matches the highlighted lens
  before any click.
- A note set to Sales Coach generates `note_chunks` whose **content** shows that
  framing. The generated text is pasted into the report, not a row count.
- The rail is non-interactive once frozen, verified in a running browser.
- `npm run typecheck`, `npm test`, `npm run build` all clean.
