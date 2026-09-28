"use client";

import type { PaneControls } from "./use-note-panes";

/**
 * The two controls that hide and show a pane (issue #23): the hide button in
 * the pane's own header, and the thin strip a hidden pane leaves behind,
 * which holds the one button that brings it back. Both are real buttons with
 * `aria-expanded` and `aria-controls`, named for the pane they control.
 *
 * The strip's visibility is CSS alone, from the `data-pane-*` attribute on
 * `<html>` and the width — never a React `hidden`, which the server would
 * render as "shown" and Tailwind's preflight enforces with `!important`, so
 * the strip would be missing until hydration. Tailwind cannot build those
 * variant classes at runtime, so the caller passes them in whole.
 */

/** Points toward the edge the pane lives on when it hides, away from it
 *  when it shows. `left` is the lens rail's edge. */
function Chevron({ toward }: { toward: "left" | "right" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 10 10"
      className={`h-[10px] w-[10px] ${toward === "right" ? "rotate-180" : ""}`}
    >
      <path d="M6.5 1.5 3 5l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

const TARGET =
  "flex cursor-pointer items-center justify-center text-meta hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";

/** Sits in the pane's header. 24px square: the smallest target WCAG 2.2 AA
 *  allows, and no taller than the header line it sits on. */
export function PaneHideButton({
  label,
  controls,
  expanded,
  onToggle,
  edge,
  hideRef,
}: PaneControls & { edge: "left" | "right" }) {
  return (
    <button
      ref={hideRef}
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={`Hide ${label}`}
      title={`Hide ${label}`}
      onClick={onToggle}
      className={`${TARGET} h-6 w-6 flex-none`}
    >
      <Chevron toward={edge} />
    </button>
  );
}

/** The strip a hidden pane leaves: 28px wide, the full height of the screen,
 *  on the pane's own sheet, with the pane's name written down it so the
 *  reader can see what is folded there. The whole name is the target. */
export function PaneStrip({
  label,
  controls,
  expanded,
  onToggle,
  edge,
  className,
  showRef,
}: PaneControls & {
  edge: "left" | "right";
  className: string;
}) {
  return (
    <div className={`min-h-0 w-[28px] flex-none flex-col ${className}`}>
      <button
        ref={showRef}
        type="button"
        aria-expanded={expanded}
        aria-controls={controls}
        aria-label={`Show ${label}`}
        title={`Show ${label}`}
        onClick={onToggle}
        className={`${TARGET} flex-col gap-[10px] pt-[12px] pb-[14px]`}
      >
        <Chevron toward={edge === "left" ? "right" : "left"} />
        <span className="font-mono text-[9px] tracking-[0.14em] uppercase [writing-mode:vertical-rl]">
          {label}
        </span>
      </button>
    </div>
  );
}
