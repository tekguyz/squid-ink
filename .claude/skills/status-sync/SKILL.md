---
name: status-sync
description: Audit this repo's real state — check-docs.mjs output, git state after a fetch, and the open GitHub issues plus the pinned tracking issue — and report what is genuinely open, ending with 2-3 next-step candidates and one recommended pick. Reads check-script output, never whole documents. Use when the user asks for a status sync, a handoff, "where are we", or "what's next".
---

# Status sync for `squid-ink`

This repo's state lives in four places: `scripts/check-docs.mjs` (countable
claims), `git` (what happened), GitHub Issues (open work) and `CLAUDE.md`
(standing rules). This skill measures all four and reports what is open.

**`docs/KNOWN_GAPS.md` is frozen since 2026-09-23.** Every open item in it moved
to an issue that day, and a pinned tracking issue holds the order. The file is
now a record of decisions and measurements. It is not the open-work list — do
not read it for "what is open" or "what is next".

**That is the whole job.** It prints no paste block and produces no message for
another tool. Nothing is pasted into a Claude.ai Project any more — see
`C:\Projects\tekguyz-one\docs\adr\0001-retire-the-claude-ai-project-loop.md`.

**There is deliberately no `STATUS.md` here and this skill must never create
one.** Status lives in `CLAUDE.md`, GitHub Issues and `git log`. A
sibling repo consolidated all three into one status file and it reached 734
lines.

## Which session to run this in

**Run it in the session that did the work, whenever there was work.** A fresh
session is cheaper — it starts with an empty context, which is why the reading
budget below exists — but it can only read `git log`. It did not watch anything
get decided, and it did not watch anything get rejected.

Rejections are load-bearing in the findings for the same reason they were in the
old paste block: they are what stops the next session re-proposing an option
already ruled out, and a session that was not there cannot write them. On
2026-09-09 a same-session report carried four rejections; a fresh one would have
carried none.

So:

- **Work happened in this chat** — a feature, a fix, a decision, an argument
  settled: run it here.
- **No work happened, you just want the state** — a plain "where are we": a
  fresh session is fine and costs less. Say `no work in this session — state
  only` rather than inventing content for it.

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
  the surface count. See the surface rule under "Rules for the findings".
- **For open work, list issue *titles and labels*, not bodies.** Use:

  ```bash
  gh issue list --state open --limit 100 --json number,title,labels --jq '.[] | "#\(.number) \(.title) [\([.labels[].name]|join(","))]"'
  ```

  That returns every open issue on one line each — 2.7 KB for 29 issues,
  measured 2026-09-24. Then read the pinned tracking issue, which holds the
  order and the "next" list:

  ```bash
  gh api graphql -f query='{repository(owner:"tekguyz",name:"squid-ink"){pinnedIssues(first:5){nodes{issue{number title}}}}}' --jq '.data.repository.pinnedIssues.nodes[].issue | "#\(.number) \(.title)"'
  gh issue view <pinned-number> --json body --jq .body
  ```

  Find the pinned issue by that query each run. Do not trust a number written
  here. Open a single issue with `gh issue view <n>` only when the findings need
  its body. A tracking-list box can lag its issue: when they disagree, the
  issue's own state wins, and the mismatch is a finding.

  **Do not grep `docs/KNOWN_GAPS.md` for open work.** It is frozen, and its
  headings are closed or moved. That grep is what this skill did before
  2026-09-23.
- **Never read `docs/_archive/*` for current state.** It is superseded material
  kept as a record — the retired Superpowers plans and specs archived 2026-09-20
  among it — and by design it contains claims that are no longer true. Open one
  only when the user names it.
- **Never repair a doc here.** If the script reports drift, name it in the
  findings and tell the user to run `doc-audit`. Repair is that skill's job,
  and the commit of a repaired doc belongs to that skill too — this skill
  commits nothing.

If the script exits `2`, it **could not run** and is not a pass. Say so; do not
treat silence as clean.

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
   measured-looking claim, which is the worst kind these findings can carry.
3. `git status -sb` and `git diff --stat`, **after the fetch**. Report three
   states separately and never merge them:
   - **uncommitted in the working tree** — not shipped, say so explicitly;
   - **ahead of origin** — committed here, not pushed, invisible to the other
     laptop and to Vercel;
   - **behind origin** — work exists that this machine has not pulled. Say
     "behind origin/main by N commits — run `git pull` before working here",
     and do NOT describe the tree as current. Pushed is still not deployed.
