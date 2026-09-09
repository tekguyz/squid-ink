---
name: doc-audit
description: Audit CLAUDE.md, docs/KNOWN_GAPS.md, docs/DECISIONS.md, docs/ROADMAP.md and docs/DEPLOYMENT.md against the real repo state and against each other, repair whichever is stale, and commit the doc files. Use when the user asks for a doc audit, says the docs are stale, or when the handoff skill reports a check finding it could not resolve. This is the heavy pass — the handoff skill does not run it.
---

# Doc audit — measure the docs against the repo, repair what drifted

This is the expensive half of what used to be one `handoff` skill. It was split
on 2026-09-09 because the cheap half ran several times a day and paid for this
half every time. Measured that day: a full pass reads about **69k tokens** of
documents before writing a word, and up to **127k** when a citation leads into a
`design-reference/*.dc.html` file.

**Run this when a doc is actually suspect**, not on every handoff:

- `node scripts/check-docs.mjs` reported a finding the `handoff` skill could not
  resolve from script output alone
- a session shipped work that needs a new `KNOWN_GAPS.md` entry or a dated
  `RESOLVED` line
- the user asks for a doc audit, or says something in the docs looks wrong

The `handoff` skill runs the same script but reads only its **output**. It never
opens a whole doc. That is the whole point of the split — do not reintroduce doc
reading there.

## Where status lives in this repo

This repo has **no `STATUS.md`**, and does not need one yet. Five files carry
everything, and all five are on disk:

| What it holds | Lives in |
|---|---|
| Stack decision, pinned versions, the rules that govern new code | `CLAUDE.md` |
| Every deviation, deferral, and deliberately-not-built thing | `docs/KNOWN_GAPS.md` |
| Locked decisions, what was rejected and why, what is still open | `docs/DECISIONS.md` |
| Scope, phases, cost picture, explicit out-of-scope | `docs/ROADMAP.md` |
| Vercel and Supabase config, and how to re-measure it | `docs/DEPLOYMENT.md` |

`DECISIONS.md` and `ROADMAP.md` **moved into the tree on 2026-08-31.** Before
that they were Claude.ai Project knowledge files, invisible here, and that is
not a footnote — it is the reason this audit exists in its current shape. A
decision lived in `DECISIONS.md` and its contradiction lived in
`docs/KNOWN_GAPS.md` for a full day, and no check in this repo could have found
it, because the file it disagreed with could not be read. **`docs/` is now the
source of truth for all five.**

Do not add a `docs/STATUS.md` until there is genuinely dated narrative that fits
in none of them. Five files that are always accurate beat six that drift.

The **design files are the source of truth for anything visual** —
`design-reference/Note Detail.dc.html` (turn 3: `#3a` light, `#3b` dark, `#3c`
locked tokens) and `design-reference/App Surfaces.dc.html` (ten further
surfaces, none built). Turns 1 and 2 of the Note Detail file are history and
must never be cited. `app/globals.css` is the source of truth for what the app
actually paints; every value in it is a copy of a design-file value, which is
exactly the shape that drifts silently. Check 1 covers it — **and covers it
better than reading the files, which cost 58k tokens together.** Open a design
file only when a check finding names a specific value, and read only that
region.

---

## Audit and repair

**Measure, never infer.** `CLAUDE.md`'s own conventions are written as
absolutes; treat a claim in this repo's docs the same way you would treat a
claim in chat — as something to verify, not something to cite.

### Check 1 — the countable claims, every run, no exceptions

```bash
node scripts/check-docs.mjs
```

Repo-only. No browser, no dev server, no network. It measures twelve things:

1. **The pinned-version table in `CLAUDE.md` against `package.json`** — both
   directions, so a package added to one and not the other is a finding, and any
   `^`/`~` range is a finding on its own. This is the single most drift-prone
   claim in the repo: fifteen versions copied by hand into a doc that nothing
   updates.
2. Every `npm run <script>` `CLAUDE.md` names exists in `package.json`.
3. Every repo path `CLAUDE.md` names in backticks exists on disk.
4. **Every `oklch()` in `app/globals.css` appears verbatim in the Note Detail
   design file.** All 64 did at handoff time. A value that stops matching means
   a token was hand-edited away from the locked design — the exact defect the
   design side fixed before this build started.
