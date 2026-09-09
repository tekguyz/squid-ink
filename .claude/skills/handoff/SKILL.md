---
name: handoff
description: Run the repo's check script and git state, then print a paste-ready handoff block for the user's Claude.ai planning Project. Reads check-script output, never whole documents. Use when the user asks for a handoff, a status sync, "where are we", or says they are about to plan/spec/write a prompt in Claude.ai.
---

# Handoff to the Claude.ai planning Project

The user runs a **separate Claude.ai Project** for planning, specs and
prompt-writing. That Project reads this repo's files through the **GitHub
connector**, so it already has `CLAUDE.md`, `docs/KNOWN_GAPS.md`,
`docs/ROADMAP.md` and `docs/DECISIONS.md` as they are on `main`.

**What sync cannot give it:** commit history, what happened this session, what
was decided, what was rejected, and what needs a human. That is what this block
is for, and it is the only thing this block should carry.

## Which session to run this in

**Run it in the session that did the work, whenever there was work.** A fresh
session is cheaper — it starts with an empty context, which is why the reading
budget below exists — but it can only read `git log`. It did not watch anything
get decided, and it did not watch anything get rejected.

That matters because "Rejections are load-bearing" under "Rules for the block"
is not decoration: the rejections are what stop the planning Project
re-proposing an option already ruled out, and a session that was not there
cannot write them. On 2026-09-09 a same-session block carried four rejections;
a fresh one would have carried none.

So:

- **Work happened in this chat** — a feature, a fix, a decision, an argument
  settled: run it here. The **This session** section is the reason.
- **No work happened, you just want the state** — a plain "where are we" before
  opening the planning Project: a fresh session is fine and costs less.

If you are running in a fresh session after work happened elsewhere, say so in
the block: write "This session" as `no work in this session — state only`
rather than leaving it blank or inventing content for it.

## The reading budget — this is the point of the skill

This skill was split from `doc-audit` on 2026-09-09 because it was reading five
whole documents on every run, several times a day. Measured on 2026-09-09:
`docs/KNOWN_GAPS.md` is 33k tokens, `CLAUDE.md` 16.3k, `docs/DECISIONS.md`
10.5k, `docs/ROADMAP.md` 5.9k, `docs/DEPLOYMENT.md` 3k — about **69k tokens
before writing a word**, and up to **127k** when a citation in old check 3b led
into `design-reference/Note Detail.dc.html` (33k) or `App Surfaces.dc.html`
(25k).

**Hard rules. Do not reason past these.**

- **Read check-script *output*, never the documents it checks.** The script
  already names the exact stale entry. That naming is the finding.
- **`CLAUDE.md` is already in context** — it loads every session. Read it from
  what you already have. Do not re-read the file.
- **Never open the `design-reference/*.dc.html` files.** Together they are 58k
  tokens. Check 4 in `check-docs.mjs` compares every `oklch()` in
  `app/globals.css` against the Note Detail file already; a script verifies that
  better than reading 1,814 lines.
- **Never open `docs/DECISIONS.md` or `docs/DEPLOYMENT.md`, and open only the
  first 15 lines of `docs/ROADMAP.md`.** Cross-doc contradictions are
  `doc-audit`'s job, and check 11 and check 12 in the script catch the
  mechanical half of it on every run. The one exception is the ROADMAP status
  line, which names which surfaces are built:

  ```bash
  sed -n '1,15p' docs/ROADMAP.md
  ```

  That is ~200 tokens against the file's 5.9k, and it is the ONLY source for
  the surface count. See the surface rule under "Rules for the block".
- **For open work, grep the *headings*, not the bullets.** Use:

  ```bash
  grep -n "^#\{2,3\} " docs/KNOWN_GAPS.md
  ```

  That returns every gap's heading with its line number — 4.0 KB against the
  file's 132 KB, measured 2026-09-09. Then `sed -n '<start>,<end>p'` for the one
  or two sections the block actually needs. A heading carrying
  `**RESOLVED YYYY-MM-DD.**` in its body is closed; there are 28 such markers,
  so do not report a heading as open without opening its section.
- **Never repair a doc here.** If the script reports drift, name it in the block
  and tell the user to run `doc-audit`. Repair is that skill's job.

If the script exits `2`, it **could not run** and is not a pass. Say so in the
block; do not treat silence as clean.

## What to gather

1. `node scripts/check-docs.mjs` — countable claims across the docs,
   `package.json`, `app/globals.css`, the SQL schemas and `vercel.json`.
   Exit `0` clean, `1` findings one per line, `2` could not read something.
