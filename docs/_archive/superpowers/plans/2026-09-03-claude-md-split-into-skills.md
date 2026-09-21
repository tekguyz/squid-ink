# CLAUDE.md → On-Demand Convention Skills — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the always-loaded `CLAUDE.md` from 858 lines / 48.5 KB to roughly 220 lines / 14 KB by moving five pipeline sections into project skills that load only when that pipeline is worked on, without losing a single word or weakening a single mechanical check.

**Architecture:** Claude Code auto-loads `CLAUDE.md` only. `@import` lines cost the same tokens, so they are not a saving. A **skill** is the one construct whose body loads on demand — at session start it costs only its one-line `description`. So each pipeline section becomes `.claude/skills/<name>-conventions/SKILL.md`. `CLAUDE.md` keeps the rules that govern *all* new code, plus a short index table naming each skill and when to load it. `check-docs.mjs` stops reading one file and starts reading a **corpus** — `CLAUDE.md` plus every convention skill — so every existing mechanical check keeps its full reach.

**Tech Stack:** Markdown, Node ESM (`.claude/skills/handoff/check-docs.mjs`), Vitest (the existing `project-conventions.test.ts` is untouched).

**Spec:** This document. There is no separate spec; the decision and its rationale are stated here.

---

## Global Constraints

- **No word is deleted.** Every task is a *move*. Text arrives in the new file byte-identical except for heading level and a new file header. If a passage genuinely must change, that is a separate commit with its own reason.
- **`CLAUDE.md` keeps its `# This is NOT the Next.js you know` block, at the end.** `next dev` rewrites that block into `CLAUDE.md` (see `node_modules/next/dist/server/lib/generate-agent-files.js`). Removing it only re-creates an uncommitted change.
- **`**Last updated:**` discipline extends to the new files.** `CLAUDE.md` carries one. Each new `SKILL.md` gets its own. Changing one byte of any of them means updating that file's line.
- **No application name anywhere.** `CLAUDE.md` § Naming forbids a name string in code. Skill directory names are domain-named (`recorder-conventions`), never product-named.
- **The checker's exit codes are load-bearing:** 0 = clean, 1 = findings, 2 = could not run (NOT a pass). Never let a refactor turn a check into a silent no-op; check 1 already guards against exactly that (`"...so this check is watching nothing"`). Preserve that pattern in every new or widened check.
- **Convention skill directory glob, used verbatim everywhere:** `.claude/skills/*-conventions/SKILL.md`.
- **`CLAUDE.md` line budget after this work: 260.** Enforced in Task 8.

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `.claude/skills/recorder-conventions/SKILL.md` | Current `CLAUDE.md` § Recorder (lines 213–289) |
| `.claude/skills/transcription-conventions/SKILL.md` | § Transcription (290–405) |
| `.claude/skills/notegen-conventions/SKILL.md` | § Note generation (406–577) + the persona-resolution block lifted out of § Data |
| `.claude/skills/embeddings-conventions/SKILL.md` | § Embeddings (578–697) |
| `.claude/skills/supabase-conventions/SKILL.md` | § Supabase (705–837), all subsections |

**Modified:**

- `CLAUDE.md` — five sections removed, § Data trimmed, new § "Where the rest of these conventions live" added.
- `.claude/skills/handoff/check-docs.mjs` — corpus reader, checks 1/2/3/8/11 widened, new check 13.
- `.claude/skills/handoff/SKILL.md` — the audit's file table and repair rules cover the new files.

**Untouched:** every file under `app/`, `components/`, `lib/`, `scripts/`, `supabase/`; all of `docs/*.md`; `README.md`; `package.json`. This plan does not change one line of application code.

---

### Task 1: Teach the checker to read a corpus

The checker reads `CLAUDE.md` as a single string in five places. Once text moves, those checks go quiet — which is worse than loud. Widen the reader first, while the corpus is still just `CLAUDE.md`, so the change is provably behaviour-neutral.

**Files:**
- Modify: `.claude/skills/handoff/check-docs.mjs:78` (the `const claude = read("CLAUDE.md")` line) and checks 1, 2, 3 (lines 81–156) and 11 (433–463)

