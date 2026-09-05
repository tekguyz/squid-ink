# Squid Ink — PRD + Technical Roadmap

**Status:** Blueprint complete, and the §8 MVP chain is **built** — recorder,
Gemini transcription, structured note generation, Voyage embeddings and Claude
ask-your-notes chat all ship, on Supabase auth and Note Detail. Claude Design
in progress — Recorder UI resolved (hybrid HUD + full-app); the ten surfaces in
`design-reference/App Surfaces.dc.html` remain unbuilt. 2026-08-30
feature-triage backlog fully disposed: promoted into phases below, or rejected
(see §7).

**This file is a PLAN, not a shipping log.** What is built is recorded in
`CLAUDE.md`; what is deliberately not built is in `docs/KNOWN_GAPS.md`; what was
decided or rejected is in `docs/DECISIONS.md`. A phase listed below is scope,
and says nothing either way about whether it has shipped.

**Last updated:** 2026-09-05 (status line rewritten — it read "Blueprint
complete. Claude Design in progress" from before any code existed, which read
as though nothing was built. The phases below are unchanged and were re-checked
against the tree that day: nothing shipped since 2026-09-03 contradicts them.
Header previously corrected 2026-09-03, when it read 2026-08-30 while §5 and §8
already carried amendments dated 2026-09-01 and §4's schema snippet had been
superseded; see the dated notes in those sections).

---

## 1. What this is

A full rewrite: a bot-free AI meeting notepad. System/mic audio capture, no
bots joining calls, rough notes + transcript merged into structured output,
ask-your-notes chat, calendar sync, optional live spoken assistant.
Positioned as a materially better version of Granola — same core loop,
better personas system, better design, better docs/brand.

The prior build is fully discarded. No data migration, no code audit, no
legacy users (owner's second account + one friend only). The only carryover
is the feature inventory and product philosophy (dense over noisy,
truth-first, no AI fluff). App naming is unconfirmed as of 2026-08-30 —
working name **Squid Ink** used internally; a prior note recorded
"Crispy Bacon" as locked (2026-08-29), since reopened. Visual identity,
logo/icon system, copy, and docs get a full redesign with zero carryover
from the prior build regardless of what the app is ultimately named.

**Single-owner, indefinitely.** No organizations/workspace layer, no admin
roles, no seats. See DECISIONS.md "Multi-tenancy" for the retrofit cost if
this is ever revisited — it's bounded/additive, not a rewrite, but it is not
being built now and nothing here should assume it.

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js | Team fluency + Vercel fit |
| Styling / tokens | Tailwind v4, CSS-first `@theme` tokens | Single source of truth for design tokens (colors, type) — see DECISIONS.md "Frontend engineering conventions" for the locked token values and the defect this closes |
| Hosting | Vercel (Fluid Compute) | 300s default duration on all plans, 800s Pro/Enterprise — the actual cause of the prior build's timeout failures (Netlify Functions' 10s cap) doesn't carry over |
| DB / Auth | Supabase | Already decided; RLS for owner-only access |
| Vector store | Supabase pgvector | No new infra |
| Async jobs | Enqueue + `processing_status`, worker likely runs as a Vercel Function given Fluid Compute headroom | Kept even though the hard timeout forcing-function is gone — resilience/UX pattern, not just a timeout workaround |
| Client state | Zustand (ephemeral UI: drawers, recorder HUD/dock, filters) + Supabase Realtime (`processing_status` pushes) | Avoids defaulting to TanStack Query; add it only where optimistic client-side mutations are genuinely needed (e.g. chat streaming) |
| App shell | PWA (manifest + service worker) | Installable, offline shell caching of loaded notes, push on job completion. Does not provide OS-level global hotkeys — that needs a native shell, which is out of scope |
| Payments | None | Explicitly out of scope |

## 3. Model / vendor split

