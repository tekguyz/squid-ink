import type { Persona } from "./view-types";

/** The slug of the persona selected on mount. A slug, not a uuid, because the
 *  uuid is per-user and changes on reseed. */
export const DEFAULT_PERSONA_ID = "neutral-analyst";

/** Rendered only when the signed-in user has no personas rows at all — a new
 *  account before its personas are provisioned. Without it the rail would
 *  render zero lenses and the shell would read a persona off an empty array.
 *  It is a crash floor, not a preset list: the four real personas are rows. */
export const DEFAULT_PERSONA_FALLBACK: Omit<Persona, "takeaways"> = {
  id: DEFAULT_PERSONA_ID,
  name: "Neutral Analyst",
  sub: "dense · no framing",
  depth: "dense",
  actions: [
    "Extract decisions only",
    "Timeline of blockers",
    "Unanswered questions",
    "Diff against last call",
  ],
};