**Interfaces:**
- Produces: `CONVENTION_DOCS` — `Array<{ rel: string, text: string }>`, always `CLAUDE.md` first, then each `.claude/skills/*-conventions/SKILL.md` in sorted order. Consumed by Tasks 2 and 8.
- Produces: `conventionText` — `string`, all corpus members joined with `"\n"`. For checks that only ask "is this claim made anywhere".

- [ ] **Step 1: Record the current output as the baseline**

```bash
node .claude/skills/handoff/check-docs.mjs > /tmp/checker-before.txt 2>&1; echo "exit=$?"
```

Expected: some exit code and some text. Whatever it is, that is the baseline. Keep the file — Step 5 diffs against it.

- [ ] **Step 2: Add the corpus reader**

Insert immediately after the existing `const claude = read("CLAUDE.md");` line, and leave that line in place:

```js
/** The convention corpus. CLAUDE.md holds the rules that govern all new code;
 *  each pipeline's rules live in an on-demand skill under
 *  .claude/skills/<name>-conventions/. Both are conventions, so every check
 *  that reads "what CLAUDE.md claims" reads all of them. Reading only
 *  CLAUDE.md after the 2026-09-03 split would leave these checks watching a
 *  file the claims had moved out of. */
const CONVENTION_SKILL_DIR = ".claude/skills";
const CONVENTION_DOCS = (() => {
  const docs = [{ rel: "CLAUDE.md", text: claude }];
  const dir = path.join(ROOT, CONVENTION_SKILL_DIR);
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir).sort()) {
      if (!entry.endsWith("-conventions")) continue;
      const rel = `${CONVENTION_SKILL_DIR}/${entry}/SKILL.md`;
      if (has(rel)) docs.push({ rel, text: read(rel) });
    }
  }
  return docs;
})();
const conventionText = CONVENTION_DOCS.map((d) => d.text).join("\n");
```

- [ ] **Step 3: Point checks 1, 2 and 3 at the corpus**

In each of those three checks, replace the read of the `claude` variable with a loop over `CONVENTION_DOCS`, and change each `findings.push` so it names `doc.rel` instead of the literal `"CLAUDE.md"`. Check 2 becomes:

```js
for (const { rel, text } of CONVENTION_DOCS) {
  for (const m of text.matchAll(/`npm run ([a-z:-]+)`/g)) {
    const script = m[1];
    if (!scripts.has(script)) findings.push(`${rel} names \`npm run ${script}\`, which is not in package.json scripts`);
  }
}
```

Apply the same shape to check 1's version-table scan and check 3's backtick-path scan. Check 1's "watching nothing" guard stays, and now means *no corpus member* held a matching row.

- [ ] **Step 4: Widen check 11 to the corpus**

Check 10's `ATTACHED` array stays exactly as it is — those five are the Claude.ai Project attachments, and skills are not attached there. Check 11's `DOCS` array becomes the five docs **plus** every `CONVENTION_DOCS` member after the first:

```js
const DOCS = [
  "CLAUDE.md",
  "docs/KNOWN_GAPS.md",
  "docs/DECISIONS.md",
  "docs/ROADMAP.md",
  "docs/DEPLOYMENT.md",
  ...CONVENTION_DOCS.slice(1).map((d) => d.rel),
];
```

- [ ] **Step 5: Prove the change is behaviour-neutral**

```bash
node .claude/skills/handoff/check-docs.mjs > /tmp/checker-after.txt 2>&1; echo "exit=$?"; diff /tmp/checker-before.txt /tmp/checker-after.txt && echo IDENTICAL
```

Expected: `IDENTICAL`, and the same exit code. No convention skills exist yet, so the corpus has one member and nothing may move.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/handoff/check-docs.mjs
git commit -m "refactor(handoff): read conventions as a corpus, not one file

The checks that measure what CLAUDE.md claims are about to have their
subject split across on-demand skills. Widen the reader first, while the
corpus is still a single member, so the move can be proved neutral.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Fix the stale secret-key allowlist, and derive it from the corpus

**This is a pre-existing bug, found while planning.** `check-docs.mjs:277` hardcodes seven files under a comment saying "Six local-only scripts", while `CLAUDE.md` § Supabase → Keys names **nine** — corrected there on 2026-09-03. The allowlist is missing `scripts/verify-manual-transcribe.mjs`, `scripts/verify-notegen-pipeline.mjs` and `scripts/verify-persona-selection.mjs`, so check 8 reports three false findings today. The comment "Keep this list identical to CLAUDE.md > Supabase > Keys" is an instruction no mechanism enforces — and the Keys text is about to move, so it must become derived rather than copied.

**Files:**
- Modify: `.claude/skills/handoff/check-docs.mjs:276-285`

**Interfaces:**
- Consumes: `conventionText` from Task 1.
- Produces: `ALLOWED_SECRET_FILES` — a `Set<string>` derived from the corpus, not typed by hand. The existing `isAllowedSecretFile` helper below it is unchanged.

- [ ] **Step 1: Prove the bug**

```bash
node .claude/skills/handoff/check-docs.mjs 2>&1 | grep -i "secret"
```

Expected: findings naming `verify-manual-transcribe.mjs`, `verify-notegen-pipeline.mjs` and `verify-persona-selection.mjs` as unauthorised readers of the secret key. They are authorised; `CLAUDE.md` says so. If the output is clean instead, stop and re-read check 8 before continuing — the premise of this task would then be wrong.

- [ ] **Step 2: Derive the list from the corpus**

Replace the hardcoded `const ALLOWED_SECRET_FILES = new Set([...])` block with:

```js
// DERIVED, not copied — amended 2026-09-03. The previous hardcoded list said
// "six" and held seven while CLAUDE.md named nine; a comment saying "keep this
// identical" is not a mechanism. The conventions name every allowed reader in
// backticks, so read them from there. The cron route is the one shipped file
// and is matched by path; the local-only scripts are named by basename.
const ALLOWED_SECRET_FILES = new Set(["app/api/cron/transcribe/route.ts"]);
for (const m of conventionText.matchAll(/`(scripts\/[\w.-]+\.mjs|[\w-]+\.mjs)`/g)) {
  const name = m[1].startsWith("scripts/") ? m[1] : `scripts/${m[1]}`;
  if (has(name)) ALLOWED_SECRET_FILES.add(name);
}
if (ALLOWED_SECRET_FILES.size < 5) {
  findings.push(
    "check-docs: the secret-key allowlist derived fewer than five files from the conventions — the Keys section was reworded or moved, so this check is watching nothing",
  );
}
```

The floor-of-five guard is the same idea as check 1's "watching nothing" line: a derived list that silently derives to almost nothing is worse than a stale one.

- [ ] **Step 3: Prove the fix**

```bash
node .claude/skills/handoff/check-docs.mjs 2>&1 | grep -i "secret"
```

Expected: no finding names any `scripts/verify-*.mjs`. The note line reports the derived count.

- [ ] **Step 4: Prove it still catches a real violation**

```bash
printf '\nconst k = process.env.SUPABASE_SECRET_KEY;\n' >> lib/notes/get-note.ts
node .claude/skills/handoff/check-docs.mjs 2>&1 | grep -i "get-note"
git checkout -- lib/notes/get-note.ts
git status --short
```

Expected: a finding naming `lib/notes/get-note.ts`, then an empty `git status`. A derived allowlist that lets everything through is the failure mode worth testing for.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/handoff/check-docs.mjs
git commit -m "fix(handoff): derive the secret-key allowlist from the conventions

The hardcoded Set held seven entries under a comment saying six, while
CLAUDE.md named nine; check 8 was reporting three real scripts as
unauthorised. Derive it instead, with a floor guard so a reworded Keys
section fails loudly rather than allowing everything.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Move § Recorder into a skill

The first move. Do this one alone and check it end to end; Tasks 4–7 repeat the identical shape, so a mistake found here is a mistake found five times.

**Files:**
- Create: `.claude/skills/recorder-conventions/SKILL.md`
- Modify: `CLAUDE.md` — remove lines 213–289 (`## Recorder` through the line before `## Transcription`)

