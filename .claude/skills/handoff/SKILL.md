---
name: handoff
description: Audit CLAUDE.md, docs/KNOWN_GAPS.md, docs/DECISIONS.md, docs/ROADMAP.md and docs/DEPLOYMENT.md against the real repo state and against each other, repair whichever is stale, then print a paste-ready handoff block for the user's Claude.ai planning Project. Use when the user asks for a handoff, a status sync, "where are we", or says they are about to plan/spec/write a prompt in Claude.ai.
---

# Handoff to the Claude.ai planning Project

The user runs a **separate Claude.ai Project** for planning, specs and
prompt-writing. That Project cannot see this repo. It knows only what the user
pastes into it, and it attaches its standing knowledge **from this tree**.

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
not a footnote — it is the reason this skill exists in its current shape. A
decision lived in `DECISIONS.md` and its contradiction lived in
`docs/KNOWN_GAPS.md` for a full day, and no check in this repo could have
found it, because the file it disagreed with could not be read. **`docs/` is now
the source of truth for all five.** Edits made in a planning chat come back as
commits; the Project does not hold a private copy.

Do not add a `docs/STATUS.md` until there is genuinely dated narrative that fits
in none of them. Five files that are always accurate beat six that drift.

The **design files are the source of truth for anything visual** —
`design-reference/Note Detail.dc.html` (turn 3: `#3a` light, `#3b` dark, `#3c`
locked tokens) and `design-reference/App Surfaces.dc.html` (ten further
surfaces, none built). Turns 1 and 2 of the Note Detail file are history and
must never be cited. `app/globals.css` is the source of truth for what the app
actually paints; every value in it is a copy of a design-file value, which is
exactly the shape that drifts silently. Check 1 covers it.

Two jobs, in this order. **Never skip job 1.** A handoff generated from a stale
doc looks exactly as authoritative as an accurate one, and the planning Project
has no way to tell the difference.

---

## Job 1 — audit and repair the two docs

**Measure, never infer.** `CLAUDE.md`'s own conventions are written as
absolutes; treat a claim in this repo's docs the same way you would treat a
claim in chat — as something to verify, not something to cite.

### Check 1 — the countable claims, every run, no exceptions