2. **`git fetch origin` FIRST, before any other git command.** Then
   `git log --oneline -20` and, if the branch tracks a remote,
   `git log origin/main --oneline -5`.

   The fetch is not optional and it is not tidiness. `origin/main` is a
   **cached local ref**, and without a fetch it holds whatever the last fetch
   on THIS machine saw. The user works from two laptops against one repo. On
   the laptop that did not do the work, `git status -sb` reports "in sync with
   origin/main" while the remote is many commits ahead — a confident, wrong,
   measured-looking claim, which is the worst kind this block can carry.
3. `git status -sb` and `git diff --stat`, **after the fetch**. Report three
   states separately and never merge them:
   - **uncommitted in the working tree** — not shipped, say so explicitly;
   - **ahead of origin** — committed here, not pushed, invisible to the other
     laptop and to Vercel;
   - **behind origin** — work exists that this machine has not pulled. Say
     "behind origin/main by N commits — run `git pull` before working here",
     and do NOT describe the tree as current. Pushed is still not deployed.
4. `docs/KNOWN_GAPS.md` open sections, by the heading grep above.
5. `CLAUDE.md` rules, from context.

`main` auto-deploys to Vercel (`tekguyz/squid-ink`,
`https://squid-ink.vercel.app`). Check it with
`vercel ls squid-ink --scope tekguyz` and report what it says, or report the
deploy as not checked. A push is not proof the build went green.

Gates (`npm run build`, `npm run typecheck`, `npm test`) only if the block will
claim something is done. Otherwise report them as not run.

## Print the block

Output it as a fenced markdown block the user can copy whole. **Print it in the
response; do not write it to a file** — it is a message, not an artifact.

Keep it under roughly 400 words. The planning Project already has the synced
docs; this is not the place to re-derive them.

```markdown
## squid-ink — handoff <YYYY-MM-DD>

**Deployed:** <what production is running — commit sha + one line, or "unverified — Vercel not checked this session">
**Repo:** <clean / N uncommitted files> · <in sync with origin/main / N unpushed>
**Gates:** <build / typecheck / test — real result, or "not run this session">
**Checks:** <check-docs.mjs — clean, or N findings, or "could not run (exit 2)">

### Shipped since last handoff
- <one line per batch, with the measured figure that matters>

### This session
- <3-6 bullets: what was asked, what was decided, what was rejected and why>

### Open now
- <what is genuinely open, from the KNOWN_GAPS.md heading grep — measured only>
- <every check finding, one line each: which figure or token drifted and which file is wrong. Omit the line entirely when the script exits 0.>

### Needs the user, not more code
- <visual sign-off, a copy or naming decision, anything flagged as the owner's call>
- <"Run `doc-audit`" if the script reported drift this run>

### Reserved — do not brief around these blind
- <the locked token set, the three typefaces, the flat-components rule, the 400-line ceiling, the locked app name, and the Supabase rules: publishable key only in app code, four per-operation RLS policies, never filter on user_id in application code>
```

## Rules for the block

- **Every claim measured.** If a figure was not verified this run, verify it now
  or leave it out. Never carry a number forward from memory.
- **Rejections are load-bearing.** The planning Project writes the next brief.
  Telling it what was considered and rejected is what stops it re-proposing
  that, and it is the highest-value part of the block.
- **Name the reserved systems, quoting `CLAUDE.md` as it stands this session.**
  The token set, the three typefaces and the naming rule are the ones a new
  brief will trip over first. `CLAUDE.md` is already in context — read the rule
  from it, do not restate it from this file. **Rules move.** The naming rule was
  "no app name anywhere in code" until 2026-09-07 and is now "Squid Ink, locked";
  this skill went on saying "the no-app-name rule" until 2026-09-09. A rule
  copied into a skill is a rule that stops tracking its source.
- **Read which surfaces are built off the ROADMAP status line, never off this
  file.** `design-reference/App Surfaces.dc.html` holds ten surfaces (01
  dashboard, 02 recorder, 02b record HUD, 03 personas, 04 auth, 05 onboarding,
  06 settings, 07 collections, 08 share, 09 live assistant, 10 newsprint
  light). **How many are built changes; the count does not live here.** Run the
  `sed -n '1,15p' docs/ROADMAP.md` above and quote what it says. Report an
  unbuilt surface as scope creep only when the session touched one the status
  line does not list as built — and say so loudly then.

  This bullet used to name a frozen count. It said "none built and none in
  scope" on 2026-09-09, when three were built and the ROADMAP said so, and a
  handoff reported a shipped surface as scope creep on the strength of it. A
  number written into a skill is a number nobody re-checks.
- **No hedging, no filler.** "Note Detail shipped, 20 tests passing" or "Note
  Detail is uncommitted" — never "Note Detail is essentially done".
- **No attach-list.** The planning Project gets its files from the GitHub
  connector. If a doc changed in the repo, the user clicks "Sync now" — do not
  print a file list, and never tell the user to re-upload anything.
