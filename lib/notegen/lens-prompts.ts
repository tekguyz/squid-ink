import { DEFAULT_PERSONA_ID } from "@/lib/notes/default-persona";

/** How each lens is described to the model.
 *
 *  A static lookup in code, keyed by slug, and NOT a column. This is
 *  prompt-engineering configuration — the same category as
 *  components/note-detail/speaker-colors.ts, which maps a persona to a token
 *  name because Tailwind cannot build class names at runtime. It is
 *  emphatically not the same category as the deleted persona-presets.ts, which
 *  duplicated whole preset objects the personas table now owns. The row still
 *  owns identity, ordering, depth and quick-actions; this owns only the
 *  sentences handed to Gemini.
 *
 *  KEYED BY SLUG. personas.sql declares and indexes unique (user_id, slug) and
 *  states in its own header that slug is the key chosen to survive a reseed.
 *  name carries neither constraint nor index and is display text, so keying on
 *  it would route three lenses to neutral output the first time a user renames
 *  one. Recorded in CLAUDE.md § Data and DECISIONS.md § Personas, 2026-09-02.
 *
 *  The four slugs below are exactly the four persona_provisioning.sql inserts.
 *  A fifth arriving from the deferred custom-persona phase falls back to
 *  neutral rather than throwing — a cron run must not die on one odd lens. */

export interface LensPrompt {
  slug: string;
  /** The lens's display name, used inside the prompt so the model is given a
   *  role rather than only a list of instructions. */
  label: string;
  /** One paragraph. What this lens looks for, and what it leaves alone. */
  framing: string;
}

const NEUTRAL: LensPrompt = {
  slug: DEFAULT_PERSONA_ID,
  label: "Neutral Analyst",
  framing:
    "Read the transcript as a neutral analyst. Report what was actually " +
    "said and decided, with no framing, no coaching and no advocacy. Prefer " +
    "the speakers' own words for anything contested. Where the conversation " +
    "left something unresolved, say it is unresolved rather than resolving " +
    "it yourself.",
};

const LENSES: Record<string, LensPrompt> = {
  [DEFAULT_PERSONA_ID]: NEUTRAL,

  "sales-coach": {
    slug: "sales-coach",
    label: "Sales Coach",
    framing:
      "Read the transcript as a sales coach reviewing a call with the rep " +
      "who ran it. Attend to objections and how they were handled, buying " +
      "signals, concessions made, and commitments given on either side. Be " +
      "direct about what was mishandled. Do not soften a weak moment into a " +
      "neutral one.",
  },

  investor: {
    slug: "investor",
    label: "Investor",
    framing:
      "Read the transcript as an investor assessing the business behind the " +
      "conversation. Attend to unit economics, claimed and implied numbers, " +
      "expansion and concentration risk, and anything asserted without " +
      "evidence. Quantify where the transcript gives you the figures, and " +
      "name the gap where it does not.",
  },

  "engineering-lead": {
    slug: "engineering-lead",
    label: "Engineering Lead",
    framing:
      "Read the transcript as the engineering lead who has to deliver what " +
      "was discussed. Attend to scope, sequencing, dependencies, and the " +
      "assumptions that would break the plan if they turned out wrong. " +
      "Separate what was actually committed to from what was merely floated.",
  },
};

export function lensPromptFor(slug: string): LensPrompt {
  return LENSES[slug] ?? NEUTRAL;
}
