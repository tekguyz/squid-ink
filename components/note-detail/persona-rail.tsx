"use client";

import type { Persona } from "@/lib/notes/view-types";

export interface PersonaRailProps {
  personas: Persona[];
  selectedId: string;
  quickActions: string[];
  spansLinked: number;
  onSelect: (personaId: string) => void;
}

const LABEL =
  "font-mono text-[8.5px] tracking-[0.14em] uppercase text-meta";

export function PersonaRail({
  personas,
  selectedId,
  quickActions,
  spansLinked,
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
              title={persona.sub}
              onClick={() => onSelect(persona.id)}
              className={[
                "cursor-pointer border-l-2 px-[11px] pt-2 pb-[9px] text-left",
                "font-header text-sm font-semibold leading-[1.25]",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                selected
                  ? "border-accent bg-paper text-ink"
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

      <div className="mt-auto border-t border-rule px-3 py-[11px] font-mono text-[9px] leading-[1.7] text-meta">
        grounding
        <br />
        <span className="text-accent">{spansLinked} spans linked</span>
      </div>
    </div>
  );
}