**Interfaces:**
- Produces: the file-header shape every later task copies — YAML frontmatter with `name` and `description`, then `**Last updated:**`, then the moved body with each `##` demoted to `#` and each `###` to `##`.

- [ ] **Step 1: Extract the section verbatim**

```bash
grep -n "^## Recorder$\|^## Transcription$" CLAUDE.md
sed -n '213,289p' CLAUDE.md > /tmp/recorder-body.md; wc -l /tmp/recorder-body.md; head -3 /tmp/recorder-body.md; tail -3 /tmp/recorder-body.md
```

Expected: 77 lines, starting `## Recorder`, ending on the last line of that section. Derive the range from the grep, never from this document — the file may have moved under you.

- [ ] **Step 2: Write the skill file**

Create `.claude/skills/recorder-conventions/SKILL.md` — frontmatter, then the body from Step 1 with its own `## Recorder` heading line dropped:

```markdown
---
name: recorder-conventions
description: Rules for the audio capture path — the HUD, the module-scope Zustand store, getDisplayMedia, MediaRecorder wiring, mic constraints, codec detection, the {user_id}/{note_id} Storage path, and the upload-failure tier. Use when touching lib/recorder/, components that record or upload audio, app/notes/actions/recording.ts, storage_audio.sql, or scripts/verify-recorder-upload.mjs.
---

# Recorder conventions

**Last updated:** 2026-09-03
Update this line whenever this file changes — don't let it drift from reality.

<body from /tmp/recorder-body.md, minus its own `## Recorder` heading line>
```

The `description` is the only part of this file that loads at session start, and it is the sole thing that decides whether these rules are read at all. Name the **directories and filenames** a reader would be touching, not the concepts — a concept match is a guess, a path match is a fact.

- [ ] **Step 3: Remove the section from CLAUDE.md**

```bash
sed -i '213,289d' CLAUDE.md && grep -n "^## " CLAUDE.md | head
```

Expected: `## Recorder` is gone; `## Transcription` now sits at line 213.

- [ ] **Step 4: Prove nothing was lost**

```bash
diff <(git show HEAD:CLAUDE.md | sed -n '214,289p') \
     <(tail -n +9 .claude/skills/recorder-conventions/SKILL.md)
```

