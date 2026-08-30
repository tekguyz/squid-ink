-- One completed note plus the chunks Note Detail renders.
--
-- The owner is resolved by email rather than hardcoded, so this file carries
-- no environment-specific user id and can be re-run against any project that
-- has the test user. Both inserts are guarded by on conflict do nothing.
--
-- Prose is copied verbatim from lib/mock/note.ts so the rendered page stays
-- visually comparable to Prompt 1's output. lib/mock stays in place as a
-- design reference; no application code imports it any more.

with owner as (
  select id from auth.users where email = 'squid-ink-owner@example.test'
)
insert into public.notes (
  id, user_id, title, processing_status, raw_transcript,
  diarization_enabled, audio_duration_seconds, created_at, updated_at
)
select
  '11111111-1111-4111-8111-111111111111',
  owner.id,
  'Pilot pricing & rollout',
  'completed',
  -- Raw transcript is retained regardless of the diarization outcome.
  $transcript$Priya Raghavan: Before pricing, I want to be honest about where the pilot stands: two of the four clinics have live data flowing, the other two are stuck on the VPN request.
Marcus Lund: Stuck how? Is that an IT queue thing or a contract thing?
Priya Raghavan: IT queue. Their security review closes on the 9th and nothing moves before that. I'd rather we plan the rollout around the 9th than pretend it's a two-day fix.
Devon Achebe: From our side the ingest pipeline doesn't care whether it's two clinics or four. The risk is the mapping table — every clinic names its fields differently and we're hand-writing those maps.
Marcus Lund: How long per clinic?
Devon Achebe: Six to eight hours the first time. Under two once we've seen a similar EHR.
Priya Raghavan: Which brings us to price. They pushed back on the per-seat number — they want per-clinic, capped.
Marcus Lund: Per-clinic capped is fine if the cap sits above 40 seats. Below that we're subsidising their growth.
Priya Raghavan: Then let's put per-clinic with a 40-seat cap in the SOW and see if it survives legal.
Devon Achebe: One flag: if they add clinics five and six in Q4, the mapping work lands in the same week as the migration freeze.
Marcus Lund: Note that as a risk and we'll staff for it. Anything else before we close?
Priya Raghavan: Just the security review date — everything hangs off the 9th.$transcript$,
  true,
  2467,                                    -- 41:07, renders as "41 min"
  '2026-08-26T14:00:00Z',                  -- renders as "Wed 26 Aug 2026"
  '2026-08-26T14:00:00Z'
from owner
on conflict (id) do nothing;

