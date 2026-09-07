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

/**
 * The height of the strip the HUD occupies at the bottom of the viewport: the
 * margin above, plus the idle pill itself.
 *
 * A SCROLLING region whose bottom edge is the viewport bottom cannot avoid the
 * HUD by padding its content — padding only moves the last row, and at any
 * other scroll position a row is still passing underneath. The region has to
 * END above the strip. That is what this value is for, and why it is a length
 * rather than the margin alone.
 *
 * 24px of margin plus a 40px idle pill is 64px; the value is 72px so the two
 * edges are 8px apart rather than the 0.15px an exact sum leaves — the pill
 * measures 39.85px in the browser (9px marker, 9px padding, a 13.5px Bitter
 * line), and a sub-pixel clearance is not a clearance.
 *
 * The recording and error phases are taller, and are deliberately allowed to
 * overhang the reserve — they exist for seconds to minutes, they are what the
 * user is looking at, and reserving for the tallest phase would leave a
 * permanent gap on every screen for a state that is normally not on it.
 */
export const HUD_RESERVE = "72px";
