import type { ReactNode } from "react";

/**
 * The pieces every onboarding step repeats: the 26px Bitter title with its
 * lede, and the action row pinned to the bottom of the pane.
 * Presentational; no state.
 */

export function StepHeader({ title, lede }: { title: string; lede: string }) {
  return (
    <header className="mt-[8px]">
      <h2 className="font-header text-ink text-[26px] leading-[1.18] font-semibold tracking-[-0.012em]">
        {title}
      </h2>
      <p className="font-body text-muted mt-[9px] max-w-[520px] text-[13.5px] leading-[1.6]">
        {lede}
      </p>
    </header>
  );
}

export function StepActions({ children }: { children: ReactNode }) {
  return <div className="mt-auto flex items-center gap-[12px] pt-[20px]">{children}</div>;
}

/** Disabled only while busy, so it keeps its fill (issue #22): busy is a
 *  status, not "unavailable". Callers set `aria-busy` with `disabled`. */
export const PRIMARY =
  "bg-accent text-on-accent hover:bg-accent-pressed focus-visible:outline-accent cursor-pointer px-[16px] py-[9px] font-mono text-[10.5px] font-medium tracking-[0.08em] uppercase focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-progress";

/** Add to a button that is disabled because ANOTHER one is working: it is
 *  unavailable, not busy (issue #22). The pressed one keeps its look. */
export const UNAVAILABLE =
  "disabled:border-rule-2 disabled:bg-raised disabled:text-ink-disabled disabled:hover:bg-raised";

/** Only ever disabled while it or its sibling is busy; see UNAVAILABLE. */
export const SECONDARY =
  "border-control-edge text-ink-2 hover:bg-raised focus-visible:outline-accent cursor-pointer border px-[16px] py-[8px] font-mono text-[10.5px] tracking-[0.08em] uppercase focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-progress";