5. The eight locked accent values are still present, verbatim.
6. No app-name string (`squid ink`, `crispy bacon`) in `app/`, `components/` or
   `lib/`. The public name is unconfirmed; `package.json` is the only place a
   name may appear.
7. `app/layout.tsx` loads exactly Bitter, Archivo and IBM Plex Mono — no fourth
   face. The design file contains Newsreader, Zilla Slab and Libre Franklin in
   its earlier turns, which is how a wrong font gets in.
8. **Supabase key hygiene.** No `NEXT_PUBLIC_` variable whose name says `SECRET`
   or `SERVICE_ROLE`; no source file outside `scripts/verify-rls.mjs` reading a
   secret key; no literal key committed anywhere in `app/`, `components/`,
   `lib/` or `scripts/`; `.env*` still ignored. The secret key bypasses RLS, so
   this is the one drift in the repo that is a breach rather than a blemish.
9. **RLS shape in `supabase/schemas/*.sql`** — four per-operation policies per
   table, never a blanket `for all`; every policy `to authenticated`; every
   `auth.uid()` wrapped as `(select auth.uid())`; UPDATE carrying `with check`;
   a `revoke all` before the grants. Comments are stripped first, because these
   files explain the rules in prose and a rule quoted in a comment is not a
   policy. This is the shape, not the behaviour — `node scripts/verify-rls.mjs`
   is still the only thing that proves the live database.
10. **The five planning docs all exist** — the four the Claude.ai Project syncs
    as standing knowledge, plus `docs/DEPLOYMENT.md`.
11. **No doc claims, in the present tense, that a doc that exists does not.**
    Written directly against the 2026-08-31 failure: five passages in
    `docs/KNOWN_GAPS.md` still said `DECISIONS.md` and `ROADMAP.md` were "not on
    disk here" and could not be audited, and one of them rested a closed finding
    on the owner's report rather than the file. Past-tense history is legitimate
    and is exempted; the filename is matched across a three-line window because
    the prose wraps.
12. **`docs/DEPLOYMENT.md`'s figures against the code they describe** — the cron
    schedule against `vercel.json`, `maxDuration` against the route,
    `MAX_TRANSCRIPTIONS_PER_RUN` against `sweep.ts`. That file is the only record
    this repo carries that it is deployed at all, so a number raised in code and
    not there reads as a plan change that never happened.

Exit `0` clean, `1` findings one per line, `2` means it could not read something
and **is not a pass** — fix the script before continuing.

All twelve were verified to catch real drift, by breaking each one and watching
it fail — the original nine when the script was written, checks 10–12 when the
docs moved in on 2026-08-31. If you change a check, do that again; a check that
has never failed is decoration.

**What it cannot do, so do not claim it did:** it cannot check a *rule*. Most of
`CLAUDE.md` and its `.claude/rules/*.md` files are decisions — the
flat-components rule, the 250/400 line ceilings, the mock-data-only boundary.
Those are not stale for being old, and this job does not touch them. Correct a
figure, keep the reason.

### Check 2 — what shipped that the docs do not mention

`git log --oneline -20`, and `git log origin/main --oneline -5` if a remote
exists. For every commit since `docs/KNOWN_GAPS.md`'s newest dated entry,
confirm something covers it. Read commit bodies — this repo writes real ones.

### Check 3 — what `docs/KNOWN_GAPS.md` claims that is no longer true

Start from the heading index, not the whole file:

```bash
grep -n "^#\{2,3\} " docs/KNOWN_GAPS.md
```

4.0 KB against the file's 132 KB, measured 2026-09-09. Then read only the
sections the session touched. A gap that is genuinely closed does **not** get
deleted: rewrite it in place with a dated `**RESOLVED YYYY-MM-DD.**` line saying
what closed it. The file is a record of decisions, and a deletion destroys the
reasoning along with the entry. The App Surfaces reference gap was closed this
way on 2026-08-30.

### Check 3b — contradictions between the five docs

The highest-yield check in this job, because it was impossible before
2026-08-31. `docs/DECISIONS.md` and `docs/ROADMAP.md` are now readable, so
**verify a claim against them instead of relaying it.**

