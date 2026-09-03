# Squid Ink: Decisions Log
 
Working state as of 2026-08-30. Update this file as decisions change — don't
let it drift from reality.
 
## What this project is
 
Rebuilding Squid Ink: a bot-free AI meeting notepad (Granola-style, aiming
to beat it) — system/mic audio capture, no bots joining calls, rough notes +
transcript merged into structured output, ask-your-notes chat, calendar
sync, optional live spoken assistant.
 
The prior build was vibe-coded in Google AI Studio a year ago (React 18/Vite/TS →
Netlify, Supabase, Gemini). Repo: https://github.com/tekguyz/crispy-bacon.
KB docs (VISION, ARCHITECTURE, PROJECT_STRUCTURE, INTELLIGENCE, SECURITY,
INDEX) describe the prior build's design and are kept only for the feature
inventory — its code and visual brand are being discarded. The app name is
a separate, still-open question (see Branding below).
 
## Locked decisions
 
**Scope of rewrite**
- Full rewrite. All data, users, auth, and audio from the prior build get
  discarded — no migration path to design around. Its only "users" were the
  owner's own second account and one friend; Stripe was sandbox only.
- No payments/Stripe anywhere in this rebuild.
- No code audit of the prior build — it's being discarded, so auditing dead
  code is wasted effort. The useful artifact from it is the feature
  inventory (see below), not the code.
- Branding: app name is **unconfirmed** (as of 2026-08-30). Working name
  **Squid Ink** is used internally for code, repo, and this doc. A prior
  note recorded the name as locked to "Crispy Bacon" (2026-08-29) — that
  has since been reopened by the owner and should not be treated as
  decided. Visual identity is 100% total redesign regardless of naming: no
  carryover of the prior build's visual language ("Organic"
  cream/rust-orange/Newsreader), logo, icons, copy, or docs. Design starts
  fresh in Claude Design, no KB-doc import.
**Multi-tenancy**
- Confirmed 2026-08-30: **staying single-owner/solo indefinitely.** No
  organizations/workspace table, no admin roles, no seats.
- The team-switcher pattern that appeared in early Claude Design mockups
  ("FINTORY · 3 MEMBERS") was cosmetic scaffolding borrowed from reference
  screenshots for layout purposes only — strip it before Claude Code
  prompt-packs. Don't build backend or RLS against it.
- Retrofit cost if ever revisited (not being built now, reference only):
  bounded/additive, not a rewrite — `organizations` + `organization_members`
  tables, nullable `notes.organization_id`, RLS extended to
  `user_id = auth.uid() OR organization_id IN (member orgs)`, invite flow
  reusing existing magic-link auth. Main risk is RLS test coverage
  (a multi-tenant RLS bug leaks across owners; a solo-RLS bug is invisible),
  not the schema change itself.
**Auth**
- Supabase email/magic-link auth as primary identity. Google OAuth is a
  separate "Connect Calendar/Drive" action in settings, not tied to login —
  removes the "unverified app" warning from the login flow entirely. Warning
  still appears once at connect-time (GCP consent screen in Testing status);
  for <5 known users, adding them as test users is the cheap fix, not full
  verification.
- **Magic-link flow was broken from Prompt 2 through early Prompt 3,
  undetected.** `app/auth/confirm/route.ts` only handled the `token_hash`
  shape (a custom `{{ .TokenHash }}` email template). Supabase's *default*
  email template routes through `/auth/v1/verify` and returns a PKCE
  `?code=` instead, so every real magic link landed on
  `/login?error=missing_token`. Nothing caught it earlier because RLS
  verification used password-grant JWTs (`scripts/verify-rls.mjs`), not a
  clicked email link, and working sessions in dev were already cookied.
  Fixed mid-Prompt-3 (commit `ddaef6b`): the route now exchanges a `code`
  for a session, keeps the `token_hash` path working too, and no longer
  reports an expired link as a missing token. **Confirmed live and working
  end-to-end by the owner post-fix**, on `https://squid-ink.vercel.app`.
