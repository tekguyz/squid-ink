import type { PersonaDepth } from "./view-types";

/**
 * What a valid persona CONFIGURATION is — the depths, the quick-action cap,
 * and the two predicates that decide both.
 *
 * ONE MODULE, imported by both sides on purpose. The Server Action in
 * app/notes/actions/configure-persona.ts validates against these, and
 * components/personas/ renders the same cap in its own copy. Written down
 * twice they drift, and the failure that drift produces is the worst kind: a
 * UI that offers a seventh quick action and an action that silently refuses
 * it. Both test suites assert against MAX_QUICK_ACTIONS imported from here
 * rather than against a written-down 6, so raising the cap moves the tests
 * with it instead of failing them.
 *
 * CLIENT-SAFE BY DESIGN, the same requirement lib/notes/default-persona.ts
 * carries. It pulls in no Supabase client, so a client component importing
 * MAX_QUICK_ACTIONS does not drag the server client into the browser bundle.
 */

/** The three depths, in the order the segmented control renders them.
 *
 *  MIRRORS personas_depth_check in supabase/schemas/personas.sql. The column's
 *  check constraint is the floor, not the guard: a Server Action is a public
 *  HTTP endpoint, so a bad value must be refused before the database sees it,
 *  with an outcome the caller can read rather than a Postgres error string. */
export const PERSONA_DEPTHS: readonly PersonaDepth[] = [
  "brief",
  "dense",
  "exhaustive",
] as const;

export function isPersonaDepth(value: unknown): value is PersonaDepth {
  return (
    typeof value === "string" &&
    (PERSONA_DEPTHS as readonly string[]).includes(value)
  );
}

/** The most quick actions one persona may carry.
 *
 *  A PRODUCT LIMIT, not a database one — personas.quick_actions is an
 *  unbounded text[]. The rail in components/note-detail/persona-rail.tsx
 *  renders every one of them in a fixed-height column beside the transcript,
 *  and six is what fits there without the column scrolling. It is enforced in
 *  the action and surfaced in the UI, never left to fail silently. */
export const MAX_QUICK_ACTIONS = 6;

/** The longest one quick action may be. The rail renders these as buttons at
 *  11.5px in a 236px column; past this they wrap to a third line. */
export const MAX_QUICK_ACTION_LENGTH = 60;

/** The stored form of a typed quick action, or null when it is not one.
 *
 *  Trims first, so " " is empty rather than a one-space action, and collapses
 *  runs of whitespace so two actions cannot differ only by a double space —
 *  which would defeat the duplicate check below and break React's key on the
 *  list that renders them. */
export function normalizeQuickAction(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_QUICK_ACTION_LENGTH) return null;
  return trimmed;
}
