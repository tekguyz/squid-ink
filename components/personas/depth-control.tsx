"use client";

import { planForDepth } from "@/lib/notegen/depth-policy";
import { PERSONA_DEPTHS } from "@/lib/notes/persona-config";
import type { PersonaDepth } from "@/lib/notes/view-types";

/**
 * The Brief / Dense / Exhaustive segmented control, and the line under it that
 * says what the choice actually does.
 *
 * DEPTH IS NOT COSMETIC, which is why this is its own file rather than a block
 * inside persona-anatomy.tsx. lib/notegen/depth-policy.ts maps the value onto
 * Gemini's thinking_level and onto a prompt scope, so pressing a segment here
 * changes what every future note under this lens costs and how much analytical
 * work it contains. The derived line is read from planForDepth, never written
 * down, so the screen cannot claim a scope the pipeline does not run.
 *
 * PERSONA_DEPTHS comes from lib/notes/persona-config.ts — the same constant
 * app/notes/actions/configure-persona.ts validates against. Two lists would
 * let this control offer a segment the action refuses.
 *
 * PRESENTATIONAL, and deliberately so. The optimistic value lives one level up
 * in persona-anatomy.tsx because the Output shape row is derived from the SAME
 * depth; owning it here would leave that row a round trip behind, showing
 * "summary ×1" beside a line that had already said "no summary". One
 * optimistic value, two rows that agree.
 */

export function DepthControl({
  value,
  pending,
  message,
  onSelect,
}: {
  value: PersonaDepth;
  pending: boolean;
  /** A refusal from the action, or null. Rendered here rather than swallowed:
   *  the optimistic segment has already snapped back to the row's real depth,
   *  and a silent snap-back reads as the control being broken. */
  message: string | null;
  onSelect: (depth: PersonaDepth) => void;
}) {
  const plan = planForDepth(value);

  return (
    <div>
      <span
        role="group"
        aria-label="Depth"
        className="border-control-edge flex w-fit border"
      >
        {PERSONA_DEPTHS.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              disabled={pending}
              onClick={() => onSelect(option)}
              className={[
                "font-mono px-[13px] py-[6px] text-[10px] capitalize",
                "focus-visible:outline-accent focus-visible:outline-2 focus-visible:-outline-offset-2",
                pending ? "cursor-progress" : "cursor-pointer",
                selected
                  ? "bg-tint text-accent-text"
                  : "text-ink-2 hover:bg-raised",
              ].join(" ")}
            >
              {option}
            </button>
          );
        })}
      </span>

      {/* Derived from planForDepth, so it moves with the segment above it and
          with the pipeline underneath it. */}
      <p className="font-mono text-meta mt-[8px] text-[9.5px] uppercase">
        {value} · {plan.scope} ·{" "}
        {plan.wantsSummary ? "summary included" : "no summary"} · thinking{" "}
        {plan.thinkingLevel}
      </p>

      {message !== null && (
        <p role="alert" className="font-mono text-notice mt-[6px] text-[9.5px]">
          {message}
        </p>
      )}
    </div>
  );
}