**Frontend + hosting**
- Next.js + Vercel. Netlify is out. Root cause of the prior build's sync-processing
  failures was Netlify Functions' 10-second timeout (and no WebSocket
  support) — not React, not the framework choice generally.
- Vercel Fluid Compute (300s default duration on all plans, 800s on
  Pro/Enterprise, Vercel Workflows beyond that) likely removes the need for
  a separate always-on worker host that the prior build's failure implied. Still keeping
  the enqueue/`processing_status` async pattern for UX resilience regardless
  of host limits — The prior build's schema already used
  `local → uploading → analyzing → completed`, just needs a real worker
  behind it.
**State management** — confirmed 2026-08-30
- **Zustand** for ephemeral client UI state: drawers, recorder HUD/dock
  state, dashboard filters, split-screen/timeline toggles.
- Data fetching via **Next.js Server Components/Server Actions** for
  loads/mutations, and **Supabase Realtime** subscriptions to push
  `processing_status` changes — not polling.
- **TanStack Query is not a default dependency.** Add it only where
  client-side caching or optimistic mutations across route boundaries are
  actually needed (e.g. ask-your-notes chat streaming). Don't reach for it
  by default on every fetch.
- **What actually shipped is a poll, not Realtime — noted 2026-09-03.** The
  decision above is unchanged and still the target; no Realtime subscription
  exists anywhere in the tree. `components/note-detail/use-transcription-poll.ts`
  (2026-09-01) is a **bounded** poll of ONE row — 5 s interval, 10-minute cap,
  only on the note the reader has open — chosen because the latency is
  dominated by the Vercel Hobby cron schedule, so a subscription would be
  polishing the wrong end. Read the "not polling" line above as intent, not as a
  description of the code. Reasoning in docs/KNOWN_GAPS.md § "No Realtime push".
**Model / vendor split**
- Not vendor-locked to Google/Gemini. Split by task, not ideology:
  - **Gemini 3.7 Flash / 3.5 Transcribe** — the high-volume, per-recording
    pipeline: batch transcription, multimodal ingestion (docs/links/images),
    structured note generation, fact-grounding, summarization. Cheap,
    multimodal, already-owned key, no latency pressure on this path.
    **No Gemini Pro anywhere in this rebuild (confirmed 2026-09-01)** —
    Flash's `thinking_level` parameter (minimal/low/medium/high) covers the
    reasoning-depth range Pro was reserved for; see ROADMAP.md §5.
  - **Claude (Sonnet/Opus)** — the two lower-volume, quality-sensitive,
    user-initiated surfaces: ask-your-notes chat (RAG + tool use, single-
    note and cross-note) and the live voice assistant's reasoning layer.
  - **Vapi** — orchestrates the live voice assistant's STT+TTS, with Claude
    as the reasoning layer (officially supported integration). Bills
    per-call, which avoids the per-open-session Gemini Live cost spiral seen
  previously —
    this was the actual mechanism behind the original "not vendor-locked"
    call, not a blanket anti-Gemini stance.
  - **Eleven Labs** — optional, only if a distinct branded TTS voice is
    wanted later. Not load-bearing.
  - Claude has no native audio input/output (confirmed current as of Aug
    2026 — text/image input only). Claude Code is the build tool only — no
    runtime role in the shipped app.
**Data handling / training opt-out**
- Google's paid Gemini API / Vertex AI tier is not used to train models;
  the free Google AI Studio tier is. The original Gemini key was created in
  AI Studio a year ago. **Action item before real meeting content flows through this app:
  confirm the Gemini key in use is a billed/paid key, not the free AI
  Studio key.** Not legal advice — verify directly in the console. Claude's
  commercial API has the equivalent no-training default already.
- Real-time PII redaction (regex pass before transcript reaches Gemini/
  Claude) is promoted into ROADMAP.md Core UX/UI — see there for scope.
**Live voice assistant**
- KEEP. Rebuilt on Vapi + Claude (previously Gemini Live).
- Interaction model — resolved, matches the Claude Design mockup (surface
  09): the assistant proposes silently in an overlay card by default
  ("silent unless it can cite"), and speaks only on an explicit user
  action ("Say it"). It never speaks unprompted. No open call remaining
  here.
