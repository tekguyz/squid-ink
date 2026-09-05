/**
 * The clearance the Record HUD keeps from the viewport edges, and the same
 * clearance anything else that renders against a viewport corner must keep.
 *
 * It exists because two fixed elements independently claimed bottom-right and
 * neither knew about the other (docs/KNOWN_GAPS.md). The HUD owns that corner
 * by design — drag/snap-to-corner was considered and rejected — so the rule is
 * "the HUD sits here, everyone else sits this far away from it", and one value
 * has to say so in a single place or the two drift apart again.
 *
 * A plain length rather than a Tailwind class: Tailwind cannot build a class
 * name at runtime, so a shared spacing step could only be shared as a string
 * both files paste into their own class list — which is the duplication this
 * constant is here to remove. Applied through `style`, there is exactly one
 * literal and both call sites read it.
 */
export const HUD_SAFE_MARGIN = "24px";
