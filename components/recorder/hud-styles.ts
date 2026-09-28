/**
 * Class strings every HUD piece shares, so the choice, the demo pill and the
 * error pill cannot drift from the pills record-hud.tsx draws itself (#20).
 */

/** A floating pill in the HUD corner. The stack itself ignores the pointer;
 *  each pill takes it back. */
export const PILL =
  "pointer-events-auto flex items-center shadow-[0_8px_24px_var(--shadow-hud)]";

/** DESIGN.md § Buttons → Focus: every interactive element, one idiom. */
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

/** The small mono label on a HUD button — Pause, Stop, Meeting, Cancel. */
export const MONO_ACTION = `font-mono text-[9px] tracking-[0.06em] uppercase cursor-pointer ${FOCUS_RING}`;

/** A ghost button (Discard, Dismiss, Cancel). The transparent border gives it
 *  the framed buttons' height, which clears the 24px target. */
export const GHOST_ACTION = `${MONO_ACTION} text-rail-idle hover:text-ink-2 border border-transparent px-[8px] py-[5px]`;