**RAG**
- Replacing the prior "last 10 chats via File API" approach with pgvector
  on Supabase —
  already on Supabase, vendor-agnostic, no new infra.
- Chunking: multi-granularity — structured chunks (one per summary /
  takeaway / action item) plus transcript-segment chunks (~500–800 tokens,
  ~15% overlap, tagged with speaker + timestamp) for verbatim/fact-grounding
  queries.
- Schema: `note_chunks` table, HNSW vector index + GIN full-text index,
  RLS on `user_id = auth.uid()` matching the existing owner-only model. Full
  schema in ROADMAP.md §4.
- Retrieval: hybrid — vector cosine similarity + Postgres full-text via
  reciprocal rank fusion. Pure embedding similarity misses proper
  nouns/dollar figures reliably enough that this isn't optional. Custom AI
  dictionary (Core UX/UI) attacks this upstream — see ROADMAP.md §4.
- RLS is `user_id`-scoped, not `note_id`-scoped, so cross-note retrieval
  already works without a schema change — promoted into ROADMAP.md Core
  UX/UI as an "ask all notes" mode.
- pgvector itself costs nothing extra — open-source Postgres extension,
  already bundled in the existing Supabase plan. The only recurring RAG cost
  is the embedding API call, which is a rounding error at this app's volume
  (well under $0.01/month at ~50 meetings/month).
- Embedding vendor: **Voyage AI `voyage-3-large`, confirmed** (was the open
  item, now closed).
**Cost — validated against real usage, not just estimated**
- Reviewed the prior build's actual GCP bill for March 2026: **$13.32 total
  for the month**. 78% of that was Gemini 3 Pro text tokens; every
  audio-related line item combined totaled $0.15. No Live-API session
  charges present in this snapshot.
