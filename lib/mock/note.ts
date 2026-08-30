import type { Note, Speaker } from "@/lib/notes/view-types";

export const DEFAULT_PERSONA_ID = "neutral-analyst";

const PRIYA: Speaker = { name: "Priya Raghavan", initials: "PR", token: "speaker-1" };
const MARCUS: Speaker = { name: "Marcus Lund", initials: "ML", token: "speaker-2" };
const DEVON: Speaker = { name: "Devon Achebe", initials: "DA", token: "speaker-3" };

/** Bar heights as percentages, precomputed from the design's waveform curve.
 *  Held as constants so nothing calls Math during render. */
const WAVEFORM = [
  44, 53, 80, 82, 49, 44, 56, 78, 83, 46, 44, 59, 76, 84, 44, 43, 62,
  73, 85, 47, 42, 64, 70, 85, 50, 41, 67, 67, 85, 53, 39, 69, 64, 85,
  55, 37, 70, 61, 84, 57, 35, 72, 64, 82, 60, 32, 72, 67, 80, 61, 30,
  73, 70, 78, 63, 27, 73, 73, 76, 64, 24, 72, 76, 73, 65, 24, 72, 79,
];

export const mockNote: Note = {
  id: "pilot-pricing-rollout",
  title: "Pilot pricing & rollout",
  meta: "Wed 26 Aug 2026 · 41 min · Northwind Health",
  turnCount: 12,
  duration: "41:07",
  playhead: "03:31",
  spansLinked: 27,
  waveform: WAVEFORM,

  summary: [
    {
      text: "Two of four pilot clinics have live data; the other two are blocked on Northwind's security review, closing the 9th",
      cite: { time: "00:58", segmentId: 3 },
    },
    {
      text: ". Pricing moved from per-seat to per-clinic with a 40-seat cap",
      cite: { time: "03:31", segmentId: 8 },
    },
    {
      text: ", pending legal. Field mapping is the live risk: 6–8h per unfamiliar EHR, colliding with the Q4 freeze if clinics five and six land in Q4",
      cite: { time: "04:48", segmentId: 10 },
    },
    { text: "." },
  ],

  actionItems: [
    {
      text: "Confirm security-review outcome with Northwind IT",
      owner: "P. Raghavan",
      due: "Sep 9",
      time: "00:58",
      segmentId: 3,
    },
    {
      text: "Draft per-clinic / 40-seat-cap terms into SOW v4",
      owner: "M. Lund",
      due: "Aug 31",
      time: "04:12",
      segmentId: 9,
    },
    {
      text: "Estimate mapping hours for clinics 5–6 vs Q4 freeze",
      owner: "D. Achebe",
      due: "Sep 4",
      time: "04:48",
      segmentId: 10,
    },
  ],

  stats: [
    { speaker: PRIYA, talk: "46%", asked: "5", fillers: "11" },
    { speaker: MARCUS, talk: "31%", asked: "7", fillers: "6" },
    { speaker: DEVON, talk: "23%", asked: "1", fillers: "4" },
  ],

  sampleExchange: {
    question: "Did anyone commit to a date for the SOW redraft?",
    answer: [
      {
        text: "No date was said aloud. Marcus agreed to put per-clinic terms in the SOW",
        cite: { time: "04:12", segmentId: 9 },
      },
      { text: "and the Aug 31 due date is yours, added after the call." },
    ],
  },

  segments: [
    { id: 1, time: "00:12", speaker: PRIYA, text: "Before pricing, I want to be honest about where the pilot stands: two of the four clinics have live data flowing, the other two are stuck on the VPN request." },
    { id: 2, time: "00:41", speaker: MARCUS, text: "Stuck how? Is that an IT queue thing or a contract thing?" },
    { id: 3, time: "00:58", speaker: PRIYA, text: "IT queue. Their security review closes on the 9th and nothing moves before that. I'd rather we plan the rollout around the 9th than pretend it's a two-day fix." },
    { id: 4, time: "01:35", speaker: DEVON, text: "From our side the ingest pipeline doesn't care whether it's two clinics or four. The risk is the mapping table — every clinic names its fields differently and we're hand-writing those maps." },
    { id: 5, time: "02:20", speaker: MARCUS, text: "How long per clinic?" },
    { id: 6, time: "02:26", speaker: DEVON, text: "Six to eight hours the first time. Under two once we've seen a similar EHR." },
    { id: 7, time: "03:04", speaker: PRIYA, text: "Which brings us to price. They pushed back on the per-seat number — they want per-clinic, capped." },
    { id: 8, time: "03:31", speaker: MARCUS, text: "Per-clinic capped is fine if the cap sits above 40 seats. Below that we're subsidising their growth." },
    { id: 9, time: "04:12", speaker: PRIYA, text: "Then let's put per-clinic with a 40-seat cap in the SOW and see if it survives legal." },
    { id: 10, time: "04:48", speaker: DEVON, text: "One flag: if they add clinics five and six in Q4, the mapping work lands in the same week as the migration freeze." },
    { id: 11, time: "05:20", speaker: MARCUS, text: "Note that as a risk and we'll staff for it. Anything else before we close?" },
    { id: 12, time: "05:33", speaker: PRIYA, text: "Just the security review date — everything hangs off the 9th." },
  ],

  personas: [
    {
      id: DEFAULT_PERSONA_ID,
      name: "Neutral Analyst",
      sub: "dense · no framing",
      depth: "dense",
      takeaways: [
        { n: "01", segmentId: 3, time: "00:58", text: "Rollout dates hang off the customer's Sept 9 security review, not our readiness." },
        { n: "02", segmentId: 8, time: "03:31", text: "Per-clinic pricing is only non-dilutive above a 40-seat cap." },
        { n: "03", segmentId: 6, time: "02:26", text: "Mapping cost is front-loaded per EHR family, not per clinic — 6–8h first, under 2h thereafter." },
      ],
      actions: ["Extract decisions only", "Timeline of blockers", "Unanswered questions", "Diff against last call"],
    },
    {
      id: "sales-coach",
      name: "Sales Coach",
      sub: "coaching · direct",
      depth: "dense",
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
      depth: "dense",
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
      depth: "dense",
      takeaways: [
        { n: "01", segmentId: 4, time: "01:35", text: "Hand-written field maps are the bottleneck — clinic count is not the scaling variable." },
        { n: "02", segmentId: 10, time: "04:48", text: "Clinics 5–6 in Q4 would land mapping work inside the migration freeze week." },
        { n: "03", segmentId: 3, time: "00:58", text: "Two clinics stay dark until the customer's Sept 9 security review clears — plan a staged cutover." },
      ],
      actions: ["Scope the mapping work", "Risk register entry", "Sequencing plan", "Handoff brief"],
    },
  ],
};
