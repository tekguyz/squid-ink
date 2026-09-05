"use client";

import { THEME_TOGGLE_LANE } from "@/components/theme-toggle";
import type { Persona } from "@/lib/notes/view-types";

export interface PersonaRailProps {
  personas: Persona[];
  selectedId: string;
  quickActions: string[];
  spansLinked: number;
  /** True once the note's lens is frozen — generation has been committed to,
   *  either by reaching notegen_status or by Transcribe having been pressed.
   *
   *  The lens a note generated under is a FACT about that note, not a filter
   *  over it: docs/DECISIONS.md § Personas rejected regeneration on
   *  2026-08-30. This is the UX half of enforcing that; the half that actually
   *  holds is the guarded UPDATE in app/notes/actions/persona.ts. */
  locked: boolean;
  onSelect: (personaId: string) => void;
}

const LABEL =
  "font-mono text-[8.5px] tracking-[0.14em] uppercase text-meta";

/** A NATIVE `disabled`, not the `aria-disabled` transcribe-button.tsx uses.
 *  The difference is deliberate and worth stating, because the two controls
 *  sit on the same screen and look inconsistent otherwise.
 *
 *  That button stays focusable because it has something to announce — a
 *  'failed' note's prose explains an outcome the reader needs. A locked lens
 *  announces nothing a screen reader does not already get from aria-selected,
 *  so removing it from the tab order costs no information and correctly says
 *  "this is not actionable". */

export function PersonaRail({
  personas,
  selectedId,
  quickActions,
  spansLinked,
  locked,
  onSelect,
}: PersonaRailProps) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden border-r border-rule bg-rail pt-3.5">
      <div className={`px-3 pb-2.5 ${LABEL}`}>Lens</div>

      <div role="tablist" aria-label="Summary lens" className="flex flex-col">
        {personas.map((persona) => {
          const selected = persona.id === selectedId;
          return (
            <button
              key={persona.id}
              type="button"
              role="tab"
              aria-selected={selected}
              disabled={locked}
              title={persona.sub}
              onClick={() => onSelect(persona.id)}
              className={[
                "border-l-2 px-[11px] pt-2 pb-[9px] text-left",
                "font-header text-sm font-semibold leading-[1.25]",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                locked ? "cursor-default" : "cursor-pointer",
                selected
                  ? // The selected lens keeps full contrast even when locked.
                    // It is reporting which lens generated this note, and
                    // dimming it would hide the answer along with the control.
                    "border-accent bg-paper text-ink"
                  : locked
                    ? "border-transparent text-placeholder"
                    : "border-transparent text-rail-idle hover:bg-raised",
              ].join(" ")}
            >
              {persona.name}
            </button>
          );
        })}
      </div>

      <div className="cursor-pointer border-l-2 border-transparent px-[11px] pt-2 pb-[9px] font-header text-sm font-semibold text-placeholder">
        + New lens
      </div>

      <div className={`mt-[22px] px-3 pb-2 ${LABEL}`}>Actions</div>
      <div className="flex flex-col gap-1 px-2.5">
        {quickActions.map((action) => (
          <button
            key={action}
            type="button"
            className="cursor-pointer border border-rule-2 bg-raised px-2 py-1.5 text-left text-[11.5px] leading-[1.35] text-ink-2 hover:bg-paper focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            {action}
          </button>
        ))}
      </div>

      {/* The theme toggle is fixed in this corner, and the rule around the
          Record HUD's corner applies here too: reserve a lane rather than let
          two elements land on the same pixels by render order. The reserved
          height is declared next to the toggle itself, not restated here. */}
      <div
        style={{ paddingBottom: THEME_TOGGLE_LANE }}
        className="mt-auto border-t border-rule px-3 pt-[11px] font-mono text-[9px] leading-[1.7] text-meta"
      >
        grounding
        <br />
        <span className="text-accent">{spansLinked} spans linked</span>
      </div>
    </div>
  );
}