| Surface | Vendor | Why |
|---|---|---|
| Batch transcription (incl. diarization, word timestamps) | Gemini 3.5 Transcribe | Native diarization + timestamps at no extra cost; no latency pressure on this path |
| Multimodal ingestion (docs, links, images) | Gemini 3.7 Flash | Cheap, multimodal, already-owned key |
| Structured note generation, fact-grounding, summarization | Gemini 3.7 Flash only — no Pro (confirmed 2026-09-01, see §5) | High-volume, runs on every recording — cost-sensitive by default; depth varies `thinking_level` + prompt scope, not model |
| Ask-your-notes chat (RAG + tool use, single-note or cross-note) | Claude (Sonnet/Opus) | Quality-sensitive, tool-chain reliability, low volume (user-initiated) |
| Live voice assistant reasoning | Claude (Sonnet/Opus), orchestrated via Vapi | Claude has no native audio I/O (confirmed current as of Aug 2026 — text/image only); Vapi handles the STT+TTS glue and bills per-call, avoiding the per-open-session Gemini Live cost spiral seen previously |
| Live voice assistant TTS | Vapi default, or Eleven Labs for a distinct branded voice | Eleven Labs optional, not load-bearing |
| RAG embeddings | Voyage AI (`voyage-4`) — **confirmed** | Anthropic's recommended pairing for Claude-consumed retrieval; $0.06/1M, 32K context. Read `voyage-3-large` until 2026-09-03; that model is now Voyage's legacy tier at $0.18/1M with no free allowance, so only the name here was stale — the $0.06 figure was already `voyage-4`'s. See DECISIONS.md § RAG |

Claude Code is the **build tool only** — no runtime role in the shipped app.

Data handling: paid Gemini/Vertex and Claude's commercial API are not used
for model training by default. The original key was created in the free Google AI
Studio tier, which is — confirm the current key is billed before real meeting
content flows through it (see DECISIONS.md "Data handling").

## 4. RAG design

**Chunking** — multi-granularity, not one-size:
- Structured chunks: one per summary / takeaway / action item.
- Transcript-segment chunks: ~500–800 tokens, ~15% overlap, tagged with
  speaker (from diarization) + timestamp — backs the fact-grounding /
  "cite the source span" requirement.

**Schema** — design intent, **not the shipped table.** Noted 2026-09-03:
`supabase/schemas/note_chunks.sql` is the source of truth and its own header
says its columns are "tightened against the ROADMAP snippet". The shipped table
adds a nullable `persona_id` whose foreign key is **composite** against
`personas (id, user_id)`, and `note_id`/`user_id` are likewise tightened. Read
the snippet below for the chunking intent, never for column shapes.

```sql
create table note_chunks (
  id uuid primary key default gen_random_uuid(),
  note_id uuid references notes(id) on delete cascade,
  user_id uuid references auth.users(id),
  chunk_type text check (chunk_type in
    ('summary','takeaway','action_item','transcript_segment','imported_doc')),
  content text not null,
  embedding vector(1024),
  metadata jsonb,          -- {speaker, ts_start, ts_end, source_url, seq}
  created_at timestamptz default now()
);
create index on note_chunks using hnsw (embedding vector_cosine_ops);
create index on note_chunks using gin (to_tsvector('english', content));
```
RLS: `user_id = auth.uid()`, matching the existing owner-only model. Because
RLS is scoped to `user_id`, not `note_id`, **cross-note retrieval already
works with no schema change** — see "Cross-note chat" below.

**Retrieval:** hybrid — vector cosine similarity + Postgres full-text,
combined via reciprocal rank fusion. Pure embedding similarity misses proper
nouns / dollar figures / dates reliably enough in meeting content that this
isn't optional. **Custom AI dictionary** (Core UX/UI): a user-maintained
glossary of company jargon, brand names, and project/client names, injected
as context into both the transcription call and the structured-note-gen
call — attacks this exact proper-noun gap upstream, before it ever reaches
retrieval.

**Cross-note chat** (Core UX/UI): the note-detail composer currently reads
"Ask this note…" — add an "ask all notes" mode alongside it. No retrieval
architecture change (RLS already permits it); the work is a scope toggle in
the query and including note title/date in returned chunk metadata so
multi-note answers can cite *which* meeting supports each claim.

**Single-note vs cross-note retrieval, added 2026-09-03 — supersedes the "single-note and cross-note" RAG framing above.** Single-note chat skips retrieval entirely: raw transcript + generated notes go directly into context with a 5-minute `cache_control` breakpoint. Cross-note chat is the only consumer of hybrid RRF search, implemented as a non-`SECURITY DEFINER` Postgres function (`search_note_chunks`) so RLS on `note_chunks`/`notes` does the owner-scoping. Candidate pool: `WHERE created_at > now() - interval '90 days' ORDER BY created_at DESC LIMIT 25` — one clause, naturally yields whichever bound is smaller. Result cap: 25 chunks post-RRF, always.

**New table: `chat_messages`.**
```sql
create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('user','assistant')),
  content text not null,
  scope text check (scope in ('this_note','all_notes')),
  metadata jsonb,
  created_at timestamptz default now()
);
create index on chat_messages (note_id, created_at);
```