Expected: no output. Any difference is a word lost in transit — fix it before moving on. (Line 214, not 213, because the `## Recorder` heading was replaced by the file's own `# Recorder conventions`.)

- [ ] **Step 5: Run the checker and the tests**

```bash
node .claude/skills/handoff/check-docs.mjs; echo "exit=$?"
npm test
```

Expected: checker exit 0, and a green test run. The corpus reader from Task 1 is what keeps the backtick-path check seeing `lib/recorder/codec.ts`; if paths under `lib/recorder/` start showing as missing, Task 1 Step 3 was not applied to check 3.

- [ ] **Step 6: Set the `Last updated` line and commit**

`CLAUDE.md`'s `**Last updated:**` becomes `2026-09-03`.

```bash
git add CLAUDE.md .claude/skills/recorder-conventions/SKILL.md
git commit -m "docs(conventions): move the recorder rules into an on-demand skill

CLAUDE.md loads in full on every session; a skill body loads only when
invoked. The recorder rules are needed when touching lib/recorder/, and
nowhere else, so they cost roughly 1,900 tokens a session for nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Move § Transcription into a skill

Identical shape to Task 3.

**Files:**
- Create: `.claude/skills/transcription-conventions/SKILL.md`
- Modify: `CLAUDE.md` — remove original lines 290–405 (after Task 3, they start at 213)

**Interfaces:**
- Consumes: the header shape from Task 3, Step 2.

- [ ] **Step 1: Confirm the live range, then extract**

```bash
grep -n "^## Transcription$\|^## Note generation$" CLAUDE.md
```

Extract from the `## Transcription` line to the line *before* `## Note generation`, into `/tmp/transcription-body.md`. Expected: 116 lines.

- [ ] **Step 2: Write the skill file**

```markdown
---
name: transcription-conventions
description: Rules for turning recorded audio into a transcript — processing_status as the queue, the one-statement guarded claim, staleness and object-existence checks, the diarization duration policy, Gemini interactions.create casing and field traps, the /api/cron public-prefix requirement, and the Vercel Hobby limits. Use when touching lib/transcription/, app/api/cron/transcribe/route.ts, app/notes/actions/transcription.ts, lib/audio/mime-type.ts, or the transcription verify scripts.
---

# Transcription conventions

**Last updated:** 2026-09-03
Update this line whenever this file changes — don't let it drift from reality.

<body from /tmp/transcription-body.md, minus its own heading line>
```

- [ ] **Step 3: Remove the section and prove nothing was lost**

Delete the same range from `CLAUDE.md`, then:

```bash
diff <(git show HEAD:CLAUDE.md | sed -n '291,405p') \
     <(tail -n +9 .claude/skills/transcription-conventions/SKILL.md)
```

Expected: no output.

- [ ] **Step 4: Verify and commit**

```bash
node .claude/skills/handoff/check-docs.mjs; echo "exit=$?"
npm test
```

Expected: exit 0, green tests. Set `CLAUDE.md`'s `**Last updated:**` and commit with the Task 3 message shape, naming transcription.

---

### Task 5: Move § Note generation, and the persona-resolution block out of § Data

Two moves in one task because they are one subject: `resolvePersonaFor` exists to serve generation, and splitting them would leave a rule in `CLAUDE.md` whose reason lives elsewhere.

**Files:**
- Create: `.claude/skills/notegen-conventions/SKILL.md`
- Modify: `CLAUDE.md` — remove § Note generation (original 406–577), and remove original lines 152–205 from § Data **except** the "The client never sees a uuid." paragraph (original 178–183), which stays

**Interfaces:**
- Consumes: the header shape from Task 3, Step 2.

- [ ] **Step 1: Locate both ranges**

```bash
grep -n "^## Note generation$\|^## Embeddings$" CLAUDE.md
grep -n "Which persona row a generation pipeline\|The client never sees a uuid\|\`lib/mock/note.ts\` is no longer" CLAUDE.md
```

The persona block runs from the `**Which persona row a generation pipeline...**` line to the line before `` `lib/mock/note.ts` is no longer rendered ``.

- [ ] **Step 2: Keep the uuid paragraph in CLAUDE.md**

This paragraph constrains every component that renders a persona, not just the generator, so it stays in the always-loaded file. Leave these six lines in place in § Data; everything else in the block moves:

```markdown
**The client never sees a uuid.** `Persona.id` and `Note.personaId` are both
slugs; `note-view-model.ts` translates one way and
`app/notes/actions/persona.ts` the other. A uuid is per-user and does not
survive a reseed.
```

- [ ] **Step 3: Write the skill file**

```markdown
---
name: notegen-conventions
description: Rules for generating structured notes from a transcript — notegen_status as the queue, the two-condition claim and its ClaimResult tagged union, why persona_id rides out on RETURNING, the blank-transcript guard order, the deleteGeneratedChunks persona_id IS NULL clause, per-note lens selection and its freeze window, resolvePersonaFor's three steps, and Gemini response_format and thinking_level casing. Use when touching lib/notegen/, app/notes/actions/persona.ts, lens prompts, personas rows, or the notegen and persona-selection verify scripts.
---

# Note generation conventions

**Last updated:** 2026-09-03
Update this line whenever this file changes — don't let it drift from reality.

## Which persona row a generation pipeline reads its config from

<the persona-resolution block, minus the uuid paragraph kept in CLAUDE.md>

## The queue and the claim

<§ Note generation body, minus its own heading line>
```

- [ ] **Step 4: Remove both ranges and verify**

```bash
node .claude/skills/handoff/check-docs.mjs; echo "exit=$?"
npm test
grep -c "resolvePersonaFor\|DEFAULT_PERSONA_FALLBACK" .claude/skills/notegen-conventions/SKILL.md
sed -n '/^## Data$/,/^## Naming$/p' CLAUDE.md
```

Expected: checker exit 0, green tests, a non-zero grep count proving the persona rules landed, and a § Data that still reads as a complete thought. Read that last output top to bottom before committing — this is the one task that leaves a section edited rather than removed.

- [ ] **Step 5: Commit**

Set `**Last updated:**` on `CLAUDE.md` and the new skill, then commit both with the Task 3 message shape, naming note generation and saying the persona-resolution rules travelled with it.

---

### Task 6: Move § Embeddings into a skill

**Files:**
- Create: `.claude/skills/embeddings-conventions/SKILL.md`
- Modify: `CLAUDE.md` — remove original lines 578–697

- [ ] **Step 1: Locate the live range**

```bash
grep -n "^## Embeddings$\|^## Naming$" CLAUDE.md
```

- [ ] **Step 2: Write the skill file**

```markdown
---
name: embeddings-conventions
description: Rules for embedding note chunks — embedding IS NULL as the chunk-grain queue, why there is deliberately no claim, the voyage-4 model and its pinned output_dimension, output_dtype and input_type, batch and rate-limit numbers, which errors charge an attempt, the content-error-only one-at-a-time fallback, metadata merging, the text-typed eligibility filter, and the partial index. Use when touching lib/rag/, note_chunks.embedding, VOYAGE_API_KEY, or scripts/verify-embeddings-pipeline.mjs.
---

# Embeddings conventions

**Last updated:** 2026-09-03
Update this line whenever this file changes — don't let it drift from reality.

<body, minus its own heading line>
```

- [ ] **Step 3: Remove, verify, commit**

```bash
node .claude/skills/handoff/check-docs.mjs; echo "exit=$?"
npm test
```

Expected: exit 0, green tests. `VOYAGE_API_KEY`'s two-shipped-files rule is also pinned by `project-conventions.test.ts`, which this plan does not touch — the Vitest run is what proves that still holds. Set `**Last updated:**` on both files and commit.

---

### Task 7: Move § Supabase into a skill

All subsections — Pinned versions, Declarative schema workflow, RLS rules, Deployment, Keys, Proving RLS — move together. They are one subject, and the Keys text is what Task 2's derived allowlist reads.

**Files:**
- Create: `.claude/skills/supabase-conventions/SKILL.md`
- Modify: `CLAUDE.md` — remove original lines 705–837

- [ ] **Step 1: Locate the live range**

```bash
grep -n "^## Supabase$\|^## Commands$" CLAUDE.md
```

- [ ] **Step 2: Write the skill file, demoting headings one level**

`## Supabase` becomes `# Supabase conventions`; each `### Pinned versions`, `### Declarative schema workflow`, `### RLS rules`, `### Deployment`, `### Keys` and `### Proving RLS` becomes `##`.

```markdown
---
name: supabase-conventions
description: This project's Supabase rules — hosted-only with no Docker, the declarative schema workflow and config.toml ordering, the four-per-operation RLS policy shape with wrapped auth.uid() and composite foreign keys, publishable-vs-secret key confinement and which files may read the secret, service_role grants, and how to prove RLS. Use when touching supabase/schemas/, RLS policies, migrations, lib/supabase/, auth redirects, or any query whose rows are user-owned.
---

# Supabase conventions

**Last updated:** 2026-09-03
Update this line whenever this file changes — don't let it drift from reality.

<body with headings demoted one level>
```

- [ ] **Step 3: Prove the derived allowlist survived the move**

```bash
node .claude/skills/handoff/check-docs.mjs 2>&1 | grep -i "secret\|allowlist"
```

Expected: the derived-count note line, no "watching nothing" finding, and no finding naming a `scripts/verify-*.mjs`. **This is the single most likely thing to break in this whole plan** — the Keys text has just left `CLAUDE.md`, and Task 1's corpus reader is the only thing keeping it in view.

- [ ] **Step 4: Verify and commit**

```bash
node .claude/skills/handoff/check-docs.mjs; echo "exit=$?"
npm test
node scripts/verify-rls.mjs
```

Expected: checker exit 0, green tests, and a passing two-user RLS proof. The RLS script needs `.env.local`; if it is absent, say so rather than reporting a pass. Set `**Last updated:**` on both files and commit.

---

### Task 8: Add the index to CLAUDE.md and enforce the budget

**This is the task that answers "will future pipelines be added automatically."** They will not, on their own — a skill body is invisible until invoked, and an instruction read once is an instruction that can be rationalised past. Two mechanisms make it stick: an index that loads every session, and a check that fails when the index and the disk disagree.

**Files:**
- Modify: `CLAUDE.md` — add § "Where the rest of these conventions live", immediately after § File layout
- Modify: `.claude/skills/handoff/check-docs.mjs` — add check 13 after check 12

**Interfaces:**
- Consumes: `CONVENTION_DOCS` from Task 1.
- Produces: an index table whose second column holds each skill directory name in backticks, which check 13 parses.

- [ ] **Step 1: Write check 13 first, and watch it fail**

Append to `check-docs.mjs`, after check 12:

```js
/* 13 — CLAUDE.md stays within budget, and its index matches the disk ------- */
{
  // CLAUDE.md is the only auto-loaded convention file, so its length is a
  // per-session tax on every future chat. 260 lines is the budget set when the
  // pipeline sections moved out on 2026-09-03; a section that grows past it
  // earns a skill, never a raised budget. Same argument as the 400-line source
  // ceiling in File layout.
  const BUDGET = 260;
  const lines = claude.split("\n").length;
  if (lines > BUDGET) {
    findings.push(`CLAUDE.md is ${lines} lines, over its ${BUDGET}-line budget — move a section into a convention skill rather than raising the budget`);
  }

  const onDisk = new Set(CONVENTION_DOCS.slice(1).map((d) => d.rel.split("/")[2]));
  const indexed = new Set([...claude.matchAll(/`([\w-]+-conventions)`/g)].map((m) => m[1]));
  if (onDisk.size === 0) {
    findings.push("no .claude/skills/*-conventions/SKILL.md exists — the split was reverted or the glob was renamed, so this check is watching nothing");
  }
  for (const name of onDisk) {
    if (!indexed.has(name)) findings.push(`${name} exists on disk but CLAUDE.md's index does not list it — it will never be loaded`);
  }
  for (const name of indexed) {
    if (!onDisk.has(name)) findings.push(`CLAUDE.md's index lists ${name}, which has no .claude/skills/${name}/SKILL.md`);
  }
  notes.push(`conventions: CLAUDE.md ${lines}/${BUDGET} lines, ${onDisk.size} skill(s), index agrees`);
}
```

Run it before adding the index section:

```bash
node .claude/skills/handoff/check-docs.mjs 2>&1 | grep -i "index does not list"
```

Expected: five findings, one per skill. That proves the check is live rather than decorative.

- [ ] **Step 2: Add the index section to CLAUDE.md**

```markdown
## Where the rest of these conventions live