-- Chunks. embedding stays null throughout: no embedding pipeline is in
-- scope for this prompt, and HNSW indexes an empty column fine.
with owner as (
  select id from auth.users where email = 'squid-ink-owner@example.test'
),
seed (id, chunk_type, content, metadata) as (
  values
    -- Transcript segments. metadata.seq drives render order; speaker.token
    -- is a token name, never a colour value.
    ('22222222-0000-4000-8000-000000000001'::uuid, 'transcript_segment', 'Before pricing, I want to be honest about where the pilot stands: two of the four clinics have live data flowing, the other two are stuck on the VPN request.', $j${"seq":1,"ts_start":"00:12","speaker":{"name":"Priya Raghavan","initials":"PR","token":"speaker-1"}}$j$::jsonb),
    ('22222222-0000-4000-8000-000000000002'::uuid, 'transcript_segment', 'Stuck how? Is that an IT queue thing or a contract thing?', $j${"seq":2,"ts_start":"00:41","speaker":{"name":"Marcus Lund","initials":"ML","token":"speaker-2"}}$j$::jsonb),
    ('22222222-0000-4000-8000-000000000003'::uuid, 'transcript_segment', 'IT queue. Their security review closes on the 9th and nothing moves before that. I''d rather we plan the rollout around the 9th than pretend it''s a two-day fix.', $j${"seq":3,"ts_start":"00:58","speaker":{"name":"Priya Raghavan","initials":"PR","token":"speaker-1"}}$j$::jsonb),
    ('22222222-0000-4000-8000-000000000004'::uuid, 'transcript_segment', 'From our side the ingest pipeline doesn''t care whether it''s two clinics or four. The risk is the mapping table — every clinic names its fields differently and we''re hand-writing those maps.', $j${"seq":4,"ts_start":"01:35","speaker":{"name":"Devon Achebe","initials":"DA","token":"speaker-3"}}$j$::jsonb),
    ('22222222-0000-4000-8000-000000000005'::uuid, 'transcript_segment', 'How long per clinic?', $j${"seq":5,"ts_start":"02:20","speaker":{"name":"Marcus Lund","initials":"ML","token":"speaker-2"}}$j$::jsonb),
    ('22222222-0000-4000-8000-000000000006'::uuid, 'transcript_segment', 'Six to eight hours the first time. Under two once we''ve seen a similar EHR.', $j${"seq":6,"ts_start":"02:26","speaker":{"name":"Devon Achebe","initials":"DA","token":"speaker-3"}}$j$::jsonb),
    ('22222222-0000-4000-8000-000000000007'::uuid, 'transcript_segment', 'Which brings us to price. They pushed back on the per-seat number — they want per-clinic, capped.', $j${"seq":7,"ts_start":"03:04","speaker":{"name":"Priya Raghavan","initials":"PR","token":"speaker-1"}}$j$::jsonb),
    ('22222222-0000-4000-8000-000000000008'::uuid, 'transcript_segment', 'Per-clinic capped is fine if the cap sits above 40 seats. Below that we''re subsidising their growth.', $j${"seq":8,"ts_start":"03:31","speaker":{"name":"Marcus Lund","initials":"ML","token":"speaker-2"}}$j$::jsonb),
    ('22222222-0000-4000-8000-000000000009'::uuid, 'transcript_segment', 'Then let''s put per-clinic with a 40-seat cap in the SOW and see if it survives legal.', $j${"seq":9,"ts_start":"04:12","speaker":{"name":"Priya Raghavan","initials":"PR","token":"speaker-1"}}$j$::jsonb),
    ('22222222-0000-4000-8000-000000000010'::uuid, 'transcript_segment', 'One flag: if they add clinics five and six in Q4, the mapping work lands in the same week as the migration freeze.', $j${"seq":10,"ts_start":"04:48","speaker":{"name":"Devon Achebe","initials":"DA","token":"speaker-3"}}$j$::jsonb),
    ('22222222-0000-4000-8000-000000000011'::uuid, 'transcript_segment', 'Note that as a risk and we''ll staff for it. Anything else before we close?', $j${"seq":11,"ts_start":"05:20","speaker":{"name":"Marcus Lund","initials":"ML","token":"speaker-2"}}$j$::jsonb),
    ('22222222-0000-4000-8000-000000000012'::uuid, 'transcript_segment', 'Just the security review date — everything hangs off the 9th.', $j${"seq":12,"ts_start":"05:33","speaker":{"name":"Priya Raghavan","initials":"PR","token":"speaker-1"}}$j$::jsonb),

    -- One summary chunk. metadata.runs holds the CiteRun[] split so citation
    -- chips can sit inline without dangerouslySetInnerHTML.
    ('33333333-0000-4000-8000-000000000001'::uuid, 'summary', 'Two of four pilot clinics have live data; the other two are blocked on Northwind''s security review, closing the 9th. Pricing moved from per-seat to per-clinic with a 40-seat cap, pending legal. Field mapping is the live risk: 6–8h per unfamiliar EHR, colliding with the Q4 freeze if clinics five and six land in Q4.', $j${"seq":1,"runs":[{"text":"Two of four pilot clinics have live data; the other two are blocked on Northwind's security review, closing the 9th","cite":{"time":"00:58","segmentId":3}},{"text":". Pricing moved from per-seat to per-clinic with a 40-seat cap","cite":{"time":"03:31","segmentId":8}},{"text":", pending legal. Field mapping is the live risk: 6–8h per unfamiliar EHR, colliding with the Q4 freeze if clinics five and six land in Q4","cite":{"time":"04:48","segmentId":10}},{"text":"."}]}$j$::jsonb),

    -- Takeaways for the default neutral-analyst persona. The other three
    -- personas remain UI constants — no personas table ships this prompt.
    ('44444444-0000-4000-8000-000000000001'::uuid, 'takeaway', 'Rollout dates hang off the customer''s Sept 9 security review, not our readiness.', $j${"n":"01","seq":1,"ts_start":"00:58","segment_id":3}$j$::jsonb),
    ('44444444-0000-4000-8000-000000000002'::uuid, 'takeaway', 'Per-clinic pricing is only non-dilutive above a 40-seat cap.', $j${"n":"02","seq":2,"ts_start":"03:31","segment_id":8}$j$::jsonb),
    ('44444444-0000-4000-8000-000000000003'::uuid, 'takeaway', 'Mapping cost is front-loaded per EHR family, not per clinic — 6–8h first, under 2h thereafter.', $j${"n":"03","seq":3,"ts_start":"02:26","segment_id":6}$j$::jsonb),

    -- Action items. owner/due live in metadata; the action-item drawer
    -- (ROADMAP §5, Core UX/UI) extends these fields rather than a new table.
    ('55555555-0000-4000-8000-000000000001'::uuid, 'action_item', 'Confirm security-review outcome with Northwind IT', $j${"seq":1,"owner":"P. Raghavan","due":"Sep 9","ts_start":"00:58","segment_id":3}$j$::jsonb),
    ('55555555-0000-4000-8000-000000000002'::uuid, 'action_item', 'Draft per-clinic / 40-seat-cap terms into SOW v4', $j${"seq":2,"owner":"M. Lund","due":"Aug 31","ts_start":"04:12","segment_id":9}$j$::jsonb),
    ('55555555-0000-4000-8000-000000000003'::uuid, 'action_item', 'Estimate mapping hours for clinics 5–6 vs Q4 freeze', $j${"seq":3,"owner":"D. Achebe","due":"Sep 4","ts_start":"04:48","segment_id":10}$j$::jsonb)
)
insert into public.note_chunks (id, note_id, user_id, chunk_type, content, metadata)
select
  seed.id,
  '11111111-1111-4111-8111-111111111111',
  owner.id,
  seed.chunk_type,
  seed.content,
  seed.metadata