RLS: `user_id = auth.uid()`, matching every other owner-scoped table.

**As shipped, tightened against the snippet above.** `user_id` carries
`on delete cascade` (without it a deleted account leaves rows that fail every
RLS predicate — invisible and undeletable), `metadata` is
`not null default '{}'::jsonb` to match `note_chunks`, and there is a second
index on `(user_id, created_at)` because the rate limit counts the caller's
rows in the last 60 seconds on every send. `service_role` is granted nothing:
no cron job touches this table.

**Speaker tags** (Core UX/UI): the note-detail mockup already renders real
speaker names (avatar + name in the transcript pane), not generic "Speaker
1/2" — so the UI assumption is already correct. What's missing is the
backend mapping: manual rename of a diarized label for now. Calendar-
attendee auto-match (confidence-based, falling back to manual) is an
Advanced-phase addition once calendar sync exists (§8).

**Speaker diarization:** **on by default, auto-disabled per-recording past
~28 minutes** (safety margin under Google's 30-min diarized-file cap),
falling back to plain transcript — no manual toggle. Not a cost issue,
confirmed twice over: general per-minute pricing, and the reviewed March
2026 GCP bill for the prior build, where every audio-related line item
combined totaled $0.15 for the month. Google's own docs still mark speaker
attribution "experimental" for 3+ speakers; accepted for now since real
usage tops out at 3 people and reliability is expected to improve. Raw
transcript is always retained regardless of diarization outcome (matches
past practice).

**Long recordings:** Gemini 3.5 Transcribe caps files at 60 minutes plain /
30 minutes diarized. Owner's own meetings stay under that, but the product
should assume other users won't — recordings exceeding the cap need to be
segmented into chunks, transcribed separately, and stitched (with the
caveat that diarization labels aren't guaranteed consistent across segment
boundaries without extra reconciliation work). Add to MVP scope if the
product targets anyone beyond the owner; otherwise Core UX/UI phase is soon
enough.

Cross-meeting persistent speaker identity remains **out of MVP scope**
regardless — biometric-adjacent data, needs its own consent-flow design.
(Voice-fingerprint enrollment, if ever pursued, is an implementation method
for this same deferred feature, not a separate one.)

## 5. Personas (new feature, replaces Granola's split Templates/Recipes)

A **Persona** is one named preset bundling:
1. **Lens** — whose expertise frames the analysis (e.g. Sales Coach,
   Investor, Engineering Lead, Neutral Analyst).
2. **Depth/goal** — Brief / Dense / Exhaustive, replaces the prior build's separate
   DepthToggle + GoalSelector. **Resolved 2026-09-01: single-model MVP, no
   Gemini Pro anywhere** — Flash's `thinking_level` parameter covers the
   reasoning-depth range Pro was reserved for at materially lower cost.
   **Corrected 2026-09-03:** the SDK union is
   `"minimal" | "low" | "medium" | "high"`, four values, not the three this
   line named; `lib/notegen/depth-policy.ts` maps Brief/Dense/Exhaustive to
   low/medium/high and leaves `minimal` unused. The casing is load-bearing and
   is recorded in CLAUDE.md § Note generation, not here — the lowercase union
   belongs to the `interactions.create` surface this project calls, while the
   SCREAMING_CASE `ThinkingLevel` enum belongs to `models.generateContent` and
   is a 400 here. Depth varies **scope, not just length**:
   Exhaustive does more analytical work (cross-referencing, deeper
   action-item inference); Brief and Dense are narrower cuts of the same
   extraction, not shorter versions of Exhaustive.
3. **Quick-actions** — bundled recipe-equivalents specific to that lens.
   Concrete built-in set to design against (Core UX/UI): *Extract decisions
   only*, *Timeline of blockers*, *Unanswered questions*, *Diff against
   last call*, plus **draft-follow-up actions per lens** — client email
   (Sales Coach / Investor), Slack message (general/Neutral), Jira ticket
   (Engineering Lead).

Default persona: neutral/dense, matching existing product philosophy.
MVP ships with a handful of built-in personas. User-authored custom personas
are a later phase, not MVP.

Persona edits apply to new notes only — no post-hoc regeneration of past
notes. Considered and rejected 2026-08-30 (see DECISIONS.md): ask-your-notes
chat already answers persona-shifted questions on demand without paying for
a redundant Gemini re-run.

Interactive action-item drawers (Core UX/UI): the `action_item` chunk type
already exists in the schema — expanding checkbox items into a drawer with
owner, due date, priority, and execution notes is an added-fields change,
not a new pipeline.

**Structured note generation — resolved 2026-09-01.** One Gemini call per
note, taking lens + depth together; quick-actions are lens-gated
afterward, not a second call. Input is the text transcript only
(`raw_transcript` + `note_chunks`), not the source audio — audio-native
input is named as a future option for Sales Coach specifically (tone/
sentiment on a prospect call), not built or scheduled. Generation chains
automatically once transcription reaches `'completed'`; the recorder's
manual Transcribe-button trigger is unchanged.

## 6. Feature inventory — keep / redesign / new

| Feature (prior-build origin) | Disposition |
|---|---|
| Recorder (system/mic capture, no bots) | Keep, redesign UI — **hybrid**: persistent record HUD (ambient trigger, not calendar-gated) + full-app editor for the actual note |
| Import (links/text/Drive) | Keep, redesign UI |
| Dashboard / feed | Keep, redesign UI |
| Per-note detail + chat | Keep, redesign UI, chat now Claude+RAG, single-note and cross-note modes |
| Collections / tags | Keep, redesign UI |
| Share links | Keep, redesign UI, **add share-preview / OG image** and **guest link controls** (revoke, expiry, per-link transcript override) |
| Settings / onboarding | Keep, redesign UI |
| Live assistant | Keep, rebuilt on Vapi + Claude (was Gemini Live); silent-by-default overlay, speaks only on explicit user action |
| Personas | **New** (replaces nothing directly; see §5) |
| Speaker tags | **New** — real-name mapping over diarized labels (manual, then calendar-assisted) |
| Action-item drawers | **New** — owner/due-date/priority/notes on existing action items |
| Export (Markdown/JSON) | **New** |
| Webhooks | **New** — meeting-completion payload to a custom endpoint |
| MCP bridge | **New** — expose the ask-your-notes RAG tool to Claude Desktop / other MCP clients |
| Real-time PII redaction | **New** — regex pass before transcript reaches Gemini/Claude |
| Profile context box | **New** — baseline role/team context, complements Personas |
| PWA | **New** — installable, offline shell cache, job-completion push |
| App name | **Unconfirmed** — naming reopened 2026-08-30; working name Squid Ink; no other prior-build branding carries over regardless |
| Brand identity (logo, icons) | **New** — total redesign, no carryover from the prior build |
| Docs / copy | **New** — none of the prior build's existed as a real deliverable |

## 7. Explicit out of scope

- Payments / Stripe, anywhere.
- Data, user, or auth migration from the prior build.
- Google OAuth tied to login (stays a separate "Connect Calendar/Drive"
  action per existing locked decision).
- Cross-meeting speaker identity, including voice-fingerprint enrollment
  (deferred, see §4).
- Multi-tenant/team workspace features — decided against indefinitely, not
  just deferred. See DECISIONS.md "Multi-tenancy" for retrofit cost if ever
  revisited.
- OS-level global hotkeys / any native (Electron/Tauri) shell.
- Local-first/offline recording with on-device transcription — needs its
  own ASR + sync engine, doesn't match current scale.
- Sentiment/cultural-health dashboards — requires multi-tenancy (rejected
  above) plus data sources (Slack/email) not in this architecture.
- Custom edge-ML background-noise masking — solves a cost problem already
  disproven (§8a, $0.15/mo total audio spend); browser `noiseSuppression:
  true` is the free equivalent if audio *quality*, not cost, ever becomes
  the actual issue.

## 8. Roadmap

**MVP** — Next.js/Vercel/Supabase skeleton, auth (Supabase email/magic-link,
Google OAuth as separate connect action), recorder → Gemini transcription
(diarized by default under ~28 min, auto-fallback past that) → Gemini
structured notes → pgvector index → Claude ask-your-notes chat, core
dashboard/feed, default neutral persona only. Recorder is a first-class
ad-hoc entry point — not calendar-gated.

## 8a. Cost picture (validated against real usage)

Reviewed the prior build's actual March 2026 GCP bill: **$13.32 total for
the month**, 78% of it Gemini 3 Pro text tokens, audio-related line items
combined totaling $0.15. This rebuild routes the high-volume path to Flash
instead of Pro, so real costs should land at or below this baseline — the estimate
below is consistent with, not a correction of, that real data.

| Item | Est. cost |
|---|---|
| Transcription (Gemini 3.5 Transcribe, ~$0.005/min) | ~$11/mo |
| Embeddings (Voyage, $0.06/1M tokens) | Effectively free (<$0.01/mo) |
| pgvector storage/search | $0 — bundled in existing Supabase plan |
| Structured note generation (Gemini 3.7 Flash) | Low, usage-based |
| Ask-your-notes chat + live voice reasoning (Claude) | Low, usage-based — only runs when the user actively chats/talks |
| Hosting (Vercel/Supabase) | Likely free-to-low tier at this scale |

No line item here is a paid "RAG service" — pgvector is free infrastructure
you already have; the only recurring RAG-specific cost is the embedding call,
which is a rounding error at this volume.

**Core UX/UI** —
- Claude Design pass (full visual + brand identity, no carryover from the prior build)
- Personas (initial set): built-in personas, Quick Actions incl. draft-follow-up types,
  Exhaustive depth as `thinking_level: high` + wider prompt scope on Flash
  (**amended 2026-09-01** — this line read "Exhaustive-depth → Gemini Pro
  routing"; §5 resolved that to a single model on that date)
- Interactive action-item drawers (owner/due date/priority/notes)
- Collections/tags
- Share links + OG preview + guest link controls (revoke/expiry/per-link
  transcript override)
- Settings/onboarding polish
- PWA (manifest, service worker, job-completion push)
- Speaker tags (manual rename of diarized labels)
- Custom AI dictionary (glossary injected into transcription + note-gen)
- Profile context box (baseline role/team context)
- Real-time PII redaction (regex pass pre-Gemini/Claude)
- Cross-note ask-your-notes mode ("ask all notes" toggle)
- Markdown/JSON export
- Local Backup Audio Buffer, full version (encrypted 48h local retention)

**Advanced** —
- Live voice assistant (Vapi + Claude)
- Custom user-authored personas
- Calendar sync, including the Coming-Up schedule hub and pre-meeting prep
  notes attached to a future calendar event
- Calendar-attendee auto-match for speaker tags
- In-line context timeline bar (waveform + speaker coloring — depends on
  speaker tags shipping first)
- Webhook triggers (meeting-completion JSON payload to a custom endpoint —
  needs auth/retry/rate-limit design)
- MCP bridge (needs its own auth/scoping design; reuses the ask-your-notes
  RAG tool machinery rather than building new retrieval)
- Docs/media asset finalization
- Cross-meeting speaker identity, with consent flow, if still wanted

## 8b. MVP hardening / QA edge cases

Not roadmap phases — required test coverage regardless of what else ships,
flagged during 2026-08-30 feature triage:

- **Audio device handoff.** Mid-session Bluetooth→built-in-speaker (or
  reverse) switch must not drop the recording or produce distorted/robotic
  audio. Handle `devicechange` and restart the affected track cleanly.
  Test explicitly before ship — this is a common real scenario, not an
  edge case.
- **Echo with no headphones.** System + mic capture running simultaneously
  without headphones risks duplicate/echoed transcription. Baseline is the
  browser's native `echoCancellation: true` constraint; test the no-
  headphones scenario specifically rather than assuming it's covered.
- **Local backup buffer, light version.** Don't discard the local audio
  blob until `processing_status` reaches `completed` — cheap retry-safety
  ahead of the full encrypted 48h buffer (Core UX/UI, above).

## 9. Resolved items

1. **Brand/name direction** — recorded 2026-08-29 as "Crispy Bacon retained,
   naming only," then reopened by the owner 2026-08-30. **Unconfirmed as of
   this update** — working name Squid Ink used internally. Visual identity,
   logo/icon system, and all other brand assets remain a full redesign with
   zero carryover from the prior build, independent of what the app is
   ultimately named.
2. **Multi-tenancy** — resolved 2026-08-30. Staying single-owner/solo
   indefinitely; no organizations/workspace table. Any team-switcher-style
   UI in early Claude Design mockups is cosmetic scaffolding, not scope.
3. **Recorder UI shape** — resolved 2026-08-30. Hybrid: persistent record
   HUD as the ambient trigger, existing full-app pane as the editor.
4. **Live assistant speak/write** — resolved, matches Claude Design surface
   09: silent-by-default overlay, speaks only on explicit user trigger.
5. **2026-08-30 feature-triage backlog** — fully disposed. All items either
   promoted into MVP/Core UX/UI/Advanced (§8) or explicitly rejected (§7).
   Nothing left pending.