- This doesn't cover the period ~a year ago when diarization was pulled for
  cost reasons (predates this bill), but it does confirm audio/diarization
  processing isn't a meaningful cost driver on current-generation pricing —
  best guess is that scare was really Gemini Live's per-open-session
  billing (the exact mechanism Vapi's per-call billing already fixes), not
  the diarization feature itself. Moot either way; not worth chasing
  further.
- This rebuild routes the high-volume path to Flash, not Pro, so real
  costs should
  land at or below this $13/month baseline.
**Speaker diarization & tagging**
- **On by default, auto-disabled per-recording past ~28 minutes** (safety
  margin under Google's 30-min diarized-file cap), falling back to plain
  transcript — no manual toggle needed. Not a cost issue, confirmed above.
  Google's own docs still mark speaker attribution "experimental" for 3+
  speakers; accepted for now since real usage tops out at 3 people. Raw
  transcript always retained regardless of diarization outcome (matches
  past practice of keeping the raw transcript alongside).
- Long recordings: Gemini 3.5 Transcribe caps files at 60 min plain / 30 min
  diarized. Owner's own meetings stay under that, but if the product ever
  has users beyond the owner, recordings exceeding the cap need segmenting,
  transcribing per-segment, and stitching — with diarization labels not
  guaranteed consistent across segment boundaries without extra work.
- **Speaker tags** (real names over diarized labels) promoted into ROADMAP
  Core UX/UI — manual rename now, calendar-attendee auto-match in Advanced
  once calendar sync exists.
- Cross-meeting persistent speaker identity, including voice-fingerprint
  enrollment as an implementation method: out of MVP scope entirely —
  biometric-adjacent data, needs its own consent-flow design if pursued
  later.
**Personas** (new feature, replaces Granola's split Templates/Recipes system)
- One named preset bundling three things Granola keeps as two confusing
  systems: (1) Lens — whose expertise frames the analysis (Sales Coach,
  Investor, Engineering Lead, Neutral Analyst...); (2) Depth/goal — replaces
  the prior build's separate DepthToggle + GoalSelector. **Confirmed
  2026-09-01: single-model MVP, Gemini 3.7 Flash only, no Pro anywhere.**
  Depth is a `thinking_level` (low/medium/high) plus a scope change on the
  prompt — Exhaustive does more analytical work (cross-referencing, deeper
  action-item inference), not just a longer Dense; (3) Quick-actions —
  bundled recipe-equivalents specific to that lens, including draft-
  follow-up types (client email, Slack message, Jira ticket) per lens.
- Default persona: neutral/dense, matching existing truth-first philosophy.
  MVP ships a handful of built-in personas only. User-authored custom
  personas are a later phase.
- Interactive action-item drawers (owner/due date/priority/notes) promoted
  into ROADMAP Core UX/UI — extends the existing `action_item` chunk type.
- **Regeneration — considered and rejected, 2026-08-30.** Re-running
  structured note gen post-hoc under a different persona was proposed and
  cut: ask-your-notes chat already answers persona-shifted questions on
  demand (e.g. "how would a Sales Coach read this?") without re-running or
  re-storing structured note gen, so persisted regeneration would just pay
  for a redundant Gemini call. Persona edits apply to new notes only, as
  originally designed. No schema or pipeline change.
- **Backend shipped, Prompt 3, 2026-08-30.** All four personas are rows in
  `public.personas`, owner-scoped, four-policy RLS (`(select auth.uid()) =
  user_id`, wrapped) matching the `notes`/`note_chunks` pattern.
  `note_chunks.persona_id` is a nullable FK, `on delete set null`, and —
  critically — composite against `personas (id, user_id)`, not a bare `id`
  reference, because foreign keys are validated as the referenced table's
  owner and are not subject to RLS; a single-column FK would have let one
  user attribute a chunk to another user's persona. Verified refused with a
  real cross-tenant insert (`23503`). `depth` (`'brief' | 'dense' |
  'exhaustive'`) is a column on `personas` and a field on the view type —
  schema/type only, no routing logic and no UI control yet; all four seeded
  personas default to `'dense'`, since the prior hardcoded presets encoded
  no depth value to preserve. `lib/notes/persona-presets.ts` is deleted, not
  repointed. `lib/mock/types.ts` is folded into `lib/notes/view-types.ts`
  and deleted; zero remaining importers.
- **Per-note lens selection — SHIPPED 2026-09-02.** The rail on Note Detail
  writes `notes.persona_id` behind a guard that freezes wider than expected:
  `processing_status IN ('local','uploading') AND notegen_status IS NULL`. The
  `processing_status` clause is the load-bearing one — pressing Transcribe
  leaves `notegen_status` null for the whole transcription, because generation
  only claims afterwards, so guarding on `notegen_status` alone would leave a
  minutes-long window in which the rail shows one lens and generation picks up
  another. The rail's `disabled` attribute is UX; the SQL guard is the
  enforcement, because a Server Action is a public HTTP endpoint. Seeding on
  mount is a real write, never a visual default, and never happens on a frozen
  note. The last choice is remembered as a slug in Auth user metadata, not a
  table. Regeneration stays rejected — the lock is what makes that true in the
  UI rather than merely unimplemented.
- **Persona identity is the slug, never the name and never the id —
  resolved 2026-09-02.** Written when no persona-selection surface existed, and
  **amended 2026-09-03** now that one does: resolution takes `notes.persona_id`
  first, scoped by **both** id and `user_id`, and only falls to the slug step
  below when the note carries none or that id resolves to no row. A set
  `persona_id` that resolves to nothing falls through rather than throwing — a
  lens deleted between selection and generation is a real sequence. The slug
  step is unchanged and is what the rest of this bullet describes. A pipeline
  with no note-level lens still needs a concrete row to read `depth` and lens
  framing from, so structured note generation resolves one as
  `user_id = <note.user_id> and slug = 'neutral-analyst'`
  (`DEFAULT_PERSONA_ID`). Slug because `personas.sql`
  declares and indexes `unique (user_id, slug)` and states in its own header
  that slug is the key chosen to survive a reseed; `name` is display text
  carrying no constraint and no index, so the custom-persona phase named above
  — where a user may rename or duplicate a display name — would break a
  name-scoped query silently. Not `personas.id` either: that is a per-user
  `gen_random_uuid()` from the provisioning trigger, while
  `DEFAULT_PERSONA_ID` is the slug string, making the comparison a type error.
  Zero rows means an account predating the 2026-08-31 trigger and falls back to
  `DEFAULT_PERSONA_FALLBACK`. Generated chunks still write `persona_id = null`
  either way — this decides which config drives generation, not attribution.
  The cron path filters `user_id` in application code, the one deliberate
  exception to the standing "let RLS supply it" rule, because `service_role`
  bypasses RLS and an unfiltered lookup can return another account's row.
  Convention recorded in CLAUDE.md § Data.
- **Provisioning — RESOLVED 2026-08-31.** A `security definer` trigger on
  `auth.users` in `supabase/schemas/persona_provisioning.sql` inserts all four
  rows for a new account, proven by `scripts/verify-persona-provisioning.mjs`.
  Accounts predating it are deliberately not backfilled, which is why
  `DEFAULT_PERSONA_FALLBACK` is still live code. This bullet read "Still open:
  no `auth.users` trigger provisions personas for a new account" until
  2026-09-03, contradicting the "Explicitly still open" section of this same
  file, which had recorded it closed on 2026-08-31.
- **Still open:** deleting a persona re-attributes its takeaways to the default
  persona rather than orphaning them, and nothing deletes a persona yet. See
  ROADMAP.md §5 / Core UX/UI for where this belongs.
**Structured note generation** — resolved 2026-09-01, closes the depth-
routing open item under Personas above and ROADMAP.md §5.
- **No Gemini Pro anywhere in this rebuild.** Single model: Gemini 3.7 Flash
  for all three depths. Supersedes every prior "Exhaustive may route to Pro"
  line in this file and in ROADMAP.md §3/§5.
- Depth is `thinking_level` (Brief → low, Dense → medium, Exhaustive → high)
  **plus a scope change**, not length alone — Exhaustive does more
  analytical work, not just a longer Dense output.
- **One Gemini call per note-gen pass** — lens and depth are both inputs to
  the same call; quick-actions are lens-gated after generation, not a
  second call.
- **Input is the text transcript only** (`notes.raw_transcript` +
  speaker-tagged `note_chunks`), not the source audio, for all four
  personas in MVP. Audio-native input (re-sending the recording for tone/
  nuance) is named as a future option for the Sales Coach lens
  specifically — not built, not scheduled.
- **Trigger: note generation chains automatically off transcription
  reaching `'completed'`** — no separate button, reusing the atomic-claim
  pattern from Track 3. Distinct from, and does not change, the recorder's
  own transcription trigger below.
- **Recorder → transcription trigger is unchanged and stays manual.**
  Reconfirmed 2026-09-01 against this decision: no auto-fire on recording
  stop. A mis-started or wrong-meeting recording is a real failure mode on
  an ambient, non-calendar-gated recorder, and burning a transcription on
  one is worse than one extra click. The Transcribe button on Note Detail
  remains the only way a recording reaches `'analyzing'`.
**Recorder UI shape** — resolved 2026-08-30
- Hybrid, not a binary float-vs-full-app pick: a small persistent
  **record pill/HUD** (start/stop/pause, timer, mic level) as the always-
  available ambient trigger for ad-hoc capture — not calendar-gated — plus
  the existing full 900×812 pane as the actual editing surface once a note
  is open. No new Claude Design surface — add the pill/HUD as an additional
  state on the existing Recorder board.
**Guest link controls**
- Share links stay public, read-only guest links (transcript withheld by
  default, citations still resolvable — already locked). Adding: per-link
  revoke, optional expiry, and a per-link override of the
  transcript-withheld default. Extends the existing Share surface — no new
  Claude Design pass needed.
**PWA**
- Adding manifest + service worker: installable (desktop/home-screen icon),
  offline shell caching of already-loaded notes/dashboard, and push
  notification on `processing_status` reaching `completed`.
- Does **not** provide OS-level global hotkeys — that still requires a
  native shell (Electron/Tauri), which remains out of scope.
- App icon/splash sequenced after the logo/icon redesign, not before.
**Feature scope** — keep/cut/redesign pass on the prior feature inventory
(recorder,
import, dashboard/feed, per-note detail+chat, collections/tags, share links,
settings, onboarding, live assistant): all kept, all get a full UI redesign.
New, not from the prior build: personas, speaker tags, action-item
drawers, export,
webhooks, MCP bridge, real-time PII redaction, profile context box,
share-preview/OG image, guest link controls, PWA, full brand identity
(logo/icons — name is retained, see Branding above), real docs/copy. Full
phase assignment for all of the above is in ROADMAP.md §8.
**Deployment** (ad hoc — happened during Prompt 3, not originally planned)
- Live at `https://squid-ink.vercel.app` as of 2026-08-30. Sign-in confirmed
  working end-to-end post magic-link fix (see Auth above).
- **`docs/DEPLOYMENT.md` in the repo is the source of truth** for the Vercel
  project, the environment variables, the Supabase Site URL, and the redirect
  allowlist — including the `curl` recipes that re-measure all of it without a
  dashboard login. Values are deliberately not restated here; this doc carried
  them until 2026-08-30, which meant two places could disagree with nothing
  forcing them back in sync. Same trim as the token values and pinned versions
  in Frontend engineering conventions. To audit a value, read that file.
- The redirect allowlist recorded here previously was wrong in a way that broke
  sign-in: it covered `https://squid-ink-*.vercel.app/**`, but Vercel names
  deployment URLs from the package name, so they read `squid-<hash>-tekguyz`.
  Corrected 2026-08-30. This is exactly the drift the trim above prevents.
- Supabase's built-in mailer is rate-limited and not production-grade; custom
  SMTP (Resend) is not configured. Fine for owner+1-friend scale, worth
  flagging before any real user volume.
- **A tracked home for this config — RESOLVED 2026-08-31, `docs/DEPLOYMENT.md`.**
  Corrected 2026-09-03. Two bullets here read "None of this is tracked in the
  repo… Needs a home — either a `docs/DEPLOYMENT.md` in-repo or a section here
  kept current — not decided yet", followed by a verbatim repeat of the SMTP
  paragraph above. Both were written before that file existed, and both
  contradicted the "Explicitly still open" section of this same file, which had
  already recorded the question closed. Removed rather than marked, because
  they described a decision that was pending and is not; the decision itself is
  the bullet above this one.
 
## Rejected — 2026-08-30 feature-triage
 
- **Sentiment & Cultural Health Dashboards** — required multi-tenancy
  (now explicitly rejected) plus new data sources (Slack/email) that don't
  exist in this architecture.
- **Split-Screen "Raw Scribbles vs AI Truth" editor** — redundant; this is
  just a description of the already-locked core record→structure loop, not
  a distinct feature.
- **Local-First Offline Mode** — needs on-device ASR + a sync engine;
  doesn't match owner+1-friend scale.
- **Localized Hotkeys for Live Tagging** — needs OS-level global hotkey
  registration while unfocused, impossible in a pure web app; would need a
  native shell, which isn't being built.
- **Zero-Install WebRTC fallback** — moot; the app is already 100% web,
  zero-install by default. Only relevant if a native shell is ever built.
- **Sub-Hz Background Noise Masking** — solves a cost problem already
  disproven ($0.15/mo total audio spend, see Cost above); browser
  `noiseSuppression: true` is the free equivalent if audio quality, not
  cost, ever becomes the actual issue.
- **Persona regeneration** — see Personas above.
## Already covered, no action needed
 
- **Zoom-In Context Tool** — already built: the `data-cite` chip
  interaction in the note-detail mockup already jumps from a claim to its
  source transcript span.
- **Custom & Role-Specific Framework Templates** — fold naming (Architecture
  Review, PRD draft, 1-on-1, retro) into the 4 built-in Personas rather than
  building a second system.
## Explicitly still open
 
**Updated 2026-08-31**, the first time this file could be checked against the
repo — it moved into the tree that day. Three of the five entries below had
shipped. Kept in place with what closed them, rather than deleted.

- **Google OAuth/Calendar connect flow** — still open. Nothing in `app/`,
  `lib/` or `components/` references Google beyond `next/font/google` and the
  `@google/genai` transcription client.
- **Audio Storage** — **mostly RESOLVED 2026-08-31.** The bucket and its three
  policies are `supabase/schemas/storage_audio.sql`; upload code shipped with
  the recorder and is proven by `scripts/verify-recorder-upload.mjs`.
  **Playback UI closed 2026-08-31 — this entry is now fully resolved.**
  `components/note-detail/audio-player.tsx` sits on the Note Detail meta line
  and plays the object that `lib/notes/audio-playback.ts` fetches with the
  browser client; play/pause, an mm:ss clock and a seek bar, every colour a
  token and every corner square. Confirmed in a running browser against a real
  seeded recording, not only in tests. The waveform scrubber is deliberately not
  part of it — ROADMAP §8 keeps that behind speaker tags.
- **Persona provisioning on signup** — **RESOLVED 2026-08-31.** A
  `security definer` trigger on `auth.users` in
  `supabase/schemas/persona_provisioning.sql`, proven by
  `scripts/verify-persona-provisioning.mjs`. Accounts predating it are
  deliberately not backfilled.
- **Persona-delete re-attribution behaviour** — still open, and now has a guard
  rail rather than just a question. `note_chunks.persona_id` is
  `on delete set null`, so deleting a persona silently re-attributes its
  takeaways to the default lens. Nothing can delete a personas row today. The
  comment block at `supabase/schemas/note_chunks.sql:71` states the choice that
  must be made before a delete button ships.
- **A tracked home for the deployment config** — **RESOLVED 2026-08-31.**
  `docs/DEPLOYMENT.md`.

Everything else from the 2026-08-30 feature-triage backlog is disposed — see
ROADMAP.md §8 for what was promoted and where, and "Rejected" above for what
wasn't.
 
## Build context
 
Rebuilding via Claude Code with Opus 5 (Supabase skill + Superpowers
available) for the actual build, alongside Claude.ai for planning.
TEKGUYZ Engineering workflow applies: discovery → blueprint → prompt-pack
gates, in that order.
 
- **Discovery**: complete.
- **Blueprint**: complete, all open items closed, including the 2026-08-30
  feature-triage pass — see `ROADMAP.md`.
- **Claude Design**: in progress. Recorder UI resolved (see above). Note
  Detail finalized 2026-08-30 — turn 3 (3a light / 3b dark) is the locked
  treatment, 3c is the token spec of record (current numeric values live in
  `app/globals.css`, not this doc — see Frontend engineering conventions
  below). No other open design calls.
- **Prompt-pack**: in progress.
  - Prompt 1 (repo scaffold + Note Detail UI) — complete.
  - Prompt 2 (Supabase persistence — `notes`/`note_chunks` schema, pgvector
    HNSW/GIN indexes, owner-only RLS proven via two real `auth.users`
    accounts with genuine session JWTs, magic-link auth routes added, Note
    Detail wired to real data) — complete as shipped, but its magic-link
    auth route had a latent bug (see Auth above) not caught until Prompt 3,
    because RLS proof used password-grant JWTs, not an actual clicked
    email link.
  - Prompt 3 (`personas` table + owner-scoped RLS, composite `persona_id`
    FK on `note_chunks`, `depth` field, `lib/mock/types.ts` folded into
    `lib/notes/view-types.ts`) — **complete, merged `bd8e7d2..ddaef6b`,
    2026-08-30.** Branch `feat/personas-table-and-view-types`, deleted
    post-merge. Also fixed the Prompt 2 magic-link bug and stood up the
    (untracked) Vercel deployment — see Auth and Deployment above.
  - Open before Prompt 4: Google OAuth/Calendar connect flow, audio Storage
    bucket, persona provisioning on signup, persona-delete behavior. See
    "Explicitly still open" above.
## Frontend engineering conventions (added 2026-08-30, trimmed 2026-08-30 to remove duplication with CLAUDE.md)
 
- **Repo/package naming**: local folder `tekguyz-squid-ink`, npm package
  name `squid-ink` — deliberately decoupled from the app's still-unconfirmed
  public name (see Branding above) so a naming decision doesn't require a
  code-wide rename. The public name, whatever it ends up being, only ever
  appears as user-facing copy.
- **Styling / tokens**: Tailwind v4, CSS-first `@theme` block in
  `globals.css`. Every color in every component is a `var(--token-name)`
  reference — no inline `oklch()` literals. This is the code-side fix for
  the same defect Claude Design found and fixed on its own side (tokens
  living inline in the `.dc.html` files with nothing enforcing them).
- **Note Detail tokens, locked** (design intent, from Claude Design's 3c
  spec): hue band 140–146 for the accent; typography is Bitter (headers),
  Archivo (body), IBM Plex Mono (metadata) — matches `App_Surfaces.dc.html`.
  **Exact oklch values are not recorded here.** CLAUDE.md states
  `app/globals.css` is "the only file that names a colour" — this doc
  carried the full numeric token list until 2026-08-30, which meant two
  places could disagree after any token change with nothing forcing them
  back in sync. Removed for that reason. To audit a value, read
  `app/globals.css` directly.
- **File/folder structure**: flat, feature-colocated components — no FSD,
  no atomic-design (atoms/molecules/organisms) layering. A single screen
  doesn't need architectural ceremony built for a product that doesn't
  exist yet; revisit only if flat stops fitting once more surfaces exist.
  Line-ceiling numbers and the enforcement mechanism (a convention test)
  live in CLAUDE.md, not here — removed 2026-08-30, same reason as above.
- **Dependency versions**: verified and pinned exact (no `^`/`~` ranges) at
  build time against current npm/official release info — never assumed
  from a model's training data, since JS-ecosystem versions move faster
  than any knowledge cutoff. **Current pinned versions live in this repo's
  `CLAUDE.md`, not here** — removed 2026-08-30 so only one file needs
  updating when a dependency bumps.
- **Build workflow — Superpowers is mandatory, not optional**:
  `brainstorming` → `using-git-worktrees` → `writing-plans` →
  `executing-plans` (single coherent build) or `subagent-driven-development`
  (genuinely parallel, multi-surface work) → `test-driven-development`
  (scoped to interactive/stateful logic — persona switching, citation-chip
  state, composer input — not static presentational markup being matched
  against a visual reference) → `requesting-code-review` →
  `finishing-a-development-branch`. Prompt packs must name the specific
  skills a task needs explicitly — they don't self-load.
- **Review tooling**: `vercel-react-best-practices` and `web-design-guidelines`
  (`vercel-labs/agent-skills`) adopted for code-quality and UI-guideline
  review, used alongside `requesting-code-review`. Confirm both are
  actually installed in the active Claude Code session before a prompt
  names them — an uninstalled skill is silently ignored.
- **Design review tooling**: `impeccable` adopted 2026-08-31 for frontend
  design work — critique, polish, audit and redesign of UI surfaces. It is
  invoked as `/impeccable critique <file>` for a scored UX design review,
  and `/impeccable polish` for a final quality pass before shipping. It was
  used on the audio-player and transcribe-button critiques before it was
  written down here. `critique` spawns **two isolated sub-agents** (its
  Assessment A and Assessment B) that must not see each other's output
  before synthesis. That is the skill's own internal mechanism, not task
  delegation — it runs at full capability even when a prompt's budget says
  "no delegation", and running it inline instead produces a self-declared
  degraded report. Same caveat as above: confirm it is installed in the
  active session before a prompt names it. Its install also generated
  `DESIGN.md` at the repo root (via `/impeccable document` in scan mode, read
  out of `app/globals.css` and `components/` rather than authored) and
  `.impeccable/`, whose `config.json` sets `hook.enabled: false` to disable
  the Edit/Write hook the installer added unasked. `DESIGN.md` describes the
  incumbent system; it does not outrank `app/globals.css` or the
  `design-reference/*.dc.html` files, which remain the source of truth.
## Related documents in this project
 
- `ROADMAP.md` — PRD + technical roadmap