from seed cross join owner
on conflict (id) do nothing;

-- The four personas, migrated verbatim out of lib/notes/persona-presets.ts.
-- Owner resolved by email, same as the note above, so this file carries no
-- environment-specific user id.
--
-- sort_order is the rail order: neutral-analyst first, which is what
-- DEFAULT_PERSONA_ID selects on mount.
--
-- depth: the pre-change file encoded no depth for any persona. 'dense' is the
-- column default and matches the only subtitle that names one. No per-persona
-- depth is invented.
with owner as (
  select id from auth.users where email = 'squid-ink-owner@example.test'
),
seed (id, slug, name, sub, depth, quick_actions, sort_order) as (
  values
    ('66666666-0000-4000-8000-000000000001'::uuid, 'neutral-analyst', 'Neutral Analyst', 'dense · no framing', 'dense',
      array['Extract decisions only', 'Timeline of blockers', 'Unanswered questions', 'Diff against last call'], 0),
    ('66666666-0000-4000-8000-000000000002'::uuid, 'sales-coach', 'Sales Coach', 'coaching · direct', 'dense',
      array['Score objection handling', 'Draft follow-up email', 'Next-call agenda', 'Concessions made'], 1),
    ('66666666-0000-4000-8000-000000000003'::uuid, 'investor', 'Investor', 'economics · risk', 'dense',
      array['Unit-economics read', 'Expansion risk memo', 'Diligence questions', 'Quantified risks'], 2),
    ('66666666-0000-4000-8000-000000000004'::uuid, 'engineering-lead', 'Engineering Lead', 'scope · sequencing', 'dense',
      array['Scope the mapping work', 'Risk register entry', 'Sequencing plan', 'Handoff brief'], 3)
)
insert into public.personas (id, user_id, slug, name, sub, depth, quick_actions, sort_order)
select seed.id, owner.id, seed.slug, seed.name, seed.sub, seed.depth, seed.quick_actions, seed.sort_order
from seed cross join owner
on conflict (id) do nothing;

