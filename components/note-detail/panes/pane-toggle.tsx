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
  shortcut,
  hideRef,
}: PaneControls & { edge: "left" | "right" }) {
  return (
    <button
      ref={hideRef}
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={`Hide ${label}`}
      aria-keyshortcuts={shortcut}
      title={`Hide ${label}  ${shortcut}`}
      onClick={onToggle}
      className={`${TARGET} h-6 w-6 flex-none`}
    >
      <Chevron toward={edge} />
    </button>
  );
}

/** The strip a hidden pane leaves: 28px wide, the full height of the screen,
 *  on the pane's own sheet, with the pane's name written down it so the
 *  reader can see what is folded there. The whole strip is the target. */
export function PaneStrip({
  label,
  controls,
  expanded,
  onToggle,
  edge,
  className,
  shortcut,
  showRef,
}: PaneControls & {
  edge: "left" | "right";
  className: string;
}) {
  return (
    // Below 768px (issue #91) only the transcript's strip shows, and it is the
    // bottom band instead: one outlined button at the band's left, the
    // recorder's pill at its right.
    <div className={`min-h-0 w-[28px] flex-none flex-col max-md:w-full max-md:flex-row max-md:items-center max-md:border-t max-md:border-rule-strong max-md:bg-canvas max-md:px-[16px] ${className}`}>
      <button
        ref={showRef}
        type="button"
        aria-expanded={expanded}
        aria-controls={controls}
        aria-label={`Show ${label}`}
        aria-keyshortcuts={shortcut}
        title={`Show ${label}  ${shortcut}`}
        onClick={onToggle}
        className={`${TARGET} flex-1 flex-col justify-start gap-[10px] pt-[12px] pb-[14px] max-md:h-[40px] max-md:flex-none max-md:flex-row max-md:gap-[8px] max-md:border max-md:border-control-edge max-md:bg-raised max-md:px-[12px] max-md:py-0 max-md:text-ink-2`}
      >
        <Chevron toward={edge === "left" ? "right" : "left"} />
        <span className="font-mono text-[9px] tracking-[0.14em] uppercase [writing-mode:vertical-rl] max-md:text-[11px] max-md:tracking-[0.1em] max-md:[writing-mode:horizontal-tb]">
          {label}
        </span>
      </button>
    </div>
  );
}