Check 11 catches the mechanical half. The rest is reading, and two shapes recur:

- **The repo says open, the decision says closed.** Persona timing was settled in
  `DECISIONS.md` § Personas on 2026-08-30 and `docs/KNOWN_GAPS.md` called it open
  for a day. Work `DECISIONS.md` § "Explicitly still open" and `ROADMAP.md` § 9
  against what actually shipped.
- **The repo cites an authority that says the opposite.** `CLAUDE.md` and
  `lib/recorder/capture.ts:19` forbid `noiseSuppression` "— ROADMAP §7 rejected
  extra masking", where §7 rejects *custom edge-ML* masking on cost grounds and
  offers browser `noiseSuppression` as the free alternative. **Follow every
  citation to the cited section.** A citation that has never been opened is the
  same as no citation.

**Follow a citation into the section, not into the file.** Use
`grep -n "^#" <file>` to find the section's line range, then `sed -n`. Reading
`docs/DECISIONS.md` whole costs 10.5k tokens and a `.dc.html` design file costs
25–33k; a section costs a fraction of that and answers the same question.

A contradiction in a *rule* is reported, never silently rewritten — same
standard as check 1. A contradiction in a *status* is repaired in place with a
dated line naming what closed it.

### Check 4 — uncommitted and unpushed work

`git status --short` and `git status -sb`. Work in the tree is **not** shipped —
say "uncommitted in the working tree" explicitly, never fold it into "shipped".
`git remote -v`: there **is** a remote (`origin`, GitHub), so report ahead/behind
from `git status -sb` rather than assuming nothing is pushed. Pushed is still not
deployed: `main` auto-deploys to Vercel (`tekguyz/squid-ink`,
`https://squid-ink.vercel.app`), but a push is not proof the build went green.
Check it with `vercel ls squid-ink --scope tekguyz` and report what it says.

### Check 5 — the gates, if the audit will call anything done

```bash
npm run build
npx tsc --noEmit
npm test
```

A doc saying something is complete is not evidence. Run them and quote the real
output. Skip this only when the audit makes no completeness claim at all.

### Check 6 — scope fence

`design-reference/App Surfaces.dc.html` holds ten surfaces (01 dashboard,
02 recorder, 02b record HUD, 03 personas, 04 auth, 05 onboarding, 06 settings,
07 collections, 08 share, 09 live assistant, 10 newsprint light). **None is
built and none was in scope.** That list is reproduced here so this check costs
nothing; do not open the file to re-count it. If the session touched anything
resembling one, say so loudly — it is scope creep, not progress.

---

## Repair, then commit

Repair whichever doc is stale, in that doc's own established format:

- **`CLAUDE.md` and `.claude/rules/*.md`** — correct the figure the script
  named. Do not reword a rule that the script cannot check; if a rule is
  genuinely wrong, that is a code-reading finding, and it is reported, not
  silently rewritten. **If you change one byte of `CLAUDE.md`, set its
  `**Last updated:**` line under `# Conventions` to today's date**, the same way
  `docs/ROADMAP.md`'s header date is bumped. The line exists so a reader can
  tell at a glance whether the file has been measured recently; leaving it
  behind a real edit is the exact drift this audit exists to catch. Same rule
  for `docs/ROADMAP.md`'s header and `docs/DECISIONS.md`'s "Working state as of"
  line — a doc this job repairs is a doc whose date it stamps.
- **`docs/KNOWN_GAPS.md`** — add a dated section for anything newly deferred,
  and mark anything now closed `**RESOLVED YYYY-MM-DD.**` in place, with what
  closed it.

If every doc was already accurate, say so plainly and change nothing.

**If any doc changed, commit it — those files alone, nothing else in the tree**,
even if other work is in progress. Message names the measurement, e.g.
`"CLAUDE.md: next 16.3.3 -> 16.4.0, measured against package.json"`.

Then tell the user to click **Sync now** in the Claude.ai Project, because the
connector serves the branch and a repair it has not fetched is not yet visible
there. Do not print an attach-list; the file selection is set once in the
Claude.ai UI.