-- Takeaways for the three non-default personas, migrated verbatim out of
-- PRESET_PERSONAS in lib/notes/persona-presets.ts. These are new rows, not a
-- backfill of the existing three, which stay null-attributed and therefore
-- belong to the default persona.
with owner as (
  select id from auth.users where email = 'squid-ink-owner@example.test'
),
seed (id, persona_slug, content, metadata) as (
  values
    ('77777777-0000-4000-8000-000000000001'::uuid, 'sales-coach', 'The per-seat objection was never tested — you moved to per-clinic in one turn.', $j${"n":"01","seq":1,"ts_start":"03:04","segment_id":7}$j$::jsonb),
    ('77777777-0000-4000-8000-000000000002'::uuid, 'sales-coach', 'Your side named the 40-seat cap first; the customer never had to price their own growth.', $j${"n":"02","seq":2,"ts_start":"03:31","segment_id":8}$j$::jsonb),
    ('77777777-0000-4000-8000-000000000003'::uuid, 'sales-coach', 'The Sept 9 date is the only hard commitment on the call — anchor the next agenda on it.', $j${"n":"03","seq":3,"ts_start":"00:58","segment_id":3}$j$::jsonb),
    ('77777777-0000-4000-8000-000000000004'::uuid, 'investor', 'Capped per-clinic pricing shifts expansion upside to the customer above 40 seats.', $j${"n":"01","seq":1,"ts_start":"03:31","segment_id":8}$j$::jsonb),
    ('77777777-0000-4000-8000-000000000005'::uuid, 'investor', 'Onboarding cost falls sharply after the first EHR of a family — margin improves with clustering, not headcount.', $j${"n":"02","seq":2,"ts_start":"02:26","segment_id":6}$j$::jsonb),
    ('77777777-0000-4000-8000-000000000006'::uuid, 'investor', 'Q4 expansion collides with a migration freeze: revenue timing risk, not demand risk.', $j${"n":"03","seq":3,"ts_start":"04:48","segment_id":10}$j$::jsonb),
    ('77777777-0000-4000-8000-000000000007'::uuid, 'engineering-lead', 'Hand-written field maps are the bottleneck — clinic count is not the scaling variable.', $j${"n":"01","seq":1,"ts_start":"01:35","segment_id":4}$j$::jsonb),
    ('77777777-0000-4000-8000-000000000008'::uuid, 'engineering-lead', 'Clinics 5–6 in Q4 would land mapping work inside the migration freeze week.', $j${"n":"02","seq":2,"ts_start":"04:48","segment_id":10}$j$::jsonb),
    ('77777777-0000-4000-8000-000000000009'::uuid, 'engineering-lead', 'Two clinics stay dark until the customer''s Sept 9 security review clears — plan a staged cutover.', $j${"n":"03","seq":3,"ts_start":"00:58","segment_id":3}$j$::jsonb)
)
insert into public.note_chunks (id, note_id, user_id, chunk_type, content, metadata, persona_id)
select
  seed.id,
  '11111111-1111-4111-8111-111111111111',
  owner.id,
  'takeaway',
  seed.content,
  seed.metadata,
  persona.id
from seed
cross join owner
join public.personas persona
  on persona.user_id = owner.id and persona.slug = seed.persona_slug
on conflict (id) do nothing;