4. Open GitHub issues and the pinned tracking issue, by the two commands above.
5. `CLAUDE.md` rules, from context.

`main` auto-deploys to Vercel (`tekguyz/squid-ink`,
`https://squid-ink.vercel.app`). Check it with
`vercel ls squid-ink --scope tekguyz` and report what it says, or report the
deploy as not checked. A push is not proof the build went green.

Gates (`npm run build`, `npm run typecheck`, `npm test`) only if the findings
will claim something is done. Otherwise report them as not run.

## Rules for the findings

- **Every claim measured.** If a figure was not verified this run, verify it now
  or leave it out. Never carry a number forward from memory.
- **Rejections are load-bearing.** The next session writes the next brief.
  Saying what was considered and rejected is what stops it re-proposing that,
  and it is the highest-value part of the report.
- **Name the reserved systems, quoting `CLAUDE.md` as it stands this session.**
  The locked token set, the three typefaces, the flat-components rule, the
  400-line ceiling, the locked app name, and the Supabase rules — publishable
  key only in app code, four per-operation RLS policies, never filter on
  `user_id` in application code — are the ones a new brief will trip over
  first. `CLAUDE.md` is already in context: read the rule from it, do not
  restate it from this file. **Rules move.** The naming rule was "no app name
  anywhere in code" until 2026-09-07 and is now "Squid Ink, locked"; this skill
  went on saying "the no-app-name rule" until 2026-09-09. A rule copied into a
  skill is a rule that stops tracking its source.
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
  status report called a shipped surface scope creep on the strength of it. A
  number written into a skill is a number nobody re-checks.
- **"Next" costs no extra reading, and that is the constraint that shapes it.**
  Derive the candidates from what this run already gathered and nothing else:
  the unbuilt surfaces the ROADMAP status line names, the open issue list, and
  the pinned tracking issue's order. Take candidates from the top of its "next"
  section first. Opening a document to pick a next step is the budget breach
  this skill exists to prevent. If the sources already in hand do not support a
  recommendation, write `no clear next — the user should choose` and stop; that
  is a valid answer, not a failure.

  **Name candidates, never a roadmap.** Two or three, one pick, and no ordering
  beyond the pick. A candidate must be ready *now*: an open issue whose blocker
  is still open, or that the tracking issue says needs a decision first, is not
  a candidate, it is open work. Give each candidate its issue number and its
  `size:` label, because the label says which workflow runs it.

  **Never carry a candidate list forward, and never write one into this file.**
  The pick is measured off this run's output, the same as every figure. The
  surface-count bullet above is what happens when a skill freezes something that
  moves; a next-step list moves faster than a count does.
- **Verify before recommending, when the claim is "already built".** A feature
  can be shipped and hardened while a planning doc still reads as though it is
  queued — on 2026-09-15 the chat feature had shipped on 2026-09-03, with two
  verify scripts passing, while `docs/ROADMAP.md` §4 still described its
  composer in the future tense. If a candidate looks like it might already
  exist, run its verify script and grep for its entry point before naming it as
  next; recommending work that is already done is the most expensive mistake
  this skill can make.
- **No hedging, no filler.** "Note Detail shipped, 20 tests passing" or "Note
  Detail is uncommitted" — never "Note Detail is essentially done".

## Reporting back

A short answer in the response. No file, no fenced block, no template.

Cover, in this order, and leave out any line with nothing measured behind it:

- **Deployed** — what production is running, or "unverified — Vercel not checked
  this session".
- **Repo** — clean or N uncommitted files, and in sync / N ahead / N behind.
- **Gates** and **checks** — the real result, or "not run this session".
- **Shipped since the last sync**, one line per batch with the figure that
  matters.
- **This session** — what was asked, what was decided, what was rejected and
  why.
- **Open now** — from the issue list, measured only, plus every check finding
  one line each. Omit the check lines entirely when the script exits `0`.
- **Next** — 2-3 candidates, one line each, then the pick and the half-sentence
  reason.
- **Needs the user, not more code** — a visual sign-off, a copy or naming
  decision, or "run `doc-audit`" when the script reported drift this run.
