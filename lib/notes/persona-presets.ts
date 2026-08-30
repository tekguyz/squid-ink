import type { Persona } from "@/lib/notes/view-types";

/** The default persona's id. Its takeaways come from real `takeaway` chunks;
 *  only its name, subtitle and quick-actions are constants. */
export const DEFAULT_PERSONA_ID = "neutral-analyst";

export const DEFAULT_PERSONA_NAME = "Neutral Analyst";
export const DEFAULT_PERSONA_SUB = "dense · no framing";
export const DEFAULT_PERSONA_ACTIONS = [
  "Extract decisions only",
  "Timeline of blockers",
  "Unanswered questions",
  "Diff against last call",
];

/**
 * The three non-default personas, still hardcoded.
 *
 * MVP ships the default neutral persona only (ROADMAP.md §8) — there is no
 * personas table, and note_chunks has no persona_id, so a takeaway cannot yet
 * be attributed to a lens. These stay constants until the Personas feature is
 * actually built in the Core UX/UI phase. Recorded in docs/KNOWN_GAPS.md.
 */
export const PRESET_PERSONAS: Persona[] = [
  {
    id: "sales-coach",
    name: "Sales Coach",
    sub: "coaching · direct",
    takeaways: [
      { n: "01", segmentId: 7, time: "03:04", text: "The per-seat objection was never tested — you moved to per-clinic in one turn." },
      { n: "02", segmentId: 8, time: "03:31", text: "Your side named the 40-seat cap first; the customer never had to price their own growth." },
      { n: "03", segmentId: 3, time: "00:58", text: "The Sept 9 date is the only hard commitment on the call — anchor the next agenda on it." },
    ],
    actions: ["Score objection handling", "Draft follow-up email", "Next-call agenda", "Concessions made"],
  },
  {
    id: "investor",
    name: "Investor",
    sub: "economics · risk",
    takeaways: [
      { n: "01", segmentId: 8, time: "03:31", text: "Capped per-clinic pricing shifts expansion upside to the customer above 40 seats." },
      { n: "02", segmentId: 6, time: "02:26", text: "Onboarding cost falls sharply after the first EHR of a family — margin improves with clustering, not headcount." },
      { n: "03", segmentId: 10, time: "04:48", text: "Q4 expansion collides with a migration freeze: revenue timing risk, not demand risk." },
    ],
    actions: ["Unit-economics read", "Expansion risk memo", "Diligence questions", "Quantified risks"],
  },
  {
    id: "engineering-lead",
    name: "Engineering Lead",
    sub: "scope · sequencing",
    takeaways: [
      { n: "01", segmentId: 4, time: "01:35", text: "Hand-written field maps are the bottleneck — clinic count is not the scaling variable." },
      { n: "02", segmentId: 10, time: "04:48", text: "Clinics 5–6 in Q4 would land mapping work inside the migration freeze week." },
      { n: "03", segmentId: 3, time: "00:58", text: "Two clinics stay dark until the customer's Sept 9 security review clears — plan a staged cutover." },
    ],
    actions: ["Scope the mapping work", "Risk register entry", "Sequencing plan", "Handoff brief"],
  },
];