```bash
node .claude/skills/handoff/check-docs.mjs
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
8. **Supabase key hygiene.** No `NEXT_PUBLIC_` variable whose name says
   `SECRET` or `SERVICE_ROLE`; no source file outside `scripts/verify-rls.mjs`
   reading a secret key; no literal key committed anywhere in `app/`,
   `components/`, `lib/` or `scripts/`; `.env*` still ignored. The secret key
   bypasses RLS, so this is the one drift in the repo that is a breach rather
   than a blemish.
9. **RLS shape in `supabase/schemas/*.sql`** — four per-operation policies per
   table, never a blanket `for all`; every policy `to authenticated`; every
   `auth.uid()` wrapped as `(select auth.uid())`; UPDATE carrying `with check`;
   a `revoke all` before the grants. Comments are stripped first, because these
   files explain the rules in prose and a rule quoted in a comment is not a
   policy. This is the shape, not the behaviour — `node scripts/verify-rls.mjs`
   is still the only thing that proves the live database.
10. **The five planning docs all exist** — the four the Claude.ai Project
    attaches as standing knowledge, plus `docs/DEPLOYMENT.md`.
11. **No doc claims, in the present tense, that a doc that exists does not.**
    Written directly against the 2026-08-31 failure: five passages in
    `docs/KNOWN_GAPS.md` still said `DECISIONS.md` and `ROADMAP.md` were "not on
    disk here" and could not be audited, and one of them rested a closed finding
    on the owner's report rather than the file. Past-tense history is
    legitimate and is exempted; the filename is matched across a three-line
    window because the prose wraps.
12. **`docs/DEPLOYMENT.md`'s figures against the code they describe** — the cron
    schedule against `vercel.json`, `maxDuration` against the route,
    `MAX_TRANSCRIPTIONS_PER_RUN` against `sweep.ts`. That file is the only
    record this repo carries that it is deployed at all, so a number raised in
    code and not there reads as a plan change that never happened.

Exit `0` clean, `1` findings one per line, `2` means it could not read
something and **is not a pass** — fix the script before continuing.

All twelve were verified to catch real drift, by breaking each one and watching
it fail — the original nine when the script was written, checks 10–12 when the
docs moved in on 2026-08-31. If you change a check, do that again;
a check that has never failed is decoration.

**What it cannot do, so do not claim it did:** it cannot check a *rule*. Most of
`CLAUDE.md` is decisions — the flat-components rule, the 250/400 line ceilings,
the mock-data-only boundary. Those are not stale for being old, and this job
does not touch them. Correct a figure, keep the reason.

### Check 2 — what shipped that the docs do not mention

`git log --oneline -20`, and `git log origin/main --oneline -5` if a remote
exists. For every commit since `docs/KNOWN_GAPS.md`'s newest dated entry,
confirm something covers it. Read commit bodies — this repo writes real ones.

### Check 3 — what `docs/KNOWN_GAPS.md` claims that is no longer true

Grep it for anything the session touched. A gap that is genuinely closed does
**not** get deleted: rewrite it in place with a dated `**RESOLVED YYYY-MM-DD.**`
line saying what closed it. The file is a record of decisions, and a deletion
destroys the reasoning along with the entry. The App Surfaces reference gap was
closed this way on 2026-08-30.

### Check 3b — contradictions between the five docs

New on 2026-08-31, and the highest-yield check in this job, because it was
impossible before that date. `docs/DECISIONS.md` and `docs/ROADMAP.md` are now
readable, so **verify a claim against them instead of relaying it.**

Check 11 catches the mechanical half. The rest is reading, and two shapes recur:

- **The repo says open, the decision says closed.** Persona timing was settled
  in `DECISIONS.md` § Personas on 2026-08-30 and `docs/KNOWN_GAPS.md` called it
  open for a day. Work `DECISIONS.md` § "Explicitly still open" and
  `ROADMAP.md` § 9 against what actually shipped.
- **The repo cites an authority that says the opposite.** `CLAUDE.md:131` and
  `lib/recorder/capture.ts:19` forbid `noiseSuppression` "— ROADMAP §7 rejected
  extra masking", where §7 rejects *custom edge-ML* masking on cost grounds and
  offers browser `noiseSuppression` as the free alternative. **Follow every
  citation to the cited section.** A citation that has never been opened is the
  same as no citation.

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
Check it with `vercel ls squid-ink --scope tekguyz` and report what it says. The
repo carries no `.vercel` or `vercel.json`, so this hosting is invisible from the
tree — see docs/KNOWN_GAPS.md, "The repo has no record that it is deployed".

### Check 5 — the gates, if the handoff will call anything done

```bash
npm run build
npx tsc --noEmit
npm test
```

A doc saying something is complete is not evidence. Run them and quote the real
output. Skip this only when the handoff makes no completeness claim at all.

### Check 6 — scope fence

`design-reference/App Surfaces.dc.html` holds ten surfaces (01 dashboard,
02 recorder, 02b record HUD, 03 personas, 04 auth, 05 onboarding, 06 settings,
07 collections, 08 share, 09 live assistant, 10 newsprint light). **None is
built and none was in scope.** If the session touched anything resembling one,
say so loudly — it is scope creep, not progress. Confirm the count if the
planning Project is about to brief one of them.

---

Then repair whichever doc is stale, in that doc's own established format:

- **`CLAUDE.md`** — correct the figure the script named. Do not reword a rule
  that the script cannot check; if a rule is genuinely wrong, that is a
  code-reading finding, and it is reported, not silently rewritten.
- **`docs/KNOWN_GAPS.md`** — add a dated section for anything newly deferred,
  and mark anything now closed `**RESOLVED YYYY-MM-DD.**` in place, with what
  closed it.

If both were already accurate, say so plainly and change nothing.

**If either doc changed, commit it — those files alone, nothing else in the
tree**, even if other work is in progress. Message names the measurement, e.g.
`"CLAUDE.md: next 16.3.3 -> 16.4.0, measured against package.json"`. An audit
that ends with an uncommitted repair leaves the printed block below citing a doc
state that is not actually in the repo.

---

## Job 2 — print the handoff block

Output it as a fenced markdown block the user can copy whole. **Print it in the
response; do not write it to a file** — it is a message, not an artifact, and a
file would go stale the moment it is written.

Keep it under roughly 500 words. The planning Project has the docs attached; do
not re-derive them here.

```markdown
## squid-ink — handoff <YYYY-MM-DD>

**Repo:** <clean / N uncommitted files> · <in sync with origin/main / N unpushed> · <prod deploy: Ready <age> / not checked>
**Gates:** <build / tsc / test — real result, or "not run this session">

### Shipped since last handoff
- <one line per batch, with the measured figure that matters>

### This session
- <3-6 bullets: what was asked, what was decided, what was rejected and why>

### Open now
- <genuinely open, from docs/KNOWN_GAPS.md — measured only>
- <every check-1 finding, if any: what drifted and how it was resolved. Omit the line entirely when the script exits 0.>

### Needs the user, not more code
- <visual sign-off, a copy or naming decision, anything flagged as the owner's call>

### Reserved — do not brief around these blind
- <the locked token set, the three typefaces, the flat-components rule, the 400-line ceiling, the no-app-name rule, and the Supabase rules: publishable key only in app code, four per-operation RLS policies, never filter on user_id in application code>

### Attach to this Project
CLAUDE.md · docs/KNOWN_GAPS.md · docs/DECISIONS.md · docs/ROADMAP.md
(docs/DEPLOYMENT.md on demand, not as standing knowledge)
```

Rules for the block:

- **Every claim measured.** If a figure was not verified this session, verify it
  now or leave it out. Never carry a number forward from memory.
- **Rejections are load-bearing.** The planning Project writes the next brief.
  Telling it what was considered and rejected is what stops it re-proposing
  that, and it is the highest-value part of the block.
- **Name the reserved systems.** The token set, the typefaces and the
  no-app-name rule are the ones a new brief will trip over first.
- **No hedging, no filler.** "Note Detail shipped, 20 tests passing" or "Note
  Detail is uncommitted" — never "Note Detail is essentially done".
- **The attach-list is a budget, not an inventory.** Project knowledge loads
  into every conversation there, so a file parked in it is paid for on every
  chat. Four files is the whole permanent set: `CLAUDE.md`,
  `docs/KNOWN_GAPS.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`.
  `docs/DEPLOYMENT.md` is attached only by a chat that needs it. The `.dc.html`
  design files are large and belong in the planning Project only when a chat is
  actually briefing a new surface — name the turn and paste that region, never
  the file.
