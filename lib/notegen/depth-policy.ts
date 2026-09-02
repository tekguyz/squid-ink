import type { PersonaDepth } from "@/lib/notes/view-types";

/** Depth to a Gemini reasoning budget and a prompt scope.
 *
 *  A pure function of the persona's depth column, deliberately — the same
 *  shape lib/transcription/diarization-policy.ts uses for duration. No I/O and
 *  no SDK import, so the mapping is testable without a network.
 *
 *  DEPTH CHANGES SCOPE, NOT ONLY LENGTH. DECISIONS.md § "Structured note
 *  generation" is explicit that Exhaustive does more analytical work than a
 *  longer Dense. That is why this returns a scope alongside the thinking
 *  level: a single "how hard to think" number would make Exhaustive a Dense
 *  run with a bigger budget, which is precisely what that decision rejected.
 *
 *  THE VALUES ARE LOWERCASE, AND THAT MATTERS. genai.d.ts declares two
 *  different things named for thinking level: the lowercase union
 *  "minimal" | "low" | "medium" | "high" on GenerationConfig_2 (:14439), which
 *  is the interactions.create surface this project calls, and a ThinkingLevel
 *  enum whose members are SCREAMING_CASE (:14409), belonging to the camelCase
 *  models.generateContent surface. Sending an enum member here is a 400 that
 *  no unit test would otherwise catch, which is why one below asserts the
 *  casing. Read from the pinned 2.19.0 types on 2026-09-02. */

export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

/** What the model is asked to produce, not how much of it.
 *
 *  - decisions-and-actions: decisions taken and action items. No summary.
 *  - balanced: summary, takeaways and action items, each at even weight.
 *  - cross-referenced: the same three, plus explicit cross-referencing between
 *    them and inference of action items only implied by the talk. */
export type DepthScope =
  | "decisions-and-actions"
  | "balanced"
  | "cross-referenced";

export interface DepthPlan {
  thinkingLevel: ThinkingLevel;
  scope: DepthScope;
  /** Brief produces no summary at all, so persist-result must not fabricate an
   *  empty one and the response schema must not require it. */
  wantsSummary: boolean;
}

const DENSE: DepthPlan = {
  thinkingLevel: "medium",
  scope: "balanced",
  wantsSummary: true,
};

const PLANS: Record<PersonaDepth, DepthPlan> = {
  brief: {
    thinkingLevel: "low",
    scope: "decisions-and-actions",
    wantsSummary: false,
  },
  dense: DENSE,
  exhaustive: {
    thinkingLevel: "high",
    scope: "cross-referenced",
    wantsSummary: true,
  },
};

export function planForDepth(depth: PersonaDepth): DepthPlan {
  // A depth outside the union cannot come from the database — the column is
  // checked. It can come from DEFAULT_PERSONA_FALLBACK drifting out of step
  // with that column, or from the custom-persona phase DECISIONS.md defers.
  // Dense is the honest default there; a throw would fail a whole cron run
  // over one malformed lens.
  return PLANS[depth] ?? DENSE;
}