This file loads in full on every session, so it holds only what governs **all**
new code. Each pipeline's rules live in a skill that loads on demand — its body
costs nothing until it is invoked. Split 2026-09-03; nothing was deleted.

| Working on | Load |
|---|---|
| Audio capture, upload, Storage paths | `recorder-conventions` |
| Audio to transcript, the cron sweep, Gemini audio calls | `transcription-conventions` |
| Transcript to structured notes, personas, lenses | `notegen-conventions` |
| Chunk to vector, Voyage, the pending-embedding queue | `embeddings-conventions` |
| Schemas, RLS, migrations, keys, deployment | `supabase-conventions` |

**Load the matching skill BEFORE editing any file it names.** These are not
background reading — each holds rules that are invisible from the code and
expensive to rediscover, and several record bugs this project already shipped
once.

**A new pipeline gets a new skill, never a new section here.** When a track
grows its own queue column, its own claim, or its own vendor, create
`.claude/skills/<name>-conventions/SKILL.md` and add one row above. The handoff
checker fails if this table and the directories on disk disagree, and fails if
this file passes 260 lines.
```

- [ ] **Step 3: Watch it pass**

```bash
node .claude/skills/handoff/check-docs.mjs; echo "exit=$?"
wc -l CLAUDE.md
```

Expected: exit 0, the `conventions:` note line, and roughly 220 lines.

- [ ] **Step 4: Prove the budget guard bites**

```bash
for i in $(seq 1 60); do echo "padding" >> CLAUDE.md; done
node .claude/skills/handoff/check-docs.mjs 2>&1 | grep -i "budget"
git checkout -- CLAUDE.md
git status --short
```

Expected: the over-budget finding, then an empty `git status`. A budget nobody has watched fail is a budget that might not work.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md .claude/skills/handoff/check-docs.mjs
git commit -m "docs(conventions): index the convention skills and enforce the budget

An on-demand skill is invisible until invoked, so the split needs a pointer
that loads every session and a check that fails when the pointer and the disk
disagree. 260-line budget, both directions of the index checked, and both
guards proved to fail before being made to pass.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Update the handoff skill, measure, and report

**Files:**
- Modify: `.claude/skills/handoff/SKILL.md` — the description (line 3), the file table (line 17), the check list (lines 63–69), the repair rules (lines 195–198), and the attachment note (line 268)

- [ ] **Step 1: Widen the audit's subject**

The description and the file table name `CLAUDE.md` as the home of "the rules that govern new code". Add a row to the table:

```markdown
| Per-pipeline rules — recorder, transcription, notegen, embeddings, Supabase | `.claude/skills/*-conventions/SKILL.md` |
```

In the numbered check list, checks 1–3 now read "the convention corpus — `CLAUDE.md` plus every `.claude/skills/*-conventions/SKILL.md`" rather than `CLAUDE.md` alone.

- [ ] **Step 2: Extend the Last-updated rule**

The existing rule reads *"If you change one byte of `CLAUDE.md`, set its `**Last updated:**` line."* Replace it with:

```markdown
**If you change one byte of `CLAUDE.md` or of any
`.claude/skills/*-conventions/SKILL.md`, set THAT file's `**Last updated:**`
line.** Each carries its own; updating the wrong one is drift, not a record.
```

- [ ] **Step 3: Mark the Claude.ai attachment boundary**

`SKILL.md:268` says four files are "the whole permanent set" attached to the planning Project. That stays true — convention skills are Claude Code's on-demand context and the Project has no equivalent, so they are **not** attached. Add one sentence saying so, so a future reader does not "fix" it by attaching five more files.

- [ ] **Step 4: Measure the result**

```bash
wc -l -c CLAUDE.md
wc -c .claude/skills/*-conventions/SKILL.md
node .claude/skills/handoff/check-docs.mjs; echo "exit=$?"
npm test
npm run typecheck
npm run build
```

Expected: `CLAUDE.md` near 220 lines / 14 KB, five skill files totalling near 34 KB, checker exit 0, and green tests, typecheck and build. The build is in this list because `CLAUDE.md` carries the `next dev`-written block; confirm the build did not re-add a removed section.

- [ ] **Step 5: Confirm nothing was lost, across the whole split**

```bash
git show HEAD~7:CLAUDE.md | wc -c
{ cat CLAUDE.md; cat .claude/skills/*-conventions/SKILL.md; } | wc -c
```

Expected: the second number is **larger** than the first, by roughly the frontmatter and headers added. If it is smaller, text was lost — find it with `git diff HEAD~7 -- CLAUDE.md` before committing.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/handoff/SKILL.md
git commit -m "docs(handoff): audit the convention skills alongside CLAUDE.md

The rules the audit measures now live across CLAUDE.md and five on-demand
skills. Name them in the file table, widen checks 1-3's stated subject, and
make the Last-updated rule per-file. The Claude.ai Project attachment set is
unchanged and now says why.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## What this does not fix

- **A skill only helps if its `description` fires.** That is the real risk here, and no check can measure it. If a session edits `lib/rag/` without loading `embeddings-conventions`, the rules were not consulted. The index table in `CLAUDE.md` is the mitigation — it loads every session and names the trigger — but it is a pointer, not a guarantee. Watch for it over the next few sessions; if a rule gets missed, the fix is a sharper `description` naming more paths, not a retreat to one big file.
- **`docs/KNOWN_GAPS.md` is 105 KB.** It does not auto-load, so it costs nothing at session start, but it is read in full during a handoff. Out of scope here; worth its own pass later.
- **The Claude.ai planning Project is untouched.** Its four attached files and its instructions are unchanged by this plan.
